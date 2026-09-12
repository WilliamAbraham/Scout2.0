# Scout — Product Design

**Date:** 2026-09-12
**Status:** Design agreed, not yet implemented
**Scope:** Whole-product vision, with the hackathon execution split and milestones in §§8–9. Those sections narrow the demo scope; the broader features below remain future product work.

> This is an MVP. Designs favor the simplest thing that works. Subsystems are
> deliberately shallow, and several known-imperfect behaviors are accepted.

---

## 1. What Scout is

Scout automates the NYC apartment hunt end to end. A user connects their Gmail
and Google Calendar, sets up saved-search alerts on StreetEasy and
Apartments.com themselves, and fills in a search profile. From then on Scout
runs unattended: it reads the alert emails, decides which listings are worth
pursuing, finds the broker, emails them from the user's own account, negotiates
a tour, books it on their calendar, and sends the application packet when asked.

The user watches on a dashboard and is pulled in only when the agent genuinely
cannot proceed.

Scout is multi-tenant from day one. Today's pipeline is single-user and
file-based; that is the first thing to change.

---

## 2. Core loop

1. **Onboard** — sign up, connect Gmail (read + send) and Calendar, build a
   search profile.
2. **Ingest** — alert emails arrive in the user's inbox; Scout parses the
   listing cards out of them.
3. **Match** — each new listing is scored against the profile. Matches become
   *pursuits*.
4. **Enrich** — resolve the broker's contact details from the brokerage's own
   website.
5. **Outreach** — the agent writes and sends the first email from the user's
   Gmail, asking for a tour.
6. **Converse** — broker replies are handled autonomously: answering questions,
   proposing times, following up.
7. **Schedule** — a confirmed tour is written to the user's Google Calendar.
8. **Apply** — when a broker requests an application, the agent sends the
   stored packet.
9. **Escalate** — anything it cannot do lands in the dashboard's **Needs you**
   queue.

---

## 3. Automation boundary

Everything runs unattended except the escalations below. This boundary is the
product — it is what the user is trusting us with — so it is defined
explicitly rather than left to the agent's judgment.

| Stage | Automated | Escalates when |
|---|---|---|
| Parse listing, score against profile | Always | — |
| Find broker contact | Yes | No contact recoverable |
| Send tour request, handle replies | Yes | Broker asks something the profile cannot answer |
| Schedule tour | Yes — books on calendar | No offered slot fits availability |
| Send application packet | Yes — by email | Broker sends a **portal link**; or a required document is missing |
| Lease / final decision | No | Always — a human decides |

### `needs_human`

Escalation is **not** a pipeline stage. A pursuit carries its stage *and* a
separate `needs_human` flag with a reason, because a pursuit can be
mid-conversation and blocked at the same time.

The dashboard's **Needs you** queue is every pursuit with the flag set. It is
the first thing on screen. Resolving an item clears the flag and hands control
back to the agent.

Reasons, each of which needs a matching resolve-flow in the UI:

- `no_contact` — supply a contact, or skip this listing
- `unanswerable_question` — answer it; the answer is also written back to the profile
- `no_fitting_slot` — pick from the offered times, or widen availability
- `portal_link` — complete the third-party application yourself
- `missing_document` — upload the missing item
- `decision` — the application was approved or rejected

---

## 4. Feature inventory

### Ingestion
- Per-user Gmail OAuth (read + send scopes), tokens stored in the database.
- Incremental sync via Gmail `historyId`.
- One parser per alert sender. StreetEasy exists; Apartments.com is next.
- Listings deduplicated on `rental_id`.

### Search profile
- Budget, bedrooms, bathrooms, neighborhoods, must-haves, dealbreakers.
- Tour availability windows (e.g. "nothing before 5pm on weekdays").
- Free-text preferences the agent can quote when a broker asks a question.
- Answers captured from `unanswerable_question` escalations are written back
  here, so the same question is never asked twice.

### Matching
- Each new listing is scored against the profile by the LLM.
- Matches create a pursuit. Non-matches remain visible in the feed.

### Contact enrichment
See §6 — this is the highest-risk subsystem.

### Outreach agent
- Composes and sends the opening tour request from the user's Gmail.
- Handles every broker reply autonomously until an escalation trigger fires.
- Stateless per turn; see §5.

### Scheduling
- Google Calendar free/busy read, constrained by the profile's availability
  windows.
- Confirmed tours written as calendar events.

### Documents and applications
- Upload and store application materials (ID, pay stubs, employment letter,
  bank statements, references, guarantor info).
- The agent attaches and sends the packet by email autonomously.
- A link to a third-party application portal always defers to the user. The
  agent must therefore be able to recognize a portal link in a reply.

### Application tracker
- Second dashboard tab. Stages are driven by agent activity, not manual entry:
  `contacted → tour scheduled → toured → applied → decision`.

### Natural-language search
- Plain-English query over the user's own saved listings ("the ones under 4k
  with a dishwasher I haven't toured yet").
- The LLM writes a SQL `where` clause against the listing columns. No vector
  search — the data is structured.

### Roommates
- Invite by email. Invitees see the same listings and tracker, and upload their
  own documents into the shared packet.
- No roles or permissions. The agent always runs off the account owner's Gmail
  and calendar, which avoids the question of whose identity is sending mail.

---

## 5. Pipeline design

A single worker process wakes every few minutes and, for each user:

1. **Sync** — incremental Gmail pull via `historyId`.
2. **Route** each new message: listing alert (known sender), broker reply
   (matches a stored `thread_id`), or noise.
3. **Alert path** — parse cards → upsert listings on `rental_id` → score new
   ones against the profile → matches create a pursuit.
4. **Enrich** — resolve the broker contact (cache hit, else fetch → extract →
   Playwright fallback) → resolved, or `needs_human: no_contact`.
5. **Open** — the LLM writes the first email → send via Gmail API → store the
   returned `thread_id` on the pursuit.
6. **Reply path** — load the thread and pursuit state → one LLM call with tools
   → act.

**Agent tools:** `check_availability`, `book_tour`, `send_reply`, `send_packet`,
`escalate`, `mark_dead`.

### Three mechanics that matter

**Thread identity is the Gmail `thread_id`,** stored on the pursuit. That is the
entire join between an inbound reply and the state it belongs to.

**Idempotency is mandatory.** Polling is at-least-once. A `processed_messages`
table keyed on Gmail message id makes it effectively-once. Without it a retry
emails a broker twice from the user's real address.

**The agent is stateless per turn.** State lives in Postgres, context is the
email thread, and each inbound reply is one LLM call with tools. There is no
session to hold in memory and no long-running agent process — which is why no
agent framework is needed.

### Send cap

A per-user daily send cap. The reference corpus averages ~3 listings/day, but a
loose profile could fire dozens of emails in a morning from someone's personal
Gmail. That risks the user's real account, so the cap is a hard guardrail rather
than a tuning knob.

---

## 6. Contact enrichment

The riskiest subsystem, and the one most changed by looking at real data.

### What the corpus shows

280 listings across 86 alert emails, **60 distinct brokerages**:

| Adapters | Coverage |
|---|---|
| 12 brokerages | 62% |
| 20 | 77% |
| 40 | 93% |
| 60 | 100% |

**24 of the 60 brokerages appear exactly once.**

### Consequences

**Do not scrape StreetEasy.** A plain fetch of a rental page returns 403. It is
also unnecessary: the alert email already carries address, price, beds, baths,
and brokerage, and `resolveRentalUrl` only reads `Location` headers off the
redirect chain without ever loading the protected page. Keep it that way.

**Do not write per-brokerage adapters.** The `names.ts` plan proposed a
brokerage registry with an extraction adapter each. That is 60 scrapers for one
user's three months of mail, and a different 60 for the next user. Instead use
**one generic extraction path**: fetch the brokerage page, hand the text to the
LLM, ask for agent name, email, and phone. One code path, and the long tail
costs nothing extra.

**Fetch first; Playwright is a fallback.** Most NYC brokerage sites are small
templated builds that render server-side, so `fetch` + cheerio gets the HTML.
Playwright costs ~300MB of RAM per browser and seconds per launch. Use it only
when a plain fetch returns a shell with no content.

**Cache the brokerage, not the agents.** The brokerage's website, general
leasing address, and email pattern are stable and reused — 280 listings collapse
to 60 such lookups. The *set of agents* is per listing and is not cacheable.

**Use the office address.** 84% of listings carry the brokerage's office address
in parentheses — `REAL New York (29 West 30th Street, ...)`. It disambiguates
similarly-named firms and helps identify the right website.

### Extract every agent on the listing

Capture **all** agents the source explicitly attaches to the listing, not just
the first one. NYC rentals are frequently co-listed, and reaching only one agent
of a pair is how a thread goes unanswered.

Rules, carried over from the original `names.ts` plan:

- Capture every name with its profile URL, preserving the order on the page.
- Deduplicate on profile URL first, then on normalized name within the listing.
- Record primary/secondary **only** where the source explicitly labels it;
  otherwise role is unspecified. First on the page does not mean primary.
- Exclude navigation, "suggested agents", unrelated team members, and generic
  inquiry contacts that carry no listing attribution.
- Preserve team or company labels separately. Never invent a personal name.

### Tiered resolution

1. **All agents** attached to the listing on the brokerage's own listing page
2. The brokerage's general leasing address
3. `needs_human: no_contact`

Tier 2 requires no listing-level matching at all and nearly always resolves, so
it is the floor the agent can always fall back to.

### One listing, one thread

A pursuit sends **one email addressed to every resolved agent** — primary in
`To`, co-agents in `Cc` — not one email per agent.

This is not a stylistic choice. The entire pipeline joins inbound replies to
state on the Gmail `thread_id` (§5). Separate emails would create separate
threads for one apartment, splitting a single pursuit across several
conversations that the agent would then handle as if they were unrelated. It
also avoids three near-identical emails about one apartment landing on a
co-listing team, which is what makes a sender look automated.

Any agent's reply lands in the same thread and advances the same pursuit.

### Shape

Two tables, reflecting the different lifetimes:

- `brokerages` — name, office address, website, general leasing email. Cached
  and reused across listings.
- `listing_agents` — per listing: name, email, phone, profile URL, source order,
  and role only where explicitly labeled.

### Ambiguous cases observed in real data

- **`Owner`** — FSBO, no brokerage exists. No path; escalate.
- **Property managers** (Greystar, Monday Morning Management, Centennial) —
  multifamily leasing offices, not agent profiles. The contact is an office,
  not a person.
- **An individual as the brokerage** (`Denise Rosenblum, LREB`) — easiest case;
  the name is already the contact.
- **Near-identical firm names** — `REAL New York` and `R New York` are different
  companies. Never fuzzy-match brokerage names.
- **No office address** (16% of listings) — hardest to disambiguate.

---

## 7. Tech stack

Already set by the repo: Node 24 + TypeScript (strict, `.ts` run directly), npm
workspaces, Postgres/Supabase + Drizzle, Next.js 16 App Router + React 19 +
Tailwind v3 + shadcn/ui, Supabase Auth, `googleapis`, Playwright, cheerio.

| Need | Choice |
|---|---|
| LLM | **OpenAI API** — matching, email composition, reply handling, portal-link detection, contact extraction, NL search |
| Agent loop | **No framework.** One call per inbound reply with tools; state in Postgres |
| Email sending | **Gmail API** via existing `googleapis`; replies threaded with `In-Reply-To` / `References` |
| Background work | **One Node worker on Railway**, polling loop. No queue, no Pub/Sub push |
| Documents | **Supabase Storage** |
| NL search | **LLM → SQL filter** over listing columns |
| Hosting | **Vercel** (frontend) + **Railway** (worker) + **Supabase** (DB, auth, storage) |

Playwright stays, demoted to an enrichment fallback tier.

---

## 8. Two-person hackathon split

**Demo goal:** one connected owner goes from a StreetEasy alert to a matched
listing, verified broker contact, tour-request conversation, and, if time permits,
a confirmed calendar event. Show a real **Needs you** case as well as the happy
path. Multi-tenant onboarding, Apartments.com, roommates, application packets,
and natural-language search are outside the hackathon critical path.

This is a recommended execution plan added for the hackathon. It does not claim
that the whole-product functionality above is implemented. Assume both people
can work in TypeScript; give Person A the stronger scraping/agent experience
and Person B the stronger full-stack/product experience.

### First 45–60 minutes — together

Agree the smallest shared contract before coding independently:

- One restricted demo owner and the Google account used for the demo. Existing
  local credentials may support a controlled local demo; hosted credentials
  stay server-only. Public multi-user access is not part of this shortcut.
- A profile with budget, beds, preferences, timezone, and tour windows.
- Listing/pursuit records with listing facts, match explanation, contact evidence,
  stage, blocker reason, thread reference, and optional calendar event reference.
- Demo stages: `matched → ready_to_contact → contacted → tour_scheduled`, plus
  `closed`. `needs_human` remains separate. Do not mark a tour as attended merely
  because its scheduled time passed.
- Commands: save profile, request outreach, resolve a blocker, and pause a pursuit.
  Define their input/output shapes and allowed state transitions. The worker
  owns action outcomes; the UI submits commands rather than pretending a send
  or booking succeeded.
- Three seed scenarios using the same shapes as live data: ready to contact,
  missing contact, and tour scheduled. Record which are fixtures in the demo.

Write this contract in `docs/hackathon-contract.md` during implementation;
that file is a planned deliverable, not an existing API. A owns the Drizzle
migration; B reviews it. Both review contract changes before either depends
on a new field or enum. Do not spend this session designing future subsystems.

### Person A — listing intelligence and Gmail conversation

**Owns:** ingestion, parsing, matching, brokerage discovery and verification,
contact extraction, Gmail send/reply integration, and the polling worker.

Deliver in this order:

1. Use a cached StreetEasy alert to persist a listing and pursuit that B can
   display. Start with deterministic budget/bed filters; add LLM preference
   scoring only where useful.
2. Prove the riskiest step early: find the correct current unit and a verified
   contact on a representative brokerage page. Store the source and fall back
   to `needs_human: no_contact` when evidence is insufficient.
3. Generate a tour-request draft with recipients and persist it. Wire the
   outreach command to Gmail, record the result/thread, and do not blindly
   retry an uncertain send. A visible manual-review outcome is enough for the
   demo; a generalized distributed job system is unnecessary.
4. Process one broker reply into a proposed slot, a response, or an escalation.
   Invoke B's calendar functions when confirmation and availability permit.
5. Replace cached ingestion with live polling after the persisted path works.

**First handoff:** one real parsed listing in the agreed shape, followed by a
pursuit with contact evidence and an outreach draft. Do not wait for a complete
agent before handing data to B.

A primarily edits `backend/`. A owns the worker's stage transitions and Gmail
credentials/integration. Avoid broad brokerage coverage until one path works.

### Person B — full-stack demo experience and calendar tools

**Owns:** the minimal profile screen, listings/pursuit dashboard, detail view,
**Needs you** resolve flow, authenticated UI reads/commands, and Calendar
availability/booking integration.

Deliver in this order:

1. Build the screens against the shared seed scenarios: listing facts, why it
   matched, contact/source, email draft, current stage, and the next action.
   Reuse the existing auth scaffold; custom multi-user onboarding can wait.
2. Connect reads and commands to the shared database contract. Implement server
   authorization for the demo owner. Persist commands for A's worker; never
   expose service credentials or send Gmail directly from the browser.
3. Make the missing-contact flow work end to end: supply a contact or close the
   pursuit. Include a pause control and surface failed/uncertain actions.
4. Implement server-only `checkAvailability` and `bookTour` functions in an
   agreed calendar module under `backend/`; A integrates calls from the worker.
   Both agree arguments/results before implementation. Use explicit timezone,
   duration, confirmation, and persisted event identity; surface uncertain
   booking results instead of automatically repeating the write.
5. Own frontend deployment, demo account setup, and the demo script. A owns the
   worker startup/deployment. Test the actual deployed connection together.

B primarily edits `frontend/` but also owns the agreed calendar module. This
balances the work and avoids leaving all external integrations with A. Folder
boundaries are a coordination aid, not a ban on full-stack work.

### Coordination rules

- A owns schema/migrations and the worker; B owns UI/server commands and calendar
  functions. Agree shared root configuration changes before editing them.
- Integrate as soon as the first persisted pursuit exists. Seeded screens must
  use the real contract, not a separate mock shape that needs a late rewrite.
- Keep each deliverable on a small feature branch/PR. Merge usable increments;
  do not leave two giant branches until the final hour.
- No new feature until the current milestone runs through both tracks. If A is
  blocked on scraping, use the explicit manual-contact resolve flow; if Calendar
  is unfinished, show a confirmed proposed tour without claiming it was booked.

---

## 9. Hackathon build order and cut line

Use milestones rather than fixed days because the hackathon duration is not
specified. Reserve roughly the final quarter of the available time for
integration, deployment, and rehearsing the demo.

| Milestone | Person A | Person B | Together, verify |
|---|---|---|---|
| 0: contract | Minimal schema and seed data | Screens/commands and calendar interface | Both consume the same fixture shapes |
| 1: alert to dashboard | Parse and match one cached alert | Profile and persisted pursuit view | A's actual row appears in B's UI |
| 2: contact to outreach | Verified contact, draft, Gmail action | Contact evidence, outreach control, blocker resolution | One authorized email sends and the real result appears |
| 3: reply to tour | Read reply and invoke calendar tools | Availability/booking functions and tour state | One controlled reply produces the expected action or escalation |
| 4: rehearsal | Live ingestion and worker startup | Deployment and demo narrative | Repeat the demo without duplicate sends; show a missing-contact case |

**Minimum convincing demo:** alert → match → verified or explicitly supplied
contact → one tour email → visible reply/state update. Calendar booking is the
first extension. A fixture replay is a legitimate backup when clearly labelled;
it must not masquerade as live broker activity.

**Cut first if behind:** visual polish beyond readability, additional brokerage
coverage, rich onboarding, and automatic follow-ups. Do not add Apartments.com,
roommates, natural-language search, or sensitive application sending before this
path works. Do not spend the remaining time implementing production-wide
multi-tenancy or a general retry framework for features the demo does not use.

**Demo correctness checks:** correct apartment/unit and recipient, owner-only
access, no blind retry of an uncertain send/booking, and dashboard stages backed
by recorded outcomes. Use a controlled recipient for rehearsals; a live broker
response is not a dependable dependency for the presentation.

---

## 10. Out of scope for v1

- Scraping StreetEasy listing pages
- Per-brokerage scraper adapters
- Vector / embedding search
- Roommate roles and permissions
- SMS or phone outreach — email only
- Agent-completed third-party application portals
- Lease signing
