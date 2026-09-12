# Next.js Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the empty `frontend/` workspace into a running Next.js app built from the official `with-supabase` starter, wired into the npm workspaces monorepo without loosening the repo's TypeScript conventions.

**Architecture:** The `with-supabase` template is scaffolded outside the repo, then merged into `frontend/` rather than copied wholesale — the workspace's identity (`@scout/frontend`) and the repo's strict compiler flags survive the merge. Next serves the UI on port 3000 and owns Supabase Auth via the publishable key; the existing backend moves to port 4000. How listing data is read is deliberately not decided here.

**Tech Stack:** Next.js 16.3.3 (App Router, `cacheComponents`), React 19, Supabase Auth via `@supabase/ssr`, Tailwind CSS v3, shadcn/ui, `next-themes`, TypeScript 5, npm workspaces on Node 24.

**Spec:** `docs/superpowers/specs/2026-08-30-nextjs-frontend-design.md`

## Global Constraints

- Branch: all work lands on `main`. The user asked for this explicitly.
- Pin these exactly, overriding the template's `"latest"`: `next@16.3.3`, `@supabase/ssr@0.12.5`, `@supabase/supabase-js@2.112.4`, `eslint-config-next@16.3.3`, `@types/node@^26`, `tailwindcss@^3.4.19`.
- `frontend/package.json` must NOT contain `"type": "module"`. The template omits it deliberately; its `.mjs`/`.ts` config files are loaded expecting default resolution.
- These compiler flags must survive into the final `frontend/tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, `moduleDetection: "force"`, `target: "esnext"`.
- **Never drop a strict flag to make a build pass.** If the template's own code collides with one, stop and report the exact files and flags to the user. That is a decision gate, not a judgment call.
- Do NOT set a `types` array in `frontend/tsconfig.json`. The old stub had `"types": []`; restoring it would exclude `@types/react` and break every `.tsx` file.
- One `.gitignore` at the repo root. The template's own `.gitignore` is folded in and deleted.
- Never commit `.env.local`. Never print the values of `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` into the transcript.
- Tailwind is **v3** here (`@tailwind` directives + `tailwind.config.ts`). Do not "upgrade" it to v4 syntax.
- Install only from the repo root, so dependencies hoist to the workspace root. A `frontend/node_modules/` directory appearing means something was run from the wrong directory.

## File Structure

**Created (moved in from the template):** `frontend/app/`, `frontend/components/`, `frontend/lib/`, `frontend/public/`, `frontend/next.config.ts`, `frontend/postcss.config.mjs`, `frontend/tailwind.config.ts`, `frontend/eslint.config.mjs`, `frontend/components.json`, `frontend/proxy.ts`.

**Created (written by hand):** `frontend/.env.local` (ignored), `frontend/.env.example` (committed).

**Modified:** `frontend/package.json`, `frontend/tsconfig.json`, root `package.json`, root `.gitignore`.

**Deleted:** `frontend/src/`, and the template's `.git/`, `README.md` and `.gitignore`.

The template's own pages and components are left untouched. Replacing the starter UI with real Scout screens is deliberately out of scope — the goal here is only a running app.

---

### Task 1: Land the template in the frontend workspace

**Files:**
- Create: `frontend/app/`, `frontend/components/`, `frontend/lib/`, `frontend/public/`, `frontend/next.config.ts`, `frontend/postcss.config.mjs`, `frontend/tailwind.config.ts`, `frontend/eslint.config.mjs`, `frontend/components.json`, `frontend/proxy.ts`, `frontend/next-env.d.ts`
- Modify: `frontend/package.json`
- Delete: `frontend/src/`

**Interfaces:**
- Consumes: nothing — this is the first task.
- Produces: a populated `frontend/` workspace whose `package.json` is named `@scout/frontend` and exposes the scripts `dev`, `build`, `start`, `lint`, `typecheck`. Tasks 2-4 all edit files this task puts in place.

- [ ] **Step 1: Scaffold the template outside the repo**

```bash
cd /private/tmp/claude-501/-Users-williamabraham-Desktop-Scout/2c3b2081-efab-4054-86b0-6379459569d4/scratchpad
rm -rf next-template
npx --yes create-next-app@latest next-template -e with-supabase --skip-install
```

Expected: `Success! Created next-template at .../next-template`

- [ ] **Step 2: Strip the template's repo-level files**

The template initializes its own git repo and ships a README and `.gitignore` that would collide with the monorepo's.

```bash
cd /private/tmp/claude-501/-Users-williamabraham-Desktop-Scout/2c3b2081-efab-4054-86b0-6379459569d4/scratchpad/next-template
rm -rf .git README.md .gitignore
```

- [ ] **Step 3: Verify the frontend workspace is still the empty stub**

Guard against clobbering real work if this plan is re-run.

```bash
cd /Users/williamabraham/Desktop/Scout
find frontend -type f -not -path "*/node_modules/*"
```

Expected exactly: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/src/.gitkeep`. If anything else is listed, STOP and report — a previous run left state behind.

- [ ] **Step 4: Move the template in**

`frontend/src/` goes away because this template has no `src/` directory; its import alias is `@/* -> ./*`.

```bash
cd /Users/williamabraham/Desktop/Scout
S=/private/tmp/claude-501/-Users-williamabraham-Desktop-Scout/2c3b2081-efab-4054-86b0-6379459569d4/scratchpad/next-template
rm -rf frontend/src
cp -R "$S"/app "$S"/components "$S"/lib "$S"/public frontend/ 2>/dev/null || true
cp "$S"/next.config.ts "$S"/postcss.config.mjs "$S"/tailwind.config.ts \
   "$S"/eslint.config.mjs "$S"/components.json "$S"/proxy.ts \
   "$S"/next-env.d.ts "$S"/.env.example frontend/
```

Note: the template has no `public/` directory in some revisions; the `|| true` keeps the copy from failing on that. Confirm what landed in the next step.

- [ ] **Step 5: Verify the move**

```bash
cd /Users/williamabraham/Desktop/Scout
ls frontend
test ! -d frontend/src && echo "src removed OK"
test -f frontend/proxy.ts && echo "proxy OK"
test -f frontend/lib/supabase/server.ts && echo "supabase lib OK"
```

Expected: all three OK lines print, and `frontend/` lists `app`, `components`, `lib`, `next.config.ts`, `proxy.ts`, `tailwind.config.ts`, `components.json`.

- [ ] **Step 6: Write the merged package.json**

Keeps the workspace name and adds `typecheck` so the root `typecheck --workspaces` covers this workspace. All floating `"latest"` versions are pinned per Global Constraints. `"type": "module"` is deliberately absent.

```bash
cd /Users/williamabraham/Desktop/Scout
cat > frontend/package.json <<'JSON'
{
  "name": "@scout/frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc"
  },
  "dependencies": {
    "@radix-ui/react-checkbox": "^1.3.1",
    "@radix-ui/react-dropdown-menu": "^2.1.14",
    "@radix-ui/react-label": "^2.1.6",
    "@radix-ui/react-slot": "^1.2.2",
    "@supabase/ssr": "0.12.5",
    "@supabase/supabase-js": "2.112.4",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.511.0",
    "next": "16.3.3",
    "next-themes": "^0.4.6",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^3.3.0"
  },
  "devDependencies": {
    "@eslint/eslintrc": "^3",
    "@types/node": "^26",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "autoprefixer": "^10.4.20",
    "eslint": "^9",
    "eslint-config-next": "16.3.3",
    "postcss": "^8",
    "tailwindcss": "^3.4.19",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "^5"
  }
}
JSON
```

- [ ] **Step 7: Install from the repo root**

```bash
cd /Users/williamabraham/Desktop/Scout
npm install
```

Expected: completes without `ERESOLVE`. If a peer-dependency conflict appears, report the exact conflict — do NOT reach for `--force` or `--legacy-peer-deps`.

- [ ] **Step 8: Verify hoisting**

```bash
cd /Users/williamabraham/Desktop/Scout
test ! -d frontend/node_modules && echo "hoisted OK"
ls node_modules/next/package.json >/dev/null && echo "next installed OK"
```

Expected: both OK lines. A `frontend/node_modules` directory means step 7 ran from the wrong directory.

- [ ] **Step 9: Commit**

`next-env.d.ts` is intentionally staged here and removed from tracking in Task 3, when the root `.gitignore` learns about it.

```bash
cd /Users/williamabraham/Desktop/Scout
git add frontend package.json package-lock.json
git commit -m "Add Next.js with-supabase template to frontend workspace"
```

---

### Task 2: Reconcile TypeScript config with the repo's strict flags

**Files:**
- Modify: `frontend/tsconfig.json`

**Interfaces:**
- Consumes: `frontend/tsconfig.json` and the `app/`, `components/`, `lib/` trees from Task 1.
- Produces: a `tsconfig.json` under which `npm run typecheck` passes for both workspaces. Tasks 3 and 4 assume typecheck is a working gate.

- [ ] **Step 1: Establish the baseline failure**

Run typecheck against the template's own config first, so any error surfaced in Step 4 can be attributed to the strict flags rather than to a pre-existing problem.

```bash
cd /Users/williamabraham/Desktop/Scout
npm run typecheck -w @scout/frontend
```

Expected: PASS. If it already fails, the template itself is broken — report the errors and stop.

- [ ] **Step 2: Write the reconciled tsconfig**

Template's config plus the five restored flags. `jsx: "react-jsx"`, `moduleResolution: "bundler"`, `plugins`, `paths` and `include` are the template's and must be kept — Next requires them. No `types` array (see Global Constraints).

```bash
cd /Users/williamabraham/Desktop/Scout
cat > frontend/tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "esnext",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,

    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force",

    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
JSON
```

- [ ] **Step 3: Run typecheck under the strict flags**

```bash
cd /Users/williamabraham/Desktop/Scout
npm run typecheck -w @scout/frontend
```

Expected: PASS.

**If it FAILS — this is the anticipated risk and a decision gate.** The template's shadcn components were not written under `exactOptionalPropertyTypes` or `noUncheckedIndexedAccess`. Do the following, in order:

1. Capture the full error list.
2. Determine which flag causes each error by re-running with that single flag disabled via CLI override, e.g. `npx tsc -p frontend --exactOptionalPropertyTypes false`.
3. Report to the user: the failing files, which flag each collides with, and the two options — fix the template's components to satisfy the flag, or drop that one flag for this workspace.
4. **Wait for the user's decision.** Do not pick one.

- [ ] **Step 4: Verify both workspaces typecheck together**

```bash
cd /Users/williamabraham/Desktop/Scout
npm run typecheck
```

Expected: passes for `@scout/backend` and `@scout/frontend`.

- [ ] **Step 5: Commit**

```bash
cd /Users/williamabraham/Desktop/Scout
git add frontend/tsconfig.json
git commit -m "Restore strict compiler flags in frontend tsconfig"
```

---

### Task 3: Wire environment, ports, and gitignore

**Files:**
- Create: `frontend/.env.local` (ignored), `frontend/.env.example` (committed)
- Modify: root `package.json`, root `.gitignore`
- Delete: `frontend/.env.example` as shipped by the template (overwritten in Step 2)

**Interfaces:**
- Consumes: `frontend/package.json` scripts from Task 1.
- Produces: root scripts `dev:web` (Next on 3000) and `dev:api` (backend on 4000), and a `frontend/.env.local` holding `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Task 4 relies on these being loaded so the env-var warning banner stays hidden.

- [ ] **Step 1: Copy the Supabase vars where Next can read them**

Next reads env files from the application directory, so the repo-root `.env` is invisible to it. This copies rather than moves — the root `.env` is the user's file and is left in place for them to remove.

```bash
cd /Users/williamabraham/Desktop/Scout
cp .env frontend/.env.local
grep -c NEXT_PUBLIC frontend/.env.local
```

Expected: `2`. Do not cat this file — it holds live credentials.

- [ ] **Step 2: Write the committed example file**

```bash
cd /Users/williamabraham/Desktop/Scout
cat > frontend/.env.example <<'ENV'
# Supabase project settings > API
# https://app.supabase.com/project/_/settings/api
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
ENV
```

- [ ] **Step 3: Add Next's ignore entries to the root gitignore**

```bash
cd /Users/williamabraham/Desktop/Scout
cat >> .gitignore <<'IGN'

# Next.js
.next/
out/
next-env.d.ts
.vercel
IGN
git rm --cached frontend/next-env.d.ts
```

`next-env.d.ts` is regenerated by Next on every build and is ignored by the template's own gitignore, so it is untracked here rather than committed.

- [ ] **Step 4: Verify the ignore rules work**

```bash
cd /Users/williamabraham/Desktop/Scout
git check-ignore -v frontend/.env.local frontend/next-env.d.ts
git check-ignore frontend/.env.example && echo "BAD: example is ignored" || echo "example is committable OK"
```

Expected: the first command reports a matching rule for both files; the second prints `example is committable OK` (the root gitignore's `!.env.example` negation covers it).

- [ ] **Step 5: Add the root dev scripts**

Next takes 3000; the backend moves to 4000 via the `PORT` override its own source comment anticipates. Existing scripts are untouched.

```bash
cd /Users/williamabraham/Desktop/Scout
python3 - <<'PY'
import json, pathlib
p = pathlib.Path("package.json")
pkg = json.loads(p.read_text())
pkg["scripts"]["dev:web"] = "npm run dev -w @scout/frontend"
pkg["scripts"]["dev:api"] = "PORT=4000 npm run start -w @scout/backend"
p.write_text(json.dumps(pkg, indent=2) + "\n")
print(json.dumps(pkg["scripts"], indent=2))
PY
```

Expected output includes `dev:web`, `dev:api`, and the pre-existing `start`, `sync`, `inspect`, `survey`, `typecheck`, `test`.

- [ ] **Step 6: Verify both servers coexist**

```bash
cd /Users/williamabraham/Desktop/Scout
npm run dev:api > /tmp/api.log 2>&1 &
npm run dev:web > /tmp/web.log 2>&1 &
sleep 25
curl -fsS http://localhost:4000/health
curl -fsS -o /dev/null -w "web:%{http_code}\n" http://localhost:3000/
kill %1 %2
```

Expected: `{"status":"ok"}` from the backend and `web:200` from Next. If Next reports the port is in use, something else holds 3000 — report it rather than switching ports.

- [ ] **Step 7: Commit**

```bash
cd /Users/williamabraham/Desktop/Scout
git add .gitignore package.json frontend/.env.example
git commit -m "Wire frontend env, dev scripts, and Next gitignore rules"
```

## Done when

1. `npm install` from the root completes with no peer-dependency errors and no `frontend/node_modules`.
2. `npm run typecheck` passes for both workspaces with all strict flags intact — or the user has explicitly approved dropping a specific flag.
3. `npm run build -w @scout/frontend` succeeds, listing `/`, `/protected`, and the `/auth/*` routes.
4. `npm run dev:web` serves `/` and `/auth/login` with no env-var warning banner.
5. `npm run dev:api` serves `/health` on 4000 while the frontend holds 3000.

Left for the user: clicking through an email-confirmation signup, which needs a link delivered to a real inbox. Left for a future plan: how listing data is read, and replacing the starter's default page with real Scout UI.
