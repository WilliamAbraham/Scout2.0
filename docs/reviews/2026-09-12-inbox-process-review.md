# Scout inbox and agent process review

Date: 2026-09-12. Status: proposal for discussion, not an accepted implementation contract. Reviewed the product design, onboarding design, current backend source/schema, and current dashboard. No application behavior changed; no live mailbox or database was accessed.

## Recommendation

Make Scout an apartment-pursuit inbox. It should answer: what arrived, which apartments Scout is pursuing, what happened most recently, and who must act next. Keep agentAI's restrained visual language and selection/detail relationship. Give the grouped rows the main workspace; make the map an alternate view. The present narrow rail plus large map works for geographic browsing but gives too little space to the process the user is supervising.

Assumption from the [product design](../superpowers/specs/2026-09-12-scout-product-design.md): qualifying matches proceed automatically within the owner's configured authorization. A newly found apartment does not require routine approval. The hackathon starts with ingestion through broker conversation, plus a tour and an actual blocker when available; applications remain later work.

## What exists now

| Layer | Verified in source | What this means for the interface |
|---|---|---|
| Ingestion | CLI Gmail discovery/cache, StreetEasy card parsing, global listing import | There is usable listing extraction, but no connected per-user dashboard feed yet. |
| Ownership and matching records | `listings` plus `user_listings`, with nullable `isMatch`, `matchReason`, `scoredAt`, `dismissedAt`, source message and first-seen time | The schema distinguishes incoming listings from pursuits. A null match result means not evaluated, not rejected. Runtime matching/population is still missing. |
| Contact enrichment | Standalone service with evidence, candidates, issues, execution outcome and `outreachReady` | A recovered contact is not necessarily a verified contact ready for outreach. Results are not wired into pursuit state. |
| Pursuits | Lifecycle enum, separate blocker reason/note/time, contact snapshot, Gmail thread reference | These are schema capabilities; they do not prove the worker has sent a message or resolved a blocker. |
| Activity | `pursuit_events` schema | Supports a factual timeline once the worker writes outcomes. Event payloads still need a shared contract. |
| Account/profile | Gmail connection metadata and search-profile schemas, plus onboarding design | Useful for sync status, search criteria, availability and pause. The onboarding routes/actions remain planned. |
| Current dashboard | Five synthetic apartments, ID-based grouping and React state; map overview | The visual prototype is interactive but does not consume backend records. Its queue transitions must not become the live business rules. |

Source anchors: [listing records](../../backend/src/db/schema/listings.ts), [pursuits and events](../../backend/src/db/schema/pursuits.ts), [stage enums](../../backend/src/db/schema/enums.ts), [enrichment](../../backend/src/enrichment/service.ts), [HTTP server](../../backend/src/index.ts), [dashboard](../../frontend/components/dashboard/scout-dashboard.tsx), [onboarding design](../superpowers/specs/2026-09-12-onboarding-search-profile-design.md).

## Inbound listings: one apartment, one row

The intended alert path is: email → extract listing cards → upsert source listing → associate it with this user → evaluate against this user's profile → create a pursuit for a match. Broker replies belong to the existing pursuit through the mailbox/thread reference; they are not new listing rows.

- Deduplicate StreetEasy cards using `rental_id`, then maintain one user-listing association and at most one pursuit for that association. Repeated alerts should update observations, not create duplicate rows or another opening email. A future second listing source needs explicit source identity; do not deduplicate by address alone.
- Retain non-matches in an All listings view with the actual reason and a future correction/reconsider action. Keep them out of the default active-work list. User dismissal and an agent's non-match decision are different facts.
- Show `Checking fit` while `isMatch` is null, `Matched` when true, and `Not a fit` when false. A true match without a pursuit is awaiting handoff, not awaiting user approval.
- Present unknown amenities, beds/baths or availability as unknown. A listing can match known criteria while some details still need confirmation. A missing fact is not evidence that a must-have is satisfied.
- Separate account-wide collection problems from listing blockers. Disconnected Gmail, first sync, no alerts yet, no matches, and no results for a UI filter require different empty states. Show last successful sync; never imply continuous monitoring from a decorative green dot.

The current importer does not populate the per-user feed or match results. Duplicate imports only fill a missing brokerage; they leave price and first/last-seen timestamps unchanged. Incoming timestamps, repeated observations and changed facts need to be agreed before the UI promises that a row is current.

## Status model: progress, attention, and next action

The schema's actual lifecycle is `matched → contacted → tour_scheduled → toured → applied → decided`, with `dead` as a stopped/terminal path. The hackathon prose instead names `ready_to_contact` and `closed`; those are not current enum values. Keep the existing enum as the integration baseline and resolve this vocabulary difference explicitly.

| User-facing state | Existing record or proposed derivation | Evidence and next action |
|---|---|---|
| Checking fit | `user_listings.isMatch = null` | Scout has not completed evaluation. |
| Finding contact | Pursuit `matched`, contact resolution queued/running | Needs worker progress evidence; stage alone only supports the generic label Matched. |
| Ready to contact | `matched`, verified outreach-ready result, send queued | A display substate, not a new lifecycle enum. No approval button under the agreed automatic flow. |
| Waiting for broker | `contacted`, successful outbound event, no pending broker reply | Show last sent time and the actual follow-up plan if one exists. `contacted` alone does not establish whose turn it is. |
| Scout replying | `contacted`, inbound reply and queued/running response | Requires explicit worker action state; do not infer it from an old `lastAgentRunAt`. |
| Tour scheduled | `tour_scheduled` with confirmed appointment details | Show time, timezone, location and calendar outcome separately. A booking attempt is not success. |
| Toured / Applied / Decision received | `toured` / `applied` / `decided` | Later scope. Each needs outcome evidence; elapsed tour time does not mean attendance. |
| Closed | Display group for `dead` and completed decisions | Show the reason/outcome: user stopped, unavailable, rejected, etc. The enum alone cannot provide it. |

`needsHumanReason` is independent of progress. For example, a pursuit can be `contacted` and blocked by `unanswerable_question`. The row belongs in Needs you but still displays Contacted and the exact request. Preserve stage on resolution; accepting an answer does not prove a reply was sent.

Other independent conditions also need clear treatment: account pause, proposed per-pursuit pause, queued action, retryable failure and send-cap delay. Pausing preserves progress; closing ends pursuit. Dismissing a feed row must not silently stop an active agent. Read/unread is an attention marker, not a task or a stage, and requires separate read-state support if added.

## Views and row layout

Use a compact navigation column, a wide grouped row list, and one selected-apartment detail pane. Offer List / Map as a workspace switch. Retain agentAI's muted surfaces, aligned headers and independent pane scrolling. On mobile, selecting a row opens a full detail view with a predictable Back action.

Recommended primary views:

- **Active**: open pursuits, with Needs you first, then upcoming tours, Scout working, and Waiting for broker. Put a compact Needs you shortcut/count in navigation. When no blockers exist, keep active progress visible instead of landing on an empty screen.
- **All listings**: everything that arrived, including Checking fit, Matched, Not a fit and Dismissed filters. Name the feed All listings rather than Found, which currently confuses receipt with qualification.
- **Closed**: stopped and completed pursuits with reasons. Tours can be a shortcut into Active initially; no separate tracker is needed for the hackathon.

Within Active, display each pursuit once using blocker → upcoming tour → current work/waiting precedence. These are views derived from data, not mutually exclusive database stages. View counts must declare their scope: pursuits needing a response, scheduled tours, or incoming listings. Do not sum overlapping filter counts as though they were independent totals.

Each row needs apartment identity, rent and basic facts, lifecycle label, one concrete latest update/next step, and time. Example fixtures for the design:

| Apartment | Rent / facts | Progress | Latest update or next step | Time |
|---|---|---|---|---|
| 87 Clinton St · 3A | $3,200 · 1 bed | Contacted · Needs you | Does October 1 work? | 12 min ago |
| 42 Bergen St · 5 | $3,100 · 1 bed | Matched · Needs you | Add a broker contact | 1 hr ago |
| 156 Franklin St · 2R | $3,350 · 1 bed | Contacted | Waiting for broker's tour times | Sent yesterday |
| 234 Wythe Ave · 4B | $3,450 · 1 bed | Tour scheduled | Mon, Sep 14, 11:00 AM ET | Upcoming |

Sort blockers by explicit urgency/deadline and then oldest unresolved; tours by appointment time; working/waiting by meaningful latest activity. Show exact timestamps on inspection. Preserve selection and scroll when data refreshes, and avoid moving the row away while the user is submitting an answer. State changes should arrive with an acknowledgement, then the confirmed result. Color supports readable text labels; it does not carry status alone.

## Selected apartment: lead with what helps the user act

The detail pane should put the current question or next action at the top, then apartment facts and fit, then conversation and history. Our current prototype places the blocker below several informational sections; reverse that order.

1. Address/unit, rent, basic facts, current stage, original listing link and observation time.
2. A specific blocker form or current next step with its owner: You, Scout, or Broker. One primary action appropriate to that request.
3. Why it fits, what is unknown, and any conflicting facts. Show source evidence where useful; do not convert the stored match score into an uncalibrated percentage badge.
4. The actual broker conversation with participants and timestamps. Show who Scout contacted and the evidence used, including every co-agent or an explicitly verified leasing contact.
5. A factual activity timeline: found, matched, contact verified, request sent, reply received, tour confirmed. Record outcomes and human resolutions; keep retrieval traces and model internals out of the default view.

Map and photos supply apartment context when reliable data exists. The current listing schema has no coordinates, image collection, normalized neighborhood or structured amenity fields; the current fixtures must not imply those facts are already available from the live feed.

## Needs you must have a matching resolve flow

| Reason | Prompt and action | Meaning of completion |
|---|---|---|
| `no_contact` | Supply a contact or stop pursuing | Save the candidate, then verify it. Never label pasted text Verified. |
| `unanswerable_question` | Show the broker's exact question and answer field | Acknowledge saved answer; worker composes/sends and records outcome. Distinguish a reusable profile fact from a listing-specific answer. |
| `no_fitting_slot` | Show actual offered slots; choose one or edit availability | Resume scheduling; display Booked only after confirmation. |
| `portal_link` | Show the verified destination and Open application | Opening a link is not completing/submitting an application. Later scope. |
| `missing_document` | Name the missing item and provide upload | Uploaded is distinct from sent to a broker. Later scope. |
| `decision` | Show the outcome and ask for the owner's decision | Human controls acceptance/withdrawal and any final commitment. Later scope. |

The enrichment service distinguishes `source_matched`, `partial`, `needs_review`, `not_found`, and `error`, plus execution outcomes and `outreachReady`. Here, `source_matched` means the source page represents the exact apartment, not that the apartment matches the user's preferences. Source-supported contact evidence also does not prove email deliverability. A provider error or exhausted search budget is not proof that no contact exists. Prefer automatic bounded retry and honest waiting/error copy. Only create a human request when there is an actionable problem the user can resolve; ambiguous listing identity and conflicting rosters need a reason contract before being shown as a generic missing email.

## Smallest useful next implementation

First agree a shared dashboard projection with the pipeline owner: listing/user-listing identity, match decision/reason/time, stage, blocker detail, contact readiness/evidence, last meaningful event, next action/owner, execution outcome and optional confirmed tour. Use explicit unknowns where the worker cannot provide a fact. Some fields exist today; next-action status, retry/cap timing, per-pursuit pause, closed reason and typed tour details still need agreement.

Then bind fixtures to that same shape and replace the ID-based grouping. Build the wide inbox and blocker-first detail with the three hackathon scenarios: matched/ready, missing contact, and scheduled tour, plus a received-but-unscored/non-match pair to prove inbound handling. Integrate authenticated reads before commands. The command contract and handler must be added; neither exists today. Resolving a blocker submits a command, shows Saving/Queued, and waits for worker acknowledgement/outcome; the UI must not write an optimistic contacted/booked stage.

Verification scenarios: repeated alert leaves one row; unknown fit never looks rejected; a blocked contacted pursuit retains its stage; contact supplied remains unverified; queued send does not show Sent; failed booking does not show Booked; reconnect appears once at account level; a passed tour time never becomes Toured automatically.

## UX basis and verification

The recommendations above are Scout-specific inferences from its design and current code. [Carbon's table guidance](https://carbondesignsystem.com/components/data-table/usage/) supports roomy rows, search/filter controls, and progressive disclosure into a side panel. [Google PAIR](https://pair.withgoogle.com/guidebook-v2/patterns/) supports familiar interaction models, task-relevant explanations, interpretable confidence, and ways to supervise automation. The local UI/UX skill's submit-feedback guidance supports explicit pending/success/error acknowledgement. These are design references, not usability tests with Scout users.

Checks for this documentation review: `yarn test` passed all 72 backend tests; `yarn lint` still fails because the root lint script is missing. These tests cover current schema/enrichment behavior, not an integrated agent pipeline. No frontend code, external actions, migration application, or live integration was performed.
