import assert from 'node:assert/strict';
import test from 'node:test';
import {indexedHitSupportsAgent, normalizeAddress, normalizeUnit, parseExtraction, supportedAgents, verifyListing} from './service.ts';
import {emailCandidates} from './agentContacts.ts';
import type {Agent, EmailListing, ExtractedListing} from './service.ts';

const input: EmailListing = {address: '448 West 19th Street', unit: 'R4', price: 8500, bedrooms: 3, bathrooms: 2,
  brokerage: 'REAL New York', brokerageOfficeAddress: '29 West 30th Street, New York, NY', city: 'New York'};
const agent = (name: string): Agent => ({name, profileUrl: `https://broker.example/agents/${name.toLowerCase()}`,
  email: `${name.toLowerCase()}@broker.example`, phone: '(212) 555-0101', role: null,
  attributionEvidence: `${name} — Listing Agent`, contactEvidence: `${name} — Listing Agent\nEmail: ${name.toLowerCase()}@broker.example`});
const listing = (): ExtractedListing => ({address: input.address, unit: 'R4', price: 8500, bedrooms: 3, bathrooms: 2,
  brokerage: input.brokerage, status: 'For rent', listingEvidence: '448 West 19th Street #R4', contradictions: [],
  agents: [agent('Ava'), agent('Ben')]});
const source = `# 448 West 19th Street #R4
For rent — $8,500 — 3 beds — 2 baths
Listed by REAL New York
## Listing Agents
Ava — Listing Agent
Email: ava@broker.example
Phone: (212) 555-0101
Ben — Listing Agent
Email: ben@broker.example
Phone: (212) 555-0101
`;

test('address abbreviations normalize but unit character order remains exact', () => {
  assert.equal(normalizeAddress(input.address), normalizeAddress('448 W. 19th St.'));
  assert.equal(normalizeUnit('Apartment R4'), normalizeUnit('#R4'));
  assert.notEqual(normalizeUnit('R4'), normalizeUnit('4R'));
});

test('index matches require full address, exact unit and an agent name in the description', async t => {
  const hit = {url: 'https://listing.example/r4', title: '448 West 19th Street #R4', description: 'Listed by Ava'};
  assert.equal(indexedHitSupportsAgent(input, hit, 'Ava'), true);
  for (const bad of [
    {...hit, title: '448 West 19th Street #4R'},
    {...hit, title: '1448 West 19th Street #R4'},
    {...hit, title: '448 West 19th Street #R40'},
    {...hit, title: `${hit.title} Ava`, description: 'Apartment available'},
    {...hit, description: 'Listed by Avani'},
  ]) await t.test(JSON.stringify(bad), () => assert.equal(indexedHitSupportsAgent(input, bad, 'Ava'), false));
});

test('preserves all sourced agents and never invents their role', () => {
  const data = parseExtraction(listing());
  assert.deepEqual(verifyListing(input, data, source), []);
  const result = supportedAgents(data, source);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.agents.map(person => person.email), ['ava@broker.example', 'ben@broker.example']);
  assert.ok(result.agents.every(person => person.role === null));
});

test('a price change alone does not reject the same apartment', () => {
  assert.deepEqual(verifyListing(input, {...listing(), price: 8750}, source.replace('$8,500', '$8,750')), []);
});

test('missing or contradictory identity cannot be filled from the email', async t => {
  const cases: Array<Partial<ExtractedListing>> = [
    {address: '999 East 20th Street'}, {unit: null}, {unit: '4R'}, {brokerage: null}, {bedrooms: 2},
    {listingEvidence: ''}, {listingEvidence: '448 West 19th Street'}, {listingEvidence: 'For rent'},
    {listingEvidence: '448 West 19th Street #R40'}, {contradictions: ['Heading R4 conflicts with description 4R']},
  ];
  for (const changes of cases) await t.test(JSON.stringify(changes), () => {
    assert.ok(verifyListing(input, {...listing(), ...changes}, source).length > 0);
  });
});

test('source text must contain the claimed identity and rental status', () => {
  assert.ok(verifyListing(input, listing(), source.replace('#R4', '#4R')).length > 0);
  assert.ok(verifyListing(input, listing(), source.replace('For rent', 'Apartment details')).length > 0);
});

test('unknown and inactive rental statuses block automatic attribution', async t => {
  for (const status of [null, '', 'Unknown', 'Rented', 'Unavailable', 'Off market', 'No longer available', 'Leased']) {
    await t.test(status || 'missing', () => assert.ok(verifyListing(input, {...listing(), status}, source).length > 0));
  }
});

test('deduplicates repeated profiles and names while preserving co-agents', () => {
  const data = listing();
  data.agents = [data.agents[0]!, {...data.agents[0]!}, data.agents[1]!];
  assert.equal(supportedAgents(data, source).agents.length, 2);
  data.agents = data.agents.map(person => ({...person, profileUrl: null}));
  data.agents[1]!.name = 'AVA';
  assert.equal(supportedAgents(data, source).agents.length, 2);
});

test('attribution must contain the same agent name and exist on the source', () => {
  for (const evidence of ['Ava is the exclusive representative', 'Ben — Listing Agent', '']) {
    const data = listing(); data.agents[0]!.attributionEvidence = evidence;
    assert.deepEqual(supportedAgents(data, source).agents.map(person => person.name), ['Ben']);
  }
});

test('unsupported contacts are removed without mutating the extraction or dropping a co-agent', async t => {
  const cases: Array<Partial<Agent>> = [
    {email: 'invented@broker.example'}, {email: 'ava at broker.example'},
    {contactEvidence: ''}, {contactEvidence: 'Email: ava@broker.example'},
    {contactEvidence: 'Ava has a verified email address'},
  ];
  for (const changes of cases) await t.test(JSON.stringify(changes), () => {
    const data = listing(); Object.assign(data.agents[0]!, changes);
    const before = structuredClone(data), result = supportedAgents(data, source);
    assert.equal(result.agents[0]!.email, null);
    assert.equal(result.agents[1]!.email, 'ben@broker.example');
    assert.ok(result.issues.length > 0);
    assert.deepEqual(data, before);
  });
});

test('missing contacts stay missing and unsupported phone does not discard valid email', () => {
  const data = listing(); Object.assign(data.agents[0]!, {email: null, phone: null, contactEvidence: ''});
  assert.equal(supportedAgents(data, source).agents[0]!.email, null);
  const wrongPhone = listing(); wrongPhone.agents[0]!.phone = '(646) 555-0199';
  const result = supportedAgents(wrongPhone, source);
  assert.equal(result.agents[0]!.phone, null);
  assert.equal(result.agents[0]!.email, 'ava@broker.example');
});

test('malformed extracted data is rejected before verification', async t => {
  const invalid = [null, {...listing(), unit: undefined}, {...listing(), price: '$8,500'},
    {...listing(), price: Number.NaN}, {...listing(), bedrooms: -1}, {...listing(), contradictions: {}},
    {...listing(), agents: [{...agent('Ava'), name: ' '}]},
    {...listing(), agents: [{...agent('Ava'), contactEvidence: undefined}]},
    {...listing(), agents: [{...agent('Ava'), email: ['ava@broker.example']}]},
  ];
  for (const [index, value] of invalid.entries()) await t.test(String(index), () => assert.throws(() => parseExtraction(value)));
});

test('a roster phone glued onto the address is stripped, and only if the address is still the agent\'s', () => {
  // Douglas Elliman's roster prints the office number immediately above the
  // address, and the extraction runs them together.
  const [repaired] = emailCandidates('212.598.3199matthew.brautigam@elliman.com', 'Matthew Brautigam', 'Douglas Elliman');
  assert.equal(repaired?.value, 'matthew.brautigam@elliman.com');

  // The same page also carries Matthew Abril. Sharing a first name is not
  // being the same person, so his address is not a candidate here.
  assert.deepEqual(emailCandidates('212.598.3199matthew.abril@elliman.com', 'Matthew Brautigam', 'Douglas Elliman')
    .filter(candidate => candidate.nameMatch), []);
});

test('an unseparated local part is still read as the agent\'s own address', () => {
  for (const [text, name] of [['lancelot@serhant.com', 'Lancelot Watson-Taffe'],
    ['jasont@serhant.com', 'Jason Tsalkas'], ['keyan.sanai@elliman.com', 'Keyan Sanai']] as const) {
    const [candidate] = emailCandidates(text, name, 'SERHANT.');
    assert.equal(candidate?.nameMatch, true, text);
  }
});
