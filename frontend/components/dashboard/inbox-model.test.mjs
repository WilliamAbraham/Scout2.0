import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoListings, demoNow } from './inbox-fixtures.ts';
import { actionOwner, dismissDemoListing, groupFor, isClosed, statusLabel, stopDemoPursuit, submitDemoResolution } from './inbox-model.ts';
import { projectRecords, safeSourceUrl } from './inbox-records.ts';
const sample = (id) => structuredClone(demoListings.find((item) => item.id === id));

test('a blocker is attention, not a replacement for contacted progress', () => {
  const before = sample('clinton');
  assert.equal(groupFor(before, 'Active'), 'Needs you');
  assert.equal(statusLabel(before), 'Contacted');
  const after = submitDemoResolution(before, 'October 1 works', demoNow);
  assert.equal(after.pursuit.stage, 'contacted');
  assert.equal(after.pursuit.work, 'answer_submitted');
  assert.equal(groupFor(after, 'Active'), 'Scout working');
  assert.equal(after.messages.length, before.messages.length);
  assert.equal(after.events.at(-1).title, 'Answer submitted');
  assert.notEqual(groupFor(after, 'Active'), 'Waiting for broker');
});
test('a supplied demo email records a receipt, with no new recipient or outreach event', () => {
  const before = sample('bergen');
  const after = submitDemoResolution(before, 'candidate@example.com', demoNow);
  assert.equal(after.pursuit.stage, 'matched');
  assert.equal(statusLabel(after), 'Contact supplied');
  assert.deepEqual(after.pursuit.contacts, []);
  assert.equal(after.events.at(-1).title, 'Contact supplied');
  assert.equal(before.pursuit.blocker.reason, 'no_contact');
});
test('queued outreach is not waiting for a broker and a passed tour stays scheduled', () => {
  assert.equal(groupFor(sample('court'), 'Active'), 'Scout working');
  const tour = sample('wythe');
  tour.pursuit.tour.at = '2020-01-01T15:00:00Z';
  assert.equal(statusLabel(tour), 'Tour scheduled');
  tour.pursuit.blocker = { reason:'no_fitting_slot', question:'Choose a time', detail:'', raisedAt:demoNow };
  assert.equal(groupFor(tour, 'Active'), 'Needs you');
  const resolved = submitDemoResolution(tour, 'Monday after 5 PM', demoNow);
  assert.deepEqual(resolved.pursuit.tour, tour.pursuit.tour);
  assert.equal(resolved.pursuit.stage, 'tour_scheduled');
});
test('unassessed and non-matching listings are distinct; dismissing never stops a pursuit', () => {
  assert.equal(statusLabel(sample('willoughby')), 'Checking fit');
  assert.equal(statusLabel(sample('kent')), 'Not a fit');
  assert.equal(groupFor(sample('kent'), 'Active'), null);
  const active = sample('clinton');
  assert.deepEqual(dismissDemoListing(active), active);
  const dismissed = dismissDemoListing(sample('kent'));
  assert.equal(groupFor(dismissed, 'All listings'), 'Dismissed');
  assert.equal(actionOwner(dismissed), 'No action needed');
});
test('closing preserves a reason, while a decision needing input remains active', () => {
  const ended = stopDemoPursuit(sample('clinton'), demoNow);
  assert.equal(groupFor(ended, 'Active'), null);
  assert.equal(groupFor(ended, 'Closed'), 'Closed');
  assert.equal(ended.pursuit.closedReason, 'Stopped by you');
  const decision = sample('clinton');
  decision.pursuit.stage = 'decided';
  decision.pursuit.blocker.reason = 'decision';
  assert.equal(isClosed(decision), false);
  assert.equal(groupFor(decision, 'Active'), 'Needs you');
  decision.pursuit.blocker = null;
  assert.equal(isClosed(decision), false);
  decision.pursuit.closedReason = 'Application declined';
  assert.equal(isClosed(decision), true);
});
const record = { id:'user-listing', is_match:null, match_reason:null, dismissed_at:null, first_seen_at:demoNow,
  listings:{ rental_id:'123', address:'1 Example St', price:'3000', bedrooms:0, bathrooms:null, listing_url:'https://streeteasy.com/rental/123' }, pursuits:null };
test('record projection deduplicates source identity and preserves unknown counts and studios', () => {
  const records = projectRecords([record, { ...record, id:'duplicate' }]);
  assert.equal(records.length, 1);
  assert.equal(records[0].assessment, 'checking');
  assert.equal(records[0].beds, 0);
  assert.equal(records[0].baths, null);
});
test('one-to-one persisted pursuit does not invent broker waiting, messages, or tour details', () => {
  const [item] = projectRecords([{ ...record, is_match:true, pursuits:{ id:'pursuit', stage:'contacted', needs_human_reason:null, needs_human_note:null, needs_human_at:null, updated_at:demoNow, contact_snapshot:null, pursuit_events:[] } }]);
  assert.equal(item.pursuit.stage, 'contacted');
  assert.equal(item.pursuit.work, 'unknown');
  assert.equal(groupFor(item, 'Active'), 'Recorded progress');
  assert.equal(statusLabel(item), 'Contacted');
  assert.equal(item.pursuit.tour, null);
  assert.deepEqual(item.messages, []);
});
test('source links accept web pages and reject executable URL schemes', () => {
  assert.equal(safeSourceUrl('javascript:alert(1)'), null);
  assert.equal(safeSourceUrl('data:text/html,test'), null);
  assert.equal(safeSourceUrl('https://example.com/listing'), 'https://example.com/listing');
});
