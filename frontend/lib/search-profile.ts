import type { SupabaseClient } from "@supabase/supabase-js";

// Mirrors backend/src/db/schema/profiles.ts and gmail.ts without importing
// across workspace ownership boundaries. Only editable criteria are included.
export type AvailabilityWindow = { day: number; start: string; end: string };
export type SearchProfile = {
  budget_min: number | null;
  budget_max: number | null;
  bedrooms_min: number | null;
  bedrooms_max: number | null;
  bathrooms_min: number | null;
  neighborhoods: string[];
  must_haves: string[];
  dealbreakers: string[];
  preferences: string | null;
  availability: AvailabilityWindow[];
};
export type GmailConnection = {
  email_address: string;
  last_synced_at: string | null;
  sync_error: string | null;
};
export type PreferencesContext = {
  signedIn: boolean;
  profile: SearchProfile | null;
  profileError: boolean;
  gmail: GmailConnection | null;
  gmailError: boolean;
  paused: boolean;
};
export const signedOutPreferences: PreferencesContext = {
  signedIn: false,
  profile: null,
  profileError: false,
  gmail: null,
  gmailError: false,
  paused: false,
};
export const sampleProfile: SearchProfile = {
  budget_min: null,
  budget_max: 3500,
  bedrooms_min: 1,
  bedrooms_max: 1,
  bathrooms_min: 1,
  neighborhoods: ["Williamsburg", "Greenpoint", "Lower East Side"],
  must_haves: [],
  dealbreakers: [],
  preferences: null,
  availability: [{ day: 1, start: "17:00", end: "19:00" }],
};
export function profileSummary(profile: SearchProfile | null): string {
  if (!profile) return "Search profile not configured";
  const {
    bedrooms_min: minBeds,
    bedrooms_max: maxBeds,
    budget_min: minRent,
    budget_max: maxRent,
  } = profile;
  const roomCount = (value: number) =>
    `${value} bedroom${value === 1 ? "" : "s"}`;
  const price = (value: number) => `$${Number(value).toLocaleString("en-US")}`;
  let beds = "Bedrooms not set";
  if (maxBeds === 0) beds = "Studio";
  else if (minBeds !== null && maxBeds !== null)
    beds =
      minBeds === maxBeds
        ? roomCount(minBeds)
        : `${minBeds}–${maxBeds} bedrooms`;
  else if (minBeds !== null) beds = `${minBeds}+ bedrooms`;
  else if (maxBeds !== null) beds = `Up to ${roomCount(maxBeds)}`;
  let budget = "Budget not set";
  if (minRent !== null && maxRent !== null)
    budget =
      minRent === maxRent
        ? price(minRent)
        : `${price(minRent)}–${price(maxRent)}`;
  else if (minRent !== null) budget = `From ${price(minRent)}`;
  else if (maxRent !== null) budget = `Up to ${price(maxRent)}`;
  return `${beds} · ${budget}`;
}
export type ProfileActionState = {
  error: string | null;
  field: string | null;
  savedAt: string | null;
};
export type ProfileValidation =
  | { profile: SearchProfile; error: null; field: null }
  | { profile: null; error: string; field: string };
const numericFields = {
  budget_min: { label: "Minimum rent", max: 9999999999.99, scale: 100 },
  budget_max: { label: "Maximum rent", max: 9999999999.99, scale: 100 },
  bedrooms_min: { label: "Minimum bedrooms", max: 999.9, scale: 10 },
  bedrooms_max: { label: "Maximum bedrooms", max: 999.9, scale: 10 },
  bathrooms_min: { label: "Minimum bathrooms", max: 999.9, scale: 10 },
} as const;
export function splitPreferenceList(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase("en-US");
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
// Malformed input is rejected rather than silently becoming null/an empty list.
export function parseSearchProfile(form: FormData): ProfileValidation {
  const invalid = (field: string, error: string): ProfileValidation => ({
    profile: null,
    field,
    error,
  });
  const numbers = {} as Pick<SearchProfile, keyof typeof numericFields>;
  for (const key of Object.keys(
    numericFields,
  ) as (keyof typeof numericFields)[]) {
    const raw = form.get(key);
    const rule = numericFields[key];
    if (typeof raw !== "string")
      return invalid(
        key,
        `${rule.label} is missing. Please enter a value or leave the field blank.`,
      );
    if (!raw.trim()) {
      numbers[key] = null;
      continue;
    }
    const value = Number(raw);
    if (
      !/^\d+(\.\d+)?$/.test(raw.trim()) ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > rule.max ||
      (raw.trim().split(".")[1]?.length ?? 0) > (rule.scale === 100 ? 2 : 1)
    ) {
      return invalid(
        key,
        `${rule.label} must be a non-negative number within the supported range (${rule.scale === 100 ? "up to two decimal places" : "up to one decimal place"}).`,
      );
    }
    numbers[key] = value;
  }
  if (
    numbers.budget_min !== null &&
    numbers.budget_max !== null &&
    numbers.budget_max < numbers.budget_min
  )
    return invalid(
      "budget_max",
      "Maximum rent must be at least the minimum rent.",
    );
  if (
    numbers.bedrooms_min !== null &&
    numbers.bedrooms_max !== null &&
    numbers.bedrooms_max < numbers.bedrooms_min
  )
    return invalid(
      "bedrooms_max",
      "Maximum bedrooms must be at least the minimum bedrooms.",
    );
  const lists = {} as Pick<
    SearchProfile,
    "neighborhoods" | "must_haves" | "dealbreakers"
  >;
  for (const key of ["neighborhoods", "must_haves", "dealbreakers"] as const) {
    const raw = form.get(key);
    if (typeof raw !== "string")
      return invalid(
        key,
        "A preference field is missing. Refresh and try again.",
      );
    lists[key] = splitPreferenceList(raw);
  }
  const preferences = form.get("preferences");
  if (typeof preferences !== "string")
    return invalid(
      "preferences",
      "Your notes could not be read. Please try again.",
    );
  const rawWindows = form.get("availability");
  if (typeof rawWindows !== "string")
    return invalid(
      "availability",
      "Tour availability is missing. Please review your windows.",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawWindows);
  } catch {
    return invalid(
      "availability",
      "Tour availability could not be read. Please review your windows.",
    );
  }
  if (!Array.isArray(parsed))
    return invalid(
      "availability",
      "Tour availability must contain a list of windows.",
    );
  const availability: AvailabilityWindow[] = [];
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const window of parsed) {
    if (
      typeof window !== "object" ||
      window === null ||
      !Number.isInteger(window.day) ||
      window.day < 0 ||
      window.day > 6 ||
      typeof window.start !== "string" ||
      typeof window.end !== "string" ||
      !time.test(window.start) ||
      !time.test(window.end) ||
      window.end <= window.start
    ) {
      return invalid(
        "availability",
        "Every tour window needs a day and an end time after its start time. Use a separate window for each day.",
      );
    }
    availability.push({
      day: window.day,
      start: window.start,
      end: window.end,
    });
  }
  return {
    profile: {
      ...numbers,
      ...lists,
      preferences: preferences.trim() || null,
      availability,
    },
    error: null,
    field: null,
  };
}

export const profileSaveFailed: ProfileActionState = {
  error:
    "Your save could not be confirmed. Your edits are still here; please try again.",
  field: null,
  savedAt: null,
};

export async function executeProfileSave(
  supabase: SupabaseClient,
  form: FormData,
): Promise<ProfileActionState> {
  try {
    const { data, error: authError } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (authError || typeof userId !== "string" || !userId)
      return {
        error: "Sign in to save your search preferences.",
        field: null,
        savedAt: null,
      };
    const parsed = parseSearchProfile(form);
    if (parsed.error !== null)
      return { error: parsed.error, field: parsed.field, savedAt: null };
    const savedAt = new Date().toISOString();
    // Only editable criteria. Agent answers, pause and send caps are preserved.
    const { data: saved, error } = await supabase
      .from("search_profiles")
      .upsert(
        { user_id: userId, ...parsed.profile, updated_at: savedAt },
        { onConflict: "user_id" },
      )
      .select("user_id")
      .maybeSingle();
    if (error || saved?.user_id !== userId) return profileSaveFailed;
    return { error: null, field: null, savedAt };
  } catch {
    return profileSaveFailed;
  }
}
