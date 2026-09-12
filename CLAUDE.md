# Repository guidance

Read [project.md](project.md) for product intent and architecture, and [context.md](context.md) for current code, commands, verification, and remaining work.

The product proposal and hackathon split are in [the design document](docs/superpowers/specs/2026-09-12-scout-product-design.md). Read [the design review](docs/reviews/2026-09-12-product-design-review.md) before implementing it; proposed corrections are not yet accepted decisions.

For frontend work, also follow [frontend/AGENTS.md](frontend/AGENTS.md).

## What this is

Scout automates NYC apartment hunting: it pulls StreetEasy listing-alert emails out of Gmail, parses the listing cards, and stores them in Postgres (Supabase). `backend/` is the data pipeline (npm workspace `@scout/backend`); `frontend/` is a Next.js app scaffolded from the Supabase `with-supabase` starter (npm workspace `@scout/frontend`) with auth, a public interactive sample dashboard, and an authenticated listing/worker view with owner-authorized commands; live deployment verification remains pending. Both are npm workspaces under the root `package.json`.

## Commands

Run installs from the **repo root** using `npm ci` and the tracked lockfile. Nested workspace dependencies can result from normal version resolution.

```bash
npm ci                           # from repo root
npm run typecheck                # tsc across every workspace
npm run test                     # node --test, auto-discovering every src/**/*.test.ts
npm run enrich -- backend/fixtures/enrichment/118-mulberry-r4.json
npm run typecheck:enrichment -w backend  # isolated enrichment typecheck
npm run dev:web                  # next dev, port 3000 (frontend/package.json also has its own `dev`)
npm run dev:api                  # backend HTTP server on port 4000 (only /health is wired up)
```

Backend pipeline scripts (`npm run <script> -w backend`, or the root aliases `sync`/`inspect`/`survey`/`worker`):
```bash
npm run sync -w backend                    # Gmail -> data/messages.json (message id corpus)
npm run inspect -w backend -- <messageId>  # dump one raw message (add --full for untruncated HTML)
npm run survey -w backend -- --offline     # shape/stats report across the cached corpus
npm run probe -w backend -- <url> <selector...>  # inspect live DOM via Playwright (HEADLESS=0 to watch)
npm run worker -w backend -- --once        # one full cycle: Gmail -> Postgres -> enrich -> draft (dry-run; see docs/backend/worker-operations.md)
npm run worker:status                      # backlog, last run, blocked work
node --experimental-strip-types backend/scripts/importListings.ts   # parse cached mail -> upsert into `listings`
```

Database (drizzle-kit, Postgres via Supabase):
```bash
npm run db:generate -w backend   # generate a migration from src/db/schema/
npm run db:migrate -w backend    # apply backend/drizzle/*.sql via scripts/migrate.ts
```

Frontend:
```bash
npm run lint -w frontend
npm run build -w frontend
```

There is no top-level lint script; run `npm run lint -w frontend` directly.

## Architecture

### Backend: Gmail -> raw cache -> parse -> Postgres

The pipeline is staged as separate, independently re-runnable steps, each backed by a file cache so later stages never need to re-hit Gmail quota or re-run OAuth:

1. **`backend/src/gmail/auth.ts`** — OAuth against `credentials.json`, refresh token persisted to `token.json` (both gitignored, live at repo root). Read-only Gmail scope only.
2. **`backend/src/gmail/mailbox.ts`** — lists message ids matching `LISTINGS_QUERY` (`from:noreply@email.streeteasy.com`), saves them to `data/messages.json`, and caches full message resources as `data/raw/<id>.json`. `loadMessage`/`loadMessages` prefer the cache and only call Gmail on a miss (or return `null` for one bad id rather than failing a whole batch).
3. **`backend/src/gmail/message.ts`** — flattens a raw Gmail message resource into `RawMessage` (subject/from/date/text/html), walking the MIME tree to find the right body part. Pure, no I/O.
4. **`backend/src/gmail/listings.ts`** — `parseListing()` uses `cheerio` to pull `.ListingCard` elements out of the email HTML into structured listings, then `resolveRentalUrl()` follows the email's tracking-link redirect chain (capped at 5 hops) to the canonical `streeteasy.com/rental/<id>` URL. Note the intentional typo-matched selector `.ListinCard-info--detailsContainer` — StreetEasy's own markup misspells it.
5. **`backend/src/gmail/alert.ts`** — parses one alert's HTML card by card. Each card is isolated, so a malformed listing cannot discard its siblings, and the result reports whether the layout was recognized (`listing_cards`), changed (`unsupported`), or genuinely carried nothing (`empty`). `backend/src/gmail/sync.ts` and `checkpoint.ts` poll Gmail from a durable history cursor with a bounded catch-up; `backend/src/pipeline/routing.ts` classifies each message as alert, reply, or noise.
6. **`backend/src/pipeline/postgresStore.ts`** — the worker's one persistence adapter: syncs alerts from Gmail, upserts `listings` (refreshing price and `last_seen_at`) and per-user `user_listings`, applies the hard filter in `pipeline/match.ts`, creates `pursuits`, stores enrichment results, and records turn outcomes as `pursuit_events`. `backend/scripts/worker.ts` drives it; `backend/src/pipeline/alert.ts` is the parse → persist → enrich stage it calls per alert. `backend/scripts/importListings.ts` is the older listings-only importer.
7. **`backend/src/db/schema/`** — the schema, split by subsystem (`enums`, `listings`, `gmail`, `profiles`, `pursuits`, `rls`) and re-exported from `index.ts`, which is what `drizzle.config.ts` points at. `backend/src/db/index.ts` loads `DATABASE_URL` from the root `.env` and connects with `prepare: false` (Supabase's transaction pooler doesn't support prepared statements).

### Schema, RLS, and the two-person seam

The schema is the coordination point between the backend agent and the dashboard (see `docs/superpowers/specs/2026-09-12-scout-product-design.md` §8). Three rules hold it together:

- **Every tenant table has RLS enabled, and every policy calls `scout_owns(user_id)`.** The frontend authenticates with the publishable key — which ships in the browser bundle — so a `public` table without policies is an open table. `scout_owns` is a hand-written SQL function (drizzle-kit does not generate functions); it exists so that adding roommates later is a `CREATE OR REPLACE` rather than a rewrite of every policy. Keep it in sync with `SCOUT_OWNS_FUNCTION` in `src/db/schema/rls.ts` — `src/db/schema.test.ts` fails if they drift.
- **`gmail_tokens` and `processed_messages` have RLS enabled and zero policies.** That denies everything arriving through PostgREST while the worker, connecting as table owner over `DATABASE_URL`, bypasses RLS. Never add a policy to them, and never mark them `FORCE ROW LEVEL SECURITY` — that would lock out the worker too.
- **`scout_owns` lives in its own migration** (`drizzle/0001_scout_owns.sql`), ahead of the generated one that creates the policies. That is what makes `db:generate` safe to re-run — a regenerated schema migration cannot drop a definition held in an earlier file. Never fold the function into a generated migration.

Two enums (`pursuit_stage`, `needs_human_reason`) are the frontend contract: every `needs_human_reason` value needs a matching resolve-flow in the dashboard's **Needs you** queue.

The enrichment service (below) deliberately has no tables here: it returns contacts and writes nothing. `pursuits.contact_snapshot` (jsonb) is where outreach reads them from — also the honest record of who the agent actually emailed, which must not change when a brokerage page is re-scraped months later. Persisting enrichment results is a later, additive migration.

**Enrichment** is implemented as a standalone service in `backend/src/enrichment/service.ts`, with `backend/scripts/enrichListing.ts` as its CLI. It prefers Tavily search when `TAVILY_API_KEY` is configured and uses Firecrawl for rendering/structured extraction and fallback search. It preserves all supported co-agents, verifies listing identity and contact evidence, and keeps index-only matches in review candidates. It does not send messages or update the database. See `docs/broker-enrichment.md` for input/output contracts, operational bounds and validation; `docs/broker-enrichment-findings.docx` contains the research report. `names.ts` retains the original design plan, including future campaign-date and batch-persistence requirements. Existing Playwright utilities remain available for site-specific investigation.

`backend/src/paths.ts` derives `REPO_ROOT`/`DATA_DIR` from `import.meta.url` so scripts behave the same regardless of invocation cwd. Everything generated (`data/`) lives outside both workspaces so either can read it, and is gitignored.

### Frontend: Next.js App Router + Supabase Auth

Scaffolded from the official `with-supabase` starter — see `docs/superpowers/plans/2026-08-30-nextjs-frontend.md` and `docs/superpowers/specs/2026-08-30-nextjs-frontend-design.md` for the exact constraints that shaped it (pinned dependency versions, which strict tsconfig flags must never be loosened, Tailwind v3 not v4). Auth screens (`frontend/app/auth/*`, `frontend/app/protected/`) remain alongside the public sample dashboard. The public dashboard uses in-memory demo listings. `/dashboard` reads authenticated, user-filtered listing/pursuit records and persisted worker payloads. `app/actions/pursuits.ts` handles owner/state-checked contact supply, closing, and pause/resume; the remaining blocker resolutions are placeholders. See [the worker contract](docs/hackathon-contract.md). Both routes link to `/preferences`: rent/room filters, outreach preferences, tour windows and a live summary. Signed-in saves use `app/actions/profile.ts` with session-derived ownership, an editable-field whitelist and a returned owner row; agent answers, pause and send caps are preserved. Signed-out visitors can edit a local sample without persistence. Only rent/room bounds filter new evaluations; other details guide outreach, and existing matches/source alerts are unchanged. Live reads/writes, deployed RLS and deployment remain unverified. The worker is draft-only; dashboard commands do not send mail or cancel an in-flight turn. Password login lands on `/dashboard`.

- Apartment snapshots use recorded facts and explicitly labeled rent arithmetic. Brokerage and last-seen values come from the listing row; alert observation is not availability verification. Missing amenities/fees/lease details stay unknown. Tour questions include personal criteria without claiming they match. Demo rent comparisons always use the sample profile.
- This Next.js version uses `proxy.ts` (not `middleware.ts`) — see `frontend/AGENTS.md`, which is regenerated by `next dev` itself; don't hand-edit around it, and commit it if it changes.
- `frontend/lib/supabase/{client,server,proxy}.ts` are the three Supabase client constructors (browser, server component, and the proxy/session-refresh path) — use the one matching the context, per the standard `@supabase/ssr` pattern.
- Auth env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) live in `frontend/.env.local` (gitignored); `frontend/.env.example` documents them. Never print their values into the transcript.

### Secrets and generated files (all gitignored, all live at repo root unless noted)

`credentials.json`, `token.json`, root `.env` (backend `DATABASE_URL`), `frontend/.env.local` (frontend Supabase keys), `data/` (Gmail message cache + parsed output).
