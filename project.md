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

The dashboard has a listings feed, a prominent **Needs you** queue, and an application tracker. Proposed extras include natural-language filtering and roommate invitations with shared listings and a shared application packet.

The proposed loop is:

`onboard → ingest → match → enrich → outreach → converse → schedule → apply`

Escalation is orthogonal to stage: a pursuit retains its stage while `needs_human` is set. Proposed reasons are `no_contact`, `unanswerable_question`, `no_fitting_slot`, `portal_link`, `missing_document`, and `decision`. Each needs a corresponding dashboard resolve action. The spec does not yet define complete stage transitions, multiple simultaneous blockers, or resume semantics.

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

Listings must retain source identity, while pursuits and inbox observations belong to an account/household. The exact tenant, membership, authorization, and data-access schema is unresolved. The existing global `rental_id` table is not that schema.

## Contact enrichment direction

Use generic fetch and extraction, with Playwright only when rendering is required. Do not scrape StreetEasy rental pages; resolve the canonical URL from the alert's redirect headers. Preserve verified brokerage identity and office address, especially for similarly named firms.

Capture every explicitly attributed listing agent, including profile URL and source order. Do not infer primary status from order. The proposal prefers one outreach message to the verified contact set, with a general leasing inbox as fallback. Verification, contact freshness, unknown-primary addressing, and split-thread handling remain open in the review.

The corpus counts in the snapshot are reported pilot observations; they were not reproduced in this review. They do not establish generic extraction accuracy or guaranteed general-inbox availability.

## Scope and work division

Proposed exclusions: StreetEasy page scraping, per-brokerage scraper adapters, vector search, SMS/phone outreach, automated portal completion, and lease signing. The spec also excludes roommate roles; baseline membership and document access controls still require a decision.

The [hackathon split](docs/superpowers/specs/2026-09-12-scout-product-design.md#8-two-person-hackathon-split) assigns A listing intelligence, Gmail conversation, schema, and worker orchestration. B owns the full-stack dashboard, UI commands, calendar tools, and demo presentation. Both first agree a minimal contract and fixture scenarios, then integrate on the first persisted pursuit.

Milestones: shared contract → alert on dashboard → verified contact and one outreach email → reply and optional calendar booking → rehearsal. Reserve the final quarter for integration. The minimum demo ends at a visible reply/state update; roommates, additional sources, packet sending, and natural-language search remain deferred. This plan is documentation, not implemented functionality.
