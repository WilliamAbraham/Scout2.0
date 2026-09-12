import assert from 'node:assert/strict';
import test from 'node:test';

import {matchListing} from './match.ts';

const criteria = {budgetMin: null, budgetMax: 5000, bedroomsMin: 2, bedroomsMax: null, bathroomsMin: null};

test('matchListing passes within budget and bedroom bounds', () => {
  assert.equal(matchListing({price: 4500, bedrooms: 2, bathrooms: 1}, criteria).isMatch, true);
});

test('matchListing fails over budget with a reason', () => {
  const result = matchListing({price: 6000, bedrooms: 2, bathrooms: 1}, criteria);
  assert.equal(result.isMatch, false);
  assert.match(result.reason, /over the \$5000 budget/);
});

test('matchListing treats unknown counts and missing profile as unconstrained', () => {
  assert.equal(matchListing({price: 4500, bedrooms: null, bathrooms: null}, criteria).isMatch, true);
  assert.equal(matchListing({price: 99999, bedrooms: 0, bathrooms: 0}, null).isMatch, true);
});
