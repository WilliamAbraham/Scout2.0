# Scout: current engineering context

Updated 2026-09-12. Dashboard iteration started from `f6f8adf`; earlier source review used `822db17` on `origin/main`. Code inspection is distinguished below from runtime verification. Start with [project.md](project.md) for product intent.

## Latest enrichment cost test

On 2026-09-12, an approved $0.10 test processed all four listings from a different StreetEasy recommendation email with GPT-4.1 Mini / Parallel fast and a fresh local cache. Actual API-reported spend was $0.020800404 total (0.52¢ per listing), over eight stage requests and approximately 45 seconds. No named brokers were found; three listings returned generic company contact channels and one returned no contact details. This is a cost measurement, not successful listing-agent enrichment. See the [benchmark report](docs/enrichment/mini-cost-benchmark-2026-09-12.md).

The prompt now matches the two-search allowance and available search-only tool. `yarn test` passes all 123 tests and the enrichment TypeScript check passes. `yarn lint` was attempted but the root lint script is still absent. The older review and integration snapshots below retain their historical status; these latest test results supersede old missing-test claims. Raw email and API artifacts remain in ignored `data/` directories.

## Latest upstream integration

Pulled `origin/main` through `f9b1b76` on 2026-09-12 into `codex/dashboard-first-pass`. Resolved the `CLAUDE.md` conflict by retaining upstream backend guidance and local dashboard context.

- Added the onboarding/search-profile design spec, broker enrichment service and research, and multi-tenant pipeline schema with RLS policies under `backend/src/db/schema/`.
- Migration files are no longer ignored. Migrations were not applied to the live database during this pull.
- `yarn test` now discovers backend tests and passed all 72 tests. `yarn lint` still fails because the root lint script is absent.
- The public dashboard remains a local sample-data implementation. Live integration remains unverified.

The review and dashboard verification sections below describe earlier snapshots; this integration status supersedes their statements about absent tenant schema, enrichment implementation, ignored migrations, and the missing test target.

## Implemented in source at the earlier review

- Root npm workspaces: `@scout/backend` and `@scout/frontend`, with a tracked `package-lock.json`.
- `backend/src/gmail/auth.ts`: single-user, read-only Gmail OAuth using root `credentials.json` and `token.json`.
- `backend/src/gmail/mailbox.ts`: StreetEasy message discovery and raw cache under `data/`; full message retrieval prefers cache. No incremental history cursor.
- `backend/src/gmail/message.ts`: MIME flattening; `listings.ts`: Cheerio card parsing and a bounded HTTPS StreetEasy redirect resolver. The misspelled `.ListinCard-info--detailsContainer` selector matches source markup.
- `backend/src/db/schema.ts`: global listings table with unique numeric `rental_id`, listing facts, and timestamps. No tenant or pursuit schema.
- `backend/scripts/importListings.ts`: imports cached mail. On conflict it only fills missing brokerage; it does not refresh price or advance observation timestamps. This matters for matching and contact recency.
- `backend/src/db/index.ts`: root `.env` database connection, with prepared statements disabled for the pooler.
- `backend/src/index.ts`: HTTP `/health` only; default port 3000, overridden to 4000 by `dev:api`.
- Frontend: public `/` renders a three-pane agentAI-style sample workspace: searchable grouped apartment rows, Map/Photos/Activity center, and persistent selected-apartment overview/conversation/actions. Mobile switches among Inbox/Map/Details. Move-in response and missing-contact forms update the demo queues; undo, pause, stop/resume, and read-only preferences are available. OpenStreetMap provides an area overview without fixture pins; photos are unavailable. State is in memory. Auth/session clients, `proxy.ts`, auth pages, and protected route remain; unused starter assets still exist.
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
| `yarn test` | Required convention; passes 123 tests as of the latest enrichment cost test |
| `npm run sync` | Gmail message corpus discovery/cache workflow |
| `npm run inspect -- <messageId>` | Inspect cached/raw mail; output can contain personal information |
| `npm run survey -- --offline` | Cached corpus survey |
| `npm run probe -w backend -- <url> <selector...>` | Inspect a brokerage page |
| `node backend/scripts/importListings.ts` | Import cached listings; writes to configured database |
| `npm run db:generate -w backend` | Generate Drizzle migration |
| `npm run db:migrate -w backend` | Apply migrations to configured database |
| `npm run extract` | Broken placeholder: `backend/scripts/extract.ts` does not exist |

Root `.env` supplies backend `DATABASE_URL`; `frontend/.env.local` supplies the two public Supabase variables documented in `frontend/.env.example`. Credentials, OAuth tokens, env files, and `data/` are ignored. Do not commit or print secrets or cached private mail.

Local setup on 2026-09-12: the user-provided Supabase settings are configured in those ignored environment files. Environment parsing and required values were checked; live authentication and database connectivity remain unverified. Teammates must configure their own local copies; credentials are not included in Git.

The initial Drizzle migration and metadata are tracked, but `.gitignore` also ignores `backend/drizzle/`. Future migrations can therefore be omitted accidentally; resolve this before schema implementation.

Preserve strict compiler flags. Frontend uses Tailwind v3. Follow the generated guidance in `frontend/AGENTS.md` before frontend code changes; this documentation task leaves that file intact.

## Verification in this review

- Fetched origin and reviewed both new commits (`4c3f856`, `822db17`) on `codex/design-review`, starting from a clean working tree.
- Local runtime: Node `v24.11.1`, npm `11.14.1`, Yarn `1.22.22`.
- `yarn lint`: failed, missing root lint script.
- `yarn test`: failed, missing backend test file; no tests executed.
- Frontend ESLint now uses the Next.js flat configuration directly; the previous FlatCompat bridge failed with a circular-JSON error after installation. ESLint runs, but reports existing violations in `components/theme-switcher.tsx` (`set-state-in-effect`) and `tailwind.config.ts` (`no-require-imports`).
- Dependencies were installed with `npm ci` during the dashboard iteration. Live auth/database flows remain unverified. See the dashboard verification below for current frontend checks.
- Documentation validation: local Markdown links and `git diff --check` are checked before committing. These checks do not establish application correctness.

## Dashboard iteration verification

Reference: read-only inspection of local `agentAI/src/app/page.tsx` and `globals.css`. After the earlier minimal single-page experiment, the user supplied a screenshot and requested agentAI as the starting point. The current revision adopts its floating window, muted listing rail, aligned pane headers, central map, and persistent right inspector. It does not port agentAI's backend or outreach integrations. OpenStreetMap replaces the Google Maps dependency for the demo overview.

- `npm run build -w frontend`: passed.
- `npm run typecheck -w frontend`: passed.
- Targeted ESLint on the dashboard: passed.
- Full frontend lint has the two existing violations listed above. Root `yarn lint` and `yarn test` were rerun and still fail for the documented missing script/test file.
- Browser, three-pane revision: verified the map loads, supplied broker contact moves a row from Needs you to Found/awaiting verification, undo restores its blocker, and move-in confirmation moves a row to Waiting for broker. Apartment-specific Activity shows sample milestones. Search empty state and Show all recovery work.
- Visual inspection: desktop three-pane workspace and 375px mobile Inbox/Details views. Selecting a mobile row opens Details and Back to inbox returns to the rail. Mobile document width matched 375px. Full keyboard traversal and OS text scaling were not exercised for this revision.
- No live auth, persistence, ingestion, outreach, or calendar integration tested. The public homepage contains only synthetic fixtures; keep it that way until authenticated live-data integration is designed.

Delivery: pushed `codex/dashboard-first-pass` to `origin` on 2026-09-12 after switching the active GitHub account to `ktpei`. The branch tracks `origin/codex/dashboard-first-pass`; the earlier HTTP 403 access blocker is resolved. Main-branch integration is tracked in [PR #2](https://github.com/WilliamAbraham/Scout2.0/pull/2). Pre-merge checks on 2026-09-12: production frontend build and all 72 backend tests passed; root lint remains unavailable and frontend lint retains the two existing violations documented below. The latest onboarding implementation plan from `25b0637` is included.

The current direction is a compact, grouped inbox with a map workspace and selected-apartment detail. Needs you contains actual blockers; routine outreach should not require approval for every apartment. Match reasons and unknowns replace uncalibrated percentages. Agent activity is available per apartment through a center-pane tab. Photos and source URLs remain unavailable for synthetic fixtures.

Next dashboard work: iterate with user feedback, agree the pursuit/command contract with pipeline owner A, then replace fixtures with authorized persisted results. Exact listing map pins, real photos, and command submission are not implemented.

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
