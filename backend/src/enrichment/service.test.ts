import assert from 'node:assert/strict';
import test from 'node:test';
import {parseEmailListing} from './service.ts';
import type {EmailListing} from './service.ts';

const input: EmailListing = {address: '118 Mulberry Street', unit: 'R4', price: 7495, bedrooms: 3, bathrooms: 1,
  brokerage: 'Example Realty', brokerageOfficeAddress: '260 Madison Avenue, New York, NY 10016', city: 'New York'};

test('accepts email fields, splits #unit, and rejects malformed inputs', () => {
  const {unit, ...withoutUnit} = input;
  assert.deepEqual(parseEmailListing({...withoutUnit, address: `${input.address} #${unit}`}), input);
  for (const bad of [null, {...input, unit: ''}, {...input, brokerage: ''}, {...input, price: 0}, {...input, bedrooms: '3'}]) {
    assert.throws(() => parseEmailListing(bad));
  }
});
