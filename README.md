# Scout

Automating NYC apartment hunting. Today the repo contains a single-user StreetEasy email ingestion pipeline, a Postgres listings schema, and a Next.js/Supabase frontend with an interactive sample dashboard. The autonomous apartment-hunting product is proposed, not implemented.

## Start here

- [Project](project.md): intended experience, architecture, scope, and work division.
- [Engineering context](context.md): current implementation, setup, commands, check failures, and next work.
- [Inbox/process review](docs/reviews/2026-09-12-inbox-process-review.md): proposed listing intake, status mapping, and inbox layout grounded in current code.
- [Design review](docs/reviews/2026-09-12-product-design-review.md): prioritized findings and acceptance checks.
- [Product design](docs/superpowers/specs/2026-09-12-scout-product-design.md): product proposal and two-person hackathon plan.

## Dashboard preview

Open `/` after starting the frontend for the interactive demo. The agentAI-inspired shell now puts a wide, grouped inbox in the main workspace and the selected apartment's current action at the top of its detail pane. Navigation separates **Active**, **All listings**, and **Closed**, with a **Needs you** shortcut. List/Map switches the main workspace; mobile opens details as a separate pane.

The typed model distinguishes incoming assessment (Checking fit, Matched, Not a fit, Dismissed), pursuit stage, blockers, and explicit worker activity. Eight fictional examples cover intake, non-matches, contact research, queued outreach, broker waiting and tours. Answer and contact submissions create demo receipts; they preserve stage and never manufacture a sent reply, verified contact or booking. Undo, stop/restore pursuit, dismiss/restore incoming listing, pause, search, filters and read-only preferences are available.

`/dashboard` adds an authenticated, read-only view over the existing Supabase `user_listings`, listing/pursuit/event, Gmail health and profile schema. Successful password login now lands there. Reads validate the session and filter by user ID under RLS; missing records and connection errors have explicit states. The deployment/population of those tables and successful live reads remain unverified. Live commands, messages and typed tour details need the backend worker contract and are not simulated in this view.

Public demo data is synthetic and resets on refresh. The map is an external OpenStreetMap area overview without listing pins; it requires network access. No original photos or source links are fabricated. No email, calendar, database mutation or background worker action is submitted by these interfaces.

## Local development

Use Node 24 and install from the repository root:

```sh
npm ci
```

Configure frontend Supabase variables using `frontend/.env.example` as the template for `frontend/.env.local`. Backend database scripts use root `.env` with `DATABASE_URL`; Gmail scripts require local OAuth credentials. See [context.md](context.md) before running scripts that access live accounts or write data.

Run in separate terminals:

```sh
npm run dev:web
npm run dev:api
```

The intended ports are 3000 for the frontend and 4000 for the backend. Root `yarn lint` currently has no script. `yarn test` passed 72 backend tests and 8 frontend inbox tests on 2026-09-12; this does not verify a connected agent pipeline.
