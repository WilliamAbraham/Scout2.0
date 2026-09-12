import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRent, rentComparison, tourQuestions } from './listing-insights.ts';
import { projectRecords } from './inbox-records.ts';

const profile = { budget_min: 2500, budget_max: 3500, must_haves: ['Elevator'], dealbreakers: ['Ground floor'] };

test('rent comparison respects both budget bounds, including exact limits and cents', () => {
  assert.equal(rentComparison(3200, profile).label, '$300 under your limit');
  assert.equal(rentComparison(3500, profile).label, 'At your rent limit');
  assert.equal(rentComparison(4200, profile).outside, true);
  assert.equal(rentComparison(2400, profile).label, '$100 below your minimum');
  assert.equal(rentComparison(3200.75, profile).label, '$299.25 under your limit');
  assert.equal(formatRent(3200.75), '$3,200.75');
});

test('missing preferences and invalid prices never manufacture a budget comparison', () => {
  for (const rent of [0, -1, NaN, Infinity]) assert.equal(rentComparison(rent, profile), null);
  assert.equal(rentComparison(3200, null), null);
  assert.equal(rentComparison(3200, { ...profile, budget_max: null }), null);
  assert.equal(rentComparison(2400, { ...profile, budget_max: null }).outside, true);
});

test('tour checklist retains listing unknowns and treats personal criteria as questions', () => {
  const questions = tourQuestions({ unknowns: ['Fees unclear.', 'Fees unclear.'] }, profile);
  assert.equal(questions.filter((q) => q === 'Fees unclear.').length, 1);
  assert.ok(questions.includes('Confirm must-have: Elevator.'));
  assert.ok(questions.includes('Check dealbreaker: Ground floor.'));
  assert.ok(tourQuestions({ unknowns: [] }, null).length > 0);
});

test('listing metadata comes from stored fields and invalid dates stay unknown', () => {
  const row = { id: 'listing', first_seen_at: '2026-09-11T12:00:00Z', is_match: null, match_reason: null, dismissed_at: null, pursuits: null,
    listings: { rental_id: '123', address: '1 Example St', price: 3000, bedrooms: 0, bathrooms: 1, listing_url: 'https://example.com/123', brokerage: ' Example Realty ', last_seen_at: '2026-09-12T13:00:00Z' } };
  const [listing] = projectRecords([row]);
  assert.equal(listing.brokerage, 'Example Realty');
  assert.equal(listing.lastSeenAt, '2026-09-12T13:00:00Z');
  assert.equal(listing.observedAt, row.first_seen_at);
  row.listings.brokerage = ' ';
  row.listings.last_seen_at = 'not a date';
  const [unknown] = projectRecords([row]);
  assert.equal(unknown.brokerage, null);
  assert.equal(unknown.lastSeenAt, null);
});
