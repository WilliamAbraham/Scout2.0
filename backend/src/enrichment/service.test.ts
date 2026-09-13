import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm, utimes, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {BrokerEnrichment, parseEmailListing} from './service.ts';
import type {Agent, EmailListing, EnrichmentOptions, ExtractedListing} from './service.ts';

const input: EmailListing = {address: '118 Mulberry Street', unit: 'R4', price: 7495, bedrooms: 3, bathrooms: 1,
  brokerage: 'Example Realty', brokerageOfficeAddress: '260 Madison Avenue, New York, NY 10016', city: 'New York'};
const home = 'https://broker.example/';
const listingUrl = `${home}rentals/118-mulberry-r4`;
const teamUrl = `${home}agents`;
const person = (name: string): Agent => ({name, email: `${name.toLowerCase()}@broker.example`, phone: '(212) 555-0101',
  profileUrl: `${home}agents/${name.toLowerCase()}`, role: null, attributionEvidence: `${name} — Listing Agent`,
  contactEvidence: `${name} — Listing Agent\n${name.toLowerCase()}@broker.example`});
const agents = [person('Ava'), person('Ben')];
const listing = (): ExtractedListing => ({address: input.address, unit: input.unit, price: input.price,
  bedrooms: 3, bathrooms: 1, brokerage: input.brokerage, status: 'For rent',
  listingEvidence: '118 Mulberry Street #R4', contradictions: [], agents: structuredClone(agents)});
const agentText = (agent: Agent) => `${agent.name} — Listing Agent\n${agent.email ?? ''}\n${agent.phone ?? ''}`;
const listingText = (data: ExtractedListing) => `${data.listingEvidence}\nFor rent, $7,495, 3 beds, 1 bath\nExample Realty\n${data.agents.map(agentText).join('\n')}`;
const page = (markdown: string, json?: unknown, links: string[] = []) => ({success: true, data: {
  markdown, json, links, html: links.map(url => `<a href="${url}">${url === teamUrl ? 'Our Agents' : url}</a>`).join(''),
  metadata: {statusCode: 200},
}});
type Payload = Record<string, unknown>;
type Handler = (url: string, payload: Payload) => unknown | Promise<unknown>;
async function setup(t: TestContext, handler: Handler, options: Partial<EnrichmentOptions> = {}) {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-enrichment-'));
  t.after(() => rm(cacheDir, {recursive: true, force: true}));
  const calls: Array<{url: string; payload: Payload; headers: Headers}> = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    const payload = JSON.parse(String(init?.body)) as Payload;
    calls.push({url: String(url), payload, headers: new Headers(init?.headers)});
    const result = await handler(String(url), payload);
    return result instanceof Response ? result : Response.json(result);
  };
  const service = new BrokerEnrichment({cacheDir, fetch: fakeFetch, sleep: async () => {}, ...options});
  return {service, calls, cacheDir};
}
function workflow(options: {pages?: Record<string, ExtractedListing>; indexed?: boolean; failBen?: boolean} = {}): Handler {
  return (url, body) => {
    if (url.endsWith('/search')) {
      const query = String(body.query);
      let hits: Array<{url: string; title?: string; description?: string}>;
      if (query.includes('official website')) hits = [{url: home}];
      else if (body.includeDomains) hits = options.indexed ? [] : Object.keys(options.pages ?? {[listingUrl]: listing()}).map(url => ({url}));
      else {
        const name = query.includes('Ava') ? 'Ava' : 'Ben';
        if (options.failBen && name === 'Ben') return new Response('', {status: 429, headers: {'Retry-After': '60'}});
        hits = [{url: 'https://streeteasy.com/building/example/r4', title: '118 Mulberry Street #R4', description: `Listed by ${name}`}];
      }
      return {success: true, data: {web: hits}};
    }
    if (body.url === home) return page('Example Realty — 260 Madison Avenue, New York, NY 10016', undefined, [teamUrl]);
    if (body.url === teamUrl) return page(agents.map(agent => `${agent.name} ${agent.profileUrl}`).join('\n'), {agents});
    const agent = agents.find(agent => agent.profileUrl === body.url);
    if (agent) return page(agentText(agent), agent);
    const extracted = (options.pages ?? {[listingUrl]: listing()})[String(body.url)];
    if (extracted) return page(listingText(extracted), extracted, agents.map(agent => agent.profileUrl!));
    throw new Error(`Unexpected request to ${String(body.url)}`);
  };
}

test('accepts email fields, splits #unit, and rejects malformed inputs before requests', async t => {
  const {unit, ...withoutUnit} = input;
  assert.deepEqual(parseEmailListing({...withoutUnit, address: `${input.address} #${unit}`}), input);
  for (const bad of [null, {...input, unit: ''}, {...input, price: 0}, {...input, bedrooms: '3'}]) {
    assert.throws(() => parseEmailListing(bad));
  }
  const {service, calls} = await setup(t, workflow());
  await assert.rejects(service.run({...input, brokerage: ''}));
  assert.equal(calls.length, 0);
});

test('full workflow returns every source agent, evidence URLs, and a stable result', async t => {
  const {service, calls} = await setup(t, workflow());
  const result = await service.run(input);
  assert.equal(result.status, 'source_matched');
  assert.equal(result.outreachReady, true);
  assert.equal(result.rosterCompleteness, 'source_only');
  assert.deepEqual(result.agents.map(agent => agent.name), ['Ava', 'Ben']);
  assert.ok(result.agents.every(agent => agent.attributionSourceUrl === listingUrl && agent.emailSourceUrl === listingUrl));
  assert.deepEqual(result.candidateAgents, []);
  assert.equal(calls.length, 4);
  assert.equal(result.attempts.length, calls.length);
  assert.ok(!Number.isNaN(Date.parse(result.checkedAt)));
});

test('follows a linked agent profile to recover missing email while preserving listing attribution', async t => {
  const data = listing();
  data.agents[0]!.email = null;
  data.agents[0]!.contactEvidence = '';
  const {service} = await setup(t, workflow({pages: {[listingUrl]: data}}));
  const result = await service.run(input);
  assert.equal(result.status, 'source_matched');
  assert.equal(result.agents[0]!.email, 'ava@broker.example');
  assert.equal(result.agents[0]!.emailSourceUrl, agents[0]!.profileUrl);
  assert.equal(result.agents[0]!.phoneSourceUrl, listingUrl);
  assert.equal(result.agents[0]!.attributionSourceUrl, listingUrl);
});

test('reconstructs real profile evidence when the extractor rearranges its quotation', async t => {
  const data = listing();
  Object.assign(data.agents[0]!, {email: null, contactEvidence: ''});
  const base = workflow({pages: {[listingUrl]: data}});
  const actual = '# Ava\n\nAgent biography\n\nava@broker.example\n(212) 555-0101';
  const {service} = await setup(t, (url, body) => body.url === agents[0]!.profileUrl
    ? page(actual, {...agents[0], attributionEvidence: 'Ava', contactEvidence: 'ava@broker.example, Ava'}) : base(url, body));
  const result = await service.run(input);
  assert.equal(result.status, 'source_matched');
  assert.equal(result.agents[0]!.contactEvidence, '# Ava\n\nAgent biography\n\nava@broker.example');
  assert.ok(actual.includes(result.agents[0]!.contactEvidence));
});

test('conflicting rental status on another exact-apartment page requires review', async t => {
  const other = listing(); other.status = 'Rented';
  const {service} = await setup(t, workflow({pages: {[listingUrl]: listing(), [`${listingUrl}-old`]: other}}));
  const result = await service.run(input);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.outreachReady, false);
});

test('missing co-agent email remains visible and prevents outreach readiness', async t => {
  const data = listing();
  Object.assign(data.agents[1]!, {email: null, profileUrl: null, contactEvidence: ''});
  const {service} = await setup(t, workflow({pages: {[listingUrl]: data}}));
  const result = await service.run(input);
  assert.equal(result.status, 'partial');
  assert.equal(result.outreachReady, false);
  assert.equal(result.agents.length, 2);
  assert.equal(result.agents[1]!.email, null);
});

test('conflicting exact-listing rosters cannot become outreach ready', async t => {
  const other = listing();
  other.agents.pop();
  const {service} = await setup(t, workflow({pages: {[listingUrl]: listing(), [`${listingUrl}-other`]: other}}));
  const result = await service.run(input);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.outreachReady, false);
  assert.deepEqual(result.agents, []);
  assert.match(result.issues.join(' '), /disagree/);
});

test('rejects the transposed unit even with identical price and contacts', async t => {
  const data = listing();
  data.unit = '4R';
  data.listingEvidence = '118 Mulberry Street #4R';
  const {service} = await setup(t, workflow({pages: {[listingUrl]: data}}), {indexedFallback: false});
  const result = await service.run(input);
  assert.equal(result.status, 'not_found');
  assert.equal(result.outreachReady, false);
  assert.deepEqual(result.agents, []);
  assert.match(result.issues.join(' '), /Unit mismatch/);
});

test('indexed evidence returns candidates only and never scrapes the portal', async t => {
  const {service, calls} = await setup(t, workflow({indexed: true}));
  const result = await service.run(input);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.outreachReady, false);
  assert.equal(result.rosterCompleteness, 'unverified');
  assert.deepEqual(result.agents, []);
  assert.deepEqual(result.candidateAgents.map(agent => agent.name), ['Ava', 'Ben']);
  assert.ok(result.candidateAgents.every(agent => agent.attributionSourceUrl.includes('streeteasy.com') && agent.emailSourceUrl?.includes('broker.example')));
  assert.ok(calls.every(call => !String(call.payload.url).includes('streeteasy.com')));
  assert.ok(calls.every(call => !('scrapeOptions' in call.payload)));
});

test('preserves a recovered candidate when the next lookup hits a quota', async t => {
  const {service} = await setup(t, workflow({indexed: true, failBen: true}));
  const result = await service.run(input);
  assert.equal(result.execution, 'partial');
  assert.equal(result.status, 'needs_review');
  assert.deepEqual(result.candidateAgents.map(agent => agent.name), ['Ava']);
  assert.match(result.issues.join(' '), /HTTP 429/);
});

test('call budget bounds requests, preserves candidates and resets on the next run', async t => {
  const {service, calls} = await setup(t, workflow({indexed: true}), {maxCalls: 6, refresh: true});
  const first = await service.run(input);
  assert.equal(first.execution, 'budget_exhausted');
  assert.deepEqual(first.candidateAgents.map(agent => agent.name), ['Ava']);
  assert.equal(calls.length, 6);
  const second = await service.run(input);
  assert.equal(second.execution, 'budget_exhausted');
  assert.equal(calls.length, 12);
  assert.equal(second.attempts.length, 6);
  assert.equal(first.attempts.length, 6);
});

test('Tavily is preferred with a key and applies the brokerage domain filter', async t => {
  const {service, calls} = await setup(t, () => ({results: [{url: listingUrl}, {url: 'https://unrelated.example/x'}]}), {tavilyKey: 'test-key'});
  assert.equal(service.searchProvider, 'tavily');
  assert.deepEqual(await service.search('target', 'broker.example'), [listingUrl]);
  assert.equal(calls[0]!.url, 'https://api.tavily.com/search');
  assert.deepEqual(calls[0]!.payload.include_domains, ['broker.example']);
  assert.equal(calls[0]!.headers.get('Authorization'), 'Bearer test-key');
});

test('retries transient errors once, but not authentication failure', async t => {
  let count = 0;
  const {service, calls} = await setup(t, () => ++count === 1 ? new Response('', {status: 503}) : {data: {web: []}});
  assert.deepEqual(await service.search('query'), []);
  assert.equal(calls.length, 2);
  const unauthorized = await setup(t, () => new Response('', {status: 401}));
  const result = await unauthorized.service.run(input);
  assert.equal(result.status, 'error');
  assert.equal(result.execution, 'error');
  assert.deepEqual(result.agents, []);
  assert.deepEqual(result.candidateAgents, []);
  assert.equal(unauthorized.calls.length, 1);
});

test('cache reuses fresh responses, expires old ones and recovers from invalid JSON', async t => {
  const {service, calls, cacheDir} = await setup(t, () => ({data: {web: []}}));
  await service.search('query');
  await service.search('query');
  assert.equal(calls.length, 1);
  assert.equal(service.attempts.at(-1)!.cached, true);
  const file = path.join(cacheDir, (await readdir(cacheDir))[0]!);
  await utimes(file, new Date(0), new Date(0));
  await service.search('query');
  assert.equal(calls.length, 2);
  await writeFile(file, '{invalid');
  await service.search('query');
  assert.equal(calls.length, 3);
});

test('refresh bypasses cache and unsuccessful target pages are never cached', async t => {
  const refreshed = await setup(t, () => ({data: {web: []}}), {refresh: true});
  await refreshed.service.search('query');
  await refreshed.service.search('query');
  assert.equal(refreshed.calls.length, 2);
  const failed = await setup(t, () => ({success: true, data: {markdown: 'Missing', metadata: {statusCode: 404}}}));
  await assert.rejects(failed.service.scrape(listingUrl), /Target page HTTP 404/);
  assert.deepEqual(await readdir(failed.cacheDir), []);
});

test('refuses portal, local and credential-bearing scrape targets before any request', async t => {
  const {service, calls} = await setup(t, workflow());
  for (const url of ['https://streeteasy.com/example', 'http://broker.example/', 'https://127.0.0.1/', 'https://localhost/', 'https://name:password@broker.example/']) {
    await assert.rejects(service.scrape(url), /Unsupported page URL/);
  }
  assert.equal(calls.length, 0);
});
