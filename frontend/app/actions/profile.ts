"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { executeProfileSave, profileSaveFailed } from "@/lib/search-profile";
import type { ProfileActionState } from "@/lib/search-profile";

export async function saveSearchProfile(
  _previous: ProfileActionState,
  form: FormData,
): Promise<ProfileActionState> {
  try {
    const result = await executeProfileSave(await createClient(), form);
    if (result.savedAt) {
      revalidatePath("/");
      revalidatePath("/dashboard");
      revalidatePath("/preferences");
    }
    return result;
  } catch {
    return profileSaveFailed;
  }
}
