import assert from 'node:assert/strict';
import test from 'node:test';

import {MAX_CATCH_UP_DAYS, catchUpTruncated, planSync} from './checkpoint.ts';

const NOW = new Date('2026-09-12T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

test('a fresh checkpoint syncs incrementally from the history id', () => {
  const plan = planSync({historyId: '12345', lastSyncedAt: daysAgo(1)}, NOW);
  assert.deepEqual(plan, {mode: 'incremental', historyId: '12345'});
});

test('a first run searches the default window', () => {
  const plan = planSync({historyId: null, lastSyncedAt: null}, NOW);
  assert.equal(plan.mode, 'catch_up');
  if (plan.mode === 'catch_up') assert.equal(plan.newerThanDays, 2);
});

test('downtime past Gmail history retention falls back to a sized catch-up', () => {
  // Google keeps roughly a week of history, so a longer gap cannot be replayed
  // from the cursor; the window is widened to cover the outage instead.
  const plan = planSync({historyId: '12345', lastSyncedAt: daysAgo(9)}, NOW);
  assert.equal(plan.mode, 'catch_up');
  if (plan.mode === 'catch_up') assert.equal(plan.newerThanDays, 10);
});

test('a long outage is bounded and reported as truncated', () => {
  const checkpoint = {historyId: '12345', lastSyncedAt: daysAgo(60)};
  const plan = planSync(checkpoint, NOW);
  assert.equal(plan.mode, 'catch_up');
  if (plan.mode === 'catch_up') assert.equal(plan.newerThanDays, MAX_CATCH_UP_DAYS);
  assert.equal(catchUpTruncated(checkpoint, plan, NOW), true);
});

test('a catch-up that covers the gap is not truncated', () => {
  const checkpoint = {historyId: '12345', lastSyncedAt: daysAgo(9)};
  assert.equal(catchUpTruncated(checkpoint, planSync(checkpoint, NOW), NOW), false);
});
