import {load} from 'cheerio';

// Only accept public StreetEasy listing URLs, never email tracking URLs or arbitrary hosts.
export function canonicalListingUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('Invalid listingUrl');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !['streeteasy.com', 'www.streeteasy.com'].includes(url.hostname)
    || !/^\/(?:rental\/\d+(?:\/|$)|building\/[^/]+\/[^/]+\/?$)/.test(url.pathname)) {
    throw new Error('Expected a public HTTPS StreetEasy listing URL');
  }
  url.hostname = 'streeteasy.com'; url.search = ''; url.hash = '';
  return url.href;
}

export interface ListingPage {url: string; content: string}

export function listingPageText(html: string): string {
  const $ = load(html);
  $('script, style, nav, footer, noscript, svg').remove();
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href')!;
    if (/^(?:https:\/\/|\/agents\/|\/profile\/|mailto:|tel:)/.test(href)) $(el).text(`${$(el).text()} (${href})`);
  });
  const title = $('title').text().slice(0, 500);
  const headings = $('h1').text().slice(0, 500);
  $('br').replaceWith('\n');
  $('h1, h2, h3, p, div, section, aside, li, dt, dd, tr').append('\n');
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  // Keep the roster even when a long description precedes it. The heading is
  // included separately so the model can check address AND unit against it.
  const roster = /listed\s+by/i.exec(text);
  const excerpt = roster ? text.slice(Math.max(0, roster.index - 200), roster.index + 5000) : text.slice(0, 5000);
  return `${title}\n${headings}\n${excerpt}`.trim();
}

export async function readListingPage(value: string, fetcher: typeof fetch = fetch): Promise<ListingPage> {
  let url = canonicalListingUrl(value)!;
  const signal = AbortSignal.timeout(10_000);
  for (let hop = 0; hop <= 3; hop++) {
    const response = await fetcher(url, {redirect: 'manual', signal});
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('Listing redirect has no location');
      url = canonicalListingUrl(new URL(location, url).href)!;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Listing page unavailable (HTTP ${response.status})`);
    }
    if (!/text\/html/i.test(response.headers.get('content-type') ?? '')) {
      await response.body.cancel(); throw new Error('Listing page is not HTML');
    }
    const stream = response.body.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const {done, value: chunk} = await stream.read(); if (done) break;
      bytes += chunk.byteLength;
      if (bytes > 2_000_000) {await stream.cancel(); throw new Error('Listing page exceeds 2 MB');}
      chunks.push(chunk);
    }
    const content = listingPageText(Buffer.concat(chunks).toString('utf8'));
    if (!content || /(?:verify (?:that )?you are human|press (?:&|and) hold|access (?:to this page has been )?denied|captcha)/i.test(content)) {
      throw new Error('Listing page blocked or empty');
    }
    return {url, content};
  }
  throw new Error('Listing redirect limit reached');
}
