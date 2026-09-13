import type {EmailListing, EnrichmentResult} from '../enrichment/service.ts';
import type {Listing as GmailListing} from '../gmail/listings.ts';
import {processListingAlert} from './alert.ts';
import type {AlertMessage, AlertStore} from './alert.ts';

export type RefreshDeps = {
  store: AlertStore;
  listAlertMessageIds(userId: string): Promise<string[]>;
  loadAlert(messageId: string): Promise<AlertMessage | null>;
  parseListings(message: AlertMessage): Promise<GmailListing[]>;
  enrich(input: EmailListing): Promise<EnrichmentResult>;
  log?: (message: string) => void;
};

export type RefreshReport = {
  messages: number;
  newMatches: number;
  enriched: number;
  skippedExisting: number;
};

/** Re-parse stored StreetEasy alerts and enrich only newly ingested matches. */
export async function refreshStoredAlerts(
  userId: string,
  deps: RefreshDeps,
): Promise<RefreshReport> {
  const log = deps.log ?? (() => {});
  const report: RefreshReport = {
    messages: 0,
    newMatches: 0,
    enriched: 0,
    skippedExisting: 0,
  };
  const ids = await deps.listAlertMessageIds(userId);
  log(`stored alert messages: ${ids.length}`);

  for (const id of ids) {
    const message = await deps.loadAlert(id);
    if (!message) {
      log(`missing cache for ${id}`);
      continue;
    }
    report.messages += 1;
    const listings = await deps.parseListings(message);
    log(`${id}: ${listings.length} card${listings.length === 1 ? '' : 's'}`);
    const receivedAt = new Date(message.date);
    const source = {
      messageId: message.id,
      receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
    };

    for (const listing of listings) {
      const outcome = await processListingAlert(userId, source, listing, {
        store: deps.store,
        enrich: async input => {
          log(`enriching ${listing.address} (${listing.rentalId})`);
          return deps.enrich(input);
        },
      }, {enrichWhen: 'new'});

      if (outcome.status === 'skipped' && outcome.reason === 'not_new') {
        report.skippedExisting += 1;
        continue;
      }
      if (outcome.status === 'skipped') continue;
      report.newMatches += 1;
      if (
        outcome.status === 'ready' ||
        outcome.status === 'needs_human' ||
        outcome.status === 'deferred'
      ) {
        report.enriched += 1;
        log(`${listing.address} ${outcome.status}`);
      } else if (outcome.status === 'error') {
        log(`${listing.address} error: ${outcome.reason}`);
      }
    }
  }

  log(
    `done: parsed=${report.messages} new=${report.newMatches} enriched=${report.enriched} skipped=${report.skippedExisting}`,
  );
  return report;
}
