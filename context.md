# Scout: current engineering context

Updated 2026-09-12. Dashboard iteration started from `f6f8adf`; earlier source review used `822db17` on `origin/main`. Code inspection is distinguished below from runtime verification. Start with [project.md](project.md) for product intent.

## Implemented in source

- Root npm workspaces: `@scout/backend` and `@scout/frontend`, with a tracked `package-lock.json`.
- `backend/src/gmail/auth.ts`: single-user, read-only Gmail OAuth using root `credentials.json` and `token.json`.
- `backend/src/gmail/mailbox.ts`: StreetEasy message discovery and raw cache under `data/`; full message retrieval prefers cache. No incremental history cursor.
- `backend/src/gmail/message.ts`: MIME flattening; `listings.ts`: Cheerio card parsing and a bounded HTTPS StreetEasy redirect resolver. The misspelled `.ListinCard-info--detailsContainer` selector matches source markup.
- `backend/src/db/schema.ts`: global listings table with unique numeric `rental_id`, listing facts, and timestamps. No tenant or pursuit schema.
- `backend/scripts/importListings.ts`: imports cached mail. On conflict it only fills missing brokerage; it does not refresh price or advance observation timestamps. This matters for matching and contact recency.
- `backend/src/db/index.ts`: root `.env` database connection, with prepared statements disabled for the pooler.
- `backend/src/index.ts`: HTTP `/health` only; default port 3000, overridden to 4000 by `dev:api`.
- Frontend: public `/` now renders a Scout sample dashboard with search, filters, price/match sorting, saved listings, expandable details, selected listing brief, and a confirm/undo demo request. Sample preferences, tours, and activity are read-only. State is in memory. Auth/session clients, `proxy.ts`, auth pages, and protected route remain; unused starter assets still exist.
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

Reference: read-only inspection of the local `agentAI/src/app/page.tsx` and `globals.css`. Reused its muted green visual direction, queue/status vocabulary, and selected-listing brief pattern in Scout's existing Next.js/Tailwind stack. Did not port its backend, Google Maps, or outreach integrations.

- `npm ci`: completed with the tracked lockfile unchanged.
- `npm run build -w frontend`: passed.
- `npm run typecheck -w frontend`: passed.
- Targeted ESLint on dashboard, root page, and root layout: passed.
- Full frontend lint: runs after the flat-config fix, with the two existing violations listed above. Root `yarn lint` and `yarn test` still fail for the documented missing script/test file.
- Browser: verified saving and saved filtering, neighborhood search, empty results, sort toggle, listing expansion/inspector update, confirmation/undo, and reset on refresh.
- Visual inspection: desktop and 375px mobile. Document width matched the viewport at 375px and 812px landscape. OS text scaling and full keyboard traversal were not exercised.
- No live auth, persistence, ingestion, outreach, or calendar integration tested. The public homepage contains only synthetic fixtures; keep it that way until authenticated live-data integration is designed.

Delivery: committed on `codex/dashboard-first-pass`. Push to `origin` returned HTTP 403: signed-in GitHub account `ktpeii` lacks write access to `WilliamAbraham/Scout2.0`. The branch is local only and no PR was created; push and PR remain pending repository access.

Next dashboard work: iterate with user feedback, agree the pursuit/command contract with pipeline owner A, then replace fixtures with authorized persisted results. Map view and command submission are not implemented.

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
