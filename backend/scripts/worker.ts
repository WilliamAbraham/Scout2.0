import path from 'node:path';
import process from 'node:process';

import {client, db} from '../src/db/index.ts';
import {BrokerEnrichment} from '../src/enrichment/service.ts';
import {getGmailClient, getGmailSendClient} from '../src/gmail/auth.ts';
import type {gmail_v1} from 'googleapis';
import {assertLiveSendReady, createLiveSendMail} from '../src/outreach/delivery.ts';
import {createOutreachPorts} from '../src/outreach/ports.ts';
import {PostgresOutbox} from '../src/outreach/postgresOutbox.ts';
import {runWorkerCycle} from '../src/outreach/worker.ts';
import {processStreetEasyAlert} from '../src/pipeline/alert.ts';
import type {AlertPipelineDeps} from '../src/pipeline/alert.ts';
import {PostgresStore} from '../src/pipeline/postgresStore.ts';
import {DATA_DIR} from '../src/paths.ts';

/**
 * The polling worker: one cycle syncs StreetEasy alerts from Gmail, persists
 * listings and pursuits, enriches broker contacts, then opens/follows up on
 * pursuits through the outreach turn loop.
 *
 *   npm run worker -- --once            # one cycle, then exit
 *   npm run worker                      # poll every WORKER_POLL_MS (default 5 min)
 *   npm run worker -- --once --live     # real Gmail sends, redirected to the controlled test recipient
 *
 * Env: DATABASE_URL, OPENROUTER_API_KEY, SCOUT_OWNER_USER_ID (bootstraps the
 * demo owner's profile), optional TAVILY_API_KEY / FIRECRAWL_API_KEY,
 * SCOUT_ALERT_NEWER_THAN (Gmail relative age, default 2d), SCOUT_ALERTS_PER_CYCLE
 * (default 5), OPENROUTER_MODEL, WORKER_POLL_MS.
 *
 * Dry-run is the default: drafts are composed and recorded as `draft_composed`
 * events, with zero Gmail send calls. `--live` requires gmail.send re-consent
 * and redirects every test send to williamja100@gmail.com.
 */
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 300_000);
const once = process.argv.includes('--once');
const live = process.argv.includes('--live');
const log = (message: string) => console.error(`[worker] ${message}`);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const openRouterApiKey = requireEnv('OPENROUTER_API_KEY');

if (live) {
  await assertLiveSendReady();
}

const outbox = new PostgresOutbox(db);
let sendClient: Promise<gmail_v1.Gmail> | null = null;

const store = new PostgresStore({
  db,
  gmail: getGmailClient,
  dryRun: !live,
  alertQuery: `newer_than:${process.env.SCOUT_ALERT_NEWER_THAN ?? '2d'}`,
  maxAlertsPerSync: Number(process.env.SCOUT_ALERTS_PER_CYCLE ?? 5),
  log,
});

const enrichment = new BrokerEnrichment({
  cacheDir: path.join(DATA_DIR, 'enrichment', 'cache'),
  ...(process.env.TAVILY_API_KEY ? {tavilyKey: process.env.TAVILY_API_KEY} : {}),
  ...(process.env.FIRECRAWL_API_KEY ? {firecrawlKey: process.env.FIRECRAWL_API_KEY} : {}),
  log,
});

const alertDeps: AlertPipelineDeps = {
  store,
  enrich: input => enrichment.run(input),
};

async function tick() {
  const owner = process.env.SCOUT_OWNER_USER_ID;
  if (owner) {
    await store.ensureOwner(owner);
  }

  const report = await runWorkerCycle(store, {
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
        htmlBody: message.body || null,
      }, alertDeps);
      for (const listing of result.listings) {
        log(JSON.stringify({messageId: message.id, ...listing}));
      }
      return result;
    },
  });
  console.log(JSON.stringify({at: new Date().toISOString(), dryRun: !live, ...report}));
}

try {
  await tick();
  if (!once) {
    setInterval(() => {
      tick().catch(error => {
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
