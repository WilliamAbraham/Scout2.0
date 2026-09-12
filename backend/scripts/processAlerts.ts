import path from 'node:path';
import process from 'node:process';

import {BrokerEnrichment} from '../src/enrichment/service.ts';
import {getGmailClient} from '../src/gmail/auth.ts';
import {LISTINGS_QUERY, loadMessages, readMessageIds, saveMessageIds, listMessageIds} from '../src/gmail/mailbox.ts';
import {parseMessage} from '../src/gmail/message.ts';
import {createOutreachPorts} from '../src/outreach/ports.ts';
import {processStreetEasyAlert} from '../src/pipeline/alert.ts';
import type {AlertPipelineDeps} from '../src/pipeline/alert.ts';
import {loadProcessedAlertIds, saveProcessedAlertIds} from '../src/pipeline/processed.ts';
import {DATA_DIR, REPO_ROOT} from '../src/paths.ts';

try {process.loadEnvFile(path.join(REPO_ROOT, '.env'));} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const openRouterKey = process.env.OPENROUTER_API_KEY;
if (!openRouterKey) {
  throw new Error('OPENROUTER_API_KEY is not set');
}

function defaultProfile() {
  return {
    budgetMax: null,
    bedrooms: null,
    availabilityNote: 'flexible',
    freeText: '',
    learnedAnswers: [],
  };
}

function createDeps(): AlertPipelineDeps {
  const enrichment = new BrokerEnrichment({
    cacheDir: path.join(DATA_DIR, 'enrichment', 'cache'),
    directOnly: process.argv.includes('--direct-only'),
    ...(process.env.TAVILY_API_KEY ? {tavilyKey: process.env.TAVILY_API_KEY} : {}),
    ...(process.env.FIRECRAWL_API_KEY ? {firecrawlKey: process.env.FIRECRAWL_API_KEY} : {}),
    log: message => console.error(message),
  });
  return {
    enrich: input => enrichment.run(input),
    ports: createOutreachPorts({
      openRouterApiKey: openRouterKey,
      model: process.env.OPENROUTER_MODEL,
      appUrl: process.env.OPENROUTER_APP_URL,
    }),
    profile: defaultProfile(),
    sendsToday: 0,
    sendCap: Number(process.env.DAILY_SEND_CAP ?? 10),
  };
}

async function main() {
  const gmail = await getGmailClient();
  const refresh = process.argv.includes('--refresh-ids');
  let ids = refresh ? null : await readMessageIds();
  if (!ids) {
    ids = await listMessageIds(gmail, LISTINGS_QUERY);
    await saveMessageIds(ids);
  }

  const processed = await loadProcessedAlertIds();
  const deps = createDeps();
  let sent = 0;
  let needsHuman = 0;
  let skipped = 0;

  const messages = await loadMessages(gmail, ids.filter(id => !processed.has(id)));
  for (const raw of messages) {
    const message = parseMessage(raw);
    const result = await processStreetEasyAlert(message, deps);
    processed.add(message.id);

    for (const listing of result.listings) {
      console.error(JSON.stringify({messageId: message.id, ...listing}));
      if (listing.status === 'outreach_sent') sent += 1;
      else if (listing.status === 'needs_human') needsHuman += 1;
      else skipped += 1;
    }
  }

  await saveProcessedAlertIds(processed);
  console.log(JSON.stringify({processed: messages.length, sent, needsHuman, skipped}));
}

await main();
