# Claude — email ingestion, persistence, and continuous worker

## Outcome

Deliver one runnable backend process that discovers incoming mail, parses every supported listing, persists progress, calls Codex enrichment, and hands eligible pursuits to Cursor outreach. This is a work assignment; live end-to-end operation is not yet complete.

The split is **Claude: ingestion and orchestration**, [Codex: enrichment and cost controls](Codex.md), and [Cursor: outreach and conversations](Cursor.md). Start with one explicitly connected mailbox. Multi-user OAuth onboarding, calendar, and application documents are later work.

## Starting point

`backend/scripts/worker.ts` already polls every five minutes and uses `PostgresStore`. It searches recent StreetEasy alerts, persists listings and pursuits, applies search-profile matching, and composes drafts. `--live` is refused. The separate `watchInbox.ts` only prints messages and uses an in-memory seen set.

`parseMessage` handles MIME bodies; `parseListing` recognizes `.ListingCard` HTML. Unsupported layouts can yield zero cards and still get marked processed. Gmail authentication uses one local read-only token, and the store currently reuses that mailbox for every active user. Preserve local uncommitted scripts and package changes; coordinate with their author.

## Work

1. Consolidate on one worker entry point. Polling is sufficient for the first release; use a durable mailbox checkpoint and bounded catch-up so restarts or more than two days of downtime do not silently lose mail. Prevent overlapping cycles and concurrent workers from processing the same mailbox/job.
2. Route new messages as listing alerts, broker replies, or unrelated mail. Preserve Gmail message/thread IDs, subject, sender, recipients, timestamps, and text/HTML bodies. Give Cursor replies with the correct pursuit and persisted thread history.
3. Support the observed alert and recommendation layouts. Validate listing fields and retain canonical URLs. Distinguish unsupported templates from genuinely empty alerts. Isolate malformed cards so one bad listing does not discard other valid cards.
4. Persist stage progress and errors. Deduplicate messages and listings, retry temporary failures with bounded backoff, and expose exhausted or unresolved work. Mark mail handled only after every card is durably represented as completed, queued, skipped for a stated reason, or failed visibly.
5. Wire Codex's shared enrichment adapter and Cursor's delivery service into the existing pipeline. Parse and persist all listings, then apply configured matching before enrichment/outreach. Keep unmatched listings visible rather than dropping them.
6. Enforce the one-owner mailbox mapping until per-user authentication exists. Coordinate the credential provider and send-scope reauthorization with Cursor; never process one mailbox as several users.
7. Add documented startup/configuration, graceful shutdown, restart supervision, and status reporting for last sync, backlog, failures, and spend. Keep dry-run free of delivery side effects even after the real sender is added. Enable live mode only when delivery is real and its configuration has been explicitly authorized.

## Ownership and interfaces

Own `backend/scripts/worker.ts`, Gmail discovery/parsing, `backend/src/pipeline/`, the worker loop in `backend/src/outreach/worker.ts`, and operational documentation/configuration. Coordinate shared schema exports, migration numbering, and root package scripts.

Codex owns enrichment internals and its cost ledger. Cursor owns sender/outbox implementation and outreach turns. The send/outbox contract is in [outreach-delivery.md](outreach-delivery.md) (`0004_black_falcon.sql`, `PostgresOutbox`). Agree the typed enrichment outcome and mailbox message envelope before wiring them. Integrate the outbox without inventing a second delivery queue. Pass `mailboxEmail` and persisted thread history into `loadTurnInput`.

## Done when

A fixture or controlled test demonstrates new mail → message parse → all listing records → matching → improved enrichment → outreach handoff. Duplicate mail, worker restart, concurrent ticks, malformed cards, unsupported templates, temporary failures, and budget exhaustion must not cause silent losses or duplicate outreach. A reply routes to the same pursuit after restart.

Document one command to run the process continuously and one to run a dry cycle. Run repository tests and relevant TypeScript checks; report the existing missing `yarn lint` script accurately. Final integration evidence must distinguish mocked delivery from an explicitly authorized controlled real send. Submit focused commits and a PR with updated setup and verified status.
