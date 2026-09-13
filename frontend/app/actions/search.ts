"use server";

import { spawn } from "node:child_process";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CommandActionState } from "@/lib/inbox-command";

/**
 * Start search and Send, the two commands that run the agent on demand.
 *
 * Both shell out to `backend/scripts/search.ts` rather than reimplementing the
 * pipeline here: the mailbox token, the enrichment providers and the Postgres
 * owner connection all live in the backend workspace, and none of them belong
 * in a request handler that the browser can reach. The owner id is taken from
 * the verified session and passed as an argument — never from the form — so a
 * signed-in user can only ever run the agent against their own search.
 *
 * Each run is bounded (`--limit`, `--budget-ms`) so the request finishes in
 * seconds instead of holding a connection open for a full pass over the pool.
 * Whatever is left stays queued for the next press.
 */

const REPO_ROOT = path.resolve(process.cwd(), "..");
/** Pool rows one press will score. The rest wait for the next press. */
const SEARCH_LIMIT = 40;
/** Stop starting new listings after this long. Live enrichment is slow. */
const SEARCH_BUDGET_MS = 45_000;
/** Hard stop, in case the child hangs on a provider that never answers. */
const KILL_AFTER_MS = 90_000;
/** Opening emails one press will send. */
const SEND_LIMIT = 10;

type Report = Record<string, unknown>;

/**
 * Run the backend command and return the JSON lines it emitted. stdout is one
 * object per line; stderr is the running log, kept only for the error message.
 */
function runSearchCommand(args: string[]): Promise<
  { ok: true; events: Report[] } | { ok: false; detail: string }
> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "--silent", "search", "-w", "backend", "--", ...args], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, KILL_AFTER_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
      // The log is only ever used to explain a failure; cap it so a chatty
      // provider cannot grow this buffer without bound.
      if (err.length > 20_000) err = err.slice(-20_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const events = out
        .split("\n")
        .flatMap((line) => {
          if (!line.trim()) return [];
          try {
            return [JSON.parse(line) as Report];
          } catch {
            return [];
          }
        });
      if (killed) {
        resolve({ ok: false, detail: "The run took too long and was stopped." });
        return;
      }
      if (code !== 0) {
        const lastLine = err.trim().split("\n").at(-1) ?? `exit code ${code}`;
        resolve({ ok: false, detail: lastLine });
        return;
      }
      resolve({ ok: true, events });
    });
  });
}

async function ownerId(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") {
    return { error: "Sign in again to run your search." };
  }
  return { userId };
}

const count = (report: Report, key: string): number => {
  const value = report[key];
  return typeof value === "number" ? value : 0;
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export async function startSearch(): Promise<CommandActionState> {
  const owner = await ownerId();
  if ("error" in owner) return { error: owner.error, message: null };

  const result = await runSearchCommand([
    "--user", owner.userId,
    "--limit", String(SEARCH_LIMIT),
    "--budget-ms", String(SEARCH_BUDGET_MS),
  ]);
  if (!result.ok) {
    return { error: `Your search could not run: ${result.detail}`, message: null };
  }

  const done = result.events.find(
    (event) => event.phase === "search" && event.state === "done",
  );
  if (!done) {
    return {
      error: "The search finished without reporting a result. Refresh to see what landed.",
      message: null,
    };
  }

  revalidatePath("/dashboard");

  const considered = count(done, "considered");
  if (considered === 0) {
    return { error: null, message: "Every listing has already been checked against your preferences." };
  }
  const parts = [
    `Checked ${plural(considered, "listing")}: ${count(done, "matched")} matched`,
  ];
  const ready = count(done, "ready");
  if (ready > 0) parts.push(`${ready} ready to contact`);
  const needsHuman = count(done, "needsHuman");
  if (needsHuman > 0) parts.push(`${plural(needsHuman, "needs")} a contact from you`);
  const fromCache = count(done, "fromCache");
  if (fromCache > 0) parts.push(`${fromCache} reused earlier research`);
  const remaining = count(done, "remaining");
  if (remaining > 0) parts.push(`${remaining} still queued — press again to continue`);
  return { error: null, message: `${parts.join(", ")}.` };
}

export async function sendOutreach(): Promise<CommandActionState> {
  const owner = await ownerId();
  if ("error" in owner) return { error: owner.error, message: null };

  const result = await runSearchCommand([
    "--user", owner.userId,
    "--send",
    "--limit", String(SEND_LIMIT),
  ]);
  if (!result.ok) {
    return { error: `Sending could not run: ${result.detail}`, message: null };
  }

  const done = result.events.find(
    (event) => event.phase === "send" && event.state === "done",
  );
  if (!done) {
    return {
      error: "Sending finished without reporting a result. Refresh before trying again, so nothing is sent twice.",
      message: null,
    };
  }

  revalidatePath("/dashboard");

  const sent = count(done, "sent");
  const skipped = count(done, "skipped");
  if (sent === 0) {
    return {
      error: null,
      message: skipped > 0
        ? `Nothing was sent: ${plural(skipped, "pursuit")} was not ready.`
        : "There is nothing ready to send yet.",
    };
  }
  return {
    error: null,
    message: `Sent ${plural(sent, "email")}${skipped > 0 ? `, skipped ${skipped}` : ""}. Check your Gmail Sent folder.`,
  };
}
