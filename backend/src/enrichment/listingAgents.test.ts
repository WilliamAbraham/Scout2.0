import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {BrokerEnrichment, parseEmailListing} from './service.ts';
import {findListingAgents} from './listingAgents.ts';
import {processListingAlert} from '../pipeline/alert.ts';

const input = parseEmailListing({address: '620 East 6th Street', unit: '9A', price: 6995, bedrooms: 3, bathrooms: 2,
  brokerage: 'FIND Real Estate', city: 'New York', listingUrl: 'https://streeteasy.com/rental/123'});

const roster = {
  address: '620 East 6th Street', unit: '9A', price: 6995, availability: null,
  agents: [{name: 'Fatma Kara', brokerage: 'FIND Real Estate', role: 'Licensed Real Estate Salesperson',
    profileUrl: 'https://streeteasy.com/profile/942807'}],
};

/**
 * StreetEasy is only ever read through Firecrawl, so the double answers the
 * provider endpoints rather than the listing host. Extraction happens inside
 * Firecrawl; what is under test here is verification and mapping.
 */
function providers(options: {listing?: unknown; search?: unknown[]} = {}) {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (target, init) => {
    const url = String(target);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (url.includes('api.firecrawl.dev/v2/search')) {
      calls.push(`search:${String(body.query)}`);
      return Response.json({success: true, data: {web: []}});
    }
    if (url.startsWith('https://api.firecrawl.dev')) {
      calls.push(String(body.url));
      return Response.json({success: true, data: {markdown: 'Listed by', json: options.listing ?? roster}});
    }
    if (url.startsWith('https://api.tavily.com')) {
      calls.push(`search:${String(body.query)}`);
      return Response.json({results: options.search ?? []});
    }
    throw new Error(`Unexpected request to ${url}`);
  };
  return {fetcher, calls};
}

test('the listing names its agent and Tavily supplies a personal address', async () => {
  const {fetcher, calls} = providers({search: [{
    url: 'https://findrealestate.com/team/fatma-kara', title: 'Fatma Kara',
    content: 'Fatma Kara, Licensed Real Estate Salesperson. Reach her at fatma@findrealestate.com or 212-555-0134.',
  }]});
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});

  assert.deepEqual(found.agents.map(agent => agent.name), ['Fatma Kara']);
  assert.equal(found.agents[0]?.email, 'fatma@findrealestate.com');
  assert.equal(found.agents[0]?.phone, '212-555-0134');
  assert.equal(found.listingUrl, 'https://streeteasy.com/rental/123');
  assert.equal(calls[0], 'https://streeteasy.com/rental/123');
  assert.match(calls[1]!, /^search:"Fatma Kara" FIND Real Estate/);
});

test('a firm mailbox is never returned as the agent\'s own address', async () => {
  const {fetcher} = providers({search: [{
    url: 'https://findrealestate.com/contact', title: 'Fatma Kara at FIND Real Estate',
    content: 'Fatma Kara. General enquiries: hello@findrealestate.com.',
  }]});
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.equal(found.agents[0]?.email, null);
  assert.match(found.notes.join(' '), /No email found for Fatma Kara/);
});

test('a search result that never names the agent supplies nothing', async () => {
  const {fetcher} = providers({search: [{
    url: 'https://findrealestate.com/team', title: 'Our team',
    content: 'Reach Someone Else at someone@findrealestate.com.',
  }]});
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.equal(found.agents[0]?.email, null);
});

test('a different apartment or a company account cannot become the listing agent', async () => {
  for (const listing of [
    {...roster, unit: '9B'},
    {...roster, address: '621 East 6th Street'},
    {...roster, agents: [{name: 'FIND Real Estate', brokerage: 'FIND Real Estate', role: null, profileUrl: null}]},
  ]) {
    const {fetcher} = providers({listing});
    const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
    assert.deepEqual(found.agents, []);
  }
});

test('an unreadable listing reports why instead of throwing', async () => {
  const fetcher: typeof fetch = async () => new Response('', {status: 402});
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.deepEqual(found.agents, []);
  assert.match(found.notes.join(' '), /Could not read the listing.*402/);
});

test('a roster credited to another firm is refused by the service', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-listing-'));
  t.after(() => rm(cacheDir, {recursive: true, force: true}));
  const {fetcher} = providers({listing: {...roster,
    agents: [{...roster.agents[0]!, brokerage: 'Other Realty'}]}});
  const service = new BrokerEnrichment({cacheDir, fetch: fetcher, sleep: async () => {}, firecrawlKey: 'k'});
  const result = await service.run(input);
  assert.deepEqual(result.agents, []);
  assert.match(result.issues.join(' '), /credits Other Realty, not FIND Real Estate/);
});

test('name-only discovery survives alert persistence without authorizing email', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-listing-'));
  t.after(() => rm(cacheDir, {recursive: true, force: true}));
  const {fetcher} = providers();
  const service = new BrokerEnrichment({cacheDir, fetch: fetcher, sleep: async () => {}, firecrawlKey: 'k'});
  let saved: Record<string, unknown> | undefined;
  const outcome = await processListingAlert('user', {messageId: 'msg', receivedAt: new Date()}, {
    address: `${input.address} #${input.unit}`, price: input.price, bedrooms: input.bedrooms, bathrooms: input.bathrooms,
    brokerage: input.brokerage, listingUrl: input.listingUrl!, rentalId: '123',
  }, {enrich: value => service.run(value), store: {
    ingestListing: async () => ({listingId: 'l', userListingId: 'ul', pursuitId: 'p', isMatch: true, isNew: true, needsEnrichment: true}),
    saveEnrichment: async (_user, _pursuit, snapshot, summary) => {assert.equal(snapshot, null); saved = summary;},
    noteEnrichmentDeferred: async () => {assert.fail('Recovered names must not disappear into a retry');},
  }});
  assert.equal(outcome.status, 'needs_human');
  assert.equal((saved?.agents as {name: string}[])[0]?.name, 'Fatma Kara');
});
