import type { SupabaseClient } from "@supabase/supabase-js";

export type CommandActionState = {
  error: string | null;
  message: string | null;
  command?: "supply_contact" | "close";
  pursuitId?: string;
};
export type PursuitCommand = {
  command: "supply_contact" | "close";
  pursuitId: string;
  expectedUpdatedAt: string;
  contact?: { name: string | null; email: string; sourceUrl: string | null };
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const value = (form: FormData, key: string) => {
  const entry = form.get(key);
  return typeof entry === "string" ? entry.trim() : "";
};

export function parsePursuitCommand(
  form: FormData,
): { data: PursuitCommand; error: null } | { data: null; error: string } {
  const invalid = (error: string) => ({ data: null, error });
  const command = value(form, "command");
  if (command !== "supply_contact" && command !== "close")
    return invalid("Choose a supported pursuit action.");
  const pursuitId = value(form, "pursuit_id");
  const expectedUpdatedAt = value(form, "expected_updated_at");
  if (
    !uuid.test(pursuitId) ||
    !timestamp.test(expectedUpdatedAt) ||
    !Number.isFinite(Date.parse(expectedUpdatedAt))
  ) {
    return invalid(
      "This pursuit could not be identified. Refresh the inbox and try again.",
    );
  }
  if (command === "close")
    return { data: { command, pursuitId, expectedUpdatedAt }, error: null };
  const email = value(form, "contact_email");
  const name = value(form, "contact_name");
  // One mailbox, never a list or a mail header. The worker uses this directly.
  if (
    email.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
      email,
    )
  ) {
    return invalid("Enter one valid broker email address.");
  }
  if (name.length > 200 || /[\r\n]/.test(name))
    return invalid("Use a broker name on one line, up to 200 characters.");
  if (value(form, "authorize_contact") !== "yes")
    return invalid(
      "Confirm that Scout may use this contact to prepare outreach.",
    );
  const source = value(form, "source_url");
  let sourceUrl: string | null = null;
  if (source) {
    try {
      const url = new URL(source);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        source.length > 2048
      )
        return invalid(
          "Use a public http or https page for the contact source.",
        );
      sourceUrl = url.href;
    } catch {
      return invalid("Enter a complete contact source URL, or leave it blank.");
    }
  }
  return {
    data: {
      command,
      pursuitId,
      expectedUpdatedAt,
      contact: { name: name || null, email, sourceUrl },
    },
    error: null,
  };
}

export function contactUpdate(
  contact: NonNullable<PursuitCommand["contact"]>,
  at: string,
) {
  return {
    contact_snapshot: {
      tier: "listing_agents",
      contacts: [
        {
          name: contact.name,
          email: contact.email,
          phone: null,
          profileUrl: null,
          role: "unspecified",
        },
      ],
      sourceUrl: contact.sourceUrl,
      // Additive JSON provenance; the existing worker reads the contact fields.
      providedBy: "user",
      providedAt: at,
    },
    needs_human_reason: null,
    needs_human_note: null,
    needs_human_at: null,
    updated_at: at,
  };
}

// Called by server actions with the request-scoped Supabase client. Claims and
// row ownership are checked here too so every execution path is authorized.
type Client = Pick<SupabaseClient, "auth" | "from">;
const failed = (error: string): CommandActionState => ({
  error,
  message: null,
});
const saved = (message: string): CommandActionState => ({
  error: null,
  message,
});
const stale =
  "This pursuit changed or is no longer available. Refresh the inbox before trying again.";
const uncertain =
  "Could not confirm this change. Refresh the inbox to check its current state before trying again.";

export async function executePursuitCommand(
  client: Client,
  form: FormData,
): Promise<CommandActionState> {
  try {
    const { data: auth, error: authError } = await client.auth.getClaims();
    const userId = auth?.claims?.sub;
    if (authError || typeof userId !== "string" || !userId)
      return failed("Sign in again before changing a pursuit.");
    const parsed = parsePursuitCommand(form);
    if (parsed.error !== null) return failed(parsed.error);
    const command = parsed.data;
    const { data: row, error: readError } = await client
      .from("pursuits")
      .select("id,stage,needs_human_reason,thread_id,enriched_at,updated_at")
      .eq("user_id", userId)
      .eq("id", command.pursuitId)
      .maybeSingle();
    if (readError || !row) return failed(stale);
    if (command.command === "close" && row.stage === "dead")
      return saved("This pursuit is already closed.");
    if (row.updated_at !== command.expectedUpdatedAt) return failed(stale);
    const at = new Date().toISOString();
    if (command.command === "supply_contact") {
      if (
        row.stage !== "matched" ||
        row.needs_human_reason !== "no_contact" ||
        row.thread_id !== null
      )
        return failed(
          "This pursuit is not waiting for an opening contact. Refresh to see its current action.",
        );
      if (!row.enriched_at)
        return failed(
          "Contact lookup has not finished. Refresh after Scout finishes before replacing its result.",
        );
      const { data: draft, error: draftError } = await client
        .from("pursuit_events")
        .select("id")
        .eq("user_id", userId)
        .eq("pursuit_id", command.pursuitId)
        .eq("type", "draft_composed")
        .limit(1)
        .maybeSingle();
      if (draftError)
        return failed(
          "Could not check the existing draft. Refresh before supplying a contact.",
        );
      if (draft)
        return failed(
          "An opening draft already exists. Updating its recipient or requesting a new draft is not supported yet.",
        );
      const { data: updated, error } = await client
        .from("pursuits")
        .update(contactUpdate(command.contact!, at))
        .eq("user_id", userId)
        .eq("id", command.pursuitId)
        .eq("updated_at", command.expectedUpdatedAt)
        .eq("stage", "matched")
        .eq("needs_human_reason", "no_contact")
        .is("thread_id", null)
        .not("enriched_at", "is", null)
        .select("id")
        .maybeSingle();
      if (error) return failed(uncertain);
      if (!updated) return failed(stale);
      return saved(
        "Contact saved for Scout’s next cycle. No message was sent by this action.",
      );
    }
    const { data: updated, error } = await client
      .from("pursuits")
      .update({ stage: "dead", next_follow_up_at: null, updated_at: at })
      .eq("user_id", userId)
      .eq("id", command.pursuitId)
      .eq("updated_at", command.expectedUpdatedAt)
      .neq("stage", "dead")
      .select("id")
      .maybeSingle();
    if (error) return failed(uncertain);
    if (!updated) return failed(stale);
    return saved(
      "Pursuit closed for future worker cycles. Work already in progress may finish.",
    );
  } catch {
    return failed(uncertain);
  }
}

export async function executeSearchPause(
  client: Client,
  form: FormData,
): Promise<CommandActionState> {
  try {
    const { data: auth, error: authError } = await client.auth.getClaims();
    const userId = auth?.claims?.sub;
    if (authError || typeof userId !== "string" || !userId)
      return failed("Sign in again before changing Scout’s pause state.");
    const intent = form.get("intent");
    const expectedPaused = form.get("expected_paused");
    if (
      (intent !== "pause" && intent !== "resume") ||
      !["true", "false"].includes(String(expectedPaused))
    )
      return failed("Choose pause or resume, then try again.");
    const { data: profile, error: readError } = await client
      .from("search_profiles")
      .select("paused_at,updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (readError)
      return failed(
        "Could not load your search profile. Refresh and try again.",
      );
    if (!profile)
      return failed(
        "Save your search preferences before pausing or resuming Scout.",
      );
    const paused = profile.paused_at !== null;
    const desired = intent === "pause";
    if (paused === desired)
      return saved(
        desired
          ? "Scout is already paused for future cycles."
          : "Scout is already enabled for future cycles.",
      );
    if (paused !== (expectedPaused === "true"))
      return failed(
        "Scout’s pause state changed. Refresh before trying again.",
      );
    const at = new Date().toISOString();
    const update = client
      .from("search_profiles")
      .update({ paused_at: desired ? at : null, updated_at: at })
      .eq("user_id", userId)
      .eq("updated_at", profile.updated_at);
    const { data: updated, error } = await (
      paused
        ? update.eq("paused_at", profile.paused_at)
        : update.is("paused_at", null)
    )
      .select("user_id")
      .maybeSingle();
    if (error) return failed(uncertain);
    if (!updated)
      return failed("Your search changed. Refresh before trying again.");
    return saved(
      desired
        ? "Scout paused for future cycles. Work already in progress may finish."
        : "Scout will resume on its next worker cycle.",
    );
  } catch {
    return failed(uncertain);
  }
}
