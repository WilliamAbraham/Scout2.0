# Scout product design review

Reviewed 2026-09-12 against `822db17`, including the all-agents revision. Source: [product design](../superpowers/specs/2026-09-12-scout-product-design.md). This is an independent assessment; recommendations below are not approved changes to product scope. The source snapshot remains unchanged.

## Hackathon assessment — updated after user clarification

The original assessment below used a production-readiness bar. That is too broad for the immediate hackathon goal. The proposal has a strong demo story: turn an apartment alert into a real broker conversation and a booked tour. Its biggest hackathon weakness is scope, not the choice of stack or lack of an agent framework.

**Keep:** one polling worker, Postgres state, fetch-first generic extraction, one conversation per pursuit, and a visible escalation queue. These are sensible shortcuts.

**Build first:** one connected demo owner, StreetEasy only, simple hard filters plus optional LLM preference scoring, verified contact discovery, and a reviewable tour email. Then show one reply advancing pursuit state; add calendar booking if time permits. A controlled demo account is sufficient if the app is actually restricted to it. Do not claim multi-tenant support from that demonstration.

**Still matters for a demo:** correct apartment/unit and recipient, no blind retry after an uncertain real send, explicit tool permissions outside email content, and state that reflects what actually happened. A simple manual-review outcome for uncertainty is enough; a generalized action system is not needed to demonstrate the loop. Use synthetic application files if showing the packet flow.

**Defer:** broad brokerage coverage, Apartments.com, roommates, automatic sensitive-packet release, natural-language SQL, and comprehensive recovery/operations. The earlier P1 findings apply before enabling their affected features for real users; they do not require building every safeguard before a controlled demo.

**Verdict:** good product pitch, oversized hackathon implementation plan. Agree the single happy path and minimal shared schema, then build it. The detailed findings remain useful as a backlog and as boundaries on what the demo can honestly claim.

## Assessment

The core loop, separate escalation flag, durable pursuit state, and modest worker architecture are sensible. The document is useful product direction, but not an implementation-ready contract for unattended email, booking, or document release. Its claim that these are shallow subsystems understates failure recovery and authorization work.

Keep the no-framework approach, fetch-first enrichment, and explicit human lease decision. Resolve the P1 findings before building external actions. P1 means a correctness or access boundary required before enabling the affected feature; P2 means a material contract or execution gap.

## P1 findings

### 1. Multi-tenancy lacks an ownership and authorization model

**Where:** §§1, 4 (roommates), 8. **Evidence:** the current [schema](../../backend/src/db/schema.ts) has only global listings, with no tenant keys. The proposal says multi-tenant from day one but also "no roles or permissions."

An invitee's access to shared listings does not establish permission to read another member's ID, change the owner's profile, or cause the owner's Gmail to send documents. Moving tokens into a database without an access contract can expose credentials to the same clients that read dashboard rows.

**Proposed correction:** choose account/household ownership, explicit membership and invite lifecycle, and the allowed readers/writers for each table and document. Keep Google tokens server-only, encrypted with separately managed key material, with disconnect/revocation handling. Choose browser RLS access versus server-authorized mutations explicitly; also scope privileged worker queries by tenant. A custom role editor can remain out of scope while these checks still exist. Supabase Storage supports RLS and its service key bypasses access controls, so a private bucket alone is not the complete boundary. [Supabase access-control documentation](https://supabase.com/docs/guides/storage/security/access-control).

**Acceptance:** two-account tests deny cross-tenant reads and writes, revoked invites lose access, document visibility matches the chosen sharing policy, and no browser query can retrieve OAuth secrets.

### 2. A processed-message table does not make external actions effectively once

**Where:** §5, "Idempotency is mandatory."

Counterexample: Gmail accepts the first email; the worker crashes before persisting `thread_id` and the processed marker; replay sends again. Marking the message processed before sending instead risks silently losing the action. A database transaction cannot atomically include Gmail or Calendar.

**Proposed correction:** retain inbox deduplication but add persisted action intents, unique logical action keys, claimed work with lease/locking, attempt state, provider identifiers, and explicit uncertain outcomes. Reconcile ambiguous sends before any retry; if success cannot be established, require review rather than promise exactly-once delivery. Persist cap reservations atomically so retries and concurrent turns cannot exceed the daily limit. Apply the same design to packets and calendar writes. A Postgres-backed action table does not require a separate queue service.

**Acceptance:** inject crashes before/after provider acceptance, replay messages, and run overlapping worker claims. No blind duplicate send or booking; unresolved outcomes remain visible and recoverable.

### 3. Document sending has no release policy or recipient boundary

**Where:** §§3–5, automated `send_packet` and autonomous replies.

The proposed packet contains IDs and bank statements. A broker's request, a forwarded thread, or an instruction embedded in email/web content must not itself authorize arbitrary recipients or attachments. A generic leasing inbox suitable for a tour question is not automatically a verified application recipient. Portal detection alone does not define this boundary.

**Proposed correction:** specify enrollment consent for automation, document-owner sharing consent, permitted packet versions and recipients, and what recipient changes require review. Validate these outside the LLM. Treat incoming mail and scraped pages as data, never tool authority. Add pause/revoke controls, attachment access/retention rules, and an audit trail of recipient, packet version, and action outcome. When policy is unresolved, create a reviewable packet draft. Do not silently change the intended eventual automation boundary.

**Acceptance:** a malicious email cannot cause unrelated files or roommate documents to be sent; a changed address or revoked consent blocks disclosure; permitted automated sends record exactly what was released.

### 4. Deduplication mixes source identity with user interest

**Where:** §§4–5, global `rental_id` upsert and "score new ones."

StreetEasy's ID is not an Apartments.com namespace. If user A already imported a global listing, treating only newly inserted rows as match candidates can prevent user B from ever being scored. Price changes and profile changes also disappear from that trigger. The current [importer](../../backend/scripts/importListings.ts) updates only brokerage on conflict, leaving price and observation timestamps stale.

**Proposed correction:** identify listings by `(source, source_listing_id)`; store per-tenant observations and pursuits separately, with a unique pursuit rule. Define rescoring on new user observation, relevant listing changes, and profile revision. Preserve evidence timestamps and decide how relistings/campaigns relate; cross-source merging requires evidence, not bare address equality.

**Acceptance:** the same alert is replay-safe, two users both receive independent matching, equal IDs from different providers do not collide, and a changed rent/profile causes the documented rescore behavior.

### 5. Generic extraction dropped the listing-verification contract

**Where:** §6 compared with [names.ts](../../backend/src/enrichment/names.ts).

Changing extraction strategy is reasonable; discarding exact unit, campaign recency, brokerage attribution, and evidence is not. A generic model can accurately extract every person from the wrong page. "General leasing address ... nearly always resolves" and "long tail costs nothing extra" are unsupported availability and cost claims. Discovery of the correct listing page/search provider is also unspecified.

**Proposed correction:** retain verification before extraction, evidence URLs/timestamps, and distinct matched, review, not-found, blocked, and error states. Define a generic discovery route and bounded fetch/render/model budgets. Cache per-listing evidence with expiry and invalidation; an agent roster is time-sensitive, not inherently uncacheable. Never infer a deliverable address from an email pattern. Treat a general inbox as a separately verified brokerage fallback and report partial contact coverage honestly.

**Acceptance:** a manually labeled pilot includes wrong units, old campaigns, syndication, multi-agent rosters, unavailable pages, and unknown firms. Report false attribution, roster/contact coverage, review rate, and cost; choose thresholds before scaling. Original corpus figures were not independently reproduced here.

## P2 findings

### 6. One outbound thread does not guarantee every reply stays in it

**Where:** §§5–6. The spec forbids inferring primary status but requires primary in `To`, leaving unlabelled rosters undefined. A broker can start a new subject/thread or discuss another listing in an existing conversation.

**Proposed correction:** when no primary is labeled, define an explicit addressing policy, such as all verified contacts in `To`, without inventing roles. Scope thread lookup by connected mailbox and tenant. Persist provider and RFC message identifiers; use an explicit review flow for ambiguous new threads rather than treating them as noise or guessing. Define reply-all and recipient-change behavior. Gmail documents that adding a message to a thread requires `threadId`, compliant `References`/`In-Reply-To`, and a matching subject. [Gmail thread guide](https://developers.google.com/workspace/gmail/api/guides/threads).

**Acceptance:** cover unlabelled co-agents, changed subjects, new threads, unrelated participants, self-sent mail, and multiple listings in one conversation.

### 7. Ingestion and worker recovery are incomplete

**Where:** §5. No bootstrap, pagination/checkpoint boundary, disconnected account behavior, failure isolation, or cursor reset is specified. Gmail returns 404 for expired history IDs and requires full synchronization. [Gmail synchronization guide](https://developers.google.com/workspace/gmail/api/guides/sync).

**Proposed correction:** persist fetched work before advancing each mailbox checkpoint; deduplicate bootstrap/resync; distinguish sent mail from actionable replies. Give each tenant bounded work and per-operation timeouts so a slow brokerage does not block everyone. Define reconnect, backoff, retry exhaustion, health monitoring, and due-action processing for follow-ups even when no new mail arrives.

**Acceptance:** replay paginated history, expire the cursor, disconnect one account, and stall an enrichment request without losing messages or starving other accounts.

### 8. State transitions and tool execution are underspecified

**Where:** §§3–5. Tracker stages omit matching/enrichment, rejection/withdrawal and failed actions. `mark_dead` has no corresponding state. There is no reliable event proving a tour happened. Clearing a single flag can also resume a pursuit while another blocker persists.

**Proposed correction:** define the transition table, valid actors, evidence requirements, blocker resolution semantics, optimistic versioning, and idempotent resume actions. Scope remembered answers to the listing or profile as appropriate; an answer about this apartment should not silently become a universal preference. Define a bounded model/tool loop: availability results must be inspected before booking, and failed tools must not advance stage. Stateless turns can still need multiple model calls.

**Acceptance:** stale UI resolves cannot overwrite newer replies, multiple blockers resolve correctly, and failed sends/bookings do not appear completed in the tracker.

### 9. Calendar booking needs a conflict and lifecycle contract

**Where:** §§3–4. Free/busy is a read, not a reservation; two pursuits can choose the same slot. Duration, timezone/DST, travel buffers, explicit confirmation, cancellation, and rescheduling are unspecified.

**Proposed correction:** define these rules, recheck before writing, serialize Scout's competing bookings, and persist event IDs with action recovery. Describe the remaining race with external calendar edits and how conflicts reach the user. Do not equate elapsed event time with confirmed attendance.

**Acceptance:** test competing pursuits, changed availability, DST boundaries, provider timeout, cancellation, and rescheduling.

### 10. Natural-language filtering has neither a safe query contract nor sufficient data

**Where:** §4. The sample dishwasher filter has no corresponding listing column. "Haven't toured" belongs to pursuits, not listing facts. Model-generated SQL can alter predicate precedence and weaken tenant filtering if concatenated into a query.

**Proposed correction:** have the model return a typed filter object with allowed fields/operators; server code builds parameterized queries and supplies immutable tenant scope. Define supported joins and unknown-value behavior. Budget/bedroom hard constraints can run deterministically before subjective model scoring. Defer unsupported amenity searches until ingestion provides evidence.

**Acceptance:** malicious filters cannot escape tenant scope; unsupported dishwasher queries return an explicit limitation; missing data is not treated as a confirmed match or non-match without a defined rule.

### 11. Build contracts and verification are not ready for the proposed split

**Where:** §§8–9 and historical frontend docs. The schema is under `backend/`, while the UI needs authenticated reads and writes, OAuth callbacks, uploads, and escalation commands. "Never touches the backend" does not specify who provides those interfaces.

**Proposed correction:** agree shared types, enum/transition ownership, RLS or API mutation boundaries, OAuth callback ownership, seed fixtures, and migration review responsibility. Include Google app consent/scopes and production connection setup as implementation prerequisites. Restore real lint/test gates. Tracked initial migrations exist, but the ignore rule can hide future generated migrations.

**Acceptance:** a clean checkout can apply tracked migrations and run meaningful checks; both tracks use the same versioned contracts and fixtures. The old frontend plan is historical, not a current checklist.

## Recommended implementation gate

Before splitting feature work, agree a compact schema/state contract resolving findings 1–4 and 8. Then prove one StreetEasy ingestion-to-draft path, including contact evidence and replay behavior. Add bounded live outreach, tours, and packet release only as their acceptance checks pass. Roommates, additional sources, and natural-language search can follow the same contracts without turning the first milestone into the entire product.

This review changed documentation only. No application behavior, live account, database, or original design snapshot was changed. Current command results and limitations are recorded in [context.md](../../context.md).
