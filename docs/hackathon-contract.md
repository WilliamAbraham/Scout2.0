# Hackathon dashboard–worker contract

Implemented by B against main through c3a05f4 (persisted worker in b3525cd), 2026-09-12. This records the source-compatible integration B uses; it is not a claim that A has signed off or that live Gmail sending works. The worker currently refuses `--live` and records drafts in dry-run mode.

## Reads

`/dashboard` validates the Supabase session and filters every parent read by its user ID under RLS. It reads listing facts, match decisions, pursuit stage/blocker, contact snapshot, `thread_id`, `enriched_at`, follow-up columns and event payloads. No OAuth tokens, mailbox credentials or service-role key reach the browser.

| Stored fact | Dashboard behavior |
|---|---|
| `user_listings.is_match`, `match_reason` | Checking fit / matched / not a fit, with the recorded reason |
| `needs_human_*` | Needs you, independently of pursuit stage |
| `contact_snapshot` | Names, emails and a safe evidence URL; user-supplied provenance differs from agent research |
| `draft_composed` payload `{type:'send',to,cc,subject,body,threadId,trigger,dryRun:true}` | **Draft · Not sent**, escaped text and recipient/subject metadata; payload `type:'send'` is not a send receipt |
| `email_sent` payload `{type:'send',to,cc,subject,body,threadId,trigger}` | Recorded outgoing email; waiting is inferred only without later contrary evidence |
| `next_follow_up_at`, `follow_up_count` | Recorded schedule and count; no invented countdown or running-worker claim |
| `tour_booked` payload `{start,end}` | Only a valid ordered pair of timestamps with offsets; location and calendar confirmation remain unknown |
| Missing `gmail_accounts` row | Gmail status not reported; imported records still display |

Events are ordered by timestamp, with ID as a stable tie-breaker. Malformed message payloads do not become messages. Any opening draft event, including one with unusable contents, suppresses another opening in the current worker. The UI does not offer regeneration. It does not fabricate broker replies or calendar links. The richer `{startsAt,endsAt,timezone,calendarEventUrl,status}` tour proposal in the handoff is not the persisted contract.

## Commands B implements

Server Actions use the request-scoped Supabase client and revalidate the session for each invocation. Ownership comes from claims, never a submitted user ID. Updates include the owner and expected state/version in their predicates and require a returned row. Errors or zero-row writes do not advance the UI optimistically; uncertain results ask the user to refresh before retrying.

| Action | Preconditions and write | Effect |
|---|---|---|
| Save preferences | Editable criteria only, existing profile action | Worker uses the stored profile |
| Supply contact | Owned pursuit, matched, no_contact, no thread, finished enrichment, unchanged updated_at, no existing opening draft | Write snapshot and clear all three needs_human fields atomically; eligible for a future opening cycle |
| Close pursuit | Owned non-dead pursuit, unchanged updated_at | Set stage=dead, clear next_follow_up_at; preserve contact, thread, blocker history and events |
| Pause / resume | Owned existing profile, expected pause state and unchanged read version | Change only paused_at and updated_at; retries requesting an already-set state do not toggle it |

Supply-contact input is one email, optional name/evidence URL and an explicit authorization checkbox. The worker uses it directly; **there is no verification step after submission**. The JSON snapshot extends the existing shape with `providedBy:'user'` and `providedAt:<ISO timestamp>`, while retaining `tier`, `contacts` and `sourceUrl`. No fake evidence is generated. `enriched_at` is not rewritten as a new verification.

There is no additional request-outreach flag. An unblocked matched row with usable contacts, no thread and no opening draft is already eligible. The dashboard does not start the worker, send mail, book a tour or insert resolved/stage-changed events. Pursuit events are read-only to dashboard users under RLS. A future worker consumer must define how resolution audit events are recorded.

The other five blockers have explicit UI placeholders: question answers, fitting slots, portal completion, missing documents and decisions. Their resolution storage/replay is not implemented by A. Updating search availability does not clear a current blocker. The dashboard leaves these requests in Needs you; closing the pursuit remains available.

## Known worker boundaries

- Pause is read at cycle start; an active cycle may finish. Closing does not cancel an in-flight turn. Current enrichment/turn persistence lacks a version guard, so B's compare-and-set does not prevent a later worker write. A must recheck pause/stage and guard persistence before reliable live cancellation.
- `listActiveUsers()` processes all profiles, but `syncUser()` shares one root Gmail client. `SCOUT_OWNER_USER_ID` currently bootstraps a profile; it does not restrict processing. Before multi-user deployment, A must scope processing to the demo owner or implement per-user Gmail. A frontend gate alone does not fix this, because profile insertion is permitted through owner RLS.
- The handoff's seeded owner has no password. A must provision login or intentionally move demo ownership; B will not bypass authentication or manufacture a session.

## Verification

Command tests use a fake Supabase request adapter to check session ownership, state predicates, column whitelists, stale/uncertain writes, draft suppression and pause retry behavior. Projection tests cover actual payload shapes and malformed records. These establish application behavior, not deployed RLS or a completed worker cycle. Browser/live verification and deployment status are tracked in [context.md](../context.md) and the [demo runbook](demo-runbook.md).
