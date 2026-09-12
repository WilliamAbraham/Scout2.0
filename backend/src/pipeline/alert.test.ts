import assert from 'node:assert/strict';
import test from 'node:test';

import type {Listing as GmailListing} from '../gmail/listings.ts';
import type {EmailListing, EnrichmentResult} from '../enrichment/service.ts';
import type {OutreachPorts} from '../outreach/types.ts';
import {gmailListingToEmailInput} from './listingInput.ts';
import {splitBrokerage, isStreetEasyAlert} from './brokerage.ts';
import {contactSnapshotFromEnrichment, agentsForOutreach} from './contacts.ts';
import {processListingAlert, processStreetEasyAlert} from './alert.ts';
import type {AlertPipelineDeps} from './alert.ts';

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

function deps(overrides: Partial<AlertPipelineDeps> = {}): AlertPipelineDeps {
  const sent: string[] = [];
  const ports: OutreachPorts = {
    llm: {complete: async () => ({text: 'Tour request body', toolCalls: []})},
    checkAvailability: async () => ({free: true}),
    bookTour: async () => ({eventId: 'evt-1'}),
    sendMail: async message => {
      sent.push(message.body);
      return {threadId: 'thread-new', messageId: 'msg-out'};
    },
    sendPacket: async () => {},
  };
  return {
    enrich: async (_input: EmailListing) => enrichmentReady(),
    ports,
    profile: {budgetMax: 8000, bedrooms: 3, availabilityNote: 'evenings', freeText: '', learnedAnswers: []},
    sendsToday: 0,
    sendCap: 10,
    ...overrides,
  };
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
  assert.equal(input.brokerage, 'DALLAL');
  assert.equal(input.unit, 'R4');
  assert.equal(input.brokerageOfficeAddress, '260 Madison Avenue, New York, NY 10016');
});

test('enrichment contacts map to outreach agents', () => {
  const snapshot = contactSnapshotFromEnrichment(enrichmentReady());
  assert.ok(snapshot);
  assert.deepEqual(agentsForOutreach(snapshot!), [{name: 'Ava Agent', email: 'ava@broker.example', role: 'primary'}]);
});

test('processListingAlert enriches then sends opening outreach', async () => {
  const pipeline = deps();
  const outcome = await processListingAlert(listing, pipeline);

  assert.equal(outcome.status, 'outreach_sent');
  if (outcome.status === 'outreach_sent') {
    assert.equal(outcome.turn.pursuit.stage, 'contacted');
    assert.ok(outcome.turn.pursuit.nextFollowUpAt);
  }
});

test('processListingAlert escalates when enrichment has no email', async () => {
  const outcome = await processListingAlert(listing, deps({
    enrich: async () => enrichmentReady({agents: [], outreachReady: false, resolution: 'unresolved'}),
  }));

  assert.equal(outcome.status, 'needs_human');
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
    const result = await processStreetEasyAlert({
      id: 'msg-1',
      threadId: 'thread-1',
      subject: 'New listings',
      from: 'noreply@email.streeteasy.com',
      date: new Date().toISOString(),
      snippet: '',
      textBody: null,
      htmlBody: html,
    }, deps());

    assert.equal(result.listings.length, 1);
    assert.equal(result.listings[0]?.status, 'outreach_sent');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
