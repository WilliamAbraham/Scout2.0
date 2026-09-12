# Running the Scout worker

The worker is the only process that touches the mailbox. One cycle polls
Gmail from a stored checkpoint, routes each message, persists every listing,
matches against the search profile, enriches broker contacts, then opens and
follows up on pursuits.

## Commands

From the repository root:

```bash
npm run worker                  # poll continuously
npm run worker -- --once        # a single cycle, then exit
npm run worker:status           # backlog, last run, and blocked work
```

`--once` is the dry cycle used for verification. Continuous mode polls every
`WORKER_POLL_MS` and handles `SIGINT`/`SIGTERM` by finishing the message in
flight, releasing the mailbox lease, and exiting.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | Postgres, from the root `.env` |
| `OPENROUTER_API_KEY` | required | Drafting model |
| `SCOUT_OWNER_USER_ID` | none | The one user this mailbox belongs to |
| `TAVILY_API_KEY`, `FIRECRAWL_API_KEY` | none | Enrichment sources |
| `SCOUT_CATCH_UP_DAYS` | 2 | Window a first run scans |
| `SCOUT_MESSAGES_PER_CYCLE` | 25 | Upper bound on mail fetched per cycle |
| `SCOUT_MAILBOX_QUERY` | none | Extra Gmail terms for a catch-up search |
| `WORKER_POLL_MS` | 300000 | Poll interval |
| `WORKER_LEASE_MS` | 600000 | Mailbox lease duration |

Gmail credentials come from `credentials.json` and `token.json` at the
repository root, with the read-only scope. Sending needs a scope this token
does not carry, which is why `--live` is still refused.

## Restart supervision

The process is stateless between cycles: everything it needs is in Postgres.
Run it under any supervisor that restarts on exit, for example a systemd unit
with `Restart=always`, or `pm2 start npm -- run worker`. A restart is safe at
any point, because the mailbox cursor only advances once every message in a
batch is durably accounted for.

## What keeps mail from being lost

- **Checkpoint.** `gmail_accounts.history_id` is Gmail's own cursor. A gap
  longer than Google's history retention falls back to a date-bounded search
  sized to the outage and capped at 14 days. A gap wider than the cap is
  reported as truncated rather than silently skipped.
- **Lease.** A cycle holds `worker_leases` for the mailbox and renews it
  between messages. A second worker declines the cycle instead of racing.
  A cycle still running when the timer fires is left alone.
- **Ledger.** `processed_messages` holds one row per message: `done`,
  `retry` with a backoff, or `exhausted` after four attempts. Exhausted mail
  stays visible in `worker:status`.
- **Order.** A message is marked handled only after every card it carried is
  completed, queued, skipped with a stated reason, or recorded as a visible
  failure. The cursor advances only when the whole batch reached that state.

## Alert layouts

`parseAlert` distinguishes three outcomes. A `listing_cards` alert is parsed
card by card, so one malformed card cannot discard its siblings. An
`unsupported` alert has rental links or a result count in its subject but
matched no card selector, which means the template changed; it is recorded
rather than treated as empty. An `empty` notice has neither.

StreetEasy caps a listing alert at five cards even when the subject claims
more results, so listings past the fifth never arrive by mail.

## Enrichment outcomes

`classifyEnrichment` decides whether paying again could change the answer.
A missing contact or an owner-listed apartment is permanent, so the pursuit
escalates to the **Needs you** queue. A dead source or an exhausted budget is
deferred: the pursuit keeps `enriched_at` null, no blocker is shown to the
owner, and the message returns after its backoff. Listings already enriched
are skipped on the retry, so nothing is charged twice.

## Limits

- `--live` is refused: `sendMail` is still a stub, so persisting sends would
  record mail that never left. Dry-run composes drafts and records them as
  `draft_composed` events.
- One local token means one mailbox. The worker refuses to start when more
  than one user has a search profile.
- Calendar booking and document release remain stubs.
