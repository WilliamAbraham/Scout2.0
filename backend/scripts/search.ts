import {hostname} from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {and, eq, isNotNull, isNull, sql} from 'drizzle-orm';

import {client, db} from '../src/db/index.ts';
import {pursuits} from '../src/db/schema/pursuits.ts';
import {BrokerEnrichment} from '../src/enrichment/service.ts';
import {EnrichmentBudget} from '../src/enrichment/spend.ts';
import {getGmailSendClient} from '../src/gmail/auth.ts';
import {assertLiveSendReady, createLiveSendMail} from '../src/outreach/delivery.ts';
import {createOutreachPorts} from '../src/outreach/ports.ts';
import {PostgresOutbox} from '../src/outreach/postgresOutbox.ts';
import {enrichForPipeline} from '../src/pipeline/agentEnrichment.ts';
import {PostgresStore} from '../src/pipeline/postgresStore.ts';
import {runPoolSearch} from '../src/pipeline/poolSearch.ts';
import {runTurn} from '../src/outreach/turn.ts';
import {DATA_DIR} from '../src/paths.ts';

/**
 * What the dashboard's Start search and Send buttons actually run.
 *
 *   npm run search -- --user <id>            # score the pool, enrich the matches
 *   npm run search -- --user <id> --send     # also send the opening emails
 *   npm run search -- --user <id> --limit 20 # stop after 20 pool rows
 *   npm run search -- --user <id> --budget-ms 30000  # stop starting after 30s
 *
 * The two halves are deliberately separate commands rather than one cycle:
 * the demo wants to watch matches appear and enrich, look at them, and only
 * then decide to send. `--send` is the only mode that touches the mailbox, and
 * every recipient is still redirected to the controlled address.
 *
 * Progress is written to stdout as one JSON object per line so the caller can
 * follow a long run; the final line is the report.
 */
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const userId = value('user') ?? process.env.SCOUT_OWNER_USER_ID;
if (!userId) throw new Error('Pass --user <id> or set SCOUT_OWNER_USER_ID');

const send = flag('send');
const limitArg = value('limit');
const limit = limitArg ? Number(limitArg) : undefined;
if (limit !== undefined && !Number.isFinite(limit)) throw new Error('--limit must be a number');
const budgetArg = value('budget-ms');
const budgetMs = budgetArg ? Number(budgetArg) : undefined;
if (budgetMs !== undefined && !Number.isFinite(budgetMs)) throw new Error('--budget-ms must be a number');

const emit = (event: Record<string, unknown>) => console.log(JSON.stringify({at: new Date().toISOString(), ...event}));
const log = (message: string) => console.error(`[search] ${message}`);

function requireEnv(name: string): string {
  const found = process.env[name];
  if (!found) throw new Error(`${name} is not set`);
  return found;
}

const openRouterApiKey = requireEnv('OPENROUTER_API_KEY');

const store = new PostgresStore({
  db,
  // Nothing in this command polls the mailbox, so OAuth is never reached.
  gmail: () => { throw new Error('search does not sync Gmail'); },
  dryRun: !send,
  catchUpDays: 0,
  maxMessagesPerSync: 0,
  ...(process.env.SCOUT_RENTER_NAME ? {renterName: process.env.SCOUT_RENTER_NAME} : {}),
  log,
});

await store.ensureOwner(userId);

const providerKeys = {
  ...(process.env.TAVILY_API_KEY ? {tavilyKey: process.env.TAVILY_API_KEY} : {}),
  ...(process.env.FIRECRAWL_API_KEY ? {firecrawlKey: process.env.FIRECRAWL_API_KEY} : {}),
};
const agentBudgetUsd = Number(process.env.SCOUT_ENRICHMENT_BUDGET_USD ?? 0);
const enrichment = new BrokerEnrichment({
  cacheDir: path.join(DATA_DIR, 'enrichment', 'cache'),
  ...providerKeys,
  log,
});
const agentOptions = {
  apiKey: openRouterApiKey,
  budget: new EnrichmentBudget(agentBudgetUsd),
  cacheDir: path.join(DATA_DIR, 'enrichment', 'agent-cache'),
  ...providerKeys,
  log,
};

try {
  if (!send) {
    emit({phase: 'search', state: 'started', userId});
    const report = await runPoolSearch(userId, {
      db,
      store,
      enrich: input => agentBudgetUsd > 0 ? enrichForPipeline(input, agentOptions) : enrichment.run(input),
      limit,
      budgetMs,
      log,
      onProgress: (done, total) => emit({phase: 'search', state: 'progress', done, total}),
    });
    emit({phase: 'search', state: 'done', ...report});
  } else {
    // Sending is a real, outward action, so the scope is stated up front and
    // the send path is refused outright unless the grant is already in place.
    await assertLiveSendReady();
    const outbox = new PostgresOutbox(db);
    const gmail = await getGmailSendClient();
    const ports = createOutreachPorts({
      openRouterApiKey,
      mode: 'live',
      ...(process.env.OPENROUTER_MODEL ? {model: process.env.OPENROUTER_MODEL} : {}),
      ...(process.env.OPENROUTER_APP_URL ? {appUrl: process.env.OPENROUTER_APP_URL} : {}),
      sendMail: createLiveSendMail({outbox, userId, gmail}),
    });

    // The same predicate the worker opens on: matched, unblocked, enriched
    // with a usable contact, and no thread yet.
    const ready = await db.select({id: pursuits.id}).from(pursuits).where(and(
      eq(pursuits.userId, userId),
      eq(pursuits.stage, 'matched'),
      isNull(pursuits.needsHumanReason),
      isNotNull(pursuits.contactSnapshot),
      isNull(pursuits.threadId),
    )).limit(limit ?? 1000);

    emit({phase: 'send', state: 'started', userId, ready: ready.length});
    let sent = 0;
    let skipped = 0;
    const at = new Date();
    for (const [index, row] of ready.entries()) {
      const input = await store.loadTurnInput(userId, row.id, 'open', null);
      if (!input) { skipped += 1; continue; }
      const sendsToday = await store.countSendsToday(userId, at);
      const result = await runTurn({...input, sendsToday, now: at}, ports);
      await store.persistTurn(userId, row.id, 'open', result);
      const didSend = result.actions.some(action => action.type === 'send');
      if (didSend) sent += 1; else skipped += 1;
      emit({phase: 'send', state: 'progress', done: index + 1, total: ready.length, sent, skipped});
    }
    emit({phase: 'send', state: 'done', ready: ready.length, sent, skipped});
  }
} finally {
  await client.end();
}
