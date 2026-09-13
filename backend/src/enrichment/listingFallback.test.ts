import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {BrokerEnrichment, parseEmailListing} from './service.ts';
import {processListingAlert} from '../pipeline/alert.ts';

const fixture = await readFile(new URL('../../fixtures/enrichment/620-east-6th-9a.html', import.meta.url), 'utf8');
const input = parseEmailListing({address: '620 East 6th Street', unit: '9A', price: 6995, bedrooms: 3, bathrooms: 2,
  brokerage: 'FIND Real Estate', city: 'New York', listingUrl: 'https://streeteasy.com/rental/123'});

async function setup(t: test.TestContext, html = fixture) {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-listing-'));
  t.after(() => rm(cacheDir, {recursive: true, force: true}));
  const urls: string[] = [];
  const service = new BrokerEnrichment({cacheDir, fetch: async target => {
    if (new URL(String(target)).hostname !== 'streeteasy.com') throw new Error('Provider unavailable');
    urls.push(String(target));
    // A blocked supplied rental URL can recover through one derived unit URL.
    return String(target).includes('/rental/') ? new Response('', {status: 403})
      : new Response(html, {headers: {'content-type': 'text/html'}});
  }});
  return {service, urls};
}

test('worker enrichment discovers Fatma from exact listing evidence without provider keys or seeded names', async t => {
  const {service, urls} = await setup(t);
  const result = await service.run(input);
  assert.deepEqual(result.agents.map(agent => agent.name), ['Fatma Kara']);
  assert.equal(result.agents[0]?.profileUrl, 'https://streeteasy.com/profile/942807');
  assert.match(result.agents[0]!.attributionEvidence, /620 East 6th Street #9A.*FIND Real Estate/);
  assert.equal(result.agents[0]?.email, null);
  assert.equal(result.outreachReady, false);
  assert.equal(result.execution, 'partial');
  assert.equal(urls.length, 2);
  assert.equal(result.listingUrl, 'https://streeteasy.com/building/620-east-6-street-new_york/9a');
});

test('name-only discovery survives alert persistence without authorizing email', async t => {
  const {service} = await setup(t);
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

test('wrong unit, rent, brokerage, or a recommended profile cannot become a listing broker', async t => {
  for (const html of [fixture.replace('#9A', '#9B'), fixture.replace('$6,995', '$6,000'),
    fixture.replace('FIND Real Estate', 'Other Realty'), fixture.replace('Listed by', 'Recommended agents')]) {
    const {service} = await setup(t, html);
    assert.deepEqual((await service.run(input)).agents, []);
  }
});

test('all co-listing brokers are retained without including profiles outside Listed by', async t => {
  const second = fixture.slice(fixture.indexOf('<div id="382609"'), fixture.lastIndexOf('</div></div>'))
    .replace('Fatma Kara', 'Another Broker').replace('942807', '999999');
  const html = fixture.replace('</div></div></div></div>\n', `</div></div>${second}</div></div>\n`)
    + '<aside><a href="https://streeteasy.com/profile/888888">Recommended Person</a><p>Licensed Real Estate Broker</p><p>FIND Real Estate</p></aside>';
  const {service} = await setup(t, html);
  assert.deepEqual((await service.run(input)).agents.map(agent => agent.name), ['Fatma Kara', 'Another Broker']);
});
