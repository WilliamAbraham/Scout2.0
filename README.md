# Scout

Automating NYC apartment hunting. Today the repo contains a single-user StreetEasy email ingestion pipeline, a Postgres listings schema, and a Next.js/Supabase frontend with an interactive sample dashboard. The autonomous apartment-hunting product is proposed, not implemented.

## Start here

- Backend completion handoffs: [Codex](docs/backend/Codex.md) (enrichment and costs), [Claude](docs/backend/Claude.md) (ingestion and continuous worker), and [Cursor](docs/backend/Cursor.md) (outreach and conversations). These are pending implementation assignments.

- [Project](project.md): intended experience, architecture, scope, and work division.
- [Engineering context](context.md): current implementation, setup, commands, check failures, and next work.
- [Verified broker discovery](docs/enrichment/fatma-live-result-2026-09-12.md): original address-only input independently found Fatma Kara in 7.9 seconds for 0.34¢; personal contact details remain unverified.
- [Enrichment cost benchmark](docs/enrichment/mini-cost-benchmark-2026-09-12.md): four new listings cost 2.08¢ total; named-broker discovery remains unresolved.
- [Design review](docs/reviews/2026-09-12-product-design-review.md): prioritized findings and acceptance checks.
- [Product design](docs/superpowers/specs/2026-09-12-scout-product-design.md): product proposal and two-person hackathon plan.

## Dashboard preview

Open `/` after starting the frontend. The dashboard follows the local agentAI reference: a compact inbox rail, a central Map / Photos / Activity workspace, and a persistent apartment detail pane. Rows are grouped into **Needs you**, **Tours scheduled**, **Waiting for broker**, **Found**, and **Closed**, with text search and All / Needs you / Found / Contacted filters. On mobile, Inbox / Map / Details navigation shows one pane at a time.

Select an apartment to inspect its fit, unknowns, next step, and sample conversation. Confirm or suggest a move-in date, supply a missing broker email for verification, undo those changes, and stop/restore pursuits. Pause/resume and read-only search preferences live in the rail footer.

All apartments and activity are fictional fixtures. The map is an external OpenStreetMap area overview, requires network access, and deliberately has no fixture location pins. Photos have an explicit empty state; no original listing links are fabricated. Changes live in memory and reset on refresh. No backend commands or external messages are submitted. Existing auth routes remain available; live data integration awaits the shared pursuit/command contract.

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

The intended ports are 3000 for the frontend and 4000 for the backend. Root `yarn lint` currently has no script. `yarn test` passed all 154 tests after the broker discovery fix (Node 22 requires `NODE_OPTIONS=--experimental-strip-types`); the enrichment TypeScript check also passed.
