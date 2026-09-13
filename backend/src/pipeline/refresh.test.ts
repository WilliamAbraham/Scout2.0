import assert from 'node:assert/strict';
import test from 'node:test';

import type {Listing as GmailListing} from '../gmail/listings.ts';
import type {EmailListing, EnrichmentResult} from '../enrichment/service.ts';
import {gmailListingToEmailInput} from './listingInput.ts';
import {refreshStoredAlerts} from './refresh.ts';
import type {AlertMessage, AlertStore, IngestOutcome} from './alert.ts';

const newListing: GmailListing = {
  address: '118 Mulberry Street #R4',
  price: 7495,
  bedrooms: 3,
  bathrooms: 1,
  listingUrl: 'https://streeteasy.com/rental/123',
  rentalId: '123',
  brokerage: 'DALLAL',
};

const knownListing: GmailListing = {
  address: '90 Morton Street #4',
  price: 4200,
  bedrooms: 1,
  bathrooms: 1,
  listingUrl: 'https://streeteasy.com/rental/90',
  rentalId: '90',
  brokerage: 'Compass',
};

const enrichmentReady = (listing: GmailListing): EnrichmentResult => ({
  status: 'source_matched',
  execution: 'completed',
  input: gmailListingToEmailInput(listing),
  brokerageUrl: 'https://broker.example',
  listingUrl: listing.listingUrl,
  agents: [{
    name: 'Ava Agent',
    profileUrl: null,
    email: 'ava@broker.example',
    phone: null,
    role: 'primary',
    attributionEvidence: 'Listing agent',
    contactEvidence: 'ava@broker.example',
    sourceUrl: listing.listingUrl,
    attributionSourceUrl: listing.listingUrl,
    emailSourceUrl: listing.listingUrl,
    phoneSourceUrl: null,
  }],
  candidateAgents: [],
  sourceListing: null,
  rosterCompleteness: 'source_only',
  outreachReady: true,
  checkedAt: new Date().toISOString(),
  issues: [],
  warnings: [],
  attempts: [],
  contactRoutes: [],
  resolution: 'agents_verified',
});

function message(id: string): AlertMessage {
  return {
    id,
    from: 'StreetEasy <noreply@email.streeteasy.com>',
    date: '2026-09-12T12:00:00Z',
    subject: 'New listings',
    htmlBody: '<div class="ListingCard"></div>',
  };
}

test('refreshStoredAlerts enriches only newly ingested matches from stored message ids', async () => {
  const ingested: string[] = [];
  const started: string[] = [];
  const enriched: string[] = [];
  const logs: string[] = [];
  const outcomes: Record<string, IngestOutcome> = {
    '123': {
      listingId: 'l-123', userListingId: 'ul-123', isMatch: true, isNew: true,
      pursuitId: 'p-123', needsEnrichment: true,
    },
    '90': {
      listingId: 'l-90', userListingId: 'ul-90', isMatch: true, isNew: false,
      pursuitId: 'p-90', needsEnrichment: true,
    },
  };

  const store: AlertStore = {
    async ingestListing(_userId, _source, listing) {
      ingested.push(listing.rentalId);
      return outcomes[listing.rentalId] ?? {
        listingId: listing.rentalId, userListingId: `ul-${listing.rentalId}`,
        isMatch: false, isNew: false, pursuitId: null, needsEnrichment: false,
      };
    },
    async noteEnrichmentStarted(_userId, pursuitId) {
      started.push(pursuitId);
    },
    async saveEnrichment() {},
    async noteEnrichmentDeferred() {},
  };

  const report = await refreshStoredAlerts('user-1', {
    store,
    listAlertMessageIds: async () => ['msg-1'],
    loadAlert: async () => message('msg-1'),
    parseListings: async () => [newListing, knownListing],
    enrich: async (input: EmailListing) => {
      enriched.push(input.listingUrl ?? input.address);
      return enrichmentReady(input.listingUrl?.includes('/90') ? knownListing : newListing);
    },
    log: (line) => logs.push(line),
  });

  assert.deepEqual(ingested, ['123', '90']);
  assert.deepEqual(enriched, ['https://streeteasy.com/rental/123']);
  assert.deepEqual(started, ['p-123']);
  assert.equal(report.messages, 1);
  assert.equal(report.newMatches, 1);
  assert.equal(report.enriched, 1);
  assert.equal(report.skippedExisting, 1);
  assert.ok(logs.some(line => /enriching 118 Mulberry Street #R4/i.test(line)));
});

test('refreshStoredAlerts does not call Gmail when a stored id is already loaded', async () => {
  let loads = 0;
  const report = await refreshStoredAlerts('user-1', {
    store: {
      async ingestListing() {
        return {
          listingId: 'l', userListingId: 'ul', isMatch: false, isNew: false,
          pursuitId: null, needsEnrichment: false,
        };
      },
      async noteEnrichmentStarted() {},
      async saveEnrichment() {},
      async noteEnrichmentDeferred() {},
    },
    listAlertMessageIds: async () => ['cached-1'],
    loadAlert: async (id) => {
      loads += 1;
      return message(id);
    },
    parseListings: async () => [],
    enrich: async () => {
      throw new Error('should not enrich an empty alert');
    },
  });

  assert.equal(loads, 1);
  assert.equal(report.messages, 1);
  assert.equal(report.enriched, 0);
});
