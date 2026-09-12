# Scout

Automating NYC apartment hunting. Today the repo contains a single-user StreetEasy email ingestion pipeline, a Postgres listings schema, and a Next.js/Supabase auth starter. The autonomous apartment-hunting product is proposed, not implemented.

## Start here

- [Project](project.md): intended experience, architecture, scope, and work division.
- [Engineering context](context.md): current implementation, setup, commands, check failures, and next work.
- [Design review](docs/reviews/2026-09-12-product-design-review.md): prioritized findings and acceptance checks.
- [Original product design](docs/superpowers/specs/2026-09-12-scout-product-design.md): preserved source proposal.

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
