# Search Profile — Design

**Status:** Superseded in part. The five-step onboarding wizard this document
originally specified is **deferred** — see §7. What remains in scope is a
single writable search-profile screen.

**Implementation update (2026-09-12):** The writable panel is implemented on
`/` and `/dashboard` on `codex/implement-pursuit-inbox`. Signed-in users without
a row can create one; failed reads disable editing. The public route still
uses fixture listings. The descriptions of the old panel below are design-time
context. See [current engineering context](../../../context.md) for verified
checks and remaining live-persistence, OAuth and schema work.

**Owner:** Person B (`frontend/`), with two schema additions owned by Person A.

**Why it shrank.** This was written against the pre-hackathon build order,
where Person B's step 2 was "onboarding and search profile." The rewritten
§§8–9 of
[the product design](2026-09-12-scout-product-design.md)
put multi-tenant onboarding outside the hackathon critical path — "reuse the
existing auth scaffold; custom multi-user onboarding can wait" — and list rich
onboarding under *cut first if behind*. Milestone 0 asks only for "a profile
with budget, beds, preferences, timezone, and tour windows," and B's dashboard
already ships the read-only version of exactly that.

---

## 1. What is in scope

Make the existing **Search preferences** panel writable.

It lives today as a `<dialog>` in
`frontend/components/dashboard/scout-dashboard.tsx:726`, rendering hardcoded
Areas / Budget / Bedrooms / Move-in under the label "Read-only sample
profile." The work is to back those fields with the user's `search_profiles`
row and let them be edited.

Out of scope: the wizard, a `/settings` route, any change to the dashboard's
route layout or shell. Route layout is B's to own and B has already chosen it.

**One structural change is unavoidable.** The dashboard is mounted at `/`,
which `proxy.ts` leaves public, and `frontend/app/page.tsx` renders
`<ScoutDashboard />` as a client component with no session. A panel backed by
the signed-in user's row cannot work from there — there is no user.

The smallest fix keeps `/` public: make `app/page.tsx` a Server Component that
reads the session, fetches the profile when one exists, and passes it down as
a prop. Signed out, it passes `null` and the panel keeps rendering today's
read-only sample. Signed in, the panel is live and editable. `ScoutDashboard`
stays a client component and keeps its fixtures for everything else.

This is the only part of B's structure this document asks to change, and it
is the minimum that makes a writable profile possible at all.

## 2. Fields

From `backend/src/db/schema/profiles.ts`:

| Panel field | Column |
|---|---|
| Budget | `budget_min`, `budget_max` |
| Bedrooms | `bedrooms_min`, `bedrooms_max` |
| Bathrooms | `bathrooms_min` |
| Areas | `neighborhoods` (text[]) |
| Must haves / Dealbreakers | `must_haves`, `dealbreakers` (text[]) |
| Anything else | `preferences` (text) |
| Tour windows | `availability` (jsonb `AvailabilityWindow[]`) |

`learned_answers` is agent-written and is not editable here. `daily_send_cap`
and `paused_at` are guardrails, not search criteria; the dashboard's existing
Pause control is the natural home for `paused_at`, and `daily_send_cap` can
stay at its default of 10 for the demo.

## 3. Two columns that do not exist yet

Person A owns migrations; neither is a frontend change.

- **Move-in.** The panel displays "Move-in: October 2026" and §8's milestone-0
  contract names it. There is no column. A month, not a date — renters
  negotiate the exact day — so `move_in_month date` with a day-one convention,
  or `move_in_month text` as `YYYY-MM`.
- **Timezone.** §8's contract names it. There is no column.
  `AvailabilityWindow` only *documents* its `HH:MM` strings as "local NYC
  time," which is an assumption rather than a stored fact. A `timezone text`
  column defaulting to `America/New_York` makes it explicit and costs nothing.

Until both land, the panel shows every other field and omits Move-in.

## 4. How writes work

Next.js **Server Actions**, using the server Supabase client from
`frontend/lib/supabase/server.ts`. Each save:

1. Reads the user from `auth.getClaims()`.
2. Validates.
3. `upsert`s into `search_profiles` with `onConflict: 'user_id'`.

`user_id` always comes from the session and is never accepted from the form
payload. RLS (`search_profiles_insert_own` / `_update_own`) is the actual
enforcement.

This is deliberately **not** a browser-direct PostgREST write. The design
review's P1 finding 1 asks that browser-RLS access versus server-authorized
mutations be chosen explicitly, and §8 says the UI should submit commands
rather than act directly. A Server Action is server-authorized: the mutation
runs on the server under the user's session, with RLS underneath it.

The distinction that matters is side effects. Editing your own profile has
none — no email leaves, no calendar is written — so it is a direct write, not
a queued command. Outreach and booking are commands for A's worker, and are
not part of this document.

## 5. Validation

Mirror the table's check constraints so the user sees a sentence rather than a
Postgres constraint name. The database is the real guard.

- `budget_max >= budget_min`, both non-negative
- `bedrooms_max >= bedrooms_min`, both non-negative
- `bathrooms_min` non-negative
- `AvailabilityWindow.end > start`, `day` in 0–6
- `daily_send_cap` between 0 and 100, if exposed

Server Actions re-validate before writing. A failure returns an error the panel
renders inline without closing.

## 6. Gmail connection status

Unchanged from the original design, and still accurate against §8.

`gmail_accounts` is dashboard-readable by design and holds no secrets; the
OAuth tokens live in `gmail_tokens`, which has RLS enabled and zero policies,
so the browser cannot reach them. The panel reads `email_address`,
`last_synced_at`, and `sync_error`, and renders one of three states: not
connected, connected, or needs-reconnect.

The connect control links to a backend route Person A owns. It must be
skippable while that route does not exist. B never handles a Google token.

## 7. Deferred: the onboarding wizard

Recorded so the decision is not relitigated, and so the design is available if
onboarding returns after the hackathon.

The original design was a five-step resumable wizard — connect Gmail → budget
and bedrooms → neighborhoods, must-haves, dealbreakers, prose → tour
availability → review — saving each step on exit, with `/dashboard` redirecting
to it when no profile row existed.

It is deferred, not rejected. Nothing about it conflicts with the panel above:
both write the same columns through the same Server Action path, so the fields
built for the panel are the fields a wizard would reuse. What the hackathon
does not justify is the step routing, the resumability, and the gate.

## 8. Open coordination points

Both are Person A's to close.

1. **The Gmail OAuth entry point** the connect control links to. Until it
   exists, that control is skippable.
2. **The `neighborhoods` vocabulary.** Free text today. `listings` stores only
   a free-text `address`, so whatever is stored here is what the matcher has to
   reconcile against it. B's prototype currently shows boroughs ("Brooklyn &
   Manhattan"); the schema's column is finer-grained than that. The matcher
   decides.

A third, related to neither: §8 names demo stages
`matched → ready_to_contact → contacted → tour_scheduled` plus `closed`, while
the `pursuit_stage` enum is
`matched, contacted, tour_scheduled, toured, applied, decided, dead`, and the
dashboard prototype uses a third set of display strings. Not this document's
problem, but it blocks integration and A owns the enum.

## 9. Verification

No test suite, per the project's MVP standing decision. Verify by editing each
field in the panel, reloading, and confirming the values persist; by submitting
an invalid range and confirming the inline message; and by confirming the row
in `search_profiles` matches what was entered.
