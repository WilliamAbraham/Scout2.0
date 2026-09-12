# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Scout automates NYC apartment hunting: it pulls StreetEasy listing-alert emails out of Gmail, parses the listing cards, and stores them in Postgres (Supabase). `backend/` is the data pipeline (npm workspace `@scout/backend`); `frontend/` is a Next.js app scaffolded from the Supabase `with-supabase` starter (npm workspace `@scout/frontend`) that currently only has auth wired up — no listing UI yet. Both are npm workspaces under the root `package.json`.

## Commands

Run installs from the **repo root** only — a `frontend/node_modules/` or `backend/node_modules/` appearing means a command ran from the wrong directory.

```bash
npm install                      # from repo root
npm run typecheck                # tsc across every workspace
npm run test                     # backend's node --test suite (currently no test files exist)
npm run dev:web                  # next dev, port 3000 (frontend/package.json also has its own `dev`)
npm run dev:api                  # backend HTTP server on port 4000 (only /health is wired up)
```

Backend pipeline scripts (`npm run <script> -w backend`, or the root aliases `sync`/`inspect`/`survey`/`extract`):
```bash
npm run sync -w backend                    # Gmail -> data/messages.json (message id corpus)
npm run inspect -w backend -- <messageId>  # dump one raw message (add --full for untruncated HTML)
npm run survey -w backend -- --offline     # shape/stats report across the cached corpus
npm run probe -w backend -- <url> <selector...>  # inspect live DOM via Playwright (HEADLESS=0 to watch)
npm run extract -w backend                 # (see backend/scripts/extract.ts when it lands)
node --experimental-strip-types backend/scripts/importListings.ts   # parse cached mail -> upsert into `listings`
```

Database (drizzle-kit, Postgres via Supabase):
```bash
npm run db:generate -w backend   # generate a migration from src/db/schema.ts
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
5. **`backend/scripts/importListings.ts`** — reads every cached raw message, parses listings, and upserts into the `listings` table keyed on `rentalId` (see below), merging in a newly-observed `brokerage` only if one wasn't already recorded.
6. **`backend/src/db/schema.ts`** — the `listings` table (Drizzle + Postgres check constraints enforce numeric `rentalId`, non-empty `address`, positive `price`, non-negative bed/bath counts, and `lastSeenAt >= firstSeenAt`). `backend/src/db/index.ts` loads `DATABASE_URL` from the root `.env` and connects with `prepare: false` (Supabase's transaction pooler doesn't support prepared statements).

**Enrichment** (`backend/src/enrichment/`) is a separate, mostly-unbuilt pipeline for attaching listing-agent names by scraping brokerage sites with Playwright (`browser.ts` manages one shared headless browser; `brokerInfo.ts`'s `locatorFields()` lets a selector be probed against a live page before a parser depends on it). `backend/src/enrichment/names.ts` is a design doc/plan only — no code yet; read it before implementing this pipeline, since it specifies required verification steps (address/unit/price/date matching) before trusting a scraped agent roster.

`backend/src/paths.ts` derives `REPO_ROOT`/`DATA_DIR` from `import.meta.url` so scripts behave the same regardless of invocation cwd. Everything generated (`data/`) lives outside both workspaces so either can read it, and is gitignored.

### Frontend: Next.js App Router + Supabase Auth

Scaffolded from the official `with-supabase` starter — see `docs/superpowers/plans/2026-08-30-nextjs-frontend.md` and `docs/superpowers/specs/2026-08-30-nextjs-frontend-design.md` for the exact constraints that shaped it (pinned dependency versions, which strict tsconfig flags must never be loosened, Tailwind v3 not v4). Only auth screens (`frontend/app/auth/*`, `frontend/app/protected/`) exist; no listing UI has been built yet.

- This Next.js version uses `proxy.ts` (not `middleware.ts`) — see `frontend/AGENTS.md`, which is regenerated by `next dev` itself; don't hand-edit around it, and commit it if it changes.
- `frontend/lib/supabase/{client,server,proxy}.ts` are the three Supabase client constructors (browser, server component, and the proxy/session-refresh path) — use the one matching the context, per the standard `@supabase/ssr` pattern.
- Auth env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) live in `frontend/.env.local` (gitignored); `frontend/.env.example` documents them. Never print their values into the transcript.

### Secrets and generated files (all gitignored, all live at repo root unless noted)

`credentials.json`, `token.json`, root `.env` (backend `DATABASE_URL`), `frontend/.env.local` (frontend Supabase keys), `data/` (Gmail message cache + parsed output).
