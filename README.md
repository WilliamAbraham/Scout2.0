# Scout

Automating NYC apartment hunting. Today the repo contains a single-user StreetEasy email ingestion pipeline, a Postgres listings schema, and a Next.js/Supabase frontend with an interactive sample dashboard. The autonomous apartment-hunting product is proposed, not implemented.

## Start here

- [Person B handoff](docs/2026-09-12-person-b-handoff.md): backend integration status and proposed next frontend work.
- [Project](project.md): intended experience, architecture, scope, and work division.
- [Engineering context](context.md): current implementation, setup, commands, check failures, and next work.
- [Inbox/process review](docs/reviews/2026-09-12-inbox-process-review.md): proposed listing intake, status mapping, and inbox layout grounded in current code.
- [Enrichment cost benchmark](docs/enrichment/mini-cost-benchmark-2026-09-12.md): four new listings cost 2.08¢ total; named-broker discovery remains unresolved.
- [Design review](docs/reviews/2026-09-12-product-design-review.md): prioritized findings and acceptance checks.
- [Product design](docs/superpowers/specs/2026-09-12-scout-product-design.md): product proposal and two-person hackathon plan.

## Dashboard preview

Open `/` after starting the frontend for the interactive demo. The agentAI-inspired shell now puts a wide, grouped inbox in the main workspace and the selected apartment's current action at the top of its detail pane. Navigation separates **Active**, **All listings**, and **Closed**, with a **Needs you** shortcut. List/Map switches the main workspace; mobile opens details as a separate pane.

The typed model distinguishes incoming assessment (Checking fit, Matched, Not a fit, Dismissed), pursuit stage, blockers, and explicit worker activity. Eight fictional examples cover intake, non-matches, contact research, queued outreach, broker waiting and tours. Answer and contact submissions create demo receipts; they preserve stage and never manufacture a sent reply, verified contact or booking. Undo, stop/restore pursuit, dismiss/restore incoming listing, pause, search and filters are available.

`/dashboard` adds an authenticated view over the existing Supabase `user_listings`, listing/pursuit/event, Gmail health and profile schema. Listing and pursuit records remain read-only. Successful password login now lands there. Reads validate the session and filter by user ID under RLS; missing records and connection errors have explicit states. The deployment/population of those tables and successful live reads remain unverified. Live commands, messages and typed tour details need the backend worker contract and are not simulated in this view.

**Search preferences** is writable for signed-in users on both `/` and `/dashboard`. The single panel loads or creates their profile, validates rent/room bounds and weekly tour windows, and saves only editable criteria through a session-authorized Server Action. Signed-out visitors see a read-only sample; failed profile reads block editing. Gmail connection metadata is shown, but Google connection setup, move-in and editable timezone await backend support. Tour windows use New York time. Authenticated persistence and deployed RLS have not been exercised yet.

Public demo listings are synthetic and reset on refresh, including when a signed-in user edits their real preferences. The map is an external OpenStreetMap area overview without listing pins; it requires network access. No original photos or source links are fabricated. Profile saves do not send email, book tours or invoke the worker; learned answers, pause state and send caps are untouched.

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

The intended ports are 3000 for the frontend and 4000 for the backend. Root `yarn lint` currently has no script. See [engineering context](context.md) for checks after integrating the persisted worker and frontend inbox.
