"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  executePursuitCommand,
  executeRefreshListings,
  executeSearchPause,
} from "@/lib/inbox-command";
import type { CommandActionState } from "@/lib/inbox-command";

export async function submitPursuitCommand(
  _previous: CommandActionState,
  form: FormData,
): Promise<CommandActionState> {
  const result = await executePursuitCommand(await createClient(), form);
  if (!result.error) revalidatePath("/dashboard");
  const command = form.get("command");
  const pursuitId = form.get("pursuit_id");
  return {
    ...result,
    ...(command === "supply_contact" || command === "close" ? { command } : {}),
    ...(typeof pursuitId === "string" ? { pursuitId } : {}),
  };
}

export async function refreshListings(
  _previous: CommandActionState,
): Promise<CommandActionState> {
  const result = await executeRefreshListings(await createClient());
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
