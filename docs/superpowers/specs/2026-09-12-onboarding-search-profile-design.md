# Onboarding and Search Profile — Design

Person B, build-order step 2. Covers the signed-in shell, the Google connect
handoff, and the wizard that writes a user's `search_profiles` row.

Owner: Person B (`frontend/`). Depends on the schema landed in
`backend/src/db/schema/` (commit `c12063b`). Blocks nothing; the listings feed
(step 3) renders a profile that this flow creates.

---

## 1. Scope

In scope:

- `/onboarding` — a resumable five-step wizard.
- `/dashboard` — the signed-in home, a stub until the listings feed lands.
- `/settings/profile` — later edits, reusing the wizard's field components.
- Deleting the `with-supabase` starter's `/protected` demo page and
  `components/tutorial/`.

Out of scope, deliberately:

- **The LLM intake resolver.** The intended end state is that the user
  describes what they want in prose and a model resolves it into structured
  fields, asking follow-up questions. It is deferred because the resolver has
  to emit neighborhood values that Person A's matcher can reconcile against
  `listings.address`, and that vocabulary is not decided yet. Nothing in this
  design is thrown away when it arrives: the review screen *is* the structured
  form the resolver will fill, and `neighborhoods` is already free text.
- Every other Person B surface — the **Needs you** queue, application tracker,
  documents, roommates, natural-language search.

## 2. Routes

| Route | Rendering | Purpose |
|---|---|---|
| `/onboarding` | Server shell, client wizard | Five steps, saving per step |
| `/dashboard` | Server component | Post-onboarding home; profile summary |
| `/settings/profile` | Server component + client form | Edit the profile later |

Gating is a server-component check inside `/dashboard`: read
`search_profiles` for the current user, `redirect('/onboarding')` when no row
exists. It deliberately does **not** live in `proxy.ts` — the proxy matcher
runs on nearly every request, and a database round-trip there would be paid
for assets and navigations alike. The proxy keeps its single existing job of
refreshing the Supabase session.

`/onboarding` does not redirect away when a profile already exists; the user
may reopen it. The review step's Finish button always lands on `/dashboard`.

## 3. Steps

Each step's Next button runs a server action that upserts only that step's
columns, which is what makes a drop-off resumable.

### Step 1 — Connect Google

Reads `gmail_accounts` for the current user and renders one of three states:

- **Not connected** — a link to `${NEXT_PUBLIC_BACKEND_URL}/auth/google/start`.
- **Connected** — the stored `emailAddress` and `lastSyncedAt`.
- **Needs reconnect** — `syncError` is non-null; same link, different copy.

The table holds no secrets by design, so the dashboard reads it directly under
RLS. Tokens live in `gmail_tokens`, which has RLS enabled and zero policies,
and are unreachable from the browser.

**This step is skippable.** Person A owns `/auth/google/start` and has not
built it yet; without a skip, onboarding would not be completable. The skip
control says plainly that Scout cannot find listings until Gmail is connected.
When A's route lands, it should redirect back to `/onboarding?step=basics`.

### Step 2 — Basics

`budgetMin`, `budgetMax`, `bedroomsMin`, `bedroomsMax`, `bathroomsMin`. All
nullable in the schema; all optional here.

### Step 3 — Preferences

`neighborhoods`, `mustHaves`, `dealbreakers` as free-text tag inputs, plus the
`preferences` prose textarea.

`neighborhoods` is free text rather than a fixed list on purpose. A closed
vocabulary is the better long-term answer, but choosing it is a matcher
decision — `listings` stores only a free-text `address`, so whatever is stored
here is what Person A has to match against. Free text keeps that decision with
A and gives the deferred resolver an unconstrained target to write into.

`learnedAnswers` is agent-written and is not editable here.

### Step 4 — Availability

Weekly recurring windows writing `AvailabilityWindow[]` to the `availability`
JSONB column: `day` 0–6 with 0 = Sunday, `start` and `end` as 24-hour `HH:MM`
in local NYC time. The UI adds and removes windows; it does not merge
overlapping ones.

### Step 5 — Review

A read-only summary of every field with an edit link per section, and Finish.
`dailySendCap` is shown with its default of 10 and is editable here — it is a
guardrail the user should see before the agent starts sending on their behalf.

## 4. Writes

Server Actions in `frontend/app/onboarding/actions.ts`, using the server
Supabase client from `lib/supabase/server.ts`. Each action:

1. Reads the user from `auth.getClaims()`.
2. Validates its own fields.
3. `upsert`s into `search_profiles` with `onConflict: 'user_id'`.

`user_id` is always taken from the session and never accepted from the form
payload. RLS (`search_profiles_insert_own` / `_update_own`) is the actual
enforcement; the server-side read is what makes the happy path work, not what
makes it safe.

## 5. Validation and errors

The form mirrors the table's check constraints so users see a message instead
of a Postgres error:

- `budgetMax >= budgetMin`, both non-negative
- `bedroomsMax >= bedroomsMin`
- `dailySendCap` between 0 and 100
- `AvailabilityWindow.end > start`, `day` in 0–6

Server actions re-validate before writing. A failed action returns `{error}`,
which the step renders inline and does not advance. A constraint violation
that reaches Postgres anyway is reported as a generic failure with the
constraint name logged server-side.

## 6. Known seams

**`AvailabilityWindow` is duplicated.** The type is declared in
`backend/src/db/schema/profiles.ts`. Importing it would have `frontend/` reach
into `backend/`, which the two-person split forbids, so it is redeclared in
`frontend/lib/types.ts` with a comment naming the schema file as the source of
truth. If the shape changes, both move. A shared workspace for cross-track
types is the real fix and is not worth it yet.

**New env var.** `NEXT_PUBLIC_BACKEND_URL` points at the backend HTTP server
(`http://localhost:4000` in development), documented in
`frontend/.env.example`.

## 7. Coordination points with Person A

1. `GET /auth/google/start` on the backend server — the OAuth entry point this
   flow links to, redirecting back to `/onboarding?step=basics` on success.
2. The `neighborhoods` vocabulary. Free text today. When A's matcher decides
   what it needs, this field and the deferred resolver both follow.

## 8. Verification

No test suite, per the project's MVP standing decision. Verification is
walking the wizard in `next dev`: complete it end to end, confirm the
`search_profiles` row and its per-step updates, confirm `/dashboard` redirects
to `/onboarding` when no profile exists, and confirm a validation failure
blocks the step.
