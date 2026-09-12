import {test} from 'node:test';
import assert from 'node:assert/strict';
import {enrichWithAgent, collectCitations} from './agent.ts';
import type {AgentOptions, AgentEnrichmentResult} from './agent.ts';
import type {EmailListing} from './service.ts';
import {EnrichmentBudget} from './spend.ts';

const input: EmailListing = {address: '10 Test Street', unit: '6-5', price: 5000, bedrooms: 2, bathrooms: 1,
  brokerage: 'Example Realty', brokerageOfficeAddress: '', city: 'New York'};
const url = 'https://example.com/listings/10-test/6-5';
const attribution = {url, excerpt: '10 Test Street #6-5. Listed by Alice Broker and Bob Agent.', sourceType: 'listing_page'};
const agents = ['Alice Broker', 'Bob Agent'].map(name => ({name, brokerage: input.brokerage, listedAddress: input.address, listedUnit: input.unit, attribution}));
const discovery = {agents, listingUrl: url, listingStatus: 'named_brokers', notes: []};
const contact = {value: 'alice@example.com', evidence: {url, excerpt: 'Alice Broker: alice@example.com', sourceType: 'broker_profile'}};
const contacts = {agents: [{id: 'agent-1', email: contact, phone: null, notes: []}], officeContacts: [], notes: []};
function response(data: unknown, citations = [url], finishReason = 'stop'): Response {
  return Response.json({id: 'mock-response', object: 'chat.completion', created: 1, model: 'mock',
    choices: [{index: 0, finish_reason: finishReason, message: {role: 'assistant', content: JSON.stringify(data),
      annotations: citations.map(url => ({type: 'url_citation', url_citation: {url, title: 'Listing'}}))}}],
    usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.001}});
}
function mock(responses: Response[], inspect?: (body: Record<string, unknown>, call: number) => void): AgentOptions {
  let calls = 0;
  return {apiKey: 'test-only', budget: new EnrichmentBudget(0.1), fetch: async (request, init) => {
    assert.equal(String(request), 'https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    inspect?.(body, calls);
    return responses[calls++] ?? Response.json({error: {message: 'Unexpected extra request'}}, {status: 500});
  }};
}

test('SDK sends OpenRouter server tools; discovery input has no seeded names; missing contact does not drop co-agent', async () => {
  const checkpoints: AgentEnrichmentResult[] = [];
  const options = mock([response(discovery), response(contacts)], (body, call) => {
    assert.equal(body.model, 'openai/gpt-4.1-mini');
    assert.equal(body.max_tool_calls, 2);
    assert.match(JSON.stringify(body.tools), /openrouter:web_search/);
    assert.doesNotMatch(JSON.stringify(body.tools), /openrouter:web_fetch/);
    if (call === 0) assert.doesNotMatch(JSON.stringify(body.messages), /Alice|Bob/);
    else assert.equal(checkpoints.at(-1)?.agents.length, 2);
  });
  options.save = async (_stage, result) => {checkpoints.push(structuredClone(result));};
  const result = await enrichWithAgent(input, options);
  assert.equal(result.execution, 'completed');
  assert.deepEqual(result.agents.map(a => a.name), ['Alice Broker', 'Bob Agent']);
  assert.equal(result.agents[0]?.email?.value, 'alice@example.com');
  assert.equal(result.agents[1]?.email, null);
});

test('HTTP contact failure preserves discovered roster and records partial execution', async () => {
  const result = await enrichWithAgent(input, mock([response(discovery), Response.json({error: {message: 'rate limited'}}, {status: 429})]));
  assert.equal(result.execution, 'partial');
  assert.equal(result.agents.length, 2);
  assert.match(result.notes.join(' '), /HTTP 429/);
});

test('malformed contact output preserves discovered roster', async () => {
  const result = await enrichWithAgent(input, mock([response(discovery), response({agents: 'bad'})]));
  assert.equal(result.execution, 'partial');
  assert.equal(result.agents.length, 2);
});

test('unrecognized agent IDs cannot add a person and uncited contacts are dropped', async () => {
  const result = await enrichWithAgent(input, mock([response(discovery), response({...contacts,
    agents: [...contacts.agents, {id: 'invented', email: contact, phone: null, notes: []}]}, [])]));
  assert.equal(result.agents.length, 2);
  assert.equal(result.agents[0]?.email, null);
  assert.match(result.notes.join(' '), /unknown contact-stage ID/);
});

test('reversed unit is a review candidate; attribution without provider citation also requires review', async () => {
  const result = await enrichWithAgent(input, mock([response({...discovery, agents: [
    {...agents[0], listedUnit: '5-6'}, agents[1],
  ]}, []), response({agents: [], officeContacts: [], notes: []})]));
  assert.ok(result.agents.every(a => a.attributionStatus === 'needs_review'));
  assert.match(result.agents[0]!.notes.join(' '), /unit conflict/);
});

test('incomplete discovery is an error and cannot claim an empty successful roster', async () => {
  const result = await enrichWithAgent(input, mock([response(discovery, [], 'length')]));
  assert.equal(result.execution, 'error');
  assert.equal(result.agents.length, 0);
});

test('owner-listed discovery does not invent people or promote office contact to agent', async () => {
  const result = await enrichWithAgent({...input, brokerage: 'Owner'}, mock([
    response({...discovery, agents: [], listingStatus: 'owner_listed'}),
    response({agents: [], officeContacts: [{name: 'Leasing office', email: contact, phone: null}], notes: []}),
  ]));
  assert.equal(result.agents.length, 0);
  assert.equal(result.listingStatus, 'owner_listed');
  assert.equal(result.officeContacts.length, 1);
});

test('contact with a cited URL but no supporting value in excerpt is rejected', async () => {
  const badContact = {...contact, evidence: {...contact.evidence, excerpt: 'Alice works at Example Realty.'}};
  const result = await enrichWithAgent(input, mock([response(discovery), response({...contacts,
    agents: [{id: 'agent-1', email: badContact, phone: null, notes: []}],
  })]));
  assert.equal(result.agents[0]?.email, null);
  assert.equal(result.agents.length, 2);
});

test('provider excerpt contradicting model contact evidence is rejected', async () => {
  const raw = await response(contacts).json() as {choices: [{message: {annotations: [{url_citation: {content: string}}]}}]};
  raw.choices[0].message.annotations[0].url_citation.content = 'Alice Broker: different@example.com';
  const result = await enrichWithAgent(input, mock([response(discovery), Response.json(raw)]));
  assert.equal(result.agents[0]?.email, null);
});

test('later masked page must not erase an earlier cited contact excerpt', () => {
  const annotations = ['Alice: alice@example.com', 'Alice: [email protected]', ''].map(content => ({
    type: 'url_citation', url_citation: {url, content},
  }));
  const citations = collectCitations({annotations});
  assert.equal(citations.length, 1);
  assert.match(citations[0]!.content, /alice@example.com/);
  assert.match(citations[0]!.content, /email protected/);
});

test('masked model email excerpt can be repaired from actual provider evidence', async () => {
  const data = {...contacts, agents: [{id: 'agent-1', email: {...contact, evidence: {...contact.evidence, excerpt: 'Alice: [email protected]'}}, phone: null, notes: []}]};
  const raw = await response(data).json() as {choices: [{message: {annotations: [{url_citation: {content: string}}]}}]};
  raw.choices[0].message.annotations[0].url_citation.content = 'Alice Broker: alice@example.com';
  const result = await enrichWithAgent(input, mock([response(discovery), Response.json(raw)]));
  assert.equal(result.agents[0]?.email?.value, 'alice@example.com');
  assert.match(result.agents[0]!.email!.evidence.excerpt, /alice@example.com/);
});

test('optional screenshot preserves both visible brokers and is sent only during discovery', async () => {
  const sourceId = 'attachment://listing-screenshot';
  const data = {...discovery, agents: agents.map(a => ({...a, attribution: {...attribution, url: sourceId, sourceType: 'provided_image'}}))};
  const options = mock([response(data, []), response(contacts)], (body, call) => {
    const messages = JSON.stringify(body.messages);
    if (call === 0) assert.match(messages, /data:image\/png;base64/);
    else assert.doesNotMatch(messages, /data:image\/png;base64/);
  });
  options.listingImage = {sourceId, dataUrl: 'data:image/png;base64,dGVzdA=='};
  const result = await enrichWithAgent(input, options);
  assert.equal(result.inputMode, 'listing_facts_and_image');
  assert.deepEqual(result.agents.map(a => a.attributionStatus), ['provided_image', 'provided_image']);
});

test('model cannot claim screenshot evidence when no image was supplied', async () => {
  const data = {...discovery, agents: agents.map(a => ({...a, attribution: {...attribution, url: 'attachment://listing-screenshot', sourceType: 'provided_image'}}))};
  const result = await enrichWithAgent(input, mock([response(data, []), response(contacts)]));
  assert.ok(result.agents.every(a => a.attributionStatus === 'needs_review'));
});
