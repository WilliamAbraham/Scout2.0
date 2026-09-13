# Scout: current engineering context

Updated 2026-09-12. Dashboard iteration started from `f6f8adf`; earlier source review used `822db17` on `origin/main`. Code inspection is distinguished below from runtime verification. Start with [project.md](project.md) for product intent.

## Brokerage contact visibility — 2026-09-12

Local integration follow-up: fast-forwarded the running branch to `origin/main` at `d8956f6`, bringing in the existing `d0258a7` dashboard/preferences layout fix alongside the contact changes. Refreshed the authenticated local `/dashboard` and visually confirmed that the outer gutter, rounded frame and shadow are gone. The live Mott Street rows also display the restored brokerage channels. This verifies local rendering, not hosted deployment.

Implemented on `codex/show-brokerage-contacts`. The alert summary previously discarded `contactRoutes`, and the dashboard ignored event contacts and never rendered snapshot phone numbers. Summaries now retain routes with evidence and original timestamps. The dashboard shows brokerage names in rows, email/phone research results in rows and details, and phone numbers from existing outreach snapshots. Only the latest completed enrichment event supplies recovered contacts; candidates and malformed payloads do not become contacts. Recovered details remain separate from outreach recipients and work-state calculations.

Centennial's existing direct adapter now retains an explicitly attributed catalog-footer office phone/email before exact-unit lookup. #3 was absent from that catalog and generic provider reads hit HTTP 429; its saved event had neither a contact snapshot nor routes. Restored the #3 office phone (212-228-9300) and #6-5 team email/phone from the existing cache into their two saved `enriched` events. The latter retains `unit_conflict` for source #5-6. Original retrieval times, blockers, snapshots and pursuit stages were preserved. No worker, paid research or send ran; other historical events with discarded routes still require recovery.

Verification: `yarn test` passed 222 backend and 40 frontend tests; workspace typechecks and targeted frontend ESLint passed. `yarn lint` remains unavailable because the root has no lint script; full frontend lint retains the existing violations in `theme-switcher.tsx` and `tailwind.config.ts`. The sample browser check confirmed brokerage/phone in the inbox and contact details with evidence and timestamp; the temporary QA route was removed. Authenticated browser verification requires owner login; the two live event repairs were verified by database return values.

## Search preferences page — 2026-09-12

Implemented `/preferences` on `codex/more-enrichment-on-frontend`. Inbox navigation and the no-fitting-slot shortcut now lead to the page, replacing the dialog. The page retains Scout’s existing shell, separates Search filters / Apartment preferences / Tour availability, and adds suggestion toggles, custom lists and a live summary.

- Source audit confirms that rent, bedroom and bathroom bounds filter newly evaluated listings. Missing room counts can pass; no review gate is created. Neighborhoods, must-haves, dealbreakers and prose go to outreach context rather than automatic matching. Existing evaluated matches and StreetEasy alerts are unchanged by a save. Blank availability is sent as flexible; tour windows do not enforce booking constraints.
- Signed-out users can edit/check a sample without a database write. Only the exact public `/preferences` route is exempted from the proxy redirect; `/dashboard` remains protected and every save validates the session. Failed profile reads block editing.
- Save execution now checks the returned owner row and catches uncertain failures; client errors retain all drafts, including time windows. Editable-field whitelisting preserves pause, learned answers and send caps. Profile saves remain last-save-wins. List entries are deduplicated case-insensitively.
- Verified: all 191 tests passed (154 backend, 37 frontend), including eight profile parser/authorization/receipt cases. Both workspace typechecks, frontend production build and targeted ESLint passed. Root `yarn lint` remains absent; full frontend lint retains its previously documented starter errors.
- Browser QA: 1440px desktop and 375px mobile; no horizontal overflow, 16px mobile inputs, studio/budget summary updates, selected suggestions, custom text, flexible availability, invalid rent and time ranges, linked/focused inline errors, retained edits and sample-check feedback. Anonymous `/dashboard` still redirects to login; the browser was left at `/preferences` with the viewport override reset. No authenticated live profile writes, RLS checks, worker commands or deployment were performed.

## Final upstream reconciliation — 2026-09-12

Integrated `origin/main` at `0a888a6` into `codex/more-enrichment-on-frontend` for [PR #9](https://github.com/WilliamAbraham/Scout2.0/pull/9). README/context conflicts preserve the implemented frontend contract alongside the new backend assignments and broker-discovery evidence. Incoming enrichment changes add no pursuit/profile schema or command changes; the worker still uses its existing provider and refuses live sending.

Verified on the combined tree: all **183 tests passed** (154 backend, 29 frontend), both workspace typechecks and the frontend production build passed, and `git diff --check` passed. Targeted frontend ESLint passed before this merge; no frontend source changed in it. Root `yarn lint` remains unavailable because its script is absent. Earlier counts below describe their respective snapshots. Owner login, real-row/RLS checks and hosting deployment remain pending; no live worker, mailbox, migration or paid enrichment command ran during this integration.

## Listing information enrichment — 2026-09-12

Implemented on `codex/more-enrichment-on-frontend`, with shared dashboard wiring in `52f7182` and listing components/tests in `e709720`.

- Rows now include bathrooms beside bedrooms. Overview adds a facts snapshot, recorded brokerage, budget comparison and a rent-only 12-month calculation. Both budget bounds are respected; absent/failed profile reads produce no comparison. Public demo comparisons use the labeled sample profile.
- `listings.brokerage` and `last_seen_at` are selected and projected without a schema migration. Invalid/missing metadata stays unknown. Last seen is an alert observation, not a claim of current availability or a price recheck.
- **Before you tour** expands into listing unknowns and questions about move-in/lease terms, extra costs, size, laundry and pets, plus saved must-haves/dealbreakers. These are unverified questions; no actual amenity or external lookup data was added.
- Verified locally: `yarn test` passed 135 backend and 29 frontend tests, including four new budget/metadata/question tests. Frontend typecheck, targeted ESLint and `git diff --check` passed. Root `yarn lint` is still unavailable because there is no root script.
- Browser QA: desktop under-budget ($300) and over-budget ($700) comparisons, annual rent amounts, expandable questions, and mobile snapshot at 375px with document width equal to viewport width. No live database, mailbox, migration or paid enrichment command ran. Authenticated source metadata loading and deployed RLS remain unverified.

## Latest handoff integration — 2026-09-12

B's handoff implementation is on `codex/more-enrichment-on-frontend`. The [dashboard–worker contract](docs/hackathon-contract.md) records actual payloads, contact/close/pause semantics and worker limits; the [demo runbook](docs/demo-runbook.md) covers login and deployment preparation.

- Server actions implement user-authorized contact supply, close pursuit and pause/resume. Every command verifies the session/owner, compares current state/version, requires a returned row and reports uncertain writes. Contact supply clears the blocker without advancing stage or claiming a send. It is eligible on a future cycle, with no later verification step. The other five blocker types have explicit placeholders; availability edits do not clear a current blocker.
- The reader now selects event payloads, thread/enrichment and follow-up fields. Valid drafts render separately from sent emails; malformed draft records suppress false readiness. Tours require ordered offset timestamps and retain unknown location/calendar confirmation. Contact evidence and user-supplied provenance are displayed. Missing Gmail metadata is “status not reported,” not proof of disconnection.
- Live data uses refreshed server props; pending state is shared across controls, and mutation results remain visible after a blocker clears, selection changes or a pursuit closes. The inbox can be refreshed for new worker events. Public demo contact receipts no longer promise a nonexistent later verification queue.
- Verification before the final upstream merge: production build, frontend typecheck and targeted ESLint passed. All 164 tests passed: 135 backend and 29 frontend (11 command, 6 handoff projection, 8 existing inbox and 4 listing-insight tests). Root lint is still absent; full frontend lint has its two known starter violations.
- Browser QA used fictional records in a temporary route, now removed: at 375px the contact form retains email and authorization after a returned sign-in error; the error is scoped to the submitted action and its persistent notice can be dismissed. Draft recipients/subject/body display as “Draft · Not sent”; the no-fitting-slot placeholder explains that preferences do not clear it, and its shortcut opens the preferences dialog. Anonymous `/dashboard` redirects to `/auth/login`. These checks did not write real pursuit/profile rows or establish deployed RLS correctness.
- Live owner login, real-row/RLS verification and deployment remain unverified; owner sign-in and a hosting target were requested. A must scope the single-mailbox worker before multi-user deployment and guard in-flight writes before reliable cancellation. No credentials/session were fabricated and no worker/mailbox/migration/paid enrichment command was run.

Merged upstream `c3a05f4` into `codex/implement-pursuit-inbox`, including the persisted worker and [Person B handoff](docs/2026-09-12-person-b-handoff.md). README and context conflicts were resolved by preserving both frontend and backend updates. The handoff describes pre-merge branch status; its command contract remains a proposal. Earlier statements below about an unmerged, in-memory worker are historical. Upstream live database results are reported by A and were not independently rerun during this pull. Local verification: after `npm ci` installed the updated lockfile dependencies, `yarn test` passed 135 backend and 8 frontend tests. `yarn lint` remains unavailable because the root script is absent. No live worker, mailbox, migration, or paid enrichment command was run.

## Latest profile-design integration — 2026-09-12

Merged upstream `ce8c8df` into `codex/implement-pursuit-inbox`. The incoming change is documentation only: it replaces the five-step onboarding plan with a writable Search preferences panel. It adds no endpoint or schema migration.

- Implemented the panel on both `/` and `/dashboard`. The public route keeps fixture listings but reads session/profile inside Suspense. Signed-out visitors get a sample; signed-in owners with no row can create one. Profile-read errors block editing and offer refresh.
- `lib/profile-server.ts` selects criteria, pause state and safe Gmail metadata under an explicit user filter. `app/actions/profile.ts` revalidates the session, rejects malformed criteria, and upserts only editable fields with the session-derived owner. Agent answers, pause and send caps are omitted from the write. No pursuit command or outreach integration was added.
- Controlled drafts retain invalid or failed submissions. Validation covers numeric bounds/precision, ordered rent/bed ranges, comma-separated criteria and complete same-day tour windows (Sunday = 0). The summary represents both lower and upper limits. Move-in/timezone columns and Google OAuth entry point remain absent; windows are labeled New York time.
- Verification: 72 backend and 8 frontend tests passed, plus direct parser assertions for valid/blank values, malformed numbers, bounds, availability, summaries and the field whitelist. Browser checks covered signed-out sample, an editable sample, malformed and inverted rent values with preserved input, adding/removing windows at 375px, a first-profile empty form, and a blocked form after a failed read. The temporary sample QA route was removed. No live profile was written; authenticated persistence and deployed RLS remain unverified.
- Frontend typecheck, targeted ESLint and production build passed. Root `yarn lint` remains unavailable. Full frontend lint retains the two existing violations in `components/theme-switcher.tsx` and `tailwind.config.ts`.

### Historical worker branch review (superseded by the persisted pipeline below)

The final fetch also found [PR #5](https://github.com/WilliamAbraham/Scout2.0/pull/5), `origin/codex/enrichment-cost-benchmark` at `97217cf`. Its parent `3aaac3c` adds outreach, alert processing and an inbox watcher. This branch was inspected read-only and is not merged into the frontend branch.

- New `next_follow_up_at` and `follow_up_count` schema fields could support scheduled-follow-up details once migrated and populated.
- `WorkerStore` declares persistence operations, but its executable currently supplies an empty in-memory store; mail, calendar and availability ports are stubs. An `outreach_sent` return from this path does not establish a Gmail send.
- The alert script uses a blank agent profile. A backend adapter must translate saved `search_profiles` criteria and structured tour windows into the agent profile. Pipeline reasons such as `owner_listed` and `enrichment_incomplete` also need a mapping to persisted assessment/blocker values.
- No new working frontend endpoint or persisted worker-state contract was found. Keep live pursuit actions disabled and preserve unknown work state until the store/service adapters and mappings land. No benchmark, mailbox or worker command was run during this inspection.

## Earlier inbox implementation — 2026-09-12 (superseded by handoff integration above)

Implemented the user-approved direction from the [inbox/process review](docs/reviews/2026-09-12-inbox-process-review.md) on `codex/implement-pursuit-inbox`.

- `inbox-model.ts` separates incoming assessment, persisted pursuit stage, blockers, current work and explicit closure. Pure queue selectors replace the fixture-ID rules. Unknown worker state uses Recorded progress; tour stages use Tours scheduled. An unclosed decision remains active.
- Public `/`: eight synthetic records, wide grouped rows, Active/All listings/Closed, Needs you shortcut, alternate map, action-first details, overview/conversation/activity, search/filter, pause/preferences and responsive detail navigation.
- Demo answer/contact receipts preserve stage and do not send, verify or book anything. Contact candidates remain unverified. Undo, stop/restore and incoming dismissal are separate; dismissal cannot stop a pursuit.
- `/dashboard`: session-validated, user-filtered Supabase SELECTs over user-listing relations, the one-to-one pursuit relation, events, Gmail health and profile. Password login lands here. Listing/pursuit mutations remain disabled; the profile-save integration above is the sole live write path. Invalid source URL schemes are omitted. Unknown messages, next action and tour time are not fabricated.
- The live reader is implemented but successful authenticated data loading, deployment/migrations and live RLS behavior remain unverified. The current importer still does not populate per-user feed records. Backend commands, reply contents and next-action/tour outcome contracts remain absent.
- Verification: 72 backend tests plus 8 frontend projection/transition tests passed. Frontend typecheck, production build and targeted lint passed. `yarn lint` remains unavailable because the root script is absent. Anonymous `/dashboard` returns HTTP 307 to `/auth/login`.
- Browser checks: desktop inbox; 375px layout with document width 375px; move-in receipt without stage advance; contact remains unverified; response focus moves to the receipt heading; stop/Closed/restore; assessment filters and non-match detail. No live mailbox/database access or migrations ran.

## Backend completion handoffs (2026-09-12)

Assigned remaining work to [Codex](docs/backend/Codex.md) (enrichment and costs), [Claude](docs/backend/Claude.md) (ingestion and continuous worker), and [Cursor](docs/backend/Cursor.md) (outreach and conversations). Cursor's Gmail sender, outbox, and dry-run boundary are implemented on `cursor/gmail-outreach`; live test mail is redirected to `williamja100@gmail.com` after `gmail.send` re-consent. Claude's continuous worker is on `main`. Codex spend persistence remains pending. See [outreach-delivery.md](docs/backend/outreach-delivery.md).

## Continuous worker (2026-09-12, branch `worktree-claude`)

The ingestion workstream in [docs/backend/Claude.md](docs/backend/Claude.md) is implemented. `backend/scripts/worker.ts` is the single entry point; the separate inbox watcher and its module were deleted. Operations are documented in [the worker guide](docs/backend/worker-operations.md).

- **Checkpointed sync.** `src/gmail/sync.ts` polls from `gmail_accounts.history_id` and falls back to a date-bounded catch-up when history has aged out, capped at 14 days and reported as truncated beyond that. The cursor advances only after every message in a batch is durably accounted for.
- **Routing.** `src/pipeline/routing.ts` classifies mail as alert, reply, or noise. Replies match a pursuit by Gmail thread id first and sender address second; the mailbox's own outbound copies are never treated as replies. `thread_messages` stores every inbound and outbound email, so a reply after a restart still routes to the same pursuit with its history.
- **Parser.** `src/gmail/alert.ts` isolates each card, so a malformed listing does not discard its siblings, and distinguishes an unsupported template from an empty notice. Replayed across all 90 cached messages: 292 cards, 0 malformed, 1 correctly classified non-alert. StreetEasy caps alerts at five cards even when the subject claims more.
- **Ledger.** `processed_messages` gained status, attempts, backoff, last error, and outcome. Failures retry roughly 5m/20m/80m and then become `exhausted`, which stays visible in `npm run worker:status`.
- **Enrichment outcomes.** `classifyEnrichment` separates permanent failures (no contact, owner-listed) from retryable ones (dead source, exhausted budget). Retryable ones are deferred without escalating to the owner and without re-charging enriched listings.
- **Concurrency.** `worker_leases` holds the mailbox for one process, renewed between messages; a second worker declines. Overlapping ticks are skipped. `SIGINT`/`SIGTERM` finish the message in flight, release the lease, and exit.
- **One mailbox, one user.** The worker refuses to start when more than one user has a search profile, since there is a single local token.
- `--live` is still refused: `sendMail` is a stub.

Migration `0004_worker_ledger` adds `thread_messages`, `worker_leases`, `worker_runs`, and the ledger columns. It was applied to the live database on 2026-09-12.

Verification: `npm run typecheck` passes and all 199 backend tests pass, including `src/pipeline/pipeline.test.ts`, which drives a fixture alert through the real parser, store, matcher, enrichment seam, and outreach handoff, and covers duplicate mail, restart, concurrent workers, malformed cards, unsupported templates, transient failures, and budget exhaustion.

Live checks on 2026-09-12 against the real mailbox (`williamsaibroker@gmail.com`) and Supabase, all in dry-run: migration `0004_worker_ledger` applied; `npm run worker -- --once` completed cleanly and exited in about ten seconds; `npm run worker:status` reports the run, the ledger, and 12 matched pursuits with 9 blocked on `no_contact`. Sync ran in incremental mode from the stored history id and correctly found nothing new, because an earlier cycle had already consumed the recent mail. **The alert to enrichment to draft path was therefore not exercised live in this session** — no new StreetEasy mail arrived during it. The first live attempt did expose a real bug, a Date bound into raw SQL in the lease query, which is fixed and covered by the offline tests.

Root `yarn lint` still has no script.

## Persisted worker pipeline (2026-09-12, branch `worktree-claude`)

The worker now runs the whole alert path against Postgres in one cycle: Gmail alert sync → `listings`/`user_listings` upsert → deterministic match against `search_profiles` → `pursuits` row → broker enrichment → `contact_snapshot` or `needs_human: no_contact` → outreach turn. `backend/src/pipeline/postgresStore.ts` is the single persistence adapter (it implements the worker's `WorkerStore` and the alert stage's `AlertStore`); `backend/src/pipeline/match.ts` is the budget/bedroom hard filter; `backend/scripts/worker.ts` is the only entry point. `processAlerts.ts` and the file-based processed-id set were removed.

- **Dry-run is the default.** `--live` requires `gmail.send` (see `npm run outreach:reconsent`) and sends through `outreach_outbox`; every live test recipient is rewritten to `williamja100@gmail.com`. Without `--live`, the open turn composes a draft and records `draft_composed` (once per pursuit), no Gmail send is called, and no pursuit leaves `matched`. Follow-ups are not scheduled in dry-run.
- **Alerts are not marked processed if a listing failed before persistence**, so a database error retries next cycle. An enrichment failure after the pursuit exists is recorded as `needs_human: no_contact` with the error in the note, not retried.
- Spend bounds: `SCOUT_ALERT_NEWER_THAN` (default `2d`) and `SCOUT_ALERTS_PER_CYCLE` (default 5) cap how many alerts enrich per cycle.
- `SCOUT_OWNER_USER_ID` bootstraps a default `search_profiles` row for the demo owner. The live Supabase DB has a seeded owner `scout-demo@example.com` (`6d859f4e-413e-44f1-9279-3c92b15a7b06`) inserted directly into `auth.users` with no password; remove it once B's sign-up flow produces a real owner.
- Migrations `0002` and `0003_pursuit_follow_ups` were applied to the live DB on 2026-09-12. `0002`'s `brokerage` column add is now `IF NOT EXISTS` because the DB had received a since-deleted migration for it. `0003` was generated for the follow-up columns the outreach commit added to the schema without a migration.
- Event types written so far: `created`, `enriched`, `escalated`, `draft_composed`; and outside dry-run `email_sent`, `follow_up_scheduled`, `tour_booked`, `packet_sent`, `stage_changed`. `EVENT` in `postgresStore.ts` is the list.

Verified live on 2026-09-12: two cycles ingested two alerts (nine listings, nine pursuits, all `no_contact` because enrichment found no verified email), a third cycle composed one draft for a pursuit seeded with an `example.com` contact, and a fourth cycle composed nothing new. `npm run typecheck` and all 135 backend tests pass; the backend `test` script now discovers every `src/**/*.test.ts`.

Next for A: apply `0004_worker_ledger` and `0005_outreach_outbox`, persist `mailboxEmail` on `loadTurnInput` if it is still missing, then run an authorized `outreach:send-test` before `--live`. Per-user tokens from `gmail_tokens` remain later work.
## Latest verified broker discovery

The revised OpenRouter agent independently identified **Fatma Kara / FIND Real Estate for 620 East 6th Street #9A** from the original address-only input on 2026-09-12. It generated one candidate StreetEasy URL, read the live page, validated its heading and available rent, and extracted the actual Listed by section. No expected name, manually injected source, or screenshot was supplied. Two paid calls (one hosted contact search) cost **$0.003407284, or 0.34¢**, in 7.882 seconds. A later offline replay verified rejection of an email tied to a conflicting brokerage. Personal email/phone remain unverified. See the [live result](docs/enrichment/fatma-live-result-2026-09-12.md).

Search is required when source evidence is absent; citation text must actually support broker attribution. Unsupported candidates are excluded from contact lookup. Personal contacts require agent/brokerage evidence and cannot duplicate generic office values. Cache policy is `listing-evidence-v3`. All 154 tests and enrichment TypeScript checks pass; root lint remains unavailable. The worker still uses its existing BrokerEnrichment provider. This successful unit-level test does not establish general batch recall.

## Latest enrichment cost test

On 2026-09-12, an approved $0.10 test processed all four listings from a different StreetEasy recommendation email with GPT-4.1 Mini / Parallel fast and a fresh local cache. Actual API-reported spend was $0.020800404 total (0.52¢ per listing), over eight stage requests and approximately 45 seconds. No named brokers were found; three listings returned generic company contact channels and one returned no contact details. This is a cost measurement, not successful listing-agent enrichment. See the [benchmark report](docs/enrichment/mini-cost-benchmark-2026-09-12.md).

The subsequent 620 East 6th Street #9A test cost $0.006410748 and missed Fatma Kara, visible in the user's listing screenshot. The OpenRouter agent now preserves optional listing URLs, attempts a bounded direct HTML read, and enforces one budgeted discovery recovery stage when no supported broker is found. Available source text must support the broker name, address and unit. The Gmail input adapter forwards the URL; the outreach runner still uses its existing BrokerEnrichment service, not this agent. See [retrieval behavior and limitations](docs/enrichment/openrouter-agent.md#retrieval-upgrade-2026-09-12).

The earlier upgrade passed all 135 offline tests and the enrichment TypeScript check. `yarn lint` was attempted but the root lint script is still absent. An approved fresh rerun of the upgraded agent cost $0.008392432 (0.84¢) across three stages and four reported searches, and still missed Fatma Kara. Two unsupported candidates were flagged needs_review; one source was a different property. The contact stage also duplicated generic office values under a candidate, exposing an ownership-validation defect. The original input lacked a URL, so direct-page retrieval was not exercised. See the [live regression report](docs/enrichment/openrouter-agent.md#live-regression-result-2026-09-12). Earlier 0.52¢/listing figures describe the old two-stage configuration. Raw email and API artifacts remain in ignored `data/` directories.

## Latest upstream integration

Pulled `origin/main` through `f9b1b76` on 2026-09-12 into `codex/dashboard-first-pass`. Resolved the `CLAUDE.md` conflict by retaining upstream backend guidance and local dashboard context.

- Added the onboarding/search-profile design spec, broker enrichment service and research, and multi-tenant pipeline schema with RLS policies under `backend/src/db/schema/`.
- Migration files are no longer ignored. Migrations were not applied to the live database during this pull.
- `yarn test` now discovers backend tests and passed all 72 tests. `yarn lint` still fails because the root lint script is absent.
- The public dashboard remains a local sample-data implementation. Live integration remains unverified.

The review and dashboard verification sections below describe earlier snapshots; this integration status supersedes their statements about absent tenant schema, enrichment implementation, ignored migrations, and the missing test target.

## Inbox/process review — current source, 2026-09-12

The [new review](docs/reviews/2026-09-12-inbox-process-review.md) maps the product process to the current schema and proposes the next UX iteration. Its UI direction was subsequently accepted and implemented above; the worker contract remains a proposal.

- Runtime intake is CLI Gmail collection/cache, StreetEasy parsing and global listing import. The importer only fills missing brokerage on duplicate rental IDs; it does not refresh price/observation times or populate `user_listings`.
- Broker enrichment is a standalone, tested service with source evidence, candidate contacts, readiness and execution outcomes. It is not wired to pursuits or the UI. `source_matched` validates apartment identity, not user preference matching; incomplete lookup is not a confirmed missing contact.
- The schema now has per-user match decisions, pursuits with independent blockers, contact/thread snapshots, events, profile/pause and Gmail health metadata. No runtime matcher, worker, command handler, broker reply router, email sender or calendar integration was found. The backend HTTP surface remains `/health` only.
- The proposal separates incoming assessment from pursuit stage and next-action ownership. It retains Needs you as a priority view, recommends wider grouped rows and an alternate map, and requires worker-confirmed outcomes for live status changes.
- `yarn test`: 72 tests passed again. `yarn lint`: failed because the root script is missing. Review checked source and mocked tests; no live mailbox, migration or database operations ran.
- Dashboard PR #2 is merged into `origin/main` at `3fedd6a`. This documentation review starts from that commit on `codex/inbox-process-review`.

## Implemented in source at the earlier review

- Root npm workspaces: `@scout/backend` and `@scout/frontend`, with a tracked `package-lock.json`.
- `backend/src/gmail/auth.ts`: single-user, read-only Gmail OAuth using root `credentials.json` and `token.json`.
- `backend/src/gmail/mailbox.ts`: StreetEasy message discovery and raw cache under `data/`; full message retrieval prefers cache. No incremental history cursor.
- `backend/src/gmail/message.ts`: MIME flattening; `listings.ts`: Cheerio card parsing and a bounded HTTPS StreetEasy redirect resolver. The misspelled `.ListinCard-info--detailsContainer` selector matches source markup.
- `backend/src/db/schema.ts`: global listings table with unique numeric `rental_id`, listing facts, and timestamps. No tenant or pursuit schema.
- `backend/scripts/importListings.ts`: imports cached mail. On conflict it only fills missing brokerage; it does not refresh price or advance observation timestamps. This matters for matching and contact recency.
- `backend/src/db/index.ts`: root `.env` database connection, with prepared statements disabled for the pooler.
- `backend/src/index.ts`: HTTP `/health` only; default port 3000, overridden to 4000 by `dev:api`.
- Frontend: public `/` renders a three-pane agentAI-style sample workspace: searchable grouped apartment rows, Map/Photos/Activity center, and persistent selected-apartment overview/conversation/actions. Mobile switches among Inbox/Map/Details. Move-in response and missing-contact forms update the demo queues; undo, pause, stop/resume, and read-only preferences are available. OpenStreetMap provides an area overview without fixture pins; photos are unavailable. State is in memory. Auth/session clients, `proxy.ts`, auth pages, and protected route remain; unused starter assets still exist.
- Enrichment browser/probe helpers exist. `backend/src/enrichment/names.ts` is a comment-only plan, not a working enrichment pipeline.

No implementation was found for multi-user Google OAuth, calendar integration, sending mail, matching, pursuits, application storage/sharing, roommate membership, natural-language search, or the proposed worker. No live service or deployment was tested.

## Commands and setup

Install dependencies from the repo root with `npm ci` using the existing lockfile. Do not introduce a Yarn lockfile merely because the house checks use Yarn. Nested workspace dependencies can result from normal version resolution; their presence alone does not prove an install ran in the wrong directory.

| Command from repo root | Purpose/status |
|---|---|
| `npm run dev:web` | Next development server on 3000 |
| `npm run dev:api` | Backend health server on 4000 |
| `npm run typecheck` | TypeScript checks across workspaces |
| `npm run lint -w frontend` | Frontend ESLint; no backend lint script |
| `npm run build -w frontend` | Frontend production build |
| `yarn lint` | Required convention; currently fails because root script is absent |
| `yarn test` | Required convention; runs backend and frontend tests |
| `npm run sync` | Gmail message corpus discovery/cache workflow |
| `npm run inspect -- <messageId>` | Inspect cached/raw mail; output can contain personal information |
| `npm run survey -- --offline` | Cached corpus survey |
| `npm run probe -w backend -- <url> <selector...>` | Inspect a brokerage page |
| `node backend/scripts/importListings.ts` | Import cached listings; writes to configured database |
| `npm run db:generate -w backend` | Generate Drizzle migration |
| `npm run db:migrate -w backend` | Apply migrations to configured database |
| `npm run worker -- --once` | One worker cycle: sync alerts, persist, enrich, compose drafts (dry-run) |
| `npm run outreach:reconsent` | Browser re-consent to add `gmail.send` |
| `npm run outreach:send-test` | Send one controlled test email to `williamja100@gmail.com` |

Root `.env` supplies backend `DATABASE_URL`; `frontend/.env.local` supplies the two public Supabase variables documented in `frontend/.env.example`. Credentials, OAuth tokens, env files, and `data/` are ignored. Do not commit or print secrets or cached private mail.

Local setup on 2026-09-12: the user-provided Supabase settings are configured in those ignored environment files. Environment parsing and required values were checked; live authentication and database connectivity remain unverified. Teammates must configure their own local copies; credentials are not included in Git.

Drizzle migrations and metadata are tracked; the upstream integration removed the migration ignore rule. No migrations were applied during this review.

Preserve strict compiler flags. Frontend uses Tailwind v3. Follow the generated guidance in `frontend/AGENTS.md` before frontend code changes; this documentation task leaves that file intact.

## Verification in this review

- Fetched origin and reviewed both new commits (`4c3f856`, `822db17`) on `codex/design-review`, starting from a clean working tree.
- Local runtime: Node `v24.11.1`, npm `11.14.1`, Yarn `1.22.22`.
- `yarn lint`: failed, missing root lint script.
- `yarn test`: failed, missing backend test file; no tests executed.
- Frontend ESLint now uses the Next.js flat configuration directly; the previous FlatCompat bridge failed with a circular-JSON error after installation. ESLint runs, but reports existing violations in `components/theme-switcher.tsx` (`set-state-in-effect`) and `tailwind.config.ts` (`no-require-imports`).
- Dependencies were installed with `npm ci` during the dashboard iteration. Live auth/database flows remain unverified. See the dashboard verification below for current frontend checks.
- Documentation validation: local Markdown links and `git diff --check` are checked before committing. These checks do not establish application correctness.

## Earlier dashboard iteration verification

Reference: read-only inspection of local `agentAI/src/app/page.tsx` and `globals.css`. After the earlier minimal single-page experiment, the user supplied a screenshot and requested agentAI as the starting point. The current revision adopts its floating window, muted listing rail, aligned pane headers, central map, and persistent right inspector. It does not port agentAI's backend or outreach integrations. OpenStreetMap replaces the Google Maps dependency for the demo overview.

- `npm run build -w frontend`: passed.
- `npm run typecheck -w frontend`: passed.
- Targeted ESLint on the dashboard: passed.
- Full frontend lint has the two existing violations listed above. Root `yarn lint` and `yarn test` were rerun and still fail for the documented missing script/test file.
- Browser, three-pane revision: verified the map loads, supplied broker contact moves a row from Needs you to Found/awaiting verification, undo restores its blocker, and move-in confirmation moves a row to Waiting for broker. Apartment-specific Activity shows sample milestones. Search empty state and Show all recovery work.
- Visual inspection: desktop three-pane workspace and 375px mobile Inbox/Details views. Selecting a mobile row opens Details and Back to inbox returns to the rail. Mobile document width matched 375px. Full keyboard traversal and OS text scaling were not exercised for this revision.
- No live auth, persistence, ingestion, outreach, or calendar integration tested. The public homepage contains only synthetic fixtures; keep it that way until authenticated live-data integration is designed.

Delivery: pushed `codex/dashboard-first-pass` to `origin` on 2026-09-12 after switching the active GitHub account to `ktpei`. The branch tracks `origin/codex/dashboard-first-pass`; the earlier HTTP 403 access blocker is resolved. Main-branch integration is tracked in [PR #2](https://github.com/WilliamAbraham/Scout2.0/pull/2). Pre-merge checks on 2026-09-12: production frontend build and all 72 backend tests passed; root lint remains unavailable and frontend lint retains the two existing violations documented below. The latest onboarding implementation plan from `25b0637` is included.

The current direction is a compact, grouped inbox with a map workspace and selected-apartment detail. Needs you contains actual blockers; routine outreach should not require approval for every apartment. Match reasons and unknowns replace uncalibrated percentages. Agent activity is available per apartment through a center-pane tab. Photos and source URLs remain unavailable for synthetic fixtures.

Next dashboard work: iterate with user feedback, agree the pursuit/command contract with pipeline owner A, then replace fixtures with authorized persisted results. Exact listing map pins, real photos, and command submission are not implemented.

## Hackathon clarification

The user clarified that this project is for a hackathon. Prioritize a demonstrable vertical slice; production launch readiness is not the immediate success criterion. See the hackathon assessment at the top of the review before treating its P1 list as a blocker for all development. Personal root agent conventions are local-only and are not part of the shared documentation.

## Two-person execution plan

The design now assigns A the entire agentic pipeline, including ingestion/matching/enrichment, Gmail, Calendar, Google credentials, schema, and worker orchestration. B owns the dashboard, authorized UI command submission, escalation/tour views, and demo presentation. A executes commands and external actions; B displays persisted results. First agree the contract and seed scenarios together; `docs/hackathon-contract.md` is a planned implementation deliverable, not yet created. Integrate on the first persisted pursuit and reserve the final quarter for rehearsal.

## Remaining decisions and next work

See [the detailed review](docs/reviews/2026-09-12-product-design-review.md). For the demo, agree a minimal schema and state contract, restrict access to the intended demo account, and define send behavior before enabling real outreach. Full roommate boundaries and packet-release rules are required only when those features are enabled.

Restore the root lint gate as focused implementation work. The current 72 schema/enrichment tests pass; establish parser fixtures and live migration/integration verification before claiming a complete pipeline.

## Historical documents

The [product spec](docs/superpowers/specs/2026-09-12-scout-product-design.md) now includes the requested hackathon work split and milestones in §§8–9. The broader product proposal remains; the hackathon plan is not an implementation completion claim. The original revision is available at `822db17`.

The August [frontend spec](docs/superpowers/specs/2026-08-30-nextjs-frontend-design.md) and [implementation plan](docs/superpowers/plans/2026-08-30-nextjs-frontend.md) are historical. Do not rerun their scaffold/copy steps against the populated frontend. Their direct-to-main instruction is superseded by current working conventions. The spec requires branding removal while the plan excludes it; current source still contains branding. Their old claims about an empty frontend and absent listings table are stale.

The product spec supersedes `names.ts` on generic extraction versus dedicated adapters. Its verification/evidence guidance remains useful input, but contradictory plans must not be treated as a single executable contract.
