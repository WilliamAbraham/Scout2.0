# Scout

Automating NYC apartment hunting. The repo includes a persisted, draft-only worker and a Next.js/Supabase dashboard with an interactive public demo. Live email sending and calendar execution remain pending.

## Start here

- [Person B handoff](docs/2026-09-12-person-b-handoff.md): frontend integration requirements and backend status at handoff; see the [implemented contract](docs/hackathon-contract.md) for current behavior.
- Backend completion handoffs: [Codex](docs/backend/Codex.md) (enrichment and costs), [Claude](docs/backend/Claude.md) (ingestion and continuous worker), and [Cursor](docs/backend/Cursor.md) (outreach and conversations). These are pending implementation assignments.
- [Project](project.md): intended experience, architecture, scope, and work division.
- [Engineering context](context.md): current implementation, setup, commands, check failures, and next work.
- [Inbox/process review](docs/reviews/2026-09-12-inbox-process-review.md): listing intake, status mapping, and inbox layout proposal implemented in the dashboard.
- [Verified broker discovery](docs/enrichment/fatma-live-result-2026-09-12.md): original address-only input independently found Fatma Kara in 7.9 seconds for 0.34¢; personal contact details remain unverified.
- [Earlier enrichment cost benchmark](docs/enrichment/mini-cost-benchmark-2026-09-12.md): four new listings cost 2.08¢ total; that run found no named brokers.
- [Design review](docs/reviews/2026-09-12-product-design-review.md): prioritized findings and acceptance checks.
- [Product design](docs/superpowers/specs/2026-09-12-scout-product-design.md): product proposal and two-person hackathon plan.

## Dashboard preview

Open `/` after starting the frontend for the interactive demo. The agentAI-inspired shell now puts a wide, grouped inbox in the main workspace and the selected apartment's current action at the top of its detail pane. Navigation separates **Active**, **All listings**, and **Closed**, with a **Needs you** shortcut. List/Map switches the main workspace; mobile opens details as a separate pane.

The typed model distinguishes incoming assessment (Checking fit, Matched, Not a fit, Dismissed), pursuit stage, blockers, and explicit worker activity. Eight fictional examples cover intake, non-matches, contact research, queued outreach, broker waiting and tours. Answer and contact submissions create demo receipts; they preserve stage and never manufacture a sent reply, verified contact or booking. Undo, stop/restore pursuit, dismiss/restore incoming listing, pause, search and filters are available.

`/dashboard` reads owner-scoped listing, pursuit, event, Gmail-health and profile records. It displays recorded drafts separately from sent messages and exposes contact supply, close pursuit, and pause/resume through session-authorized Server Actions. Other blocker resolutions remain placeholders. Password login lands here; successful live owner reads/writes, deployed RLS, and deployment remain unverified. See the [dashboard–worker contract](docs/hackathon-contract.md) for exact semantics and remaining worker limits.

Apartment overviews show recorded beds, baths, neighborhood and brokerage, a rent-only 12-month calculation, and the difference from the saved rent limits. The public demo uses an explicitly labeled sample budget. An expandable **Before you tour** checklist includes listing unknowns and personal must-haves/dealbreakers. Listing source details show when the alert was received and last observed, without claiming that availability or current price was rechecked. Amenities, fees, lease terms and square footage are still unconfirmed; this UI adds no external enrichment lookup.

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

The intended ports are 3000 for the frontend and 4000 for the backend. Use Node 24; Node 22 requires `NODE_OPTIONS=--experimental-strip-types` for the test runner. Root `yarn lint` currently has no script. See [engineering context](context.md) for checks after integrating the persisted worker, frontend inbox, and broker discovery fix.
