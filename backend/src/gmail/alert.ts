import {load} from 'cheerio';
import type {Cheerio, CheerioAPI} from 'cheerio';
import type {Element} from 'domhandler';

import {resolveRentalUrl} from './listings.ts';
import type {Listing} from './listings.ts';

/**
 * What an alert email turned out to be once parsed.
 *
 * - `listing_cards`: the layout the parser understands; `cards` holds every
 *   card that validated and `malformed` every card that did not.
 * - `unsupported`: the mail links to StreetEasy rentals but none of the card
 *   selectors matched, so a template changed or a new one appeared. The
 *   worker records this visibly instead of marking the mail handled as if it
 *   had no listings.
 * - `empty`: no rental links at all (an account notice, say). Genuinely
 *   nothing to do.
 */
export type AlertLayout = 'listing_cards' | 'unsupported' | 'empty';

export type MalformedCard = {
  index: number;
  reason: string;
  /** Whatever address text was readable, for the status report. */
  address: string | null;
};

export type ParsedAlert = {
  layout: AlertLayout;
  cards: Listing[];
  malformed: MalformedCard[];
  /** Direct rental links in the mail, for the unsupported diagnosis. */
  rentalLinks: number;
};

export type ParseAlertOptions = {
  /** The alert subject, which says how many results the mail claims to carry. */
  subject?: string | undefined;
  /** Injected for tests; the default follows the tracking redirect. */
  resolveRental?: (trackingUrl: string) => Promise<{rentalId: string; listingUrl: string}>;
};

/**
 * "3 Results for Manhattan - 9/12/26". Every alert in the corpus uses it, and
 * an account notice from the same sender does not — which is the only way to
 * tell the two apart before parsing, since the links are opaque click
 * trackers either way.
 */
const RESULTS_SUBJECT = /\b(\d+)\s+results?\s+for\b/i;

/** Links that name a rental outright, rather than a tracking redirect. */
function countRentalLinks($: CheerioAPI): number {
  let count = 0;
  $('a[href]').each((_, element) => {
    if (/streeteasy\.com\/rental\/\d+/i.test($(element).attr('href') ?? '')) {
      count += 1;
    }
  });
  return count;
}

/** How many listings the subject claims, or null when it is not an alert. */
function claimedResults(subject: string | undefined): number | null {
  const found = RESULTS_SUBJECT.exec(subject ?? '');
  return found ? Number(found[1]) : null;
}

function parsePrice(text: string): number {
  const first = text.replaceAll(' ', ' ').trim().split(/\s+/)[0] ?? '';
  return Number(first.replaceAll('$', '').replaceAll(',', ''));
}

/** "3 x 1 bath" / "Studio x 1 bath" → counts; unknowns become null. */
function parseRooms(text: string): {bedrooms: number | null; bathrooms: number | null} {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const beds = /^(\d+(?:\.\d+)?)\b/.exec(cleaned)?.[1];
  const studio = /^studio\b/i.test(cleaned);
  const baths = /(\d+(?:\.\d+)?)\s*bath/i.exec(cleaned)?.[1];
  return {
    bedrooms: studio ? 0 : beds !== undefined ? Number(beds) : null,
    bathrooms: baths !== undefined ? Number(baths) : null,
  };
}

async function parseCard(
  $: CheerioAPI,
  card: Cheerio<Element>,
  resolveRental: NonNullable<ParseAlertOptions['resolveRental']>,
): Promise<Listing> {
  const address = card.find('.ListingCard-info--address').first().text().replace(/\s+/g, ' ').trim();
  if (!address) throw new Error('missing address');

  const price = parsePrice(card.find('.ListingCard-info--price').first().text());
  if (!Number.isFinite(price) || price <= 0) throw new Error('missing or invalid price');

  // StreetEasy spells this class "ListinCard". Only the first container: the
  // nested tables repeat the class.
  const rooms = parseRooms(card.find('.ListinCard-info--detailsContainer').first().text());

  // The link wraps the card; its href is an email tracking URL.
  const trackingUrl = card.closest('a.ListingCardLink').attr('href') ?? card.find('a[href]').first().attr('href');
  if (!trackingUrl) throw new Error('missing listing link');
  const rental = await resolveRental(trackingUrl);
  if (!/^\d+$/.test(rental.rentalId)) throw new Error(`invalid rental id ${rental.rentalId}`);

  return {
    address,
    price,
    // The listings table stores unknown counts as null; the legacy Listing
    // shape is numeric, so NaN carries "unknown" until the store maps it.
    bedrooms: rooms.bedrooms ?? Number.NaN,
    bathrooms: rooms.bathrooms ?? Number.NaN,
    brokerage: card.find('.ListingCard-listingBy').first().text().replace(/\s+/g, ' ').trim(),
    ...rental,
  };
}

/**
 * Parse one StreetEasy alert's HTML. Never throws for a bad card: each card
 * is isolated so one broken listing cannot discard the others, and the
 * result says which layout the mail had so an unsupported template is
 * distinguishable from an alert with nothing in it.
 */
export async function parseAlert(html: string, options: ParseAlertOptions = {}): Promise<ParsedAlert> {
  const resolveRental = options.resolveRental ?? resolveRentalUrl;
  const $ = load(html);
  const rentalLinks = countRentalLinks($);
  const elements = $('.ListingCard').toArray();

  if (elements.length === 0) {
    // Mail that claims results, or links a rental directly, but matched no
    // card selector: a template we do not parse yet. Anything else is a
    // genuinely empty notice.
    const claimed = claimedResults(options.subject);
    const unsupported = rentalLinks > 0 || (claimed !== null && claimed > 0);
    return {layout: unsupported ? 'unsupported' : 'empty', cards: [], malformed: [], rentalLinks};
  }

  const cards: Listing[] = [];
  const malformed: MalformedCard[] = [];
  const seen = new Set<string>();
  for (const [index, element] of elements.entries()) {
    const card = $(element);
    try {
      const listing = await parseCard($, card, resolveRental);
      if (seen.has(listing.rentalId)) {
        // The same card can appear twice in one mail (a "featured" repeat).
        continue;
      }
      seen.add(listing.rentalId);
      cards.push(listing);
    } catch (error) {
      malformed.push({
        index,
        reason: error instanceof Error ? error.message : String(error),
        address: card.find('.ListingCard-info--address').first().text().trim() || null,
      });
    }
  }

  return {layout: 'listing_cards', cards, malformed, rentalLinks};
}
