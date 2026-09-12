# Next.js frontend for Scout

Date: 2026-08-30
Status: approved, ready for implementation planning

## Goal

Turn the empty `frontend/` workspace into a running Next.js application built
from the official `with-supabase` starter, wired into the existing npm
workspaces monorepo without loosening the repo's TypeScript conventions.

Success means: `npm run dev:web` serves the app on port 3000, `/` and
`/auth/login` render against the real Supabase project, `npm run typecheck`
passes across all workspaces, and `next build` succeeds.

## Scope

**In scope.** Installing the template, reconciling it with the monorepo,
preserving the strict compiler flags, moving env vars where Next can read
them, resolving the port collision with the backend, and removing the
starter's tutorial branding.

**Explicitly out of scope.** How listing data gets read. There is no listings
table yet, so the choice between querying Supabase directly under RLS and
querying it through backend REST routes has nothing concrete to attach to. It
is deferred to whenever the schema is designed. Nothing in this document
forecloses either option.

## Context

`frontend/` currently holds only `package.json`, a strict `tsconfig.json`, and
`src/.gitkeep`. The backend is a bare `node:http` server exposing only
`/health`; its `PORT` is already documented as overridable so a frontend dev
server can coexist.

Nothing in the repo touches Supabase yet. `@supabase/supabase-js` sits in
`backend/package.json` but no file imports it, and `backend/src/db/auth.ts` is
empty. The root `.env` already holds `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## Template facts

Established by scaffolding `create-next-app -e with-supabase` into a scratch
directory and reading the output, not from memory. These correct several
assumptions made earlier in design discussion:

- `-e` **ignores** the usual flags (`--tailwind`, `--src-dir`,
  `--import-alias`, etc.). There is no `src/` directory: `app/`, `components/`
  and `lib/` sit at the workspace root, and the alias is `@/* -> ./*`.
- Tailwind is **v3**, not v4: `@tailwind base/components/utilities` in
  `app/globals.css`, a `tailwind.config.ts` with content globs, and PostCSS
  running `tailwindcss` + `autoprefixer`.
- It ships shadcn/ui — `components.json`, `components/ui/*`, Radix primitives,
  `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` — plus
  `next-themes` for dark mode.
- It is an auth starter: `app/auth/{login,sign-up,forgot-password,update-password,confirm,error,sign-up-success}`,
  a `/protected` route, and a root `proxy.ts` (the current replacement for
  `middleware.ts`) that refreshes the session on nearly every request.
- `next.config.ts` sets `cacheComponents: true`, which requires Next 16+.
- Its `.gitignore` ignores `next-env.d.ts`; that file is generated, not committed.
- `next`, `@supabase/ssr` and `@supabase/supabase-js` are declared as
  `"latest"`. `eslint-config-next` is pinned to `15.3.1` while `next` resolves
  to 16.x, and `@types/node` is `^20` against the backend's `^26`.

## Design

### Installing the template

Reuse the already-scaffolded copy in the scratch directory rather than
re-downloading. Then:

1. Delete the `.git` directory create-next-app initialized, and its `README.md`.
2. Move the remaining tree into `frontend/`, and delete `frontend/src/`
   including `.gitkeep` — this template has no `src/` directory.
3. Merge `package.json` rather than overwrite it: keep `name: "@scout/frontend"`
   and `private: true`, adopt the template's dependencies and scripts, and add
   `"typecheck": "tsc"` so the root `typecheck --workspaces` covers it.
4. Remove `"type": "module"` from `frontend/package.json`. The template omits
   it deliberately; its `.mjs` and `.ts` config files are loaded expecting the
   default resolution.
5. Pin the floating versions: `next@16.3.3`, `@supabase/ssr@0.12.5`,
   `@supabase/supabase-js@2.112.4`. Bump `eslint-config-next` to `16.3.3` to
   match Next, and `@types/node` to `^26` to match the backend.
6. Install once from the repo root so dependencies hoist into the workspace
   instead of creating a nested `frontend/node_modules`.

### TypeScript configuration

Start from the template's `tsconfig.json`, which carries the `plugins`,
`paths`, and `include` entries Next requires, then restore the repo's strict
flags: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`, `moduleDetection: "force"`, and `target: "esnext"`.
Keep the template's `jsx: "react-jsx"` and `moduleResolution: "bundler"`.

**Known risk.** The template's shadcn components were not written under these
flags; `exactOptionalPropertyTypes` in particular tends to collide with React
prop spreading. If typecheck fails, report the specific files and flags that
collide and let the user decide. Do not silently drop a flag to force a green
build.

### Environment and ports

Next reads env files from the application directory, so a repo-root `.env` is
invisible to it. Move the two Supabase variables into `frontend/.env.local`,
which the root `.gitignore` already covers via `.env.*`, and commit a
`frontend/.env.example` documenting the names.

Next takes port 3000. The backend moves to 4000 via its existing `PORT`
override. Add root scripts `dev:web` (`npm run dev -w frontend`) and `dev:api`
(`PORT=4000 npm run start -w backend`), leaving `start`, `sync`, `inspect`,
and `survey` untouched.

Fold the template's `.gitignore` entries into the root `.gitignore` — `.next/`,
`/out/`, `.vercel`, `next-env.d.ts` — preserving the repo's single-gitignore
convention, and delete the template's copy.

### Removing starter branding

Delete `components/deploy-button.tsx`, `next-logo.tsx`, `supabase-logo.tsx`,
`hero.tsx`, `components/tutorial/`, `app/opengraph-image.png`, and
`app/twitter-image.png`.

These are imported from three pages, all of which must be rewritten together
or the build breaks:

| File | Imports being deleted |
|------|----------------------|
| `app/page.tsx` | `DeployButton`, `Hero`, `ConnectSupabaseSteps`, `SignUpUserSteps` |
| `app/protected/layout.tsx` | `DeployButton` |
| `app/protected/page.tsx` | `FetchDataSteps` |

Replace `app/page.tsx` with a minimal Scout home page keeping the nav, theme
switcher, and auth button. Trim the two `app/protected/` files to the same
shape minus the tutorial content.

Keep `components/ui/*`, `components/env-var-warning.tsx`, `next-themes`
theming, all of `app/auth/*`, `proxy.ts`, and `lib/supabase/*` intact.
`lib/utils.ts` keeps both exports: `cn`, and `hasEnvVars`, which
`lib/supabase/proxy.ts` depends on to skip session refresh when credentials
are absent.

## Verification

Every claim of completion must rest on observed command output:

1. `npm install` from the repo root completes without peer-dependency errors.
2. `npm run typecheck` passes for both workspaces.
3. `npm run build -w frontend` succeeds.
4. `npm run dev:web` serves `/` and `/auth/login`, both rendering without the
   env-var warning banner, confirming the Supabase credentials are loaded.
5. `npm run dev:api` serves `/health` on port 4000 with the frontend still on
   3000, confirming no port collision.

Completing an email-confirmation signup end-to-end is left to the user; it
requires clicking a link delivered to a real inbox.
