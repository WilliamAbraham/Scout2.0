import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GmailConnection,
  PreferencesContext,
  SearchProfile,
} from "./search-profile";

const profileColumns =
  "budget_min,budget_max,bedrooms_min,bedrooms_max,bathrooms_min,neighborhoods,must_haves,dealbreakers,preferences,availability,paused_at";
// Call only after validating the session. Explicit filtering complements RLS.
export async function loadPreferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<PreferencesContext> {
  const [profile, gmail] = await Promise.all([
    supabase
      .from("search_profiles")
      .select(profileColumns)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("gmail_accounts")
      .select("email_address,last_synced_at,sync_error")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const stored = profile.data as
    (SearchProfile & { paused_at: string | null }) | null;
  const { paused_at, ...criteria } = stored ?? { paused_at: null };
  return {
    signedIn: true,
    profile: profile.error || !stored ? null : (criteria as SearchProfile),
    profileError: Boolean(profile.error),
    gmail: gmail.error ? null : (gmail.data as GmailConnection | null),
    gmailError: Boolean(gmail.error),
    paused: Boolean(paused_at),
  };
}
