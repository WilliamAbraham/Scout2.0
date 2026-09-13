import assert from 'node:assert/strict';
import test from 'node:test';
import type {AgentEnrichmentResult, ResearchedAgent} from '../enrichment/agent.ts';
import {agentResultForPipeline} from './agentEnrichment.ts';
import {classifyEnrichment, summarizeEnrichment} from './alert.ts';
import {contactSnapshotFromEnrichment} from './contacts.ts';

const url = 'https://streeteasy.com/rental/123';
const evidence = {url, excerpt: '10 Test Street #1 Listed by Test Broker', sourceType: 'listing_page' as const};
const person = (overrides: Partial<ResearchedAgent> = {}): ResearchedAgent => ({
  id: 'agent-1', name: 'Test Broker', brokerage: 'Test Realty', listedAddress: '10 Test Street', listedUnit: '1',
  attribution: evidence, attributionStatus: 'source_cited', email: null, phone: null, notes: [], ...overrides,
});
const result = (overrides: Partial<AgentEnrichmentResult> = {}): AgentEnrichmentResult => ({
  input: {address: '10 Test Street', unit: '1', price: 4000, bedrooms: 2, bathrooms: 1, brokerage: 'Test Realty', brokerageOfficeAddress: '', city: 'New York'},
  model: 'openai/gpt-4.1-mini', searchEngine: 'parallel', inputMode: 'listing_facts', checkedAt: '2026-09-13T03:00:00Z',
  execution: 'completed', listingStatus: 'named_brokers', listingUrl: url, agents: [person()],
  officeContacts: [], directContacts: [], cost: {reportedUsd: 0.004, cacheHit: false, budgetLimitUsd: 0.25},
  notes: [], stages: [], evidencePolicy: 'model_reported_with_provider_citations; human_review_before_outreach', ...overrides,
});

test('agent names, evidence and cost survive without an email or outreach snapshot', () => {
  const mapped = agentResultForPipeline(result());
  assert.equal(mapped.agents[0]?.name, 'Test Broker');
  assert.equal(mapped.agents[0]?.attributionSourceUrl, url);
  assert.equal(mapped.outreachReady, false);
  assert.equal(contactSnapshotFromEnrichment(mapped), null);
  assert.equal(classifyEnrichment(mapped)?.kind, 'no_contact');
  assert.deepEqual(summarizeEnrichment(mapped).research, {engine: 'enrichWithAgent', model: 'openai/gpt-4.1-mini', listingStatus: 'named_brokers', reportedUsd: 0.004, cacheHit: false});
});

test('review or screenshot candidates never become recipients, even if they carry email', () => {
  for (const attributionStatus of ['needs_review', 'provided_image'] as const) {
    const mapped = agentResultForPipeline(result({agents: [person({attributionStatus, email: {value: 'broker@example.com', evidence}})]}));
    assert.deepEqual(mapped.agents, []);
    assert.equal(mapped.candidateAgents[0]?.email, null);
    assert.equal(contactSnapshotFromEnrichment(mapped), null);
  }
});

test('only a completed, fully reachable supported roster is ready', () => {
  const reachable = person({email: {value: 'broker@example.com', evidence}});
  const ready = agentResultForPipeline(result({agents: [reachable]}));
  assert.equal(classifyEnrichment(ready), null);
  assert.equal(contactSnapshotFromEnrichment(ready)?.contacts[0]?.email, 'broker@example.com');
  for (const patch of [{execution: 'partial' as const}, {agents: [reachable, person({id: 'agent-2'})]},
    {agents: [reachable, person({id: 'agent-2', attributionStatus: 'needs_review'})]}]) {
    assert.equal(agentResultForPipeline(result({agents: [reachable], ...patch})).outreachReady, false);
  }
});

test('exact listing teams can supply a snapshot; office and unit-conflict routes cannot', () => {
  for (const relationship of ['exact_listing', 'brokerage', 'unit_conflict'] as const) {
    const route = {kind: 'leasing_team' as const, name: 'Leasing', email: 'leasing@example.com', phone: '212-555-0123',
      relationship, sourceUrls: [url], evidence: 'Leasing contact', fetchedAt: '2026-09-12T12:00:00Z'};
    const mapped = agentResultForPipeline(result({agents: [], listingStatus: 'team_only', directContacts: [route],
      officeContacts: [{name: route.name, email: {value: route.email, evidence}, phone: {value: route.phone, evidence}}]}));
    assert.deepEqual(mapped.agents, []);
    assert.deepEqual(mapped.contactRoutes, [route]);
    assert.equal(mapped.outreachReady, relationship === 'exact_listing');
    assert.equal(contactSnapshotFromEnrichment(mapped)?.tier ?? null, relationship === 'exact_listing' ? 'building_leasing' : null);
  }
});

test('budget exhaustion stays retryable and retains recovered names', () => {
  const mapped = agentResultForPipeline(result({execution: 'partial', notes: ['Contact research failed: Budget stopped request: insufficient remaining budget']}));
  assert.equal(mapped.agents[0]?.name, 'Test Broker');
  assert.equal(classifyEnrichment(mapped)?.kind, 'budget_exhausted');
});

test('a brokerage name or generic Listing Agent label is not a named listing agent', () => {
  for (const name of ['Test Realty', 'Test Realty LLC', 'Listing Agent', 'Unknown']) {
    const mapped = agentResultForPipeline(result({agents: [person({name, email: {value: 'office@example.com', evidence}})]}));
    assert.deepEqual(mapped.agents, []);
    assert.equal(mapped.outreachReady, false);
    assert.equal(contactSnapshotFromEnrichment(mapped), null);
    assert.equal(mapped.research?.listingStatus, name.startsWith('Test Realty') ? 'team_only' : 'unresolved');
  }
});

test('an exact-unit citation from a different brokerage cannot supply outreach recipients', () => {
  const mapped = agentResultForPipeline(result({agents: [person({brokerage: 'Other Realty', email: {value: 'wrong@example.com', evidence}})]}));
  assert.deepEqual(mapped.agents, []);
  assert.equal(mapped.candidateAgents[0]?.name, 'Test Broker');
  assert.equal(mapped.candidateAgents[0]?.email, null);
  assert.equal(mapped.outreachReady, false);
  assert.match(mapped.issues.join(' '), /Brokerage conflict/);
});
