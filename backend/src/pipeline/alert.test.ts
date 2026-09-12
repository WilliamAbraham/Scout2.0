import assert from 'node:assert/strict';
import test from 'node:test';

import type {Listing as GmailListing} from '../gmail/listings.ts';
import type {EmailListing, EnrichmentResult} from '../enrichment/service.ts';
import {gmailListingToEmailInput} from './listingInput.ts';
import {splitBrokerage, isStreetEasyAlert} from './brokerage.ts';
import {contactSnapshotFromEnrichment, agentsForOutreach} from './contacts.ts';
import {processListingAlert, processStreetEasyAlert} from './alert.ts';
import type {AlertPipelineDeps, AlertStore, IngestOutcome} from './alert.ts';

const listing: GmailListing = {
  address: '118 Mulberry Street #R4',
  price: 7495,
  bedrooms: 3,
  bathrooms: 1,
  listingUrl: 'https://streeteasy.com/rental/123',
  rentalId: '123',
  brokerage: 'DALLAL (260 Madison Avenue, New York, NY 10016)',
};

const enrichmentReady = (overrides: Partial<EnrichmentResult> = {}): EnrichmentResult => ({
  status: 'source_matched',
  execution: 'completed',
  input: gmailListingToEmailInput(listing),
  brokerageUrl: 'https://broker.example',
  listingUrl: 'https://broker.example/listing',
  agents: [{
    name: 'Ava Agent',
    profileUrl: null,
    email: 'ava@broker.example',
    phone: null,
    role: 'primary',
    attributionEvidence: 'Listing agent',
    contactEvidence: 'ava@broker.example',
    sourceUrl: 'https://broker.example/listing',
    attributionSourceUrl: 'https://broker.example/listing',
    emailSourceUrl: 'https://broker.example/listing',
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
  ...overrides,
});

type Recorded = {ingested: string[]; saved: Array<{pursuitId: string; hasSnapshot: boolean; summary: Record<string, unknown>}>};

function fakeStore(ingest: Partial<IngestOutcome> = {}): AlertStore & Recorded {
  const recorded: Recorded = {ingested: [], saved: []};
  return {
    ...recorded,
    async ingestListing(_userId, _source, listing) {
      recorded.ingested.push(listing.rentalId);
      return {
        listingId: 'listing-1', userListingId: 'ul-1', isMatch: true, isNew: true,
        pursuitId: 'pursuit-1', needsEnrichment: true, ...ingest,
      };
    },
    async saveEnrichment(_userId, pursuitId, snapshot, summary) {
      recorded.saved.push({pursuitId, hasSnapshot: snapshot !== null, summary});
    },
    get ingested() { return recorded.ingested; },
    get saved() { return recorded.saved; },
  };
}

const source = {messageId: 'msg-1', receivedAt: new Date('2026-09-12T12:00:00Z')};

function deps(overrides: Partial<AlertPipelineDeps> = {}): AlertPipelineDeps & {store: AlertStore & Recorded} {
  const store = fakeStore();
  return {
    store,
    enrich: async (_input: EmailListing) => enrichmentReady(),
    ...overrides,
  } as AlertPipelineDeps & {store: AlertStore & Recorded};
}

test('splitBrokerage separates office address in parentheses', () => {
  assert.deepEqual(splitBrokerage('REAL New York (29 West 30th Street, New York, NY)'), {
    brokerageName: 'REAL New York',
    officeAddress: '29 West 30th Street, New York, NY',
  });
});

test('isStreetEasyAlert matches the alert sender', () => {
  assert.equal(isStreetEasyAlert('StreetEasy <noreply@email.streeteasy.com>'), true);
  assert.equal(isStreetEasyAlert('broker@example.com'), false);
});

test('gmail listing converts to enrichment input with split brokerage', () => {
  const input = gmailListingToEmailInput(listing);
  assert.equal(input.listingUrl, listing.listingUrl);
  assert.equal(input.brokerage, 'DALLAL');
  assert.equal(input.unit, 'R4');
  assert.equal(input.brokerageOfficeAddress, '260 Madison Avenue, New York, NY 10016');
});

test('enrichment contacts map to outreach agents', () => {
  const snapshot = contactSnapshotFromEnrichment(enrichmentReady());
  assert.ok(snapshot);
  assert.deepEqual(agentsForOutreach(snapshot!), [{name: 'Ava Agent', email: 'ava@broker.example', role: 'primary'}]);
});

test('processListingAlert persists the listing, enriches, and saves the contact snapshot', async () => {
  const pipeline = deps();
  const outcome = await processListingAlert('user-1', source, listing, pipeline);

  assert.equal(outcome.status, 'ready');
  assert.deepEqual(pipeline.store.ingested, ['123']);
  assert.equal(pipeline.store.saved.length, 1);
  assert.equal(pipeline.store.saved[0]?.hasSnapshot, true);
  assert.equal(pipeline.store.saved[0]?.summary.resolution, 'agents_verified');
});

test('processListingAlert escalates no_contact when enrichment has no email', async () => {
  const pipeline = deps({
    enrich: async () => enrichmentReady({agents: [], outreachReady: false, resolution: 'unresolved'}),
  });
  const outcome = await processListingAlert('user-1', source, listing, pipeline);

  assert.equal(outcome.status, 'needs_human');
  assert.equal(pipeline.store.saved[0]?.hasSnapshot, false);
});

test('processListingAlert skips non-matches without enriching', async () => {
  let enriched = 0;
  const store = fakeStore({isMatch: false, pursuitId: null, needsEnrichment: false});
  const outcome = await processListingAlert('user-1', source, listing, {
    store,
    enrich: async () => { enriched += 1; return enrichmentReady(); },
  });

  assert.deepEqual(outcome, {rentalId: '123', status: 'skipped', reason: 'not_matched'});
  assert.equal(enriched, 0);
});

test('processListingAlert records an enrichment failure as needs_human instead of retrying', async () => {
  const pipeline = deps({enrich: async () => { throw new Error('provider down'); }});
  const outcome = await processListingAlert('user-1', source, listing, pipeline);

  assert.equal(outcome.status, 'needs_human');
  if (outcome.status === 'needs_human') assert.equal(outcome.reason, 'enrichment_error');
  assert.equal(pipeline.store.saved[0]?.hasSnapshot, false);
  assert.match(String(pipeline.store.saved[0]?.summary.note), /provider down/);
});

test('processStreetEasyAlert parses listing cards from alert html', async () => {
  const html = `
    <a class="ListingCardLink" href="https://links.streeteasy.com/u/abc">
      <div class="ListingCard">
        <div class="ListingCard-info--address">118 Mulberry Street #R4</div>
        <div class="ListingCard-info--price">$7,495</div>
        <div class="ListinCard-info--detailsContainer">3 x 1 bath</div>
        <div class="ListingCard-listingBy">DALLAL (260 Madison Avenue, New York, NY 10016)</div>
      </div>
    </a>`;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (init?.redirect === 'manual') {
      return new Response(null, {status: 302, headers: {Location: 'https://streeteasy.com/rental/123'}});
    }
    throw new Error('Unexpected fetch');
  };

  try {
    const result = await processStreetEasyAlert('user-1', {
      id: 'msg-1',
      from: 'noreply@email.streeteasy.com',
      date: new Date().toISOString(),
      htmlBody: html,
    }, deps());

    assert.equal(result.listings.length, 1);
    assert.equal(result.listings[0]?.status, 'ready');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
