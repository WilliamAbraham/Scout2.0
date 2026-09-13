import path from 'node:path';

import {db} from '../db/index.ts';
import {BrokerEnrichment} from '../enrichment/service.ts';
import {parseAlert} from '../gmail/alert.ts';
import {getGmailClient} from '../gmail/auth.ts';
import {DATA_DIR} from '../paths.ts';
import type {RefreshReport} from './refresh.ts';
import {refreshStoredAlerts} from './refresh.ts';
import {PostgresStore} from './postgresStore.ts';

export async function runRefreshListings(
  userId: string,
  log: (message: string) => void,
): Promise<RefreshReport> {
  const store = new PostgresStore({
    db,
    gmail: getGmailClient,
    dryRun: true,
    log,
  });
  const enrichment = new BrokerEnrichment({
    cacheDir: path.join(DATA_DIR, 'enrichment', 'cache'),
    ...(process.env.TAVILY_API_KEY ? {tavilyKey: process.env.TAVILY_API_KEY} : {}),
    ...(process.env.FIRECRAWL_API_KEY ? {firecrawlKey: process.env.FIRECRAWL_API_KEY} : {}),
    log,
  });

  log(`user ${userId}`);
  return refreshStoredAlerts(userId, {
    store,
    listAlertMessageIds: () => store.listAlertMessageIds(userId),
    loadAlert: id => store.loadAlertMessage(id),
    parseListings: async message => {
      if (!message.htmlBody) return [];
      const parsed = await parseAlert(message.htmlBody, {subject: message.subject});
      if (parsed.layout === 'unsupported') {
        log(`${message.id}: unsupported alert template`);
      }
      return parsed.cards;
    },
    enrich: input => enrichment.run(input),
    log,
  });
}
