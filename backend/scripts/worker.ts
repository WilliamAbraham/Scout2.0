import {hostname} from 'node:os';
import path from 'node:path';
import process from 'node:process';

import type {gmail_v1} from 'googleapis';

import {client, db} from '../src/db/index.ts';
import {EnrichmentBudget} from '../src/enrichment/spend.ts';
import {enrichForPipeline} from '../src/pipeline/agentEnrichment.ts';
import {getGmailClient, getGmailSendClient} from '../src/gmail/auth.ts';
import {assertLiveSendReady, createLiveSendMail} from '../src/outreach/delivery.ts';
import {createOutreachPorts} from '../src/outreach/ports.ts';
import {PostgresOutbox} from '../src/outreach/postgresOutbox.ts';
import {runWorkerCycle} from '../src/outreach/worker.ts';
import {processStreetEasyAlert} from '../src/pipeline/alert.ts';
import type {AlertPipelineDeps} from '../src/pipeline/alert.ts';
import {PostgresStore} from '../src/pipeline/postgresStore.ts';
import {DATA_DIR} from '../src/paths.ts';

/**
 * The continuous worker, and the only entry point that touches the mailbox.
 *
 *   npm run worker                   # poll forever (WORKER_POLL_MS, default 5m)
 *   npm run worker -- --once         # one cycle, then exit
 *   npm run worker -- --status       # print backlog and last-run status, exit
 *   npm run worker -- --once --live  # real Gmail sends, redirected to the controlled test recipient
 *
 * One cycle: poll Gmail from the stored checkpoint, route each message to the
 * alert parser or a pursuit reply, persist every listing, match, enrich,
 * then open and follow up on pursuits. Only one process acts on a mailbox at
 * a time: the cycle holds a lease in `worker_leases` and renews it as it goes.
 *
 * Env: DATABASE_URL, OPENROUTER_API_KEY, SCOUT_OWNER_USER_ID (the one user
 * this mailbox belongs to), optional TAVILY_API_KEY / FIRECRAWL_API_KEY,
 * SCOUT_CATCH_UP_DAYS (first-run window, default 2), SCOUT_MESSAGES_PER_CYCLE
 * (default 25), SCOUT_MAILBOX_QUERY (extra Gmail terms for a catch-up),
 * OPENROUTER_MODEL (outreach only), WORKER_POLL_MS, WORKER_LEASE_MS,
 * SCOUT_ENRICHMENT_BUDGET_USD (shared per process; default 0).
 *
 * Dry-run is the default: drafts are composed and recorded as `draft_composed`
 * events, with zero Gmail send calls. `--live` requires gmail.send re-consent
 * and redirects every test send to williamja100@gmail.com.
 */
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 300_000);
const LEASE_MS = Number(process.env.WORKER_LEASE_MS ?? 600_000);
const once = process.argv.includes('--once');
const status = process.argv.includes('--status');
const live = process.argv.includes('--live');
const log = (message: string) => console.error(`[worker] ${message}`);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const store = new PostgresStore({
  db,
  gmail: getGmailClient,
  dryRun: !live,
  catchUpDays: Number(process.env.SCOUT_CATCH_UP_DAYS ?? 2),
  maxMessagesPerSync: Number(process.env.SCOUT_MESSAGES_PER_CYCLE ?? 25),
  ...(process.env.SCOUT_MAILBOX_QUERY ? {extraQuery: process.env.SCOUT_MAILBOX_QUERY} : {}),
  log,
});

if (status) {
  console.log(JSON.stringify(await store.statusReport(), null, 2));
  await client.end();
  process.exit(0);
}

const openRouterApiKey = requireEnv('OPENROUTER_API_KEY');

if (live) {
  await assertLiveSendReady();
}

const outbox = new PostgresOutbox(db);
let sendClient: Promise<gmail_v1.Gmail> | null = null;

const enrichmentOptions = {
  apiKey: openRouterApiKey,
  budget: new EnrichmentBudget(Number(process.env.SCOUT_ENRICHMENT_BUDGET_USD ?? 0)),
  cacheDir: path.join(DATA_DIR, 'enrichment', 'agent-cache'),
  ...(process.env.TAVILY_API_KEY ? {tavilyKey: process.env.TAVILY_API_KEY} : {}),
  ...(process.env.FIRECRAWL_API_KEY ? {firecrawlKey: process.env.FIRECRAWL_API_KEY} : {}),
  log,
};

const alertDeps: AlertPipelineDeps = {
  store,
  enrich: input => enrichForPipeline(input, enrichmentOptions),
};

// Identifies this process in the lease and the run log.
const HOLDER = `${hostname()}:${process.pid}`;
const LEASE = 'mailbox:default';

let stopping = false;
const shouldStop = () => stopping;

/**
 * One cycle, under a mailbox lease. Declines rather than racing another
 * worker, and renews the lease between messages so a slow cycle (enrichment
 * is minutes, not seconds) does not have it stolen mid-flight.
 */
async function tick(): Promise<void> {
  const owner = process.env.SCOUT_OWNER_USER_ID;
  if (owner) {
    await store.ensureOwner(owner);
  }

  // One local `token.json` means one mailbox. Reading it on behalf of a second
  // user would hand one person's mail to another, so refuse instead.
  const active = await store.listActiveUsers();
  if (active.length > 1) {
    throw new Error(
      `${active.length} users have search profiles but this worker has a single local Gmail token. ` +
      'Per-user OAuth is not built yet; run one mailbox per worker until it is.',
    );
  }

  if (!await store.acquireLease(LEASE, HOLDER, LEASE_MS)) {
    log('another worker holds the mailbox lease; skipping this cycle');
    return;
  }

  const runId = await store.startRun(HOLDER);
  try {
    const report = await runWorkerCycle(store, {
      shouldStop,
      heartbeat: async () => {
        if (!await store.renewLease(LEASE, HOLDER, LEASE_MS)) {
          stopping = true;
          log('lost the mailbox lease mid-cycle; stopping at the next safe point');
        }
      },
      createPorts: userId => createOutreachPorts({
        openRouterApiKey,
        mode: live ? 'live' : 'dry-run',
        ...(process.env.OPENROUTER_MODEL ? {model: process.env.OPENROUTER_MODEL} : {}),
        ...(process.env.OPENROUTER_APP_URL ? {appUrl: process.env.OPENROUTER_APP_URL} : {}),
        ...(live ? {
          sendMail: async message => createLiveSendMail({
            outbox,
            userId,
            gmail: await (sendClient ??= getGmailSendClient()),
          })(message),
        } : {}),
      }),
      processAlert: async (userId, message) => {
        const result = await processStreetEasyAlert(userId, {
          id: message.id,
          from: message.from,
          date: message.date,
          subject: message.subject,
          htmlBody: message.htmlBody,
        }, alertDeps);
        for (const listing of result.listings) {
          log(JSON.stringify({messageId: message.id, ...listing}));
        }
        return result;
      },
    });
    await store.finishRun(runId, report, null);
    console.log(JSON.stringify({at: new Date().toISOString(), mode: live ? 'live' : 'dry-run', ...report}));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.finishRun(runId, {}, message);
    throw error;
  } finally {
    await store.releaseLease(LEASE, HOLDER);
  }
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;

/** Never overlap: a cycle still running when the timer fires is left alone. */
async function scheduledTick(): Promise<void> {
  if (running) {
    log('previous cycle is still running; skipping this tick');
    return;
  }
  running = tick().finally(() => {
    running = null;
  });
  await running;
}

/** Finish the message in flight, release the lease, then exit. */
async function shutdown(signal: string): Promise<void> {
  log(`${signal} received; finishing the current cycle`);
  stopping = true;
  if (timer) clearInterval(timer);
  try {
    if (running) await running;
  } catch (error) {
    console.error(error);
  }
  await store.releaseLease(LEASE, HOLDER).catch(() => {});
  await client.end();
  process.exit(0);
}

if (!once) {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      shutdown(signal).catch(error => {
        console.error(error);
        process.exit(1);
      });
    });
  }
}

try {
  await scheduledTick();
  if (!once) {
    log(`polling every ${POLL_MS}ms as ${HOLDER}`);
    timer = setInterval(() => {
      scheduledTick().catch(error => {
        // A failed cycle is logged and retried on the next tick rather than
        // killing a long-running process.
        console.error(error);
        process.exitCode = 1;
      });
    }, POLL_MS);
  }
} finally {
  if (once) {
    await client.end();
  }
}
