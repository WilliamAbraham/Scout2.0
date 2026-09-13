import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {parseEmailListing} from './service.ts';
import {findListingAgents} from './listingAgents.ts';
import {EnrichmentBudget} from './spend.ts';
import {processListingAlert} from '../pipeline/alert.ts';
import {enrichForPipeline} from '../pipeline/agentEnrichment.ts';

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
function providers(options: {
  listing?: unknown;
  search?: unknown[];
  tavilyStatus?: number;
  firecrawlSearch?: Array<{url: string; title?: string; description?: string}>;
  profiles?: Record<string, string>;
} = {}) {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (target, init) => {
    const url = String(target);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (url.includes('api.firecrawl.dev/v2/search')) {
      calls.push(`search:${String(body.query)}`);
      return Response.json({success: true, data: {web: options.firecrawlSearch ?? []}});
    }
    if (url.startsWith('https://api.firecrawl.dev')) {
      const page = String(body.url);
      calls.push(page);
      const profile = options.profiles?.[page];
      if (profile) return Response.json({success: true, data: {markdown: profile}});
      return Response.json({success: true, data: {markdown: 'Listed by', json: options.listing ?? roster}});
    }
    if (url.startsWith('https://api.tavily.com')) {
      calls.push(`search:${String(body.query)}`);
      if (options.tavilyStatus) return new Response('', {status: options.tavilyStatus});
      return Response.json({results: options.search ?? []});
    }
    throw new Error(`Unexpected request to ${url}`);
  };
  return {fetcher, calls};
}

test('the listing names its agent and Tavily supplies a personal address', async () => {
  const {fetcher, calls} = providers({search: [{
    url: 'https://findrealestate.com/team/fatma-kara', title: 'Fatma Kara',
    content: 'Fatma Kara, Licensed Real Estate Salesperson at FIND Real Estate. Reach her at fatma@findrealestate.com or 212-555-0134.',
  }]});
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});

  assert.deepEqual(found.agents.map(agent => agent.name), ['Fatma Kara']);
  assert.equal(found.agents[0]?.email, 'fatma@findrealestate.com');
  assert.equal(found.agents[0]?.phone, '212-555-0134');
  assert.equal(found.listingUrl, 'https://streeteasy.com/rental/123');
  assert.equal(calls[0], 'https://streeteasy.com/rental/123');
  assert.equal(calls[1], 'search:Fatma Kara FIND');
});

test('a firm mailbox is never returned as the agent\'s own address', async () => {
  const {fetcher} = providers({search: [{
    url: 'https://findrealestate.com/contact', title: 'Fatma Kara at FIND Real Estate',
    content: 'Fatma Kara at FIND Real Estate. General enquiries: hello@findrealestate.com.',
  }]});
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.equal(found.agents[0]?.email, null);
  assert.match(found.notes.join(' '), /No email found for Fatma Kara/);
});

test('a namesake at another firm is not this listing\'s agent', async () => {
  // "Daniel Ramirez" is an agent at this brokerage and at several others; a
  // page naming him without naming the firm is somebody else entirely.
  const {fetcher} = providers({search: [{
    url: 'https://theagencyre.com/agent/fatma-kara', title: 'Fatma Kara - Real Estate Agent',
    content: 'Fatma Kara. Real Estate Agent at The Agency. +1 (240) 713-1490. fatma@theagencyre.com',
  }]});
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.equal(found.agents[0]?.email, null);
  assert.equal(found.agents[0]?.phone, null);
});

test('a broker directory listing the agent under another entity still counts', async () => {
  // LoopNet carries this agent as "Wayfinderpm" while the listing credits OGI
  // Management. The market is what separates them from an out-of-state
  // namesake, and the note says which signal was used.
  const {fetcher} = providers({search: [{
    url: 'https://www.loopnet.ca/commercial-real-estate-brokers/profile/fatma-kara/x',
    title: 'Fatma Kara - Real Estate Salesperson',
    content: 'Fatma Kara. Real Estate Salesperson, Wayfinderpm. New York, NY 10006. P: (646) 398-0662.',
  }]});
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.equal(found.agents[0]?.phone, '(646) 398-0662');
  assert.match(found.notes.join(' '), /corroborated by market, not by FIND Real Estate/);
});

test('a profile that prints the phone after a long bio still counts', async () => {
  // REAL NY puts Luke Joyce's phones in a sidebar. Tavily's text starts with
  // his bio, so the numbers sit ~680 characters after his name — past the
  // old 600-character window, still on his own page.
  const bio = 'Licensed Real Estate Salesperson at FIND Real Estate. '.repeat(12);
  const {fetcher} = providers({search: [{
    url: 'https://findrealestate.com/team/fatma-kara',
    title: 'Fatma Kara',
    content: `Fatma Kara ${bio} (609) 906-8403 (917) 261-2534 fatma@findrealestate.com`,
  }]});
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.equal(found.agents[0]?.phone, '(609) 906-8403');
  assert.equal(found.agents[0]?.email, 'fatma@findrealestate.com');
});

test('a firm profile is opened when search snippets omit the email', async () => {
  const profile = 'https://findrealestate.com/agents/fatma-kara';
  const {fetcher, calls} = providers({
    search: [{
      url: 'https://www.renthop.com/managers/Fatma-Kara', title: 'Fatma Kara',
      content: 'Fatma Kara, Licensed Real Estate Salesperson at FIND Real Estate. View listings.',
    }, {
      url: profile, title: 'Fatma Kara | FIND Real Estate',
      content: 'Fatma Kara is a licensed salesperson at FIND Real Estate in New York.',
    }],
    profiles: {
      [profile]: 'Fatma Kara\nLicensed Real Estate Salesperson\nFIND Real Estate\nfatma@findrealestate.com\n(212) 555-0134',
    },
  });
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.equal(found.agents[0]?.email, 'fatma@findrealestate.com');
  assert.equal(found.agents[0]?.phone, '(212) 555-0134');
  assert.ok(calls.includes(profile));
  assert.ok(!calls.includes('https://www.renthop.com/managers/Fatma-Kara'));
});

test('aggregators without an email trigger a Firecrawl people search', async () => {
  const profile = 'https://www.voronyc.com/agents/tom-gur';
  const {fetcher, calls} = providers({
    listing: {
      address: '352 East 13th Street', unit: '3S', price: 4500, availability: null,
      agents: [{name: 'Tom Gur', brokerage: 'Voro New York', role: 'Licensed Real Estate Salesperson', profileUrl: null}],
    },
    search: [{
      url: 'https://www.renthop.com/managers/Tom-Gur', title: 'Tom Gur',
      content: 'Tom Gur, Licensed Real Estate Salesperson at Voro New York. View listings.',
    }],
    firecrawlSearch: [{url: profile, title: 'Tom Gur | VORO NYC', description: 'Tom Gur at VORO NYC'}],
    profiles: {
      [profile]: 'Tom Gur\nLicensed as Yotam Gur Zeev\nVORO NYC\ntom@voronyc.com\n551-333-6680',
    },
  });
  const listing = parseEmailListing({address: '352 East 13th Street', unit: '3S', price: 4500, bedrooms: 1, bathrooms: 1,
    brokerage: 'Voro New York', city: 'New York', listingUrl: 'https://streeteasy.com/rental/5153059'});
  const found = await findListingAgents(listing, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.equal(found.agents[0]?.email, 'tom@voronyc.com');
  assert.equal(found.agents[0]?.phone, '551-333-6680');
  assert.ok(calls.includes(profile));
  assert.ok(calls.some(call => call === 'search:Tom Gur Voro'));
  assert.ok(!calls.includes('https://www.renthop.com/managers/Tom-Gur'));
});

test('a scraped namesake at another firm is still refused', async () => {
  const other = 'https://theagencyre.com/agent/fatma-kara';
  const {fetcher} = providers({
    search: [{
      url: other, title: 'Fatma Kara',
      content: 'Fatma Kara is a real estate agent. View profile.',
    }],
    profiles: {
      [other]: 'Fatma Kara\nThe Agency\nfatma@theagencyre.com\n(240) 713-1490',
    },
  });
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.equal(found.agents[0]?.email, null);
  assert.equal(found.agents[0]?.phone, null);
});

test('Firecrawl search is used when Tavily is over quota', async () => {
  const profile = 'https://findrealestate.com/agents/fatma-kara';
  const {fetcher, calls} = providers({
    tavilyStatus: 432,
    firecrawlSearch: [{url: profile, title: 'Fatma Kara | FIND Real Estate', description: 'Fatma Kara at FIND Real Estate'}],
    profiles: {
      [profile]: 'Fatma Kara\nFIND Real Estate\nfatma@findrealestate.com\n212-555-0134',
    },
  });
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.equal(found.agents[0]?.email, 'fatma@findrealestate.com');
  assert.ok(calls.some(call => call === 'search:Fatma Kara FIND'));
  assert.ok(calls.includes(profile));
});

test('a search result that never names the agent supplies nothing', async () => {
  const {fetcher} = providers({search: [{
    url: 'https://findrealestate.com/team', title: 'Our team',
    content: 'Reach Someone Else at someone@findrealestate.com.',
  }]});
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.equal(found.agents[0]?.email, null);
});

test('a StreetEasy address that adds city and ZIP is still this apartment', async () => {
  const {fetcher, calls} = providers({
    listing: {...roster, address: '620 East 6th Street, New York, NY 10009'},
    search: [{
      url: 'https://findrealestate.com/team/fatma-kara', title: 'Fatma Kara',
      content: 'Fatma Kara, Licensed Real Estate Salesperson at FIND Real Estate. fatma@findrealestate.com',
    }],
  });
  const found = await findListingAgents(input, {fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k'});
  assert.deepEqual(found.agents.map(agent => agent.name), ['Fatma Kara']);
  assert.equal(calls[1], 'search:Fatma Kara FIND');
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

test('unpaid enrichWithAgent uses the StreetEasy listing-agent fallback', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-listing-'));
  t.after(() => rm(cacheDir, {recursive: true, force: true}));
  const {fetcher} = providers({search: [{
    url: 'https://findrealestate.com/team/fatma-kara', title: 'Fatma Kara',
    content: 'Fatma Kara, Licensed Real Estate Salesperson at FIND Real Estate. Reach her at fatma@findrealestate.com or 212-555-0134.',
  }]});
  const result = await enrichForPipeline(input, {
    apiKey: 'unused', budget: new EnrichmentBudget(0), cacheDir, fetch: fetcher, firecrawlKey: 'k', tavilyKey: 'k',
  });
  assert.equal(result.research?.engine, 'enrichWithAgent');
  assert.deepEqual(result.agents.map(agent => agent.name), ['Fatma Kara']);
  assert.equal(result.agents[0]?.email, 'fatma@findrealestate.com');
  assert.match(result.issues.join(' '), /Paid discovery skipped/);
});

test('a roster credited to another firm is refused by the service', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-listing-'));
  t.after(() => rm(cacheDir, {recursive: true, force: true}));
  const {fetcher} = providers({listing: {...roster,
    agents: [{...roster.agents[0]!, brokerage: 'Other Realty'}]}});
  const result = await enrichForPipeline(input, {
    apiKey: 'unused', budget: new EnrichmentBudget(0), cacheDir, fetch: fetcher, firecrawlKey: 'k',
  });
  assert.deepEqual(result.agents, []);
  assert.match(result.issues.join(' '), /credits Other Realty, not FIND Real Estate/);
});

test('name-only discovery survives alert persistence without authorizing email', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-listing-'));
  t.after(() => rm(cacheDir, {recursive: true, force: true}));
  const {fetcher} = providers();
  let saved: Record<string, unknown> | undefined;
  const outcome = await processListingAlert('user', {messageId: 'msg', receivedAt: new Date()}, {
    address: `${input.address} #${input.unit}`, price: input.price, bedrooms: input.bedrooms, bathrooms: input.bathrooms,
    brokerage: input.brokerage, listingUrl: input.listingUrl!, rentalId: '123',
  }, {enrich: value => enrichForPipeline(value, {
    apiKey: 'unused', budget: new EnrichmentBudget(0), cacheDir, fetch: fetcher, firecrawlKey: 'k',
  }), store: {
    ingestListing: async () => ({listingId: 'l', userListingId: 'ul', pursuitId: 'p', isMatch: true, isNew: true, needsEnrichment: true}),
    saveEnrichment: async (_user, _pursuit, snapshot, summary) => {assert.equal(snapshot, null); saved = summary;},
    noteEnrichmentDeferred: async () => {assert.fail('Recovered names must not disappear into a retry');},
  }});
  assert.equal(outcome.status, 'needs_human');
  assert.equal((saved?.agents as {name: string}[])[0]?.name, 'Fatma Kara');
});
