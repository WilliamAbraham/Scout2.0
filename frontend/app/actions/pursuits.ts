"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { executePursuitCommand, executeSearchPause } from "@/lib/inbox-command";
import type { CommandActionState } from "@/lib/inbox-command";

export async function submitPursuitCommand(
  _previous: CommandActionState,
  form: FormData,
): Promise<CommandActionState> {
  const result = await executePursuitCommand(await createClient(), form);
  if (!result.error) revalidatePath("/dashboard");
  return result;
}

export async function setSearchPaused(
  _previous: CommandActionState,
  form: FormData,
): Promise<CommandActionState> {
  const result = await executeSearchPause(await createClient(), form);
  if (!result.error) {
    revalidatePath("/dashboard");
    revalidatePath("/");
  }
  return result;
}
