import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalListingUrl, listingPageText, readListingPage} from './listingPage.ts';
import {parseEmailListing} from './service.ts';

const url = 'https://streeteasy.com/rental/123';
const html = (body: string) => new Response(body, {headers: {'content-type': 'text/html'}});

test('email input preserves a canonical listing URL and strips tracking data', () => {
  const input = parseEmailListing({address: '620 East 6th Street #9A', price: 6995, bedrooms: 3, bathrooms: 2,
    brokerage: 'FIND Real Estate', city: 'New York', listingUrl: `${url}?utm_source=private#tracking`});
  assert.equal(input.listingUrl, url);
  assert.equal(canonicalListingUrl('https://www.streeteasy.com/building/620-east-6-street-new_york/9a'),
    'https://streeteasy.com/building/620-east-6-street-new_york/9a');
});

test('only public listing paths are accepted, including on redirects', async () => {
  for (const value of ['http://streeteasy.com/rental/123', 'https://streeteasy.com.evil.test/rental/123',
    'https://user:pass@streeteasy.com/rental/123', 'https://127.0.0.1/rental/123', 'https://streeteasy.com/account',
    'https://links.streeteasy.com/rental/123']) assert.throws(() => canonicalListingUrl(value));
  let calls = 0;
  await assert.rejects(readListingPage(url, async () => {
    calls++; return new Response(null, {status: 302, headers: {location: 'http://127.0.0.1/private'}});
  }), /StreetEasy listing URL/);
  assert.equal(calls, 1);
});

test('bounded page excerpt retains heading and co-brokers after a long description', () => {
  // Synthetic fixture based on the user-visible layout; not a live scraped page.
  const text = listingPageText(`<h1>620 East 6th Street #9A</h1><p>${'Long description '.repeat(1000)}</p>
    <aside>Listed by <a href="/profile/fatma-kara">Fatma Kara</a> FIND Real Estate
    <a href="/profile/another-agent">Another Agent</a></aside><script>secret()</script><footer>Unrelated broker</footer>`);
  assert.match(text, /620 East 6th Street #9A/);
  assert.match(text, /Fatma Kara/);
  assert.match(text, /Another Agent/);
  assert.doesNotMatch(text, /secret|Unrelated broker/);
  assert.ok(text.length < 6100);
});

test('blocked, non-HTML and oversized pages fail explicitly', async () => {
  await assert.rejects(readListingPage(url, async () => new Response('blocked', {status: 403})), /HTTP 403/);
  await assert.rejects(readListingPage(url, async () => html('<h1>Verify you are human</h1>')), /blocked/);
  await assert.rejects(readListingPage(url, async () => Response.json({})), /not HTML/);
  await assert.rejects(readListingPage(url, async () => html('x'.repeat(2_000_001))), /2 MB/);
});

test('redirect to the exact StreetEasy unit returns the final citation URL', async () => {
  let calls = 0;
  const finalUrl = 'https://streeteasy.com/building/620-east-6-street-new_york/9a';
  const page = await readListingPage(url, async () => ++calls === 1
    ? new Response(null, {status: 302, headers: {location: finalUrl}})
    : html('<h1>620 East 6th Street #9A</h1><p>Listed by Fatma Kara</p>'));
  assert.equal(page.url, finalUrl);
  assert.match(page.content, /Fatma Kara/);
});
