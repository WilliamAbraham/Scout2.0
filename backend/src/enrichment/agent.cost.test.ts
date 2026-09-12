import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {enrichWithAgent, AGENT_MODEL, REQUEST_ALLOWANCE_USD} from './agent.ts';
import {EnrichmentBudget} from './spend.ts';
import type {AgentOptions} from './agent.ts';
import {parseEmailListing} from './service.ts';

const input = parseEmailListing({address: '10 Test Street #1', brokerage: 'Test Realty', city: 'New York', price: 4000, bedrooms: 2, bathrooms: 1});
const url = 'https://example.com/listing';
const roster = {agents: [{name: 'Test Broker', brokerage: 'Test Realty', listedAddress: '10 Test Street', listedUnit: '1',
  attribution: {url, excerpt: '10 Test Street #1 Listed by Test Broker', sourceType: 'search_excerpt'}}], listingUrl: url, listingStatus: 'named_brokers', notes: []};
const contacts = {agents: [], officeContacts: [], notes: []};
function mock(cost: number | undefined = 0.001) {
  const requests: Record<string, unknown>[] = [];
  const options: AgentOptions = {apiKey: 'offline', budget: new EnrichmentBudget(0.2), fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    const data = body.response_format.json_schema.name === 'broker_discovery' ? roster : contacts;
    return Response.json({id: 'offline', choices: [{finish_reason: 'stop', message: {content: JSON.stringify(data),
      annotations: [{type: 'url_citation', url_citation: {url, content: '10 Test Street #1 Listed by Test Broker'}}]}}],
      usage: {prompt_tokens: 100, completion_tokens: 100, ...(cost === undefined ? {} : {cost})}});
  }};
  return {requests, options};
}

test('no supplied budget means zero paid requests, even with a key', async () => {
  const {options, requests} = mock(); delete options.budget;
  const result = await enrichWithAgent(input, options);
  assert.equal(requests.length, 0);
  assert.match(result.notes.join(' '), /Budget stopped request/);
  assert.equal(result.cost.reportedUsd, 0);
});

test('budget admission stops a second stage while preserving the roster', async () => {
  const {options, requests} = mock(); options.budget = new EnrichmentBudget(REQUEST_ALLOWANCE_USD);
  const result = await enrichWithAgent(input, options);
  assert.equal(requests.length, 1);
  assert.equal(result.agents[0]?.name, 'Test Broker');
  assert.equal(result.execution, 'partial');
  assert.equal(result.cost.reportedUsd, 0.001);
});

test('shared batch budget prevents repeated spending across listings', async () => {
  const {options, requests} = mock(); options.budget = new EnrichmentBudget(0.021);
  await enrichWithAgent(input, options);
  await enrichWithAgent({...input, unit: '2'}, options);
  assert.equal(requests.length, 2);
  assert.equal(options.budget.reportedUsd, 0.002);
});

test('unknown provider cost freezes spending rather than assuming zero', async () => {
  const {options, requests} = mock();
  const fetcher = options.fetch!;
  options.fetch = async (...args) => {const response = await fetcher(...args); const raw = await response.json() as {usage: {cost?: number}}; delete raw.usage.cost; return Response.json(raw);};
  const first = await enrichWithAgent(input, options);
  await enrichWithAgent({...input, unit: '2'}, options);
  assert.equal(requests.length, 1);
  assert.equal(first.cost.reportedUsd, null);
  assert.match(options.budget!.haltedReason!, /unavailable/);
});

test('provider overrun is reported and blocks all further calls', async () => {
  const {options, requests} = mock(0.08);
  const result = await enrichWithAgent(input, options);
  await enrichWithAgent({...input, unit: '2'}, options);
  assert.equal(requests.length, 1);
  assert.equal(result.cost.reportedUsd, 0.08);
  assert.match(options.budget!.haltedReason!, /exceeded/);
});

test('premium models and unbounded search settings are rejected before network access', async () => {
  const {options, requests} = mock();
  await assert.rejects(enrichWithAgent(input, {...options, model: 'openai/gpt-5.5'}), /only permits/);
  await assert.rejects(enrichWithAgent(input, {...options, searchEngine: 'native'}), /requires Parallel/);
  await assert.rejects(enrichWithAgent(input, {...options, maxToolCalls: 12}), /1–2/);
  assert.equal(requests.length, 0);
});

test('requests use Mini, price filters, short search excerpts, and no page-fetch tool', async () => {
  const {options, requests} = mock(); await enrichWithAgent(input, options);
  for (const request of requests) {
    assert.equal(request.model, AGENT_MODEL);
    assert.equal(request.max_completion_tokens, 2500);
    assert.equal(request.reasoning_effort, undefined);
    assert.equal(request.max_tool_calls, 2);
    assert.deepEqual(request.provider, {sort: 'price', allow_fallbacks: false, require_parameters: true, max_price: {prompt: 0.4, completion: 1.6}});
    assert.deepEqual(request.tools, [{type: 'openrouter:web_search', parameters: {engine: 'parallel', mode: 'fast', max_results: 3, max_uses: 2, max_total_results: 6, max_characters: 1500}}]);
  }
});

test('warm cache and concurrent duplicates issue no duplicate paid requests; changed unit misses cache', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-agent-cost-'));
  t.after(() => rm(cacheDir, {recursive: true, force: true}));
  const {options, requests} = mock(); options.cacheDir = cacheDir;
  const [first, concurrent] = await Promise.all([enrichWithAgent(input, options), enrichWithAgent(input, options)]);
  assert.equal(requests.length, 2);
  assert.equal(first.cost.reportedUsd! + concurrent.cost.reportedUsd!, 0.002);
  const cached = await enrichWithAgent(input, {...options, budget: new EnrichmentBudget(0)});
  assert.equal(cached.cost.cacheHit, true);
  assert.equal(cached.cost.reportedUsd, 0);
  assert.equal(cached.checkedAt, first.checkedAt);
  const changed = await enrichWithAgent({...input, unit: '2'}, {...options, budget: new EnrichmentBudget(0)});
  assert.equal(changed.cost.cacheHit, false);
  assert.equal(changed.agents.length, 0);
  assert.equal(requests.length, 2);
  const file = (await readdir(cacheDir)).find(f => f.endsWith('.json'))!;
  const saved = JSON.parse(await readFile(path.join(cacheDir, file), 'utf8'));
  saved.savedAt = Date.now() - 3_600_001;
  await writeFile(path.join(cacheDir, file), JSON.stringify(saved));
  const stale = await enrichWithAgent(input, {...options, budget: new EnrichmentBudget(0)});
  assert.equal(stale.cost.cacheHit, false);
});

test('direct Next Step office contacts skip paid contact stage without suppressing roster discovery', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-agent-direct-'));
  t.after(() => rm(cacheDir, {recursive: true, force: true}));
  const {options, requests} = mock(); const sdkFetch = options.fetch!;
  options.cacheDir = cacheDir;
  options.fetch = async (target, init) => {
    if (!String(target).startsWith('https://openrouter.ai/')) {
      return new Response('<a href="/contact/">Contact</a><p>The Next Step Realty New York LLC</p><p>4 East 8th Street</p><p>For general inquiries: Tel: 646.568.1311</p><a href="mailto:clients@nextstepny.com">clients@nextstepny.com</a>');
    }
    const raw = await (await sdkFetch(target, init)).json() as {choices: [{message: {content: string}}]};
    raw.choices[0].message.content = JSON.stringify({...roster, agents: [], listingStatus: 'team_only'});
    return Response.json(raw);
  };
  const result = await enrichWithAgent({...input, brokerage: 'Next Step Realty New York LLC'}, options);
  assert.equal(requests.length, 1, 'discovery still runs but generic contact research is skipped');
  assert.equal(result.directContacts[0]?.email, 'clients@nextstepny.com');
  assert.equal(result.agents.length, 0);
  assert.equal(result.execution, 'completed');
});
