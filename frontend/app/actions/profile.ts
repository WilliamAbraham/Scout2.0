"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseSearchProfile } from "@/lib/search-profile";
import type { ProfileActionState } from "@/lib/search-profile";

export async function saveSearchProfile(
  _previous: ProfileActionState,
  form: FormData,
): Promise<ProfileActionState> {
  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (authError || typeof userId !== "string")
    return {
      error: "Sign in to save your search preferences.",
      field: null,
      savedAt: null,
    };
  const parsed = parseSearchProfile(form);
  if (parsed.error !== null)
    return { error: parsed.error, field: parsed.field, savedAt: null };
  // Only user-editable criteria are included. Omitted agent answers, pause and
  // send-cap columns retain their values on conflict; new rows use DB defaults.
  const { error } = await supabase
    .from("search_profiles")
    .upsert(
      {
        user_id: userId,
        ...parsed.profile,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error)
    return {
      error:
        "Your preferences could not be saved. Your edits are still here; please try again.",
      field: null,
      savedAt: null,
    };
  revalidatePath("/");
  revalidatePath("/dashboard");
  return { error: null, field: null, savedAt: new Date().toISOString() };
}
