import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseEmailListing} from './service.ts';
import {EnrichmentBudget} from './spend.ts';
import {businessPhone, parseCanvasListing, parseVcard, permittedDirectUrl, resolveDirect} from './sources.ts';
import {enrichForPipeline} from '../pipeline/agentEnrichment.ts';
import type {EmailListing} from './service.ts';

function unpaid(input: EmailListing, options: {cacheDir: string; fetch?: typeof fetch}) {
  return enrichForPipeline(input, {
    apiKey: 'unused', budget: new EnrichmentBudget(0), cacheDir: options.cacheDir,
    ...(options.fetch ? {fetch: options.fetch} : {}),
  });
}

const input = parseEmailListing({address: '503 West 22nd Street #5W', price: 8800, bedrooms: 3, bathrooms: 2,
  brokerage: 'Canvas Property Group', city: 'New York'});
const fixture = JSON.parse(await readFile(new URL('../../fixtures/enrichment/direct/canvas-listing.json', import.meta.url), 'utf8'));
test('office address is optional, but malformed provided values are rejected', () => {
  assert.equal(input.brokerageOfficeAddress, '');
  assert.throws(() => parseEmailListing({...input, brokerageOfficeAddress: 123}));
});
test('Canvas public feed establishes exact listing team email and rejects its placeholder phone', () => {
  const parsed = parseCanvasListing(fixture, input, ['https://canvaspg.com/'], '2026-09-12T00:00:00Z');
  assert.equal(parsed.routes[0]?.email, 'info@canvaspg.com');
  assert.equal(parsed.routes[0]?.phone, null);
  assert.equal(parsed.routes[0]?.kind, 'leasing_team');
  assert.equal(parsed.routes[0]?.relationship, 'exact_listing');
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.warnings.length, 1);
});
test('Canvas mismatched street, unit, city, price, and room counts never produce an attributed route', () => {
  for (const patch of [{address: '505 West 22nd Street'}, {unit: 'W5'}, {price: 8801}, {bedrooms: 2}, {bathrooms: 1}, {city: 'Boston'}]) {
    assert.equal(parseCanvasListing(fixture, {...input, ...patch}, [], '').routes.length, 0);
  }
  const wrongBroker = structuredClone(fixture); wrongBroker.Details.Description = 'Other Realty';
  assert.equal(parseCanvasListing(wrongBroker, input, [], '').routes.length, 0);
});
test('missing agent data does not get filled from input or company footer', () => {
  const missing = structuredClone(fixture); missing.Agents = [{}];
  assert.equal(parseCanvasListing(missing, input, [], '').routes.length, 0);
  assert.throws(() => parseCanvasListing({}, input, [], ''));
});
test('phone validation rejects placeholders and preserves syntactically valid business phones', () => {
  for (const bad of ['123456789', '0000000000', '1111111111', '1234567890', 'undefined']) assert.equal(businessPhone(bad), null);
  assert.equal(businessPhone('+1 (212) 228-9300'), '212-228-9300');
});
test('vCard handles folding and never substitutes fax or home number for work voice', () => {
  assert.deepEqual(parseVcard('BEGIN:VCARD\nFN;CHARSET=utf-8:Centennial Properties\nEMAIL;INTERNET:apts@\n centpropny.com\nTEL;HOME;VOICE:212-555-0100\nTEL;WORK;FAX:212-555-0101\nTEL;WORK;VOICE:212-228-9300\nEND:VCARD'),
    {name: 'Centennial Properties', email: 'apts@centpropny.com', phone: '212-228-9300'});
});
test('direct readers allow only reviewed company and feed origins', () => {
  for (const url of ['https://localhost/', 'https://127.0.0.1/', 'https://canvaspg.com.evil.com/', 'https://user@canvaspg.com/', 'https://canvaspg.com:444/', 'http://canvaspg.com/', 'https://mc.wlep1.com/private']) assert.equal(permittedDirectUrl(url), false);
  assert.equal(permittedDirectUrl('https://mc.wlep1.com/api/ajax/canvas/property'), true);
});
test('owner listing is classified without any search or invented broker', async () => {
  const result = await unpaid({...input, brokerage: 'Owner'}, {cacheDir: '/unused', fetch: async () => {throw new Error('Unexpected request');}});
  assert.equal(result.resolution, 'owner_listed'); assert.equal(result.outreachReady, false);
  assert.deepEqual(result.agents, []); assert.deepEqual(result.attempts, []);
});
test('an external redirect is blocked before the destination is requested', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-direct-')); t.after(() => rm(cacheDir, {recursive: true, force: true}));
  let calls = 0;
  const result = await resolveDirect(input, {cacheDir, fetch: async () => {calls++; return new Response(null, {status: 302, headers: {location: 'https://127.0.0.1/'}});}});
  assert.equal(calls, 1); assert.match(result!.issues.join(' '), /outside verified registry/);
});
test('Centennial unit reversal remains a review contact, with primary vCard evidence', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-direct-')); t.after(() => rm(cacheDir, {recursive: true, force: true}));
  const listing = {...input, address: '248 Mott Street', unit: '6-5', price: 9495, brokerage: 'Centennial Properties NY'};
  const pages = [
    '<li class="property-card"><h3><a href="/detail">248 Mott St., #5-6</a></h3><span class="mx-available">Available now</span><div class="price"><span>$9,495</span><div class="bedrooms">3 BR | 2 BT</div></div></li>',
    '<h1>248 Mott St., #5-6</h1><p>$9,495 3 Beds 2 Baths</p><div class="agent"><div class="name"><a href="/agent">Centennial Properties</a></div><div class="phone">212-228-9300</div></div><input name="agentEmail" value="apts@centpropny.com">',
    '<a href="/contact.vcf">Download Contact</a>',
    'FN:Centennial Properties\nEMAIL:apts@centpropny.com\nTEL;WORK;VOICE:212-228-9300',
  ]; let calls = 0;
  const result = await unpaid(listing, {cacheDir, fetch: async () => new Response(pages[calls++]!)});
  assert.equal(result.contactRoutes[0]?.email, 'apts@centpropny.com');
  assert.equal(result.contactRoutes[0]?.relationship, 'unit_conflict');
  assert.equal(result.outreachReady, false); assert.equal(result.agents.length, 0);
  assert.match(result.issues.join(' '), /No automatic unit reversal/);
});

test('Centennial retains its published office phone when #3 is absent from the catalog', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-direct-')); t.after(() => rm(cacheDir, {recursive: true, force: true}));
  const listing = {...input, address: '248 Mott Street', unit: '3', price: 7995, bathrooms: 1, brokerage: 'Centennial Properties NY'};
  const result = await unpaid(listing, {cacheDir, fetch: async () => new Response(
    '<footer>Centennial Properties NY • 424 West 51st Street • (212) 228-9300 • [email protected]</footer>',
  )});
  assert.equal(result.resolution, 'brokerage_only');
  assert.equal(result.outreachReady, false);
  assert.equal(result.contactRoutes[0]?.phone, '212-228-9300');
  assert.equal(result.contactRoutes[0]?.email, null);
  assert.equal(result.contactRoutes[0]?.relationship, 'brokerage');
  assert.deepEqual(result.contactRoutes[0]?.sourceUrls, ['https://centpropny.com/index.cfm?page=properties']);
});
test('Canvas workflow discovers changing property IDs from catalogue links and caches the evidence chain', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'scout-direct-')); t.after(() => rm(cacheDir, {recursive: true, force: true}));
  const pages = new Map([
    ['https://canvaspg.com/luxury-rentals/', '<script src="/js/canvas/alllisting.js"></script>'],
    ['https://canvaspg.com/js/canvas/alllisting.js', "fetch('https://mc.wlep1.com/api/ajax/canvas/property')"],
    ['https://mc.wlep1.com/api/ajax/canvas/property', JSON.stringify({html: '<li class="unit"><div class="unit-address">503 West 22nd Street</div><a class="unit-link" href="/luxury-rentals-listing-page/?propertyid=999"></a></li>'})],
    ['https://canvaspg.com/luxury-rentals-listing-page/?propertyid=999', '<script src="/js/canvas/singlelisting.js"></script>'],
    ['https://canvaspg.com/js/canvas/singlelisting.js', "fetch('https://mc.wlep1.com/api/ajax/canvas/single?propertyid=' + id)"],
    ['https://mc.wlep1.com/api/ajax/canvas/single?propertyid=999', JSON.stringify(fixture)],
  ]); let calls = 0;
  const fetch: typeof globalThis.fetch = async url => {calls++; assert.ok(pages.has(String(url))); return new Response(pages.get(String(url))!);};
  const first = await unpaid(input, {cacheDir, fetch});
  assert.equal(first.resolution, 'leasing_team_verified'); assert.equal(first.outreachReady, true);
  assert.equal(first.agents.length, 0); assert.equal(first.contactRoutes[0]?.sourceUrls.length, 6);
  const second = await unpaid(input, {cacheDir, fetch}); assert.equal(calls, 6); assert.equal(second.research?.cacheHit, true);
});
