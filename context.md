# Scout: current engineering context

Updated 2026-09-12. Source baseline: `822db17` on `origin/main`. Code inspection is distinguished below from runtime verification. Start with [project.md](project.md) for product intent.

## Implemented in source

- Root npm workspaces: `@scout/backend` and `@scout/frontend`, with a tracked `package-lock.json`.
- `backend/src/gmail/auth.ts`: single-user, read-only Gmail OAuth using root `credentials.json` and `token.json`.
- `backend/src/gmail/mailbox.ts`: StreetEasy message discovery and raw cache under `data/`; full message retrieval prefers cache. No incremental history cursor.
- `backend/src/gmail/message.ts`: MIME flattening; `listings.ts`: Cheerio card parsing and a bounded HTTPS StreetEasy redirect resolver. The misspelled `.ListinCard-info--detailsContainer` selector matches source markup.
- `backend/src/db/schema.ts`: global listings table with unique numeric `rental_id`, listing facts, and timestamps. No tenant or pursuit schema.
- `backend/scripts/importListings.ts`: imports cached mail. On conflict it only fills missing brokerage; it does not refresh price or advance observation timestamps. This matters for matching and contact recency.
- `backend/src/db/index.ts`: root `.env` database connection, with prepared statements disabled for the pooler.
- `backend/src/index.ts`: HTTP `/health` only; default port 3000, overridden to 4000 by `dev:api`.
- Frontend: Next.js auth starter, session clients and `proxy.ts`, auth pages, and protected route. Starter tutorial/branding assets remain. No Scout listings dashboard.
- Enrichment browser/probe helpers exist. `backend/src/enrichment/names.ts` is a comment-only plan, not a working enrichment pipeline.

No implementation was found for multi-user Google OAuth, calendar integration, sending mail, matching, pursuits, application storage/sharing, roommate membership, natural-language search, or the proposed worker. No live service or deployment was tested.

## Commands and setup

Install dependencies from the repo root with `npm ci` using the existing lockfile. Do not introduce a Yarn lockfile merely because the house checks use Yarn. Nested workspace dependencies can result from normal version resolution; their presence alone does not prove an install ran in the wrong directory.

| Command from repo root | Purpose/status |
|---|---|
| `npm run dev:web` | Next development server on 3000 |
| `npm run dev:api` | Backend health server on 4000 |
| `npm run typecheck` | TypeScript checks across workspaces |
| `npm run lint -w frontend` | Frontend ESLint; no backend lint script |
| `npm run build -w frontend` | Frontend production build |
| `yarn lint` | Required convention; currently fails because root script is absent |
| `yarn test` | Required convention; backend script targets missing `src/gmail/listings.test.ts` |
| `npm run sync` | Gmail message corpus discovery/cache workflow |
| `npm run inspect -- <messageId>` | Inspect cached/raw mail; output can contain personal information |
| `npm run survey -- --offline` | Cached corpus survey |
| `npm run probe -w backend -- <url> <selector...>` | Inspect a brokerage page |
| `node backend/scripts/importListings.ts` | Import cached listings; writes to configured database |
| `npm run db:generate -w backend` | Generate Drizzle migration |
| `npm run db:migrate -w backend` | Apply migrations to configured database |
| `npm run extract` | Broken placeholder: `backend/scripts/extract.ts` does not exist |

Root `.env` supplies backend `DATABASE_URL`; `frontend/.env.local` supplies the two public Supabase variables documented in `frontend/.env.example`. Credentials, OAuth tokens, env files, and `data/` are ignored. Do not commit or print secrets or cached private mail.

The initial Drizzle migration and metadata are tracked, but `.gitignore` also ignores `backend/drizzle/`. Future migrations can therefore be omitted accidentally; resolve this before schema implementation.

Preserve strict compiler flags. Frontend uses Tailwind v3. Follow the generated guidance in `frontend/AGENTS.md` before frontend code changes; this documentation task leaves that file intact.

## Verification in this review

- Fetched origin and reviewed both new commits (`4c3f856`, `822db17`) on `codex/design-review`, starting from a clean working tree.
- Local runtime: Node `v24.11.1`, npm `11.14.1`, Yarn `1.22.22`.
- `yarn lint`: failed, missing root lint script.
- `yarn test`: failed, missing backend test file; no tests executed.
- `npm run lint -w frontend`: failed, `eslint` not installed.
- Dependencies are absent locally. Typecheck/build and live auth/database flows are not verified; no dependency installation was performed for this documentation-only review.
- Documentation validation: local Markdown links and `git diff --check` are checked before committing. These checks do not establish application correctness.

## Hackathon clarification

The user clarified that this project is for a hackathon. Prioritize a demonstrable vertical slice; production launch readiness is not the immediate success criterion. See the hackathon assessment at the top of the review before treating its P1 list as a blocker for all development. Personal root agent conventions are local-only and are not part of the shared documentation.

## Two-person execution plan

The design now assigns A the entire agentic pipeline, including ingestion/matching/enrichment, Gmail, Calendar, Google credentials, schema, and worker orchestration. B owns the dashboard, authorized UI command submission, escalation/tour views, and demo presentation. A executes commands and external actions; B displays persisted results. First agree the contract and seed scenarios together; `docs/hackathon-contract.md` is a planned implementation deliverable, not yet created. Integrate on the first persisted pursuit and reserve the final quarter for rehearsal.

## Remaining decisions and next work

See [the detailed review](docs/reviews/2026-09-12-product-design-review.md). For the demo, agree a minimal schema and state contract, restrict access to the intended demo account, and define send behavior before enabling real outreach. Full roommate boundaries and packet-release rules are required only when those features are enabled.

Restore working lint/test gates as focused implementation work; do not call the existing scripts passing checks. Establish the parser fixture baseline and migration reproducibility before building on the pipeline.

## Historical documents

The [product spec](docs/superpowers/specs/2026-09-12-scout-product-design.md) now includes the requested hackathon work split and milestones in §§8–9. The broader product proposal remains; the hackathon plan is not an implementation completion claim. The original revision is available at `822db17`.

The August [frontend spec](docs/superpowers/specs/2026-08-30-nextjs-frontend-design.md) and [implementation plan](docs/superpowers/plans/2026-08-30-nextjs-frontend.md) are historical. Do not rerun their scaffold/copy steps against the populated frontend. Their direct-to-main instruction is superseded by current working conventions. The spec requires branding removal while the plan excludes it; current source still contains branding. Their old claims about an empty frontend and absent listings table are stale.

The product spec supersedes `names.ts` on generic extraction versus dedicated adapters. Its verification/evidence guidance remains useful input, but contradictory plans must not be treated as a single executable contract.
