# Scout: product and architecture

## Purpose and document map

Scout aims to automate NYC apartment hunting from listing-alert emails through broker conversations, tours, and applications. This is the intended product, not a description of completed functionality.

- [context.md](context.md): code inventory, commands, verified status, and next work.
- [Product design snapshot](docs/superpowers/specs/2026-09-12-scout-product-design.md): detailed proposal, updated with the hackathon split in §§8–9.
- [Design review](docs/reviews/2026-09-12-product-design-review.md): blockers, contradictions, and proposed corrections. Recommendations are not yet accepted product decisions.

## Backend completion ownership

The remaining backend work is divided into [Codex](docs/backend/Codex.md) (enrichment and costs), [Claude](docs/backend/Claude.md) (ingestion and continuous worker), and [Cursor](docs/backend/Cursor.md) (outreach and conversations). The first integrated milestone is one connected mailbox through real initial outreach; reply handling and follow-ups follow, with calendar, document release, and multi-user onboarding deferred. Each handoff defines file ownership, integration contracts, and acceptance checks. This is the current work split; it does not claim the backend is finished.

## Hackathon scope

The user clarified that this is a hackathon project. Optimize the first milestone for a credible end-to-end demonstration, not production completeness. The full proposal remains the product vision; the review now distinguishes demo-critical correctness from later hardening. Recommended demo: one connected owner, StreetEasy alerts, matching, evidence-backed contact resolution, and one tour-request conversation. Calendar booking is the next extension; roommates, automatic sensitive-document release, and natural-language search can wait. This is a sequencing recommendation, not an implemented scope change.

## Intended experience

An account owner connects Gmail and Calendar, creates StreetEasy or Apartments.com alerts themselves, and supplies a search profile. Scout ingests alerts, matches listings, resolves contacts, requests tours, handles replies, schedules confirmed tours, and sends application materials within the owner's authorization.

The implemented inbox retains agentAI's muted shell with compact navigation, a wide grouped row list, and an action-first apartment detail pane. Active pursuits are grouped into Needs you, Tours scheduled, Drafts ready, Scout working, Waiting for broker, and Recorded progress when work state is unknown. All listings includes checking, matched, non-matching and dismissed arrivals; Closed contains explicit stopped/completed pursuits. A received decision without closure evidence remains active. Map is an alternate area overview, and mobile uses a separate detail pane. Demo resolutions preserve stage and acknowledge submitted/queued work without inventing sends or bookings.

The authenticated `/dashboard` reads owner-scoped listings, pursuits, events, preferences and Gmail health. Recorded drafts, outgoing messages, follow-ups and valid tour times are projected from persisted payloads; unavailable replies and calendar metadata remain unknown. Contact supply, close pursuit and pause/resume are implemented through owner/state-checked Server Actions. Other blocker resolutions remain placeholders. The [dashboard–worker contract](docs/hackathon-contract.md) describes the current draft-only worker and in-flight cancellation limits. Live login, writes, deployed RLS and deployment remain unverified. The public `/` route keeps synthetic listings.

Apartment details add a compact facts snapshot, rent comparison against both budget bounds, rent-only 12-month arithmetic, recorded brokerage and alert observation dates. An expandable tour checklist carries listing unknowns and the profile’s must-haves/dealbreakers as questions, not verified amenities. Demo calculations use the sample profile. Real amenities, square footage, lease terms, fees and availability still need source-backed collection; no new crawler or paid enrichment runs are part of this frontend change.

Search preferences now lives at `/preferences`, linked from both inbox routes. It separates automatic rent/bedroom/bathroom limits from neighborhoods, must-haves, dealbreakers and notes used in broker outreach, with tour availability in its own section. Unknown room counts can still pass matching; new criteria apply only to newly evaluated listings, not the existing inbox or source alerts. A live summary and editable sample make the page usable before sign-in. Signed-in owners save only editable fields under their session owner and RLS, preserving agent answers, pause and send caps; a returned owner row is required for success. Failed reads block editing and failed saves retain drafts. Tour windows use New York time and blank windows mean flexible. Structured move-in/lease/amenity filters, timezone editing and Google connection setup remain backend work. Live reads, authenticated persistence and deployed RLS remain unverified.
Earlier UX research used [progressive disclosure guidance](https://www.nngroup.com/articles/progressive-disclosure/), [Google PAIR's transparency/control patterns](https://pair.withgoogle.com/guidebook-v2/patterns), and [Zillow's 2025 renter research](https://www.zillow.com/research/renters-housing-trends-report-2025-35647/). The latest screenshot-driven layout supersedes the earlier single-page/modal experiment. This is a product design decision, not a completed study with Scout users. Routine work within the owner's authorization should proceed without making the user approve every listing. The inbox prioritizes blockers and commitments; supporting activity is available on demand, and uncalibrated match scores are omitted.

The user requested implementation of the [inbox/process review](docs/reviews/2026-09-12-inbox-process-review.md). Its listing-assessment, independent blocker/stage, wider inbox and action-first detail direction is now implemented. Neutral Tours scheduled/Recorded progress groups avoid implying future appointments or running work without evidence. The implemented live action contract is documented for pipeline-owner review.
The proposed loop is:

`onboard → ingest → match → enrich → outreach → converse → schedule → apply`

Escalation is orthogonal to stage: the current schema uses a nullable `needsHumanReason` as the flag and preserves `stage`. The reason values are `no_contact`, `unanswerable_question`, `no_fitting_slot`, `portal_link`, `missing_document`, and `decision`. Each needs a corresponding dashboard resolve action. The implemented stage enum is `matched`, `contacted`, `tour_scheduled`, `toured`, `applied`, `decided`, `dead`; the hackathon prose's `ready_to_contact`/`closed` vocabulary needs reconciliation. The persisted worker records dry-run drafts without advancing to contacted; remaining blocker consumers and resume semantics still need implementation.

## Automation boundary in the proposal

| Action | Intended behavior |
|---|---|
| Parse and match | Automatic |
| Resolve contacts | Automatic; escalate if unresolved |
| Send outreach and replies | Automatic; escalate unanswered profile questions |
| Book a tour | Automatic when a confirmed slot fits availability |
| Send a packet | Automatic; escalate missing documents or application portals |
| Lease and final decision | Human decision |

The review calls for explicit recipient, document-sharing, stop, and recovery rules before implementing these external actions. A product ambition is not authorization for a development agent to send real email or documents.

## Technical direction

The repository uses npm workspaces, Node with direct TypeScript execution, strict TypeScript, Postgres/Supabase with Drizzle, and Next.js App Router with Supabase Auth, React, Tailwind v3, and shadcn/ui.

The proposal adds OpenAI for matching, extraction, conversation, and natural-language filtering; Supabase Storage for documents; one polling Node worker on Railway; and Vercel for the frontend. These services and integrations are proposed, not verified deployments.

Worker state lives in Postgres. A turn loads persisted pursuit state and its mail thread. No agent framework or separate queue service is proposed. Durable action records and bounded tool execution still need design; process simplicity does not supply retry correctness.

The implemented schema separates global listings keyed by StreetEasy `rental_id`, per-user `user_listings` with match results, and per-user pursuits with blockers, thread references and event records. RLS policies and separate Google token storage exist in source; live migration/access behavior was not verified in this review. The older importer writes global listings only; the persisted worker now ingests per-user records, matches and composes drafts. Dashboard contact/close/pause commands are implemented. Live outreach, calendar execution and shared-household membership remain unresolved.

## Contact enrichment direction

Contact visibility fix (2026-09-12): persist brokerage contact routes in enrichment events and display them alongside recovered agents even when email outreach is blocked. Inbox rows show the brokerage and recovered channels; details show phone, email, evidence and retrieval time. Office routes and unit conflicts remain explicitly labeled and separate from outreach recipients. Centennial's catalog footer supplies an office fallback when exact-unit discovery fails. The saved #3 and #6-5 Mott Street events were repaired from existing cached sources without changing pursuit state or sending messages.

Verified broker discovery (2026-09-12): the OpenRouter agent independently finds **Fatma Kara at FIND Real Estate for 620 East 6th Street #9A**, using the original listing fields without a seeded name or URL. It generates one candidate URL, validates the live page heading/rent, then extracts its broker section. The fresh run cost **0.34¢** in 7.9 seconds. Offline auditing rejects the conflicting-brokerage email returned by contact search; personal contacts remain unverified. That upstream snapshot passed 154 tests. The worker provider is unchanged, and general recall is not established. See the [live report](docs/enrichment/fatma-live-result-2026-09-12.md).

Current measured status (2026-09-12): the optional GPT-4.1 Mini / OpenRouter path processed four new listings for 2.08¢ total, but returned no named brokers and only three generic company contact channels. It does not yet meet the listing-agent enrichment goal. The [live cost report](docs/enrichment/mini-cost-benchmark-2026-09-12.md) separates API execution from contact quality; lower spend alone is not a release criterion.

Use generic fetch and extraction, with Playwright only when rendering is required. Do not scrape StreetEasy rental pages; resolve the canonical URL from the alert's redirect headers. Preserve verified brokerage identity and office address, especially for similarly named firms.

Capture every explicitly attributed listing agent, including profile URL and source order. Do not infer primary status from order. The proposal prefers one outreach message to the verified contact set, with a general leasing inbox as fallback. Verification, contact freshness, unknown-primary addressing, and split-thread handling remain open in the review.

The corpus counts in the snapshot are reported pilot observations; they were not reproduced in this review. They do not establish generic extraction accuracy or guaranteed general-inbox availability.

## Scope and work division

Proposed exclusions: StreetEasy page scraping, per-brokerage scraper adapters, vector search, SMS/phone outreach, automated portal completion, and lease signing. The spec also excludes roommate roles; baseline membership and document access controls still require a decision.

The [hackathon split](docs/superpowers/specs/2026-09-12-scout-product-design.md#8-two-person-hackathon-split) assigns A the entire agentic pipeline: ingestion, matching, enrichment, Gmail conversation, Calendar integration, schema, and worker orchestration. B owns the dashboard: profile, listings, pursuit details, escalation resolution, tour display, authorized command submission, and demo presentation. Both first agree a minimal contract and fixture scenarios, then integrate on the first persisted pursuit.

Milestones: shared contract → alert on dashboard → verified contact and one outreach email → reply and optional calendar booking → rehearsal. Reserve the final quarter for integration. The minimum demo ends at a visible reply/state update; roommates, additional sources, packet sending, and natural-language search remain deferred. This plan is documentation, not implemented functionality.
