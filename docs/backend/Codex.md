# Codex — broker enrichment and cost controls

## Outcome

Provide the enrichment stage used by the continuous backend: a parsed listing becomes supported broker identities and verified contact routes, or an explicit unresolved result. This is a work assignment, not a claim that the integration is complete.

The complete split is [Claude: ingestion and worker](Claude.md), **Codex: enrichment**, and [Cursor: outreach and conversations](Cursor.md). First release targets one connected mailbox and initial outreach; replies and follow-ups follow in the same outreach workstream. Calendar, application documents, and multi-user onboarding are later milestones.

## Starting point

`backend/src/enrichment/agent.ts` (`enrichWithAgent`) is the only enrichment engine. The worker, one-email runner and CLIs call it through `enrichForPipeline`. At budget `$0` it uses StreetEasy + people search and reviewed direct adapters; a positive `SCOUT_ENRICHMENT_BUDGET_USD` pays for OpenRouter discovery. The agent independently identified Fatma Kara for 620 East 6th Street #9A; that run cost $0.003407284, but her personal email and phone remain unverified. One successful broker identification does not establish general recall or an outreach-ready contact.

Local uncommitted work observed on September 12 includes `backend/scripts/runAlert.ts` and `backend/src/enrichment/agentContacts.ts`. Coordinate with their author and reuse reviewed work; do not overwrite it or assume it is merged.

## Work

1. Expose one reusable enrichment entry point for both the one-email runner and continuous worker. Preserve listing URL, exact address/unit, brokerage, available office address, and listing facts. Keep source validation and bounded recovery from the current agent.
2. Provide a contact adapter for the worker. Distinguish supported listing agents, verified building/company routes, unsupported candidates, and unavailable contacts. Preserve evidence and checking time. A name without a verified email cannot authorize email outreach; an office address must not become a person's address.
3. Return explicit outcomes for success, missing contact, transient source failure, and exhausted budget. Claude handles durable retries; specify which outcomes are retryable and when. Do not repeatedly charge for permanent failures.
4. Add persistent spend accounting and reusable caching. Share a daily budget across enrichment and Cursor's drafting calls, survive restarts, reserve before requests, and stop new paid requests when usage is unknown or the budget is exhausted. Document that admission estimates do not guarantee an in-flight provider bill cannot exceed its reservation.
5. Keep the low-cost model and bounded requests. Report API cost, cache hits, contact coverage, and unresolved cases separately; do not substitute cheap results for correct results.

## Ownership and interfaces

Own `backend/src/enrichment/`, enrichment fixtures/tests, and enrichment documentation. Deliver an adapter returning `ContactSnapshot | null`, the evidence summary, cost, and processing outcome; agree its exact TypeScript type with Claude before integration. Deliver a spend reservation/settlement API that Cursor can use without importing enrichment prompts.

Claude owns worker wiring and the existing pipeline/store files. Supply integration instructions rather than editing those files concurrently. Coordinate schema additions and migration numbering with Claude. Cursor consumes supported contacts and never promotes unresolved candidates to recipients.

## Done when

- The original Fatma listing fixture finds Fatma without seeding her name in runtime code, while the conflicting email remains rejected.
- Wrong-unit, wrong-brokerage, generic-office, blocked-page, and no-contact cases produce the appropriate outcomes.
- Restart and retry tests show cached work is reused and the shared spending allowance is preserved.
- Claude's actual worker invokes this entry point; a CLI-only success is insufficient.
- Report offline checks separately from any authorized paid test. Record actual spend and evidence; never claim unverified contact details are confirmed.

Use a feature branch and PR, keep changes focused, run the repository checks and relevant TypeScript checks, and update verified status in the relevant docs. Root `yarn lint` currently has no script; report that limitation rather than claiming it passed.
