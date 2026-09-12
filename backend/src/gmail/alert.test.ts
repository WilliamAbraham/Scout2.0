import assert from 'node:assert/strict';
import test from 'node:test';

import {parseAlert} from './alert.ts';

const resolveRental = async (trackingUrl: string) => {
  const id = /\/u\/(\d+)/.exec(trackingUrl)?.[1] ?? '123';
  return {rentalId: id, listingUrl: `https://streeteasy.com/rental/${id}`};
};

function card(options: {
  id?: string;
  address?: string | null;
  price?: string | null;
  details?: string;
  by?: string;
  link?: boolean;
}): string {
  const id = options.id ?? '123';
  const inner = [
    options.address === null ? '' : `<div class="ListingCard-info--address">${options.address ?? '118 Mulberry Street #R4'}</div>`,
    options.price === null ? '' : `<div class="ListingCard-info--price">${options.price ?? '$7,495'}</div>`,
    `<div class="ListinCard-info--detailsContainer">${options.details ?? '3 x 1 bath'}</div>`,
    `<div class="ListingCard-listingBy">${options.by ?? 'DALLAL (260 Madison Avenue, New York, NY 10016)'}</div>`,
  ].join('');
  const body = `<div class="ListingCard">${inner}</div>`;
  return options.link === false
    ? body
    : `<a class="ListingCardLink" href="https://links.streeteasy.com/u/${id}">${body}</a>`;
}

test('parseAlert returns every valid card in the alert', async () => {
  const html = card({id: '1'}) + card({id: '2', address: '200 Grand Street #3B', price: '$4,200'});
  const parsed = await parseAlert(html, {resolveRental});

  assert.equal(parsed.layout, 'listing_cards');
  assert.equal(parsed.malformed.length, 0);
  assert.deepEqual(parsed.cards.map(listing => listing.rentalId), ['1', '2']);
  assert.equal(parsed.cards[0]?.price, 7495);
  assert.equal(parsed.cards[0]?.bedrooms, 3);
  assert.equal(parsed.cards[0]?.bathrooms, 1);
});

test('parseAlert isolates a malformed card instead of discarding the good ones', async () => {
  const html = card({id: '1', price: 'Price on request'}) + card({id: '2'});
  const parsed = await parseAlert(html, {resolveRental});

  assert.deepEqual(parsed.cards.map(listing => listing.rentalId), ['2']);
  assert.equal(parsed.malformed.length, 1);
  assert.match(parsed.malformed[0]?.reason ?? '', /price/);
  assert.equal(parsed.malformed[0]?.address, '118 Mulberry Street #R4');
});

test('parseAlert isolates a card whose link cannot be resolved', async () => {
  const html = card({id: '1'}) + card({id: '2'});
  const parsed = await parseAlert(html, {
    resolveRental: async trackingUrl => {
      if (trackingUrl.endsWith('/1')) throw new Error('redirect chain exceeded');
      return resolveRental(trackingUrl);
    },
  });

  assert.deepEqual(parsed.cards.map(listing => listing.rentalId), ['2']);
  assert.equal(parsed.malformed.length, 1);
  assert.match(parsed.malformed[0]?.reason ?? '', /redirect chain/);
});

test('parseAlert reports an unsupported layout when a rental link has no card', async () => {
  const parsed = await parseAlert(
    '<a href="https://streeteasy.com/rental/99">New listing</a><div class="ListingTile">something new</div>',
    {resolveRental},
  );

  assert.equal(parsed.layout, 'unsupported');
  assert.equal(parsed.cards.length, 0);
  assert.equal(parsed.rentalLinks, 1);
});

test('parseAlert trusts the subject when a redesign hides the listings', async () => {
  // Tracking links are opaque, so the result count in the subject is the only
  // pre-parse evidence that the mail was supposed to contain listings.
  const parsed = await parseAlert(
    '<a href="https://links.streeteasy.com/u/click?_t=abc">New listing</a>',
    {resolveRental, subject: '3 Results for Manhattan - 9/12/26'},
  );

  assert.equal(parsed.layout, 'unsupported');
});

test('parseAlert reports an empty notice distinctly from an unsupported one', async () => {
  const parsed = await parseAlert(
    '<a href="https://links.streeteasy.com/u/click?_t=abc">Finish setup</a>',
    {resolveRental, subject: 'Your StreetEasy account is ready'},
  );

  assert.equal(parsed.layout, 'empty');
  assert.equal(parsed.rentalLinks, 0);
});

test('parseAlert records unknown room counts rather than guessing zero', async () => {
  const parsed = await parseAlert(card({details: 'Studio x 1 bath'}), {resolveRental});
  assert.equal(parsed.cards[0]?.bedrooms, 0);

  const unknown = await parseAlert(card({details: 'Contact for details'}), {resolveRental});
  assert.ok(Number.isNaN(unknown.cards[0]?.bedrooms));
  assert.ok(Number.isNaN(unknown.cards[0]?.bathrooms));
});

test('parseAlert drops a card repeated within one alert', async () => {
  const parsed = await parseAlert(card({id: '7'}) + card({id: '7'}), {resolveRental});
  assert.equal(parsed.cards.length, 1);
});
