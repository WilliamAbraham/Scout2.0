export interface Listing {
  address: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  listingUrl: string;
  rentalId: string;
  brokerage: string;
}

// Stop at the rental redirect: fetching the listing page itself is unnecessary.
export async function resolveRentalUrl(link: string): Promise<{rentalId: string; listingUrl: string}> {
  let url = new URL(link);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (url.protocol !== 'https:' || !['links.streeteasy.com', 'streeteasy.com', 'www.streeteasy.com'].includes(url.hostname)) {
      throw new Error('Expected an HTTPS StreetEasy listing link.');
    }
    const rentalId = url.hostname !== 'links.streeteasy.com'
      ? /^\/rental\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1]
      : undefined;
    if (rentalId) return {rentalId, listingUrl: `https://streeteasy.com/rental/${rentalId}`};
    if (redirects === 5) break;

    const response = await fetch(url, {redirect: 'manual', signal: AbortSignal.timeout(15_000)});
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      throw new Error(`StreetEasy link did not redirect to a rental (HTTP ${response.status}).`);
    }
    url = new URL(location, url);
  }
  throw new Error('StreetEasy link exceeded 5 redirects without reaching a rental.');
}

/**
 * Every valid card in an alert, in order. The corpus importer's entry point;
 * the worker uses `parseAlert` from `./alert.ts`, which also reports the
 * layout and the cards that failed validation.
 */
export async function parseListing(messageHtml: string | null): Promise<Listing[]> {
  if (messageHtml === null) {
    throw new Error('This email has no HTML body.');
  }
  const {parseAlert} = await import('./alert.ts');
  return (await parseAlert(messageHtml)).cards;
}
