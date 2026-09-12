# Scout

Automating NYC apartment hunting. Today the repo contains a single-user StreetEasy email ingestion pipeline, a Postgres listings schema, and a Next.js/Supabase frontend with an interactive sample dashboard. The autonomous apartment-hunting product is proposed, not implemented.

## Start here

- [Project](project.md): intended experience, architecture, scope, and work division.
- [Engineering context](context.md): current implementation, setup, commands, check failures, and next work.
- [Design review](docs/reviews/2026-09-12-product-design-review.md): prioritized findings and acceptance checks.
- [Product design](docs/superpowers/specs/2026-09-12-scout-product-design.md): product proposal and two-person hackathon plan.

## Dashboard preview

Open `/` after starting the frontend. The first dashboard iteration uses the local `agentAI` project as a visual/interaction reference: muted green surfaces, queue filters, status badges, and a selected listing brief. Search, sort, save, expand listing details, and confirm/undo the sample move-in request.

All displayed listings, scores, tours, and activity are fictional demo fixtures. Changes live in memory and reset on refresh. No backend commands or external messages are submitted. Existing auth routes remain available; live data integration awaits the shared pursuit/command contract.

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

The intended ports are 3000 for the frontend and 4000 for the backend. Root `yarn lint` currently has no script, and `yarn test` references a missing test file. Those are known baseline failures, not passing validation.
