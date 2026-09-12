# Scout: product and architecture

## Purpose and document map

Scout aims to automate NYC apartment hunting from listing-alert emails through broker conversations, tours, and applications. This is the intended product, not a description of completed functionality.

- [context.md](context.md): code inventory, commands, verified status, and next work.
- [Product design snapshot](docs/superpowers/specs/2026-09-12-scout-product-design.md): detailed proposal, updated with the hackathon split in §§8–9.
- [Design review](docs/reviews/2026-09-12-product-design-review.md): blockers, contradictions, and proposed corrections. Recommendations are not yet accepted product decisions.

## Hackathon scope

The user clarified that this is a hackathon project. Optimize the first milestone for a credible end-to-end demonstration, not production completeness. The full proposal remains the product vision; the review now distinguishes demo-critical correctness from later hardening. Recommended demo: one connected owner, StreetEasy alerts, matching, evidence-backed contact resolution, and one tour-request conversation. Calendar booking is the next extension; roommates, automatic sensitive-document release, and natural-language search can wait. This is a sequencing recommendation, not an implemented scope change.

## Intended experience

An account owner connects Gmail and Calendar, creates StreetEasy or Apartments.com alerts themselves, and supplies a search profile. Scout ingests alerts, matches listings, resolves contacts, requests tours, handles replies, schedules confirmed tours, and sends application materials within the owner's authorization.

The implemented inbox retains agentAI's muted shell with compact navigation, a wide grouped row list, and an action-first apartment detail pane. Active pursuits are grouped into Needs you, Tours scheduled, Scout working, Waiting for broker, and Recorded progress when work state is unknown. All listings includes checking, matched, non-matching and dismissed arrivals; Closed contains explicit stopped/completed pursuits. A received decision without closure evidence remains active. Map is an alternate area overview, and mobile uses a separate detail pane. Demo resolutions preserve stage and acknowledge submitted/queued work without inventing sends or bookings.

The authenticated `/dashboard` route reads existing per-user listing/pursuit/event, profile and Gmail-health records under the signed-in session; successful password login lands there. Listing and pursuit records remain read-only: command execution, full broker messages, typed tour/calendar details and the worker's next-action contract remain pending. The public `/` route keeps synthetic listings.

The simplified upstream profile design (`ce8c8df`) is integrated as one writable Search preferences dialog on both routes. Signed-in owners can create or update criteria and recurring tour windows; signed-out visitors see a sample. Failed reads block editing, and invalid saves retain drafts. The server writes only editable fields under the session owner and RLS, preserving agent answers, pause and send caps. Tour windows currently use New York time; move-in/timezone columns and Google connection setup remain backend work. Live reads, authenticated persistence and deployed RLS remain unverified.
Earlier UX research used [progressive disclosure guidance](https://www.nngroup.com/articles/progressive-disclosure/), [Google PAIR's transparency/control patterns](https://pair.withgoogle.com/guidebook-v2/patterns), and [Zillow's 2025 renter research](https://www.zillow.com/research/renters-housing-trends-report-2025-35647/). The latest screenshot-driven layout supersedes the earlier single-page/modal experiment. This is a product design decision, not a completed study with Scout users. Routine work within the owner's authorization should proceed without making the user approve every listing. The inbox prioritizes blockers and commitments; supporting activity is available on demand, and uncalibrated match scores are omitted.

The user requested implementation of the [inbox/process review](docs/reviews/2026-09-12-inbox-process-review.md). Its listing-assessment, independent blocker/stage, wider inbox and action-first detail direction is now implemented. Neutral Tours scheduled/Recorded progress groups avoid implying future appointments or running work without evidence. The proposed live action contract still needs agreement with the pipeline owner.
The proposed loop is:

`onboard → ingest → match → enrich → outreach → converse → schedule → apply`

Escalation is orthogonal to stage: the current schema uses a nullable `needsHumanReason` as the flag and preserves `stage`. The reason values are `no_contact`, `unanswerable_question`, `no_fitting_slot`, `portal_link`, `missing_document`, and `decision`. Each needs a corresponding dashboard resolve action. The implemented stage enum is `matched`, `contacted`, `tour_scheduled`, `toured`, `applied`, `decided`, `dead`; the hackathon prose's `ready_to_contact`/`closed` vocabulary needs reconciliation. No runtime worker transitions were found, and multiple blockers/resume semantics still need a contract.

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

The implemented schema separates global listings keyed by StreetEasy `rental_id`, per-user `user_listings` with match results, and per-user pursuits with blockers, thread references and event records. RLS policies and separate Google token storage exist in source; live migration/access behavior was not verified in this review. The current importer still writes global listings only. Runtime per-user ingestion, matching, commands, outreach and scheduling remain unimplemented; shared-household membership is also unresolved.

## Contact enrichment direction

Use generic fetch and extraction, with Playwright only when rendering is required. Do not scrape StreetEasy rental pages; resolve the canonical URL from the alert's redirect headers. Preserve verified brokerage identity and office address, especially for similarly named firms.

Capture every explicitly attributed listing agent, including profile URL and source order. Do not infer primary status from order. The proposal prefers one outreach message to the verified contact set, with a general leasing inbox as fallback. Verification, contact freshness, unknown-primary addressing, and split-thread handling remain open in the review.

The corpus counts in the snapshot are reported pilot observations; they were not reproduced in this review. They do not establish generic extraction accuracy or guaranteed general-inbox availability.

## Scope and work division

Proposed exclusions: StreetEasy page scraping, per-brokerage scraper adapters, vector search, SMS/phone outreach, automated portal completion, and lease signing. The spec also excludes roommate roles; baseline membership and document access controls still require a decision.

The [hackathon split](docs/superpowers/specs/2026-09-12-scout-product-design.md#8-two-person-hackathon-split) assigns A the entire agentic pipeline: ingestion, matching, enrichment, Gmail conversation, Calendar integration, schema, and worker orchestration. B owns the dashboard: profile, listings, pursuit details, escalation resolution, tour display, authorized command submission, and demo presentation. Both first agree a minimal contract and fixture scenarios, then integrate on the first persisted pursuit.

Milestones: shared contract → alert on dashboard → verified contact and one outreach email → reply and optional calendar booking → rehearsal. Reserve the final quarter for integration. The minimum demo ends at a visible reply/state update; roommates, additional sources, packet sending, and natural-language search remain deferred. This plan is documentation, not implemented functionality.
