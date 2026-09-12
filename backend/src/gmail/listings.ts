import {load} from 'cheerio';

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

export async function parseListing(messageHtml: string | null): Promise<Listing[]> {
  if (messageHtml === null) {
    throw new Error('This email has no HTML body.');
  }

  const $ = load(messageHtml);
  const listingCards = $('.ListingCard');

  console.log('Number of listings:', listingCards.length);
  const listings: Listing[] = []

  for (const element of listingCards.toArray()) {
    const card = $(element);
    const address = card.find('.ListingCard-info--address').text().trim();
    const priceText = card.find('.ListingCard-info--price').text().trim();
    const price = Number(priceText.replaceAll('\u00A0', ' ').split(" ")[0]?.replaceAll("$", "").replaceAll(",", ""))

    // StreetEasy spells this class "ListinCard". Select only the first
    // container because nested tables repeat the same class.
    const detailsText = card.find('.ListinCard-info--detailsContainer')
      .first().text().replace(/\s+/g, ' ').trim().split(" ");
    const beds = Number(detailsText[0])
    const baths = Number(detailsText[2])

    // The link wraps the card; its href is an email tracking URL.
    const trackingUrl = card.closest('a.ListingCardLink').attr('href');
    if (!trackingUrl) throw new Error(`Listing card is missing its link: ${address}`);
    const rental = await resolveRentalUrl(trackingUrl);
    const broker = card.find('.ListingCard-listingBy').text().trim()

    const newListing: Listing = {
      address: address,
      price: price,
      bedrooms: beds,
      bathrooms: baths,
      brokerage: broker,
      ...rental
    }
    listings.push(newListing)
  }

  return listings;
}
