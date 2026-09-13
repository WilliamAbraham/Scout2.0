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
const SEARCH_BUDGET_MS = 30_000;
/**
 * Hard stop, for a child hung on a provider that never answers.
 *
 * This has to clear the budget by more than one listing's worst case, not by a
 * little: the budget only stops the pass from *starting* more work, and a
 * single live enrichment can run for a minute on its own. Too tight a margin
 * kills a healthy run mid-listing and reports a timeout for work that
 * actually succeeded.
 */
const KILL_AFTER_MS = 180_000;
/** Opening emails one press will send. */
const SEND_LIMIT = 10;

type Report = Record<string, unknown>;

/**
 * The one line worth showing from a crashed run.
 *
 * The tail of stderr is the Node version banner and npm's own lifecycle
 * noise, so reporting the last line tells the owner "Node.js v24.19.0". The
 * thrown message is what actually explains the failure.
 */
function failureReason(stderr: string, code: number | null): string {
  const lines = stderr.split("\n").map((line) => line.trim()).filter(Boolean);
  const thrown = lines.find((line) => /^(?:[A-Za-z]*Error|Uncaught)\b/.test(line));
  if (thrown) return thrown;
  const logged = lines.filter((line) => line.startsWith("[search] ")).at(-1);
  if (logged) return logged.slice("[search] ".length);
  return `the command exited with code ${code}`;
}

/**
 * Run the backend command and return the JSON lines it emitted. stdout is one
 * object per line; stderr is the running log, kept only for the error message.
 */
function runSearchCommand(args: string[]): Promise<
  { ok: true; events: Report[] } | { ok: false; detail: string; events: Report[] }
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
      // The process never started, so nothing ran and there is no progress.
      resolve({ ok: false, detail: error.message, events: [] });
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
        resolve({ ok: false, detail: "it ran past its time limit and was stopped", events });
        return;
      }
      if (code !== 0) {
        resolve({ ok: false, detail: failureReason(err, code), events });
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
    // Each listing is persisted as it finishes, so an interrupted run still
    // did real work. Saying only "it failed" would send the owner looking for
    // results that are already in their inbox.
    const progress = result.events
      .filter((event) => event.phase === "search" && event.state === "progress")
      .at(-1);
    revalidatePath("/dashboard");
    const done = progress ? count(progress, "done") : 0;
    return {
      error: done > 0
        ? `Your search stopped early — ${result.detail} — but the ${plural(done, "listing")} it finished are saved. Press Start search again to continue.`
        : `Your search could not run: ${result.detail}.`,
      message: null,
    };
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
  const retried = count(done, "retried");
  if (considered === 0 && retried === 0) {
    return {
      error: null,
      message: "Every listing is already checked and every match already has a contact or is waiting on you.",
    };
  }

  const parts: string[] = [];
  if (considered > 0) {
    parts.push(`Checked ${plural(considered, "new listing")}: ${count(done, "matched")} matched`);
  }
  if (retried > 0) {
    const unblocked = count(done, "unblocked");
    parts.push(
      `retried ${plural(retried, "match")} that had no contact` +
      (unblocked > 0 ? `, ${unblocked} now reachable` : ""),
    );
  }
  const ready = count(done, "ready");
  if (ready > 0) parts.push(`${ready} ready to contact`);
  const needsHuman = count(done, "needsHuman");
  if (needsHuman > 0) {
    parts.push(`${needsHuman} still ${needsHuman === 1 ? "needs" : "need"} a contact from you`);
  }
  const fromCache = count(done, "fromCache");
  if (fromCache > 0) parts.push(`${fromCache} reused earlier research`);
  const remaining = count(done, "remaining");
  if (remaining > 0) parts.push(`${remaining} still queued — press again to continue`);
  const summary = parts.join(", ");
  // The first clause is conditional, so the sentence may begin at any of them.
  return { error: null, message: `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.` };
}

/**
 * Why the turns that sent nothing declined.
 *
 * The agent refuses for reasons the owner can act on — the daily cap is one
 * press tomorrow, a pursuit that is not ready is something else entirely — so
 * reporting only the count would leave them guessing at which.
 */
function skippedExplanation(done: Report, skipped: number): string {
  const reasons = done.reasons;
  const counts =
    reasons && typeof reasons === "object" && !Array.isArray(reasons)
      ? (reasons as Record<string, unknown>)
      : {};
  const capped = count(counts as Report, "send_cap");
  if (capped >= skipped) {
    return `today's sending limit is reached. The rest go out on the next press after it resets.`;
  }
  if (capped > 0) {
    return `${capped} hit today's sending limit and ${skipped - capped} were not ready.`;
  }
  return `${plural(skipped, "pursuit")} ${skipped === 1 ? "was" : "were"} not ready.`;
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
    const progress = result.events
      .filter((event) => event.phase === "send" && event.state === "progress")
      .at(-1);
    revalidatePath("/dashboard");
    const sent = progress ? count(progress, "sent") : 0;
    return {
      error: sent > 0
        ? `Sending stopped early — ${result.detail} — after ${plural(sent, "email")} had already gone out. Refresh before pressing Send again.`
        : `Sending could not run: ${result.detail}.`,
      message: null,
    };
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
        ? `Nothing was sent: ${skippedExplanation(done, skipped)}`
        : "There is nothing ready to send yet.",
    };
  }
  return {
    error: null,
    message:
      `Sent ${plural(sent, "email")}` +
      (skipped > 0 ? `, skipped ${skipped} — ${skippedExplanation(done, skipped)}` : ".") +
      " Check your Gmail Sent folder.",
  };
}
