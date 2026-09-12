# Scout hackathon: where A and B stand, and what B has left

Written 2026-09-12 from a read of `main` (A's pipeline, through `bbc3abf`) and `origin/codex/implement-pursuit-inbox` (B's dashboard, through `f7ace0f`). Everything below is from source and the two branches' `context.md`; nothing was re-run.

Roles are as in the design spec §8: A owns `backend/`, schema/migrations, Google integrations, and the worker. B owns `frontend/`, server-side dashboard authorization, and command submission.

## B implementation update — 2026-09-12

The handoff below is the original assessment. B's current implementation is on `codex/more-enrichment-on-frontend` and is recorded in [the implemented contract](hackathon-contract.md).

- Main/schema integration is complete. Server actions now support owner-authorized contact supply, close pursuit and profile pause/resume with stale-state and failed-write handling. Contact supply uses the address directly for a future worker cycle; no verification step or separate request-outreach flag exists.
- Conversation renders stored draft recipients, subject and body as **Draft · Not sent**. The reader handles event payloads, user-supplied contact evidence, follow-up metadata and valid `{start,end}` tour events without inventing location or calendar confirmation.
- All blocker reasons have explicit UI states. Only no-contact resolution has a worker-compatible write path; the other five remain labeled placeholders. Availability changes do not clear a blocked pursuit.
- Live controls refresh server records and retain pending/error/success feedback. The original proposal to infer a Gmail connection from missing metadata was rejected: the UI reports status as unavailable/not reported.
- The [demo and deployment runbook](demo-runbook.md) is prepared. Owner login, successful real-row mutation/RLS verification and an actual hosting deployment remain pending. The browser is still signed out; no credential or session was manufactured. A must also scope the shared-mailbox worker to its owner before multi-user deployment, and guard in-flight writes before dependable cancellation.

## 1. Where A's pipeline is

The worker runs end to end against Postgres in one cycle: Gmail alert sync → `listings` / `user_listings` upsert → deterministic budget/bedroom match against `search_profiles` → `pursuits` row → broker enrichment → `contact_snapshot` or `needs_human = no_contact` → outreach draft.

Facts B can rely on today:

- **Entry point:** `npm run worker -- --once`. Dry-run is the default and `--live` is refused until Gmail sending exists.
- **Persistence adapter:** `backend/src/pipeline/postgresStore.ts`. It writes `listings`, `user_listings` (with `is_match` and `match_reason`), `pursuits`, and `pursuit_events`.
- **Events written so far:** `created`, `enriched`, `escalated`, `draft_composed`. Outside dry-run, also `email_sent`, `follow_up_scheduled`, `tour_booked`, `packet_sent`, `stage_changed`. The list is `EVENT` in `postgresStore.ts`.
- **The draft lives in the event payload.** `draft_composed` is written once per pursuit and carries the composed email in `pursuit_events.payload`.
- **Live DB state:** migrations `0001` to `0003` applied. Two cycles produced nine listings and nine pursuits, all `no_contact` because enrichment found no verified email. One pursuit seeded with an `example.com` contact has a `draft_composed` event.
- **Demo owner:** `search_profiles` is bootstrapped for `SCOUT_OWNER_USER_ID`. The live Supabase project has a seeded user `scout-demo@example.com` (`6d859f4e-413e-44f1-9279-3c92b15a7b06`) inserted directly into `auth.users` with **no password**.
- **Not written by the worker:** `gmail_accounts`. The worker still uses the single-user `token.json` at repo root.

A's next steps: real `sendMail` via Gmail (needs `gmail.send` scope and re-consent), per-user tokens from `gmail_tokens`, reply routing, then flip the worker out of dry-run.

## 2. Where B's dashboard is

On `origin/codex/implement-pursuit-inbox` (unmerged, five commits ahead of the shared base, and missing A's last three commits).

Done:

- **Public `/`:** fixture inbox with grouped rows, Active / All / Closed, Needs you shortcut, map, action-first detail pane, overview / conversation / activity tabs. Demo receipts change local state only.
- **Authenticated `/dashboard`:** session check via `supabase.auth.getClaims()`, anonymous users redirect to `/auth/login`. One user-filtered SELECT over `user_listings` → `listings` → `pursuits` → `pursuit_events`, plus Gmail health from `gmail_accounts` and the profile.
- **Projection layer** (`frontend/components/dashboard/inbox-records.ts`): maps DB rows to the inbox model and deliberately refuses to fabricate send state, tour time, or next action.
- **Search preferences panel** on `/` and `/dashboard`. Server action `frontend/app/actions/profile.ts` upserts only user-editable criteria for the session owner. This is the only live write B has.
- **Tests:** 8 frontend projection/transition tests, typecheck and production build pass. Frontend lint still has the two known violations in `theme-switcher.tsx` and `tailwind.config.ts`.

Never verified: authenticated data loading against real rows, RLS behaviour on the deployed project, deployment.

## 3. What B has left, in spec order

Spec §8 gives B five deliverables. Item 1 is done, item 2 is half done, items 3 to 5 are not started.

### 3.1 Merge and verify against A's schema

B's branch predates A's persisted worker, migrations `0002` / `0003`, and the follow-up columns (`next_follow_up_at`, `follow_up_count`). Merge `main` into the dashboard branch, then load `/dashboard` as the owner of A's nine real pursuits. This is the first time the live reader will have seen real rows.

### 3.2 Commands (spec item 2)

No pursuit command path exists. Needed:

- request outreach
- resolve a blocker
- pause / resume (the panel reads `paused_at` but never writes it)

There is no `commands` table. The `pursuits_update_own` RLS policy already allows the owner to update their own pursuit rows, so the cheapest contract is **direct updates from a server action**, with the worker reading the changed columns on its next cycle. See §4 for the proposal.

### 3.3 Needs you resolve flow, end to end (spec item 3)

The live blocker UI renders (`mode === "live" && blocker`) but has no submit. Needed for `no_contact`, which is the only reason the demo exercises:

- **Supply a contact:** write `contact_snapshot` and clear `needs_human_reason` / `needs_human_note` / `needs_human_at` together. The DB has a check constraint that reason and timestamp are set or null together.
- **Close the pursuit:** set `stage = 'dead'`.
- Surface failed or uncertain writes instead of optimistically advancing.

The other five `needs_human_reason` values (`unanswerable_question`, `no_fitting_slot`, `portal_link`, `missing_document`, `decision`) need at least a stub each, since the spec says every enum value has a resolve flow.

### 3.4 Show A's real outputs

The dashboard selects `id,type,created_at` from `pursuit_events` and drops `payload`. The composed email in `draft_composed` is therefore never displayed. The demo's proof points are the match reason, the contact evidence URL, and the draft text, so add `payload` to the select and render `draft_composed` in the conversation tab.

### 3.5 Tour display (spec item 4)

Currently always `tour: null`. Blocked on A persisting a slot / time / event link. Nothing to build until that contract exists; agree the shape now (§4).

Connection status reads `gmail_accounts`, which the worker never writes, so `/dashboard` shows "Gmail not connected" for the demo owner. Either A writes a row when the worker syncs, or B treats a missing row as "connected via local credentials" for the demo.

### 3.6 Demo login

The seeded owner has no password, so B cannot sign in as the account that owns A's data. Pick one:

- A sets a password on `scout-demo@example.com` in the Supabase dashboard, or
- B signs up a real user and A points `SCOUT_OWNER_USER_ID` at it, then deletes the seeded row.

### 3.7 Deployment and demo script (spec item 5)

Not started. B owns frontend deployment and the narrative; A owns worker startup.

## 4. Contract proposal to agree before more UI work

The spec asked for `docs/hackathon-contract.md`; neither side has written it. This section is a starting draft, not a decision.

### Reads

B reads exactly what A already writes. No new tables.

| B needs | Where it is now |
|---|---|
| Listing facts | `listings` |
| Why it matched | `user_listings.is_match`, `user_listings.match_reason` |
| Stage and blocker | `pursuits.stage`, `pursuits.needs_human_*` |
| Contact and evidence | `pursuits.contact_snapshot` (`contacts[]`, `sourceUrl`, `tier`) |
| Email draft | `pursuit_events` where `type = 'draft_composed'`, in `payload` |
| Timeline | `pursuit_events` ordered by `created_at` |
| Tour | **not persisted yet**; proposal: `pursuit_events` with `type = 'tour_booked'` and `payload = {startsAt, endsAt, timezone, calendarEventUrl, status}` |

### Commands

Direct column updates from B's server actions, under the existing owner RLS. The worker reads them on its next cycle. The UI never claims a send or booking happened; it shows what the worker records.

| Command | B writes | A's worker does |
|---|---|---|
| Save profile | `search_profiles` editable columns (done) | Uses on next match |
| Pause / resume | `search_profiles.paused_at` | Skips the user while set |
| Supply contact | `pursuits.contact_snapshot` + clear `needs_human_*` | Composes / sends outreach next cycle |
| Close pursuit | `pursuits.stage = 'dead'` | Stops acting on it |
| Request outreach | nothing new needed; clearing the blocker is the request | Same as supply contact |

Open questions for A: should B also append a `resolved` event, or does the worker write it when it picks the change up? Does the worker need a `requested_at` column to distinguish "user just resolved this" from "nothing changed"?

### Demo stages

Schema enum: `matched → contacted → tour_scheduled → toured → applied → decided → dead`. The spec's `ready_to_contact` does not exist; a pursuit with a contact snapshot and no blocker is "ready" by inference. The `closed` stage in the spec maps to `dead`.

## 5. Suggested order for the next session together

1. Decide the demo login (§3.6). Ten minutes.
2. Merge `main` into the dashboard branch and open `/dashboard` as that owner (§3.1).
3. Agree §4 and write it to `docs/hackathon-contract.md`.
4. B builds supply-contact and close-pursuit; A confirms the worker picks up a cleared blocker on the next cycle.
5. B renders the draft payload; A keeps going on Gmail send.
