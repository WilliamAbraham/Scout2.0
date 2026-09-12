import {test} from 'node:test';
import assert from 'node:assert/strict';
import {enrichWithAgent} from './agent.ts';
import {EnrichmentBudget} from './spend.ts';
import {parseEmailListing} from './service.ts';

const input = parseEmailListing({address: '620 East 6th Street #9A', price: 6995, bedrooms: 3, bathrooms: 2,
  brokerage: 'FIND Real Estate', city: 'New York'});
const url = 'https://streeteasy.com/rental/123';
const text = '620 East 6th Street #9A Listed by Fatma Kara FIND Real Estate';
const roster = {agents: [{name: 'Fatma Kara', brokerage: input.brokerage, listedAddress: input.address, listedUnit: '9A',
  attribution: {url, excerpt: text, sourceType: 'listing_page'}}], listingUrl: url, listingStatus: 'named_brokers', notes: []};
const empty = {agents: [], listingUrl: null, listingStatus: 'unresolved', notes: []};
const contacts = {agents: [], officeContacts: [], notes: []};
function response(data: unknown, content?: string) {
  return Response.json({id: 'offline-fixture', choices: [{finish_reason: 'stop', message: {content: JSON.stringify(data),
    annotations: content ? [{type: 'url_citation', url_citation: {url, content}}] : []}}], usage: {cost: 0.001}});
}

test('supplied listing page is read before discovery and its evidence supports the roster', async () => {
  const calls: string[] = [];
  const result = await enrichWithAgent({...input, listingUrl: url}, {apiKey: 'offline', budget: new EnrichmentBudget(0.05),
    fetch: async (target, init) => {
      calls.push(String(target));
      if (String(target) === url) return new Response(`<h1>${input.address} #9A</h1><aside>Listed by Fatma Kara FIND Real Estate</aside>`,
        {headers: {'content-type': 'text/html'}});
      const body = JSON.parse(String(init?.body));
      if (calls.length === 2) {
        assert.match(JSON.stringify(body.messages), /Untrusted listing-page evidence.*Fatma Kara/);
        return response(roster); // Attribution supported by our HTTP read, no hosted citation required.
      }
      return response(contacts);
    }});
  assert.equal(calls.length, 3);
  assert.equal(calls[0], url);
  assert.equal(result.agents[0]?.attributionStatus, 'source_cited');
  assert.equal(result.agents[0]?.name, 'Fatma Kara');
  assert.equal(result.cost.reportedUsd, 0.002);
});

test('empty discovery forces an alternate lookup before contacts; initial prompt has no seeded name', async () => {
  const stages: string[] = [];
  const result = await enrichWithAgent(input, {apiKey: 'offline', budget: new EnrichmentBudget(0.05), fetch: async (_target, init) => {
    if (String(_target).startsWith('https://streeteasy.com/')) return new Response(null, {status: 403});
    const body = JSON.parse(String(init?.body));
    const stage = body.response_format.json_schema.name; stages.push(stage);
    if (stage === 'broker_discovery') {
      assert.doesNotMatch(JSON.stringify(body.messages), /Fatma/);
      assert.match(JSON.stringify(body.messages), /New York/);
      return response(empty, '620 E 6th St Ashtabula OH');
    }
    if (stage === 'broker_discovery_retry') {
      assert.match(JSON.stringify(body.messages), /site:streeteasy.com\/building/);
      return response(roster, text);
    }
    assert.match(JSON.stringify(body.messages), /Fatma Kara/);
    return response(contacts);
  }});
  assert.deepEqual(stages, ['broker_discovery', 'broker_discovery_retry', 'broker_contacts']);
  assert.equal(result.agents[0]?.attributionStatus, 'source_cited');
  assert.equal(result.execution, 'completed');
  assert.equal(result.cost.reportedUsd, 0.003);
});

test('wrong-city citation cannot validate a model-claimed broker; recovery obeys the budget', async () => {
  let calls = 0;
  const result = await enrichWithAgent(input, {apiKey: 'offline', budget: new EnrichmentBudget(0.02), fetch: async target => {
    if (String(target).startsWith('https://streeteasy.com/')) return new Response(null, {status: 403});
    calls++; return response(roster, '620 E 6th St Ashtabula OH');
  }});
  assert.equal(calls, 1);
  assert.equal(result.agents[0]?.attributionStatus, 'needs_review');
  assert.equal(result.listingStatus, 'unresolved');
  assert.equal(result.execution, 'partial');
  assert.match(result.notes.join(' '), /recovery incomplete.*Budget stopped request/);
});

test('blocked listing page falls back to search without passing challenge text as evidence', async () => {
  let calls = 0;
  const result = await enrichWithAgent({...input, listingUrl: url}, {apiKey: 'offline', budget: new EnrichmentBudget(0.05),
    fetch: async (target, init) => {
      if (String(target) === url) return new Response('captcha', {status: 403});
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.doesNotMatch(JSON.stringify(body.messages), /Untrusted listing-page evidence/);
      return calls === 1 ? response(roster, text) : response(contacts);
    }});
  assert.equal(result.agents[0]?.attributionStatus, 'source_cited');
  assert.match(result.notes.join(' '), /HTTP 403/);
  assert.equal(calls, 2);
});

test('no-broker recovery is bounded and never claims an office route is a broker', async () => {
  let calls = 0;
  const result = await enrichWithAgent(input, {apiKey: 'offline', budget: new EnrichmentBudget(0.1), fetch: async (_target, init) => {
    if (String(_target).startsWith('https://streeteasy.com/')) return new Response(null, {status: 403});
    calls++;
    const body = JSON.parse(String(init?.body));
    return response(body.response_format.json_schema.name === 'broker_contacts' ? contacts : {...empty, listingStatus: 'team_only'});
  }});
  assert.equal(calls, 3);
  assert.equal(result.listingStatus, 'unresolved');
  assert.equal(result.agents.length, 0);
});

test('retry upgrades a candidate without duplicating it and retains co-brokers', async () => {
  let calls = 0;
  const result = await enrichWithAgent(input, {apiKey: 'offline', budget: new EnrichmentBudget(0.05), fetch: async target => {
    if (String(target).startsWith('https://streeteasy.com/')) return new Response(null, {status: 403});
    calls++;
    if (calls === 1) return response(roster, 'Unrelated property');
    if (calls === 2) return response({...roster, agents: [...roster.agents,
      {...roster.agents[0], name: 'Second Broker'}]}, `${text} and Second Broker`);
    return response(contacts);
  }});
  assert.deepEqual(result.agents.map(a => [a.id, a.name, a.attributionStatus]), [
    ['agent-1', 'Fatma Kara', 'source_cited'], ['agent-2', 'Second Broker', 'source_cited'],
  ]);
});

test('canonical URL is also enforced for SDK callers that bypass the input parser', async () => {
  const result = await enrichWithAgent({...input, listingUrl: `${url}?recipient=private`}, {
    apiKey: 'offline', budget: new EnrichmentBudget(0), fetch: async target => {
      assert.equal(String(target), url); return new Response(null, {status: 403});
    },
  });
  assert.equal(result.input.listingUrl, url);
  assert.equal(result.cost.reportedUsd, 0);
});

test('address-only input retrieves the candidate page and extracts without search or seeded broker names', async () => {
  let sdkCalls = 0;
  const candidate = 'https://streeteasy.com/building/620-east-6-street-new_york/9a';
  assert.doesNotMatch(JSON.stringify(input), /Fatma/);
  const result = await enrichWithAgent(input, {apiKey: 'offline', budget: new EnrichmentBudget(0.05), fetch: async (target, init) => {
    if (String(target).startsWith('https://streeteasy.com/')) {
      assert.equal(String(target), candidate);
      return new Response(`<h1>${input.address} #9A</h1><h4>$6,995</h4><p>Listed by Fatma Kara FIND Real Estate</p>`, {headers: {'content-type': 'text/html'}});
    }
    const body = JSON.parse(String(init?.body)); sdkCalls++;
    if (sdkCalls === 1) {
      assert.equal(body.tools, undefined);
      assert.equal(body.tool_choice, undefined);
      return response({...roster, listingUrl: candidate, agents: roster.agents.map(a => ({...a, attribution: {...a.attribution, url: candidate}}))});
    }
    assert.equal(body.tool_choice, 'required');
    return response(contacts);
  }});
  assert.equal(sdkCalls, 2);
  assert.equal(result.agents[0]?.name, 'Fatma Kara');
  assert.equal(result.agents[0]?.attributionStatus, 'source_cited');
  assert.equal(result.listingUrl, candidate);
});

test('generated candidate with a different unit or stale rent is not used as listing evidence', async () => {
  for (const [unit, price] of [['9', '$6,995'], ['9A', '$3,800']]) {
    const result = await enrichWithAgent(input, {apiKey: 'offline', budget: new EnrichmentBudget(0.02), fetch: async (target, init) => {
      if (String(target).startsWith('https://streeteasy.com/')) return new Response(`<h1>${input.address} #${unit}</h1><h4>${price}</h4><p>Listed by Wrong Broker</p>`, {headers: {'content-type': 'text/html'}});
      const body = JSON.parse(String(init?.body));
      assert.doesNotMatch(JSON.stringify(body.messages), /Wrong Broker/);
      assert.equal(body.tool_choice, 'required');
      return response(empty);
    }});
    assert.equal(result.listingUrl, null);
    assert.equal(result.agents.length, 0);
    assert.match(result.notes.join(' '), /heading does not match|price conflicts/);
  }
});

test('unverified names are excluded from contact lookup and cannot receive personal contacts', async () => {
  let sdkCalls = 0;
  const result = await enrichWithAgent(input, {apiKey: 'offline', budget: new EnrichmentBudget(0.05), fetch: async (target, init) => {
    if (String(target).startsWith('https://streeteasy.com/')) return new Response(null, {status: 403});
    const body = JSON.parse(String(init?.body)); sdkCalls++;
    if (sdkCalls <= 2) return response(roster); // No source text: not accepted.
    assert.match(JSON.stringify(body.messages), /Roster: \[\]/);
    assert.doesNotMatch(JSON.stringify(body.messages), /Fatma/);
    return response({agents: [{id: 'agent-1', email: {value: 'hello@findrealestate.com', evidence: {url, excerpt: 'hello@findrealestate.com', sourceType: 'company_page'}}, phone: null, notes: []}], officeContacts: [], notes: []}, 'hello@findrealestate.com');
  }});
  assert.equal(result.agents[0]?.attributionStatus, 'needs_review');
  assert.equal(result.agents[0]?.email, null);
});

test('office contact duplicates are removed from a supported broker personal fields', async () => {
  let sdkCalls = 0;
  const officeEmail = {value: 'hello@findrealestate.com', evidence: {url, excerpt: 'Email Us hello@findrealestate.com', sourceType: 'company_page'}};
  const result = await enrichWithAgent(input, {apiKey: 'offline', budget: new EnrichmentBudget(0.05), fetch: async target => {
    if (String(target).startsWith('https://streeteasy.com/')) return new Response(null, {status: 403});
    sdkCalls++;
    if (sdkCalls === 1) return response(roster, text);
    return response({agents: [{id: 'agent-1', email: officeEmail, phone: null, notes: []}],
      officeContacts: [{name: 'FIND office', email: officeEmail, phone: null}], notes: []}, `${text} Email Us hello@findrealestate.com`);
  }});
  assert.equal(result.agents[0]?.attributionStatus, 'source_cited');
  assert.equal(result.agents[0]?.email, null);
  assert.equal(result.officeContacts[0]?.email?.value, 'hello@findrealestate.com');
});

test('a namesake or stale contact at another brokerage cannot become a personal contact', async () => {
  let sdkCalls = 0;
  const otherUrl = 'https://example.com/unverified-profile';
  const result = await enrichWithAgent(input, {apiKey: 'offline', budget: new EnrichmentBudget(0.05), fetch: async target => {
    if (String(target).startsWith('https://streeteasy.com/')) return new Response(null, {status: 403});
    if (++sdkCalls === 1) return response(roster, text);
    const raw = await response({agents: [{id: 'agent-1', email: {value: 'unverified@example.com', evidence: {
      url: otherUrl, excerpt: 'Fatma Kara Other Brokerage unverified@example.com', sourceType: 'search_excerpt',
    }}, phone: null, notes: []}], officeContacts: [], notes: []}).json() as {choices: [{message: {annotations: unknown[]}}]};
    raw.choices[0].message.annotations = [{type: 'url_citation', url_citation: {url: otherUrl, content: 'Fatma Kara Other Brokerage unverified@example.com'}}];
    return Response.json(raw);
  }});
  assert.equal(result.agents[0]?.name, 'Fatma Kara');
  assert.equal(result.agents[0]?.attributionStatus, 'source_cited');
  assert.equal(result.agents[0]?.email, null);
  assert.match(result.agents[0]?.notes.join(' ') ?? '', /does not establish this agent at the listing brokerage/);
});
