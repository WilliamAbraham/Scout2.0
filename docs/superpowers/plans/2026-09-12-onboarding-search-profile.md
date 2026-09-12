# Search Profile Implementation Plan

**Implementation update (2026-09-12):** Integrated on
`codex/implement-pursuit-inbox`, retaining both existing routes. The actual
implementation uses `lib/search-profile.ts`, `lib/profile-server.ts`,
`app/actions/profile.ts` and a separate `SearchPreferencesForm`. The examples
below remain the original plan, not a record of completed live verification.
The implementation separates authentication from a missing profile, blocks
editing after read failure and rejects malformed values. See
[current engineering context](../../../context.md) for verified checks and
remaining backend work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's read-only **Search preferences** panel writable,
backed by the signed-in user's `search_profiles` row.

**Architecture:** `app/page.tsx` becomes a Server Component that reads the
session and passes the profile into `ScoutDashboard` as a prop. The panel's
fields post to Server Actions that upsert `search_profiles` under RLS. Signed
out, the panel keeps rendering today's static sample.

**Tech Stack:** Next.js 16.3.3 (App Router, React 19), `@supabase/ssr` 0.12.5,
`@supabase/supabase-js` 2.112.4, Tailwind 3.4 plus the existing
`scout-dashboard.module.css`.

**Spec:** `docs/superpowers/specs/2026-09-12-onboarding-search-profile-design.md`

**Superseded:** this plan previously had eleven tasks building a five-step
onboarding wizard, a `/dashboard` route, and a `/settings/profile` page. Those
were written before the hackathon split deferred onboarding and before Person B
shipped the dashboard at `/`. They are dropped, not paused — the spec's §7
keeps the wizard design if it ever returns.

## Global Constraints

- **No test suite.** MVP standing decision. Verify with
  `npm run typecheck -w frontend` and a browser walkthrough.
- **Run all installs from the repo root.**
- **Do not import from `backend/` into `frontend/`.** Cross-track types are
  redeclared (Task 1).
- **`npm run lint -w frontend` is already failing on `main`** — two errors in
  untouched starter files (`components/theme-switcher.tsx:21`,
  `tailwind.config.ts:62`), surfaced by the new flat ESLint config. Do not
  treat those as yours; Task 4 offers to fix them separately. Every other task
  only needs typecheck to pass.
- **Do not restructure `scout-dashboard.tsx`.** It is 764 lines of Person B's
  work. Touch only the `<dialog>` block at line 726 and the props.
- **Do not loosen `frontend/tsconfig.json` strict flags**; do not move Tailwind
  to v4.
- **Never print `NEXT_PUBLIC_SUPABASE_*` values into the transcript.**
- Columns are snake_case; copy names from `backend/src/db/schema/profiles.ts`.
  The Supabase client is untyped here, so a typo fails at runtime.
- `AvailabilityWindow.day` is 0–6 with **0 = Sunday**; `start`/`end` are 24-hour
  `"HH:MM"`.

## Prerequisite owned by Person A

`move_in_month` and `timezone` do not exist on `search_profiles` (spec §3).
**This plan does not wait for them.** Task 3 omits the Move-in field and leaves
a comment naming the missing column. Add the field when the migration lands.

---

### Task 1: Types and profile reads

**Files:**
- Create: `frontend/lib/types.ts`
- Create: `frontend/lib/profile.ts`

**Interfaces:**
- Produces: `AvailabilityWindow`, `SearchProfileRow`, `GmailAccountRow` from
  `@/lib/types`; `getSearchProfile()`, `getGmailAccount()` from `@/lib/profile`,
  both returning `null` when signed out.

- [ ] **Step 1: Create `frontend/lib/types.ts`**

```ts
/**
 * Types shared with the backend's database schema.
 *
 * Redeclared rather than imported: `frontend/` must not reach into
 * `backend/`. Source of truth is `backend/src/db/schema/profiles.ts` and
 * `backend/src/db/schema/gmail.ts` — if a shape changes there, change it here.
 */

/** A weekly recurring window the user is free to tour. `day` is 0=Sunday. */
export type AvailabilityWindow = {
  day: number;
  /** Local NYC time, 24h "HH:MM". */
  start: string;
  end: string;
};

/** `search_profiles`, as the untyped Supabase client returns it. */
export type SearchProfileRow = {
  id: string;
  user_id: string;
  budget_min: number | null;
  budget_max: number | null;
  bedrooms_min: number | null;
  bedrooms_max: number | null;
  bathrooms_min: number | null;
  neighborhoods: string[];
  must_haves: string[];
  dealbreakers: string[];
  availability: AvailabilityWindow[];
  preferences: string | null;
  daily_send_cap: number;
  paused_at: string | null;
};

/** `gmail_accounts`. Holds no secrets; tokens live in an RLS-denied table. */
export type GmailAccountRow = {
  email_address: string;
  last_synced_at: string | null;
  sync_error: string | null;
};
```

- [ ] **Step 2: Create `frontend/lib/profile.ts`**

Note the difference from a gated page: these return `null` when signed out
rather than redirecting, because `/` stays public.

```ts
import { createClient } from "@/lib/supabase/server";
import type { GmailAccountRow, SearchProfileRow } from "@/lib/types";

/** The signed-in user's id, or null. `/` is public, so signed out is normal. */
export async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return typeof userId === "string" ? userId : null;
}

/** The user's profile, or null when signed out or not yet created. */
export async function getSearchProfile(): Promise<SearchProfileRow | null> {
  const supabase = await createClient();
  // No `.eq('user_id', ...)`: RLS already restricts rows to this user, and the
  // column is unique, so at most one row can come back.
  const { data } = await supabase
    .from("search_profiles")
    .select("*")
    .maybeSingle();

  return (data as SearchProfileRow | null) ?? null;
}

/** Gmail connection state, or null when Google was never connected. */
export async function getGmailAccount(): Promise<GmailAccountRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("gmail_accounts")
    .select("email_address, last_synced_at, sync_error")
    .maybeSingle();

  return (data as GmailAccountRow | null) ?? null;
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w frontend`
Expected: passes. Nothing imports these yet.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/profile.ts
git commit -m "Read the search profile and Gmail connection state"
```

---

### Task 2: Validation and the save action

**Files:**
- Create: `frontend/lib/validation.ts`
- Create: `frontend/app/actions/profile.ts`

**Interfaces:**
- Consumes: `getUserId` from `@/lib/profile`; `AvailabilityWindow` from
  `@/lib/types`.
- Produces: `type ActionState = { error: string | null; savedAt: number | null }`
  and `saveSearchProfile(prev: ActionState, formData: FormData)` from
  `@/app/actions/profile`. Task 3 binds the panel to it with `useActionState`.

- [ ] **Step 1: Create `frontend/lib/validation.ts`**

Mirrors the check constraints in `backend/src/db/schema/profiles.ts` so the user
sees a sentence rather than a constraint name. The database is the real guard.

```ts
import type { AvailabilityWindow } from "@/lib/types";

/** "" and absent both mean "not answered"; every numeric field is nullable. */
export function optionalNumber(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateProfile(fields: {
  budgetMin: number | null;
  budgetMax: number | null;
  bedroomsMin: number | null;
  bedroomsMax: number | null;
  bathroomsMin: number | null;
}): string | null {
  const { budgetMin, budgetMax, bedroomsMin, bedroomsMax, bathroomsMin } = fields;

  if (budgetMin !== null && budgetMin < 0) return "Minimum budget cannot be negative.";
  if (budgetMax !== null && budgetMax < 0) return "Maximum budget cannot be negative.";
  if (budgetMin !== null && budgetMax !== null && budgetMax < budgetMin) {
    return "Maximum budget must be at least the minimum.";
  }
  if (bedroomsMin !== null && bedroomsMin < 0) return "Bedrooms cannot be negative.";
  if (bedroomsMax !== null && bedroomsMax < 0) return "Bedrooms cannot be negative.";
  if (bedroomsMin !== null && bedroomsMax !== null && bedroomsMax < bedroomsMin) {
    return "Maximum bedrooms must be at least the minimum.";
  }
  if (bathroomsMin !== null && bathroomsMin < 0) return "Bathrooms cannot be negative.";

  return null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateAvailability(windows: AvailabilityWindow[]): string | null {
  for (const window of windows) {
    if (!Number.isInteger(window.day) || window.day < 0 || window.day > 6) {
      return "Each tour window needs a day of the week.";
    }
    if (!TIME.test(window.start) || !TIME.test(window.end)) {
      return "Times must look like 09:00.";
    }
    if (window.end <= window.start) {
      return "Each window must end after it starts.";
    }
  }
  return null;
}

/** Comma-separated free text, from a single input. */
export function parseList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Tour windows arrive as JSON from a hidden field. */
export function parseAvailability(value: FormDataEntryValue | null): AvailabilityWindow[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((window): window is AvailabilityWindow => {
      if (typeof window !== "object" || window === null) return false;
      const candidate = window as Record<string, unknown>;
      return (
        typeof candidate.day === "number" &&
        typeof candidate.start === "string" &&
        typeof candidate.end === "string"
      );
    });
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Create `frontend/app/actions/profile.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { getUserId } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import {
  optionalNumber,
  parseAvailability,
  parseList,
  validateAvailability,
  validateProfile,
} from "@/lib/validation";

export type ActionState = { error: string | null; savedAt: number | null };

/**
 * Save the whole panel in one write.
 *
 * `user_id` comes from the session, never the form: RLS is what actually stops
 * one user writing another's row. `user_id` is unique, so conflicting on it
 * makes every save after the first an update.
 *
 * A Server Action rather than a browser PostgREST call — the mutation runs on
 * the server under the user's session. Editing your own profile has no
 * external side effect, so it is a direct write rather than a queued command
 * for the worker.
 */
export async function saveSearchProfile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Sign in to save your search.", savedAt: null };
  }

  const numbers = {
    budgetMin: optionalNumber(formData.get("budget_min")),
    budgetMax: optionalNumber(formData.get("budget_max")),
    bedroomsMin: optionalNumber(formData.get("bedrooms_min")),
    bedroomsMax: optionalNumber(formData.get("bedrooms_max")),
    bathroomsMin: optionalNumber(formData.get("bathrooms_min")),
  };

  const invalid = validateProfile(numbers);
  if (invalid) return { error: invalid, savedAt: null };

  const availability = parseAvailability(formData.get("availability"));
  const badWindow = validateAvailability(availability);
  if (badWindow) return { error: badWindow, savedAt: null };

  const preferences = formData.get("preferences");

  const supabase = await createClient();
  const { error } = await supabase.from("search_profiles").upsert(
    {
      user_id: userId,
      budget_min: numbers.budgetMin,
      budget_max: numbers.budgetMax,
      bedrooms_min: numbers.bedroomsMin,
      bedrooms_max: numbers.bedroomsMax,
      bathrooms_min: numbers.bathroomsMin,
      neighborhoods: parseList(formData.get("neighborhoods")),
      must_haves: parseList(formData.get("must_haves")),
      dealbreakers: parseList(formData.get("dealbreakers")),
      availability,
      preferences:
        typeof preferences === "string" && preferences.trim() !== ""
          ? preferences.trim()
          : null,
      // TODO: move_in_month and timezone once Person A's migration lands.
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("search_profiles upsert failed", error.code, error.message);
    return { error: "Could not save that. Please try again.", savedAt: null };
  }

  revalidatePath("/");
  return { error: null, savedAt: Date.now() };
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w frontend`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/validation.ts frontend/app/actions/profile.ts
git commit -m "Add search profile validation and the save action"
```

---

### Task 3: Make the preferences panel writable

**Files:**
- Create: `frontend/components/dashboard/search-preferences-form.tsx`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/components/dashboard/scout-dashboard.tsx` (props, and the
  `<dialog>` body at line 726 only)

**Interfaces:**
- Consumes: `saveSearchProfile`, `ActionState`; `getSearchProfile`,
  `getGmailAccount`; `SearchProfileRow`, `GmailAccountRow`,
  `AvailabilityWindow`.
- Produces: `<SearchPreferencesForm profile gmail />`;
  `<ScoutDashboard profile gmail />` — both props nullable, both defaulting to
  `null` so nothing else that renders the dashboard breaks.

- [ ] **Step 1: Create `frontend/components/dashboard/search-preferences-form.tsx`**

```tsx
"use client";

import { useActionState, useState } from "react";

import { saveSearchProfile, type ActionState } from "@/app/actions/profile";
import type {
  AvailabilityWindow,
  GmailAccountRow,
  SearchProfileRow,
} from "@/lib/types";

const INITIAL: ActionState = { error: null, savedAt: null };

/** Index is the stored `day` value; 0 = Sunday, matching the schema. */
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function SearchPreferencesForm({
  profile,
  gmail,
}: {
  profile: SearchProfileRow | null;
  gmail: GmailAccountRow | null;
}) {
  const [state, formAction, pending] = useActionState(saveSearchProfile, INITIAL);
  const [windows, setWindows] = useState<AvailabilityWindow[]>(
    profile?.availability ?? [],
  );

  function update(index: number, patch: Partial<AvailabilityWindow>) {
    setWindows(windows.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="availability" value={JSON.stringify(windows)} />

      <p>
        {gmail === null
          ? "Gmail is not connected, so Scout has no listings to work from."
          : gmail.sync_error !== null
            ? `Gmail needs reconnecting: ${gmail.sync_error}`
            : `Connected as ${gmail.email_address}`}
      </p>

      <label>
        Areas
        <input
          name="neighborhoods"
          defaultValue={(profile?.neighborhoods ?? []).join(", ")}
          placeholder="Williamsburg, Greenpoint"
        />
      </label>

      <label>
        Minimum rent
        <input
          name="budget_min"
          type="number"
          min="0"
          step="50"
          defaultValue={profile?.budget_min ?? ""}
        />
      </label>

      <label>
        Maximum rent
        <input
          name="budget_max"
          type="number"
          min="0"
          step="50"
          defaultValue={profile?.budget_max ?? ""}
        />
      </label>

      <label>
        Minimum bedrooms
        <input
          name="bedrooms_min"
          type="number"
          min="0"
          step="0.5"
          defaultValue={profile?.bedrooms_min ?? ""}
        />
      </label>

      <label>
        Maximum bedrooms
        <input
          name="bedrooms_max"
          type="number"
          min="0"
          step="0.5"
          defaultValue={profile?.bedrooms_max ?? ""}
        />
      </label>

      <label>
        Minimum bathrooms
        <input
          name="bathrooms_min"
          type="number"
          min="0"
          step="0.5"
          defaultValue={profile?.bathrooms_min ?? ""}
        />
      </label>

      {/* Move-in is omitted until Person A adds a move_in_month column. */}

      <label>
        Must haves
        <input
          name="must_haves"
          defaultValue={(profile?.must_haves ?? []).join(", ")}
          placeholder="Dishwasher, pet friendly"
        />
      </label>

      <label>
        Dealbreakers
        <input
          name="dealbreakers"
          defaultValue={(profile?.dealbreakers ?? []).join(", ")}
          placeholder="Ground floor, no laundry"
        />
      </label>

      <label>
        Anything else
        <textarea
          name="preferences"
          rows={3}
          defaultValue={profile?.preferences ?? ""}
          placeholder="Moving in October, two cats."
        />
      </label>

      <fieldset>
        <legend>Tour windows</legend>
        {windows.map((window, index) => (
          <div key={index}>
            <select
              aria-label="Day"
              value={window.day}
              onChange={(e) => update(index, { day: Number(e.target.value) })}
            >
              {DAYS.map((day, value) => (
                <option key={day} value={value}>
                  {day}
                </option>
              ))}
            </select>
            <input
              type="time"
              aria-label="Start time"
              value={window.start}
              onChange={(e) => update(index, { start: e.target.value })}
            />
            <input
              type="time"
              aria-label="End time"
              value={window.end}
              onChange={(e) => update(index, { end: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setWindows(windows.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setWindows([...windows, { day: 6, start: "10:00", end: "16:00" }])
          }
        >
          Add a window
        </button>
      </fieldset>

      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.savedAt ? <p role="status">Saved.</p> : null}

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save search"}
      </button>
    </form>
  );
}
```

Styling is left to Person B — the panel's existing `styles.preferences` rules
in `scout-dashboard.module.css` target a `<dl>`, so the form will need its own
class names added there. Ship it unstyled first and confirm it saves.

- [ ] **Step 2: Make `frontend/app/page.tsx` a Server Component**

`/` stays public: signed out, both props are `null` and the panel renders as
today's read-only sample.

```tsx
import { ScoutDashboard } from "@/components/dashboard/scout-dashboard";
import { getGmailAccount, getSearchProfile } from "@/lib/profile";

export default async function Home() {
  const [profile, gmail] = await Promise.all([
    getSearchProfile(),
    getGmailAccount(),
  ]);

  return <ScoutDashboard profile={profile} gmail={gmail} />;
}
```

- [ ] **Step 3: Accept the props in `scout-dashboard.tsx`**

Change the signature at line 100, leaving the rest of the component alone:

```tsx
export function ScoutDashboard({
  profile = null,
  gmail = null,
}: {
  profile?: SearchProfileRow | null;
  gmail?: GmailAccountRow | null;
}) {
```

and add the import:

```tsx
import type { GmailAccountRow, SearchProfileRow } from "@/lib/types";
import { SearchPreferencesForm } from "./search-preferences-form";
```

- [ ] **Step 4: Swap the dialog body**

In the `<dialog>` at line 726, replace the `<p>Read-only sample profile</p>`
and the `<dl>` beneath it with:

```tsx
{profile === null ? (
  <>
    <p>Read-only sample profile</p>
    <dl>
      <div>
        <dt>Areas</dt>
        <dd>Brooklyn &amp; Manhattan</dd>
      </div>
      <div>
        <dt>Budget</dt>
        <dd>Up to $3,500 / month</dd>
      </div>
      <div>
        <dt>Bedrooms</dt>
        <dd>1 bedroom</dd>
      </div>
      <div>
        <dt>Move-in</dt>
        <dd>October 2026</dd>
      </div>
    </dl>
  </>
) : (
  <SearchPreferencesForm profile={profile} gmail={gmail} />
)}
```

Keep the `<header>` and its close button exactly as they are.

- [ ] **Step 5: Verify**

Run: `npm run typecheck -w frontend`
Expected: passes.

Then `npm run dev:web`. Signed out at `/`, open **Search preferences**.
Expected: the static sample, unchanged from today. Sign in through
`/auth/login`, return to `/`, reopen the panel. Expected: the editable form,
empty on a first visit.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/page.tsx frontend/app/actions frontend/components/dashboard
git commit -m "Back the search preferences panel with the user's profile"
```

---

### Task 4: Walkthrough

- [ ] **Step 1: Save a full profile**

Signed in at `/`, open **Search preferences**. Fill areas, both rents, bedroom
range, must-haves, dealbreakers, the prose box, and two tour windows. Save.
Expected: "Saved." and no error.

- [ ] **Step 2: Confirm it persisted**

Reload `/` and reopen the panel. Expected: every value comes back, tour windows
included.

Then in the Supabase SQL editor:

```sql
select budget_min, budget_max, neighborhoods, must_haves,
       dealbreakers, availability, preferences
from search_profiles;
```

Expected: one row matching what was entered, with `availability` holding both
windows as objects with `day`, `start`, `end`.

- [ ] **Step 3: Confirm validation blocks a bad save**

Set minimum rent above maximum rent and save. Expected: "Maximum budget must be
at least the minimum.", the panel stays open, and the row is unchanged.

Add a tour window ending before it starts. Expected: "Each window must end
after it starts."

- [ ] **Step 4: Optionally fix the two pre-existing lint errors**

Separate commit, and only if Person B wants it — these are theirs, and they
fail on `main` today:

- `frontend/components/theme-switcher.tsx:21` — `setState` inside `useEffect`
- `frontend/tailwind.config.ts:62` — `require()` style import

Then `npm run lint -w frontend` passes again.

- [ ] **Step 5: Commit and push**

```bash
git add -A frontend
git commit -m "Fix issues found in the search profile walkthrough"
git push origin main
```

---

## Open coordination points

Person A's to close; none block this plan.

1. **`move_in_month` and `timezone`** on `search_profiles`. Task 3 omits
   Move-in and leaves a TODO in the action.
2. **The Gmail OAuth entry point.** The panel shows connection state today;
   the connect control links to A's route once it exists.
3. **The `neighborhoods` vocabulary.** Free text here. The matcher decides what
   it needs to reconcile against `listings.address`.
4. **Three stage vocabularies.** `pursuit_stage` is
   `matched, contacted, tour_scheduled, toured, applied, decided, dead`; the
   product design's §8 names `matched → ready_to_contact → contacted →
   tour_scheduled` plus `closed`; the dashboard prototype uses display strings
   matching neither. Outside this plan, but it blocks integration.
