# Onboarding and Search Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a resumable onboarding wizard that writes a user's
`search_profiles` row, plus the signed-in dashboard shell it hands off to.

**Architecture:** Next.js App Router. Server Components read Supabase through
`lib/supabase/server.ts`; every write is a Server Action that upserts one
step's columns into `search_profiles` and redirects to the next step. RLS is
the access control — `user_id` always comes from the session, never the form.
Step state lives in the `?step=` query param, so a reload resumes where the
user left off.

**Tech Stack:** Next.js 16.3.3 (App Router, React 19), `@supabase/ssr` 0.12.5,
`@supabase/supabase-js` 2.112.4, Tailwind CSS 3.4 (**not** v4), shadcn-style
primitives already in `frontend/components/ui/`.

**Spec:** `docs/superpowers/specs/2026-09-12-onboarding-search-profile-design.md`

## Global Constraints

- **No test suite.** This project is an MVP; the standing decision is no test
  effort unless asked. Every task is verified by `npm run typecheck -w frontend`,
  `npm run lint -w frontend`, and a browser walkthrough. Do not add a test
  runner, and do not skip the verification steps — they replace tests here.
- **Run all installs from the repo root.** A `frontend/node_modules/` appearing
  means a command ran from the wrong directory.
- **Do not import from `backend/` into `frontend/`.** The two-person split
  forbids it. Cross-track types are redeclared, as Task 1 does.
- **Do not loosen `frontend/tsconfig.json` strict flags** and do not upgrade
  Tailwind to v4 — both are pinned by
  `docs/superpowers/specs/2026-08-30-nextjs-frontend-design.md`.
- **Never print the values of `NEXT_PUBLIC_SUPABASE_*` into the transcript.**
- Table is `search_profiles`; columns are snake_case (`budget_min`,
  `bedrooms_min`, `must_haves`, `daily_send_cap`, …). The Supabase client is
  untyped here — there are no generated database types — so column names are
  string literals and typos fail at runtime, not compile time. Copy them from
  `backend/src/db/schema/profiles.ts` exactly.
- `dailySendCap` default is 10, valid range 0–100.
- `AvailabilityWindow.day` is 0–6 with **0 = Sunday**; `start`/`end` are
  24-hour `"HH:MM"` strings in local NYC time.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `frontend/lib/types.ts` | Cross-track types redeclared from the backend schema |
| `frontend/lib/profile.ts` | Reads: current user, their profile, their Gmail account |
| `frontend/lib/validation.ts` | Pure field validation, mirroring the DB check constraints |
| `frontend/app/onboarding/actions.ts` | One Server Action per wizard step |
| `frontend/app/onboarding/page.tsx` | Wizard shell; picks the step from `?step=` |
| `frontend/components/onboarding/step-nav.tsx` | Step indicator |
| `frontend/components/onboarding/connect-google-step.tsx` | Step 1 |
| `frontend/components/onboarding/basics-step.tsx` | Step 2 |
| `frontend/components/onboarding/preferences-step.tsx` | Step 3 |
| `frontend/components/onboarding/availability-step.tsx` | Step 4 |
| `frontend/components/onboarding/review-step.tsx` | Step 5 |
| `frontend/components/tag-input.tsx` | Free-text tag entry, used by step 3 |
| `frontend/app/dashboard/layout.tsx` | Signed-in chrome |
| `frontend/app/dashboard/page.tsx` | Home; gates on a profile existing |
| `frontend/app/settings/profile/page.tsx` | Later edits, reusing the step components |

**Modified:** `frontend/components/login-form.tsx`,
`frontend/components/sign-up-form.tsx`,
`frontend/components/update-password-form.tsx`, `frontend/.env.example`.

**Deleted:** `frontend/app/protected/`, `frontend/components/tutorial/`.

---

### Task 1: Shell — retire the starter demo, add `/dashboard`

Replaces the `with-supabase` tutorial pages with Scout's own signed-in home, so
every later task has somewhere to land.

**Files:**
- Create: `frontend/lib/types.ts`
- Create: `frontend/app/dashboard/layout.tsx`
- Create: `frontend/app/dashboard/page.tsx`
- Modify: `frontend/components/login-form.tsx:42`
- Modify: `frontend/components/sign-up-form.tsx:47`
- Modify: `frontend/components/update-password-form.tsx:37`
- Modify: `frontend/.env.example`
- Delete: `frontend/app/protected/`, `frontend/components/tutorial/`

**Interfaces:**
- Produces: `AvailabilityWindow`, `LearnedAnswer`, `SearchProfileRow`,
  `GmailAccountRow` from `@/lib/types`; the `/dashboard` route.

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

/** An answer the agent learned from an escalation. Agent-written; read-only here. */
export type LearnedAnswer = {
  question: string;
  answer: string;
  learnedAt: string;
  pursuitId: string | null;
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
  learned_answers: LearnedAnswer[];
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

- [ ] **Step 2: Create `frontend/app/dashboard/layout.tsx`**

Adapted from `app/protected/layout.tsx` with the starter's deploy button and
Supabase footer removed.

```tsx
import { AuthButton } from "@/components/auth-button";
import { EnvVarWarning } from "@/components/env-var-warning";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
        <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
          <div className="flex gap-5 items-center font-semibold">
            <Link href="/dashboard">Scout</Link>
            <Link href="/settings/profile" className="font-normal text-foreground/70 hover:text-foreground">
              Search profile
            </Link>
          </div>
          {!hasEnvVars ? (
            <EnvVarWarning />
          ) : (
            <Suspense>
              <AuthButton />
            </Suspense>
          )}
        </div>
      </nav>
      <div className="flex-1 flex flex-col gap-8 w-full max-w-5xl p-5">
        {children}
      </div>
      <footer className="w-full flex items-center justify-center border-t text-xs py-8">
        <ThemeSwitcher />
      </footer>
    </main>
  );
}
```

- [ ] **Step 3: Create a placeholder `frontend/app/dashboard/page.tsx`**

Task 2 adds the profile gate; this is just a landing target so the redirects in
Step 4 resolve.

```tsx
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-bold">Scout is watching your inbox</h1>
      <p className="text-foreground/70 text-sm">
        Matched listings will show up here.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Repoint the three auth redirects**

In `frontend/components/login-form.tsx:42` and
`frontend/components/update-password-form.tsx:37`, replace
`router.push("/protected")` with `router.push("/dashboard")`.

In `frontend/components/sign-up-form.tsx:47`, replace
`emailRedirectTo: \`${window.location.origin}/protected\`` with
`emailRedirectTo: \`${window.location.origin}/onboarding\`` — a brand-new user
has no profile, so send them straight into the wizard.

- [ ] **Step 5: Delete the starter demo**

```bash
rm -rf frontend/app/protected frontend/components/tutorial
```

- [ ] **Step 6: Add the backend URL to `frontend/.env.example`**

Append:

```
# Scout backend HTTP server, for the Gmail OAuth handoff
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
```

Then add the same line to `frontend/.env.local` (gitignored; do not commit it,
and do not print the file's other values).

- [ ] **Step 7: Verify**

Run: `npm run typecheck -w frontend && npm run lint -w frontend`
Expected: both pass, with no remaining references to `/protected` or
`components/tutorial`. Confirm with:

```bash
grep -rn "protected\|tutorial" frontend/app frontend/components
```

Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/types.ts frontend/app/dashboard frontend/components frontend/.env.example
git commit -m "Replace the starter demo pages with Scout's dashboard shell"
```

---

### Task 2: Profile reads and the onboarding gate

**Files:**
- Create: `frontend/lib/profile.ts`
- Modify: `frontend/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `SearchProfileRow`, `GmailAccountRow` from `@/lib/types`.
- Produces: `requireUserId(): Promise<string>`,
  `getSearchProfile(): Promise<SearchProfileRow | null>`,
  `getGmailAccount(): Promise<GmailAccountRow | null>` from `@/lib/profile`.

- [ ] **Step 1: Create `frontend/lib/profile.ts`**

```ts
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { GmailAccountRow, SearchProfileRow } from "@/lib/types";

/**
 * The signed-in user's id, or a redirect to login.
 *
 * `getClaims()` is the same call `proxy.ts` makes to refresh the session; the
 * JWT's `sub` is the `auth.users` id that every RLS policy compares against.
 */
export async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (error || typeof userId !== "string") {
    redirect("/auth/login");
  }

  return userId;
}

/** The user's profile, or null when onboarding has not started. */
export async function getSearchProfile(): Promise<SearchProfileRow | null> {
  const supabase = await createClient();
  // No `.eq('user_id', ...)`: RLS already restricts the rows to this user, and
  // the column is unique, so at most one row can come back.
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

- [ ] **Step 2: Gate the dashboard on a profile existing**

Replace `frontend/app/dashboard/page.tsx` entirely:

```tsx
import { redirect } from "next/navigation";

import { getSearchProfile, requireUserId } from "@/lib/profile";

export default async function DashboardPage() {
  await requireUserId();
  const profile = await getSearchProfile();

  if (!profile) {
    redirect("/onboarding");
  }

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-bold">Scout is watching your inbox</h1>
      <p className="text-foreground/70 text-sm">
        Matched listings will show up here.
      </p>
    </div>
  );
}
```

The gate lives here rather than in `proxy.ts` on purpose: the proxy's matcher
runs on nearly every request, and a database round-trip there would be paid for
navigations and assets alike.

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w frontend && npm run lint -w frontend`
Expected: both pass.

Then start the dev server and visit `/dashboard` as a signed-in user with no
profile row. Expected: redirected to `/onboarding` (which 404s until Task 3 —
that is the correct result for now, and confirms the redirect fired).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/profile.ts frontend/app/dashboard/page.tsx
git commit -m "Read the search profile and gate the dashboard on it"
```

---

### Task 3: Validation and the step Server Actions

The whole write path, landed in one task because the actions are meaningless
without the validators and vice versa.

**Files:**
- Create: `frontend/lib/validation.ts`
- Create: `frontend/app/onboarding/actions.ts`

**Interfaces:**
- Consumes: `requireUserId` from `@/lib/profile`; `AvailabilityWindow` from
  `@/lib/types`.
- Produces: `type ActionState = { error: string | null }`; the actions
  `saveBasics`, `savePreferences`, `saveAvailability`, `finishOnboarding`,
  each `(prev: ActionState, formData: FormData) => Promise<ActionState>`.
  Every step component in Tasks 5–9 binds to one of these with
  `useActionState`.

- [ ] **Step 1: Create `frontend/lib/validation.ts`**

These mirror the check constraints in `backend/src/db/schema/profiles.ts`. The
database is the real guard; this exists so the user sees a sentence instead of
a Postgres constraint name.

```ts
import type { AvailabilityWindow } from "@/lib/types";

/** "" and absent both mean "not answered"; every numeric field is nullable. */
export function optionalNumber(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateBasics(fields: {
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

export function validateSendCap(cap: number): string | null {
  if (!Number.isInteger(cap) || cap < 0 || cap > 100) {
    return "Daily send cap must be a whole number between 0 and 100.";
  }
  return null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateAvailability(windows: AvailabilityWindow[]): string | null {
  for (const window of windows) {
    if (!Number.isInteger(window.day) || window.day < 0 || window.day > 6) {
      return "Each availability window needs a day of the week.";
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

/** Tag lists arrive as a JSON string from a hidden input. */
export function parseTags(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  } catch {
    return [];
  }
}

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

- [ ] **Step 2: Create `frontend/app/onboarding/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUserId } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import {
  optionalNumber,
  parseAvailability,
  parseTags,
  validateAvailability,
  validateBasics,
  validateSendCap,
} from "@/lib/validation";

export type ActionState = { error: string | null };

/**
 * Upsert one step's columns.
 *
 * `user_id` comes from the session, never the form: RLS is what actually
 * stops one user writing another's row, and handing it a value from the
 * client would only ever be rejected. `user_id` is unique, so conflicting on
 * it makes every step after the first an update.
 */
async function saveStep(
  patch: Record<string, unknown>,
): Promise<string | null> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { error } = await supabase
    .from("search_profiles")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });

  if (error) {
    console.error("search_profiles upsert failed", error.code, error.message);
    return "Could not save that. Please try again.";
  }

  revalidatePath("/onboarding");
  revalidatePath("/dashboard");
  return null;
}

export async function saveBasics(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fields = {
    budgetMin: optionalNumber(formData.get("budget_min")),
    budgetMax: optionalNumber(formData.get("budget_max")),
    bedroomsMin: optionalNumber(formData.get("bedrooms_min")),
    bedroomsMax: optionalNumber(formData.get("bedrooms_max")),
    bathroomsMin: optionalNumber(formData.get("bathrooms_min")),
  };

  const invalid = validateBasics(fields);
  if (invalid) return { error: invalid };

  const failed = await saveStep({
    budget_min: fields.budgetMin,
    budget_max: fields.budgetMax,
    bedrooms_min: fields.bedroomsMin,
    bedrooms_max: fields.bedroomsMax,
    bathrooms_min: fields.bathroomsMin,
  });
  if (failed) return { error: failed };

  redirect("/onboarding?step=preferences");
}

export async function savePreferences(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const preferences = formData.get("preferences");

  const failed = await saveStep({
    neighborhoods: parseTags(formData.get("neighborhoods")),
    must_haves: parseTags(formData.get("must_haves")),
    dealbreakers: parseTags(formData.get("dealbreakers")),
    preferences: typeof preferences === "string" && preferences.trim() !== ""
      ? preferences.trim()
      : null,
  });
  if (failed) return { error: failed };

  redirect("/onboarding?step=availability");
}

export async function saveAvailability(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const windows = parseAvailability(formData.get("availability"));

  const invalid = validateAvailability(windows);
  if (invalid) return { error: invalid };

  const failed = await saveStep({ availability: windows });
  if (failed) return { error: failed };

  redirect("/onboarding?step=review");
}

export async function finishOnboarding(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const cap = Number(formData.get("daily_send_cap"));

  const invalid = validateSendCap(cap);
  if (invalid) return { error: invalid };

  const failed = await saveStep({ daily_send_cap: cap });
  if (failed) return { error: failed };

  redirect("/dashboard");
}
```

Note on control flow: `redirect()` throws, so a successful action never
returns. The `{ error }` shape is therefore only ever the failure path, which
is what the step components render.

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w frontend && npm run lint -w frontend`
Expected: both pass. No browser check yet — nothing calls these until Task 4.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/validation.ts frontend/app/onboarding/actions.ts
git commit -m "Add search profile validation and the per-step save actions"
```

---

### Task 4: Wizard shell and step routing

**Files:**
- Create: `frontend/app/onboarding/page.tsx`
- Create: `frontend/components/onboarding/step-nav.tsx`

**Interfaces:**
- Consumes: `getSearchProfile`, `getGmailAccount`, `requireUserId` from
  `@/lib/profile`.
- Produces: `const STEPS` and `type StepId =
  "google" | "basics" | "preferences" | "availability" | "review"` from
  `@/components/onboarding/step-nav`; the `/onboarding?step=` route that
  Tasks 5–9 fill in.

- [ ] **Step 1: Create `frontend/components/onboarding/step-nav.tsx`**

```tsx
export const STEPS = [
  { id: "google", label: "Connect Gmail" },
  { id: "basics", label: "Basics" },
  { id: "preferences", label: "Preferences" },
  { id: "availability", label: "Availability" },
  { id: "review", label: "Review" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export function isStepId(value: string | undefined): value is StepId {
  return STEPS.some((step) => step.id === value);
}

export function StepNav({ current }: { current: StepId }) {
  const currentIndex = STEPS.findIndex((step) => step.id === current);

  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {STEPS.map((step, index) => (
        <li
          key={step.id}
          className={
            index === currentIndex
              ? "font-semibold"
              : index < currentIndex
                ? "text-foreground/60"
                : "text-foreground/40"
          }
        >
          {index + 1}. {step.label}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 2: Create `frontend/app/onboarding/page.tsx`**

The step components land in Tasks 5–9; this renders a labelled placeholder for
each so the routing is verifiable on its own.

```tsx
import { getGmailAccount, getSearchProfile, requireUserId } from "@/lib/profile";
import { StepNav, isStepId } from "@/components/onboarding/step-nav";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  await requireUserId();
  const { step } = await searchParams;
  const current = isStepId(step) ? step : "google";

  const [profile, gmail] = await Promise.all([
    getSearchProfile(),
    getGmailAccount(),
  ]);

  return (
    <main className="min-h-screen flex justify-center p-5">
      <div className="w-full max-w-2xl flex flex-col gap-8 py-10">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold">Set up your search</h1>
          <StepNav current={current} />
        </div>
        <pre className="text-xs">
          {JSON.stringify({ current, hasProfile: !!profile, hasGmail: !!gmail }, null, 2)}
        </pre>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w frontend && npm run lint -w frontend`
Expected: both pass.

In the browser, visit `/onboarding`, `/onboarding?step=basics`, and
`/onboarding?step=nonsense`.
Expected: the step indicator highlights step 1, step 2, and step 1
respectively — an unknown `?step=` falls back to `google` rather than erroring.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/onboarding/page.tsx frontend/components/onboarding/step-nav.tsx
git commit -m "Add the onboarding wizard shell and step routing"
```

---

### Task 5: Step 1 — Connect Gmail

**Files:**
- Create: `frontend/components/onboarding/connect-google-step.tsx`
- Modify: `frontend/app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `GmailAccountRow` from `@/lib/types`.
- Produces: `<ConnectGoogleStep gmail={GmailAccountRow | null} />`.

- [ ] **Step 1: Create `frontend/components/onboarding/connect-google-step.tsx`**

```tsx
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { GmailAccountRow } from "@/lib/types";

/**
 * `gmail_accounts` is dashboard-readable by design and holds no secrets; the
 * OAuth tokens live in `gmail_tokens`, which has RLS on and zero policies, so
 * the browser cannot reach them.
 *
 * The connect link points at Person A's backend route, which does not exist
 * yet — hence the skip control. Without it onboarding cannot be completed.
 */
export function ConnectGoogleStep({ gmail }: { gmail: GmailAccountRow | null }) {
  const startUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/google/start`;
  const needsReconnect = gmail !== null && gmail.sync_error !== null;

  return (
    <div className="flex flex-col gap-6">
      {gmail === null ? (
        <p className="text-sm text-foreground/70">
          Scout reads your StreetEasy listing alerts out of Gmail. It never
          sends from your account without showing you first.
        </p>
      ) : needsReconnect ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-red-500">
            Gmail needs reconnecting: {gmail.sync_error}
          </p>
          <p className="text-sm text-foreground/70">{gmail.email_address}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Connected as {gmail.email_address}</p>
          <p className="text-sm text-foreground/70">
            {gmail.last_synced_at
              ? `Last synced ${new Date(gmail.last_synced_at).toLocaleString()}`
              : "Waiting for the first sync."}
          </p>
        </div>
      )}

      <div className="flex items-center gap-4">
        {gmail === null || needsReconnect ? (
          <Button asChild>
            <a href={startUrl}>
              {needsReconnect ? "Reconnect Gmail" : "Connect Gmail"}
            </a>
          </Button>
        ) : null}
        <Link
          href="/onboarding?step=basics"
          className="text-sm underline underline-offset-4"
        >
          {gmail === null ? "Skip for now" : "Continue"}
        </Link>
      </div>

      {gmail === null ? (
        <p className="text-xs text-foreground/60">
          You can skip this, but Scout cannot find listings until Gmail is
          connected.
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Render it from the wizard**

In `frontend/app/onboarding/page.tsx`, add the import and replace the `<pre>`
placeholder with a switch that handles `google` and leaves the rest as
placeholders for now:

```tsx
import { ConnectGoogleStep } from "@/components/onboarding/connect-google-step";
```

```tsx
{current === "google" ? (
  <ConnectGoogleStep gmail={gmail} />
) : (
  <pre className="text-xs">{JSON.stringify({ current, profile }, null, 2)}</pre>
)}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w frontend && npm run lint -w frontend`
Expected: both pass.

In the browser at `/onboarding`: with no `gmail_accounts` row, expect the
explanatory copy, a **Connect Gmail** button pointing at
`http://localhost:4000/auth/google/start`, and a **Skip for now** link. Click
Skip. Expected: `/onboarding?step=basics` with step 2 highlighted.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/onboarding/connect-google-step.tsx frontend/app/onboarding/page.tsx
git commit -m "Add the Connect Gmail onboarding step"
```

---

### Task 6: Step 2 — Basics

**Files:**
- Create: `frontend/components/onboarding/basics-step.tsx`
- Modify: `frontend/app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `saveBasics`, `ActionState` from `@/app/onboarding/actions`;
  `SearchProfileRow` from `@/lib/types`.
- Produces: `<BasicsStep profile={SearchProfileRow | null} />`.

- [ ] **Step 1: Create `frontend/components/onboarding/basics-step.tsx`**

```tsx
"use client";

import { useActionState } from "react";

import { saveBasics, type ActionState } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SearchProfileRow } from "@/lib/types";

const INITIAL: ActionState = { error: null };

export function BasicsStep({ profile }: { profile: SearchProfileRow | null }) {
  const [state, formAction, pending] = useActionState(saveBasics, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="budget_min">Minimum rent</Label>
          <Input
            id="budget_min"
            name="budget_min"
            type="number"
            min="0"
            step="50"
            placeholder="2000"
            defaultValue={profile?.budget_min ?? ""}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="budget_max">Maximum rent</Label>
          <Input
            id="budget_max"
            name="budget_max"
            type="number"
            min="0"
            step="50"
            placeholder="3500"
            defaultValue={profile?.budget_max ?? ""}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="bedrooms_min">Minimum bedrooms</Label>
          <Input
            id="bedrooms_min"
            name="bedrooms_min"
            type="number"
            min="0"
            step="0.5"
            placeholder="1"
            defaultValue={profile?.bedrooms_min ?? ""}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="bedrooms_max">Maximum bedrooms</Label>
          <Input
            id="bedrooms_max"
            name="bedrooms_max"
            type="number"
            min="0"
            step="0.5"
            placeholder="2"
            defaultValue={profile?.bedrooms_max ?? ""}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="bathrooms_min">Minimum bathrooms</Label>
          <Input
            id="bathrooms_min"
            name="bathrooms_min"
            type="number"
            min="0"
            step="0.5"
            placeholder="1"
            defaultValue={profile?.bathrooms_min ?? ""}
          />
        </div>
      </div>

      <p className="text-xs text-foreground/60">
        Leave anything blank that you do not want to filter on. A studio is
        zero bedrooms.
      </p>

      {state.error ? <p className="text-sm text-red-500">{state.error}</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving..." : "Continue"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Render it from the wizard**

Add `import { BasicsStep } from "@/components/onboarding/basics-step";` to
`frontend/app/onboarding/page.tsx` and add the branch:

```tsx
{current === "basics" ? <BasicsStep profile={profile} /> : null}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w frontend && npm run lint -w frontend`
Expected: both pass.

In the browser at `/onboarding?step=basics`: enter a minimum rent of 4000 and a
maximum of 2000, submit. Expected: the inline message "Maximum budget must be
at least the minimum." and no navigation. Fix the values, submit. Expected:
`/onboarding?step=preferences`. Reload `/onboarding?step=basics`. Expected: the
saved values are prefilled — proof the upsert landed.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/onboarding/basics-step.tsx frontend/app/onboarding/page.tsx
git commit -m "Add the basics onboarding step"
```

---

### Task 7: Step 3 — Preferences, and the tag input

**Files:**
- Create: `frontend/components/tag-input.tsx`
- Create: `frontend/components/onboarding/preferences-step.tsx`
- Modify: `frontend/app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `savePreferences`, `ActionState` from `@/app/onboarding/actions`.
- Produces: `<TagInput name={string} label={string} defaultValue={string[]}
  placeholder={string} />` — renders a hidden input named `name` holding
  `JSON.stringify(tags)`, which `parseTags` on the server reads.
- Produces: `<PreferencesStep profile={SearchProfileRow | null} />`.

- [ ] **Step 1: Create `frontend/components/tag-input.tsx`**

```tsx
"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Free-text tags, serialised into one hidden field as JSON.
 *
 * `neighborhoods` is deliberately unconstrained: a closed vocabulary is a
 * matcher decision (listings store only a free-text address), so it stays with
 * Person A rather than being fixed here.
 */
export function TagInput({
  name,
  label,
  defaultValue,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue: string[];
  placeholder: string;
}) {
  const [tags, setTags] = useState<string[]>(defaultValue);
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const value = draft.trim();
    if (value === "" || tags.includes(value)) {
      setDraft("");
      return;
    }
    setTags([...tags, value]);
    setDraft("");
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={`${name}-draft`}>{label}</Label>
      <input type="hidden" name={name} value={JSON.stringify(tags)} />
      <Input
        id={`${name}-draft`}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            // Enter would otherwise submit the whole step.
            e.preventDefault();
            commitDraft();
          }
        }}
      />
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li
              key={tag}
              className="flex items-center gap-1 rounded border px-2 py-1 text-sm"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                className="text-foreground/50 hover:text-foreground"
                onClick={() => setTags(tags.filter((t) => t !== tag))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/components/onboarding/preferences-step.tsx`**

```tsx
"use client";

import { useActionState } from "react";

import { savePreferences, type ActionState } from "@/app/onboarding/actions";
import { TagInput } from "@/components/tag-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { SearchProfileRow } from "@/lib/types";

const INITIAL: ActionState = { error: null };

export function PreferencesStep({ profile }: { profile: SearchProfileRow | null }) {
  const [state, formAction, pending] = useActionState(savePreferences, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <TagInput
        name="neighborhoods"
        label="Neighborhoods"
        defaultValue={profile?.neighborhoods ?? []}
        placeholder="Williamsburg, then Enter"
      />
      <TagInput
        name="must_haves"
        label="Must haves"
        defaultValue={profile?.must_haves ?? []}
        placeholder="Dishwasher, then Enter"
      />
      <TagInput
        name="dealbreakers"
        label="Dealbreakers"
        defaultValue={profile?.dealbreakers ?? []}
        placeholder="Walk-up above 3rd floor, then Enter"
      />

      <div className="grid gap-2">
        <Label htmlFor="preferences">Anything else</Label>
        <textarea
          id="preferences"
          name="preferences"
          rows={4}
          defaultValue={profile?.preferences ?? ""}
          placeholder="Moving in October, two cats, work from home three days a week."
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <p className="text-xs text-foreground/60">
          Scout may quote this to a broker when they ask something your other
          answers do not cover.
        </p>
      </div>

      {state.error ? <p className="text-sm text-red-500">{state.error}</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving..." : "Continue"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Render it from the wizard**

Add the import and branch to `frontend/app/onboarding/page.tsx`:

```tsx
import { PreferencesStep } from "@/components/onboarding/preferences-step";
```

```tsx
{current === "preferences" ? <PreferencesStep profile={profile} /> : null}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck -w frontend && npm run lint -w frontend`
Expected: both pass.

In the browser at `/onboarding?step=preferences`: type "Williamsburg" and press
Enter. Expected: it becomes a removable chip and the field clears, with **no**
form submission. Add two more, remove one, submit. Expected:
`/onboarding?step=availability`. Reload the preferences step. Expected: the
chips come back.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/tag-input.tsx frontend/components/onboarding/preferences-step.tsx frontend/app/onboarding/page.tsx
git commit -m "Add the preferences onboarding step and tag input"
```

---

### Task 8: Step 4 — Availability

**Files:**
- Create: `frontend/components/onboarding/availability-step.tsx`
- Modify: `frontend/app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `saveAvailability`, `ActionState` from `@/app/onboarding/actions`;
  `AvailabilityWindow` from `@/lib/types`.
- Produces: `<AvailabilityStep profile={SearchProfileRow | null} />`, posting
  `JSON.stringify(windows)` in a hidden field named `availability`.

- [ ] **Step 1: Create `frontend/components/onboarding/availability-step.tsx`**

```tsx
"use client";

import { useActionState, useState } from "react";

import { saveAvailability, type ActionState } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import type { AvailabilityWindow, SearchProfileRow } from "@/lib/types";

const INITIAL: ActionState = { error: null };

/** Index is the stored `day` value; 0 = Sunday, matching the schema. */
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function AvailabilityStep({ profile }: { profile: SearchProfileRow | null }) {
  const [state, formAction, pending] = useActionState(saveAvailability, INITIAL);
  const [windows, setWindows] = useState<AvailabilityWindow[]>(
    profile?.availability ?? [],
  );

  function update(index: number, patch: Partial<AvailabilityWindow>) {
    setWindows(windows.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="availability" value={JSON.stringify(windows)} />

      <p className="text-sm text-foreground/70">
        When can you tour? Scout only offers brokers times inside these
        windows. Times are New York local.
      </p>

      <ul className="flex flex-col gap-3">
        {windows.map((window, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Day"
              value={window.day}
              onChange={(e) => update(index, { day: Number(e.target.value) })}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
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
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
            <span className="text-sm text-foreground/60">to</span>
            <input
              type="time"
              aria-label="End time"
              value={window.end}
              onChange={(e) => update(index, { end: e.target.value })}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
            <button
              type="button"
              className="text-sm text-foreground/50 hover:text-foreground"
              onClick={() => setWindows(windows.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() =>
          setWindows([...windows, { day: 6, start: "10:00", end: "16:00" }])
        }
      >
        Add a window
      </Button>

      {state.error ? <p className="text-sm text-red-500">{state.error}</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving..." : "Continue"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Render it from the wizard**

Add the import and branch to `frontend/app/onboarding/page.tsx`:

```tsx
import { AvailabilityStep } from "@/components/onboarding/availability-step";
```

```tsx
{current === "availability" ? <AvailabilityStep profile={profile} /> : null}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w frontend && npm run lint -w frontend`
Expected: both pass.

In the browser at `/onboarding?step=availability`: add a window, set the end
time earlier than the start, submit. Expected: "Each window must end after it
starts." and no navigation. Fix it, add a second window, submit. Expected:
`/onboarding?step=review`. Reload the availability step. Expected: both windows
come back with their days and times.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/onboarding/availability-step.tsx frontend/app/onboarding/page.tsx
git commit -m "Add the availability onboarding step"
```

---

### Task 9: Step 5 — Review and finish

**Files:**
- Create: `frontend/components/onboarding/review-step.tsx`
- Modify: `frontend/app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `finishOnboarding`, `ActionState` from `@/app/onboarding/actions`;
  `GmailAccountRow`, `SearchProfileRow` from `@/lib/types`.
- Produces: `<ReviewStep profile={SearchProfileRow | null}
  gmail={GmailAccountRow | null} />`.

- [ ] **Step 1: Create `frontend/components/onboarding/review-step.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";

import { finishOnboarding, type ActionState } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GmailAccountRow, SearchProfileRow } from "@/lib/types";

const INITIAL: ActionState = { error: null };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function Row({
  label,
  href,
  children,
}: {
  label: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 border-b py-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-foreground/50">
          {label}
        </span>
        <span className="text-sm">{children}</span>
      </div>
      <Link href={href} className="text-sm underline underline-offset-4">
        Edit
      </Link>
    </div>
  );
}

function range(min: number | null, max: number | null, unit: string) {
  if (min === null && max === null) return "Any";
  if (min !== null && max !== null) return `${min}–${max} ${unit}`;
  if (min !== null) return `${min}+ ${unit}`;
  return `Up to ${max} ${unit}`;
}

function list(values: string[]) {
  return values.length > 0 ? values.join(", ") : "None";
}

export function ReviewStep({
  profile,
  gmail,
}: {
  profile: SearchProfileRow | null;
  gmail: GmailAccountRow | null;
}) {
  const [state, formAction, pending] = useActionState(finishOnboarding, INITIAL);
  const windows = profile?.availability ?? [];

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="flex flex-col">
        <Row label="Gmail" href="/onboarding?step=google">
          {gmail ? gmail.email_address : "Not connected"}
        </Row>
        <Row label="Rent" href="/onboarding?step=basics">
          {range(profile?.budget_min ?? null, profile?.budget_max ?? null, "per month")}
        </Row>
        <Row label="Bedrooms" href="/onboarding?step=basics">
          {range(profile?.bedrooms_min ?? null, profile?.bedrooms_max ?? null, "bed")}
        </Row>
        <Row label="Neighborhoods" href="/onboarding?step=preferences">
          {list(profile?.neighborhoods ?? [])}
        </Row>
        <Row label="Must haves" href="/onboarding?step=preferences">
          {list(profile?.must_haves ?? [])}
        </Row>
        <Row label="Dealbreakers" href="/onboarding?step=preferences">
          {list(profile?.dealbreakers ?? [])}
        </Row>
        <Row label="Availability" href="/onboarding?step=availability">
          {windows.length > 0
            ? windows.map((w) => `${DAYS[w.day]} ${w.start}–${w.end}`).join("; ")
            : "None set"}
        </Row>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="daily_send_cap">Emails Scout may send per day</Label>
        <Input
          id="daily_send_cap"
          name="daily_send_cap"
          type="number"
          min="0"
          max="100"
          step="1"
          defaultValue={profile?.daily_send_cap ?? 10}
          className="max-w-24"
        />
        <p className="text-xs text-foreground/60">
          A hard cap on outreach from your account, not a target.
        </p>
      </div>

      {gmail === null ? (
        <p className="text-sm text-foreground/70">
          Gmail is not connected yet, so Scout has no listings to work from.
          You can connect it any time from your search profile.
        </p>
      ) : null}

      {state.error ? <p className="text-sm text-red-500">{state.error}</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving..." : "Finish"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Render it from the wizard**

Add the import and branch to `frontend/app/onboarding/page.tsx`, and delete the
leftover `<pre>` placeholder — every step now has a real component:

```tsx
import { ReviewStep } from "@/components/onboarding/review-step";
```

```tsx
{current === "review" ? <ReviewStep profile={profile} gmail={gmail} /> : null}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w frontend && npm run lint -w frontend`
Expected: both pass, and `grep -n "pre className" frontend/app/onboarding/page.tsx`
returns nothing.

In the browser at `/onboarding?step=review`: confirm every row shows what you
entered in Tasks 5–8. Set the send cap to 500 and submit. Expected: "Daily send
cap must be a whole number between 0 and 100." Set it to 5 and submit.
Expected: `/dashboard`, which no longer redirects.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/onboarding/review-step.tsx frontend/app/onboarding/page.tsx
git commit -m "Add the onboarding review step"
```

---

### Task 10: `/settings/profile`

Later edits, reusing the step components rather than duplicating the fields.

**Files:**
- Create: `frontend/app/settings/profile/page.tsx`

**Interfaces:**
- Consumes: `BasicsStep`, `PreferencesStep`, `AvailabilityStep`,
  `ConnectGoogleStep`; `getGmailAccount`, `getSearchProfile`, `requireUserId`.

- [ ] **Step 1: Create `frontend/app/settings/profile/page.tsx`**

Each section reuses the wizard component, so saving a section redirects onward
through the wizard — acceptable for an MVP edit screen, and noted here so the
next person does not read it as a bug.

```tsx
import { redirect } from "next/navigation";

import { AvailabilityStep } from "@/components/onboarding/availability-step";
import { BasicsStep } from "@/components/onboarding/basics-step";
import { ConnectGoogleStep } from "@/components/onboarding/connect-google-step";
import { PreferencesStep } from "@/components/onboarding/preferences-step";
import { getGmailAccount, getSearchProfile, requireUserId } from "@/lib/profile";

export default async function SearchProfilePage() {
  await requireUserId();
  const [profile, gmail] = await Promise.all([
    getSearchProfile(),
    getGmailAccount(),
  ]);

  if (!profile) {
    redirect("/onboarding");
  }

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-2xl font-bold">Search profile</h1>

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">Gmail</h2>
        <ConnectGoogleStep gmail={gmail} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">Basics</h2>
        <BasicsStep profile={profile} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">Preferences</h2>
        <PreferencesStep profile={profile} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">Availability</h2>
        <AvailabilityStep profile={profile} />
      </section>
    </div>
  );
}
```

The page sits outside `app/dashboard/`, so it does not inherit that layout's
nav. If it should, move the file to `frontend/app/dashboard/settings/profile/`
and update the nav link in `frontend/app/dashboard/layout.tsx` to match.

- [ ] **Step 2: Verify**

Run: `npm run typecheck -w frontend && npm run lint -w frontend`
Expected: both pass.

In the browser at `/settings/profile`: every section is prefilled from the
saved row. Change the maximum rent and save. Expected: the value persists after
reload.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/settings/profile/page.tsx
git commit -m "Add the search profile settings page"
```

---

### Task 11: End-to-end walkthrough

The spec's verification section, run as one pass against a clean account.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev:web
```

- [ ] **Step 2: Walk a new account through**

Sign up, confirm the email link lands on `/onboarding`, then: skip Gmail →
fill basics → add neighborhoods, must-haves, dealbreakers, prose → add two
availability windows → review → Finish. Expected: `/dashboard` with no
redirect.

- [ ] **Step 3: Confirm the row**

In the Supabase SQL editor:

```sql
select budget_min, budget_max, neighborhoods, must_haves,
       availability, preferences, daily_send_cap
from search_profiles;
```

Expected: one row matching what was entered, with `availability` holding the
two windows as JSON objects with `day`, `start`, `end`.

- [ ] **Step 4: Confirm the gate and resumability**

Delete the row (`delete from search_profiles;`), then visit `/dashboard`.
Expected: redirect to `/onboarding`. Then complete only the basics step, close
the tab, and reopen `/onboarding?step=basics`. Expected: the saved values are
prefilled.

- [ ] **Step 5: Commit any fixes and push**

```bash
git add -A frontend
git commit -m "Fix issues found in the onboarding walkthrough"
git push origin main
```

If the walkthrough found nothing, skip the commit and just push the earlier
task commits.

---

## Open coordination points

Neither blocks this plan; both are Person A's to close.

1. `GET /auth/google/start` on the backend HTTP server, redirecting back to
   `/onboarding?step=basics` on success. Until it exists, Task 5's skip control
   is what keeps onboarding completable.
2. The `neighborhoods` vocabulary. Free text today. When the matcher decides
   what it needs to reconcile against `listings.address`, this field and the
   deferred LLM resolver both follow.
