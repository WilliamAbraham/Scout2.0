import assert from 'node:assert/strict';
import test from 'node:test';

import type {gmail_v1} from 'googleapis';

import {syncMailbox} from './sync.ts';

const NOW = new Date('2026-09-12T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

type FakeOptions = {
  history?: Array<{id: string; labelIds?: string[]}>;
  historyExpired?: boolean;
  listed?: string[];
};

function fakeGmail(options: FakeOptions = {}) {
  const queries: string[] = [];
  const gmail = {
    users: {
      getProfile: async () => ({data: {emailAddress: 'renter@example.com', historyId: '99999'}}),
      history: {
        list: async () => {
          if (options.historyExpired) {
            throw Object.assign(new Error('startHistoryId is too old'), {code: 404});
          }
          return {
            data: {
              history: [{messagesAdded: (options.history ?? []).map(message => ({message}))}],
            },
          };
        },
      },
      messages: {
        list: async (params: {q: string}) => {
          queries.push(params.q);
          return {data: {messages: (options.listed ?? []).map(id => ({id}))}};
        },
      },
    },
  } as unknown as gmail_v1.Gmail;
  return {gmail, queries};
}

test('a fresh checkpoint reads only what Gmail history added', async () => {
  const {gmail, queries} = fakeGmail({history: [{id: 'm-1'}, {id: 'm-2'}]});
  const result = await syncMailbox(gmail, {historyId: '100', lastSyncedAt: daysAgo(1)}, {now: NOW});

  assert.equal(result.plan.mode, 'incremental');
  assert.deepEqual(result.messageIds, ['m-1', 'm-2']);
  assert.deepEqual(queries, [], 'an incremental sync must not fall back to a search');
  assert.equal(result.historyId, '99999');
  assert.equal(result.emailAddress, 'renter@example.com');
});

test('drafts in the history are not mail to process', async () => {
  const {gmail} = fakeGmail({history: [{id: 'm-1'}, {id: 'd-1', labelIds: ['DRAFT']}]});
  const result = await syncMailbox(gmail, {historyId: '100', lastSyncedAt: daysAgo(1)}, {now: NOW});
  assert.deepEqual(result.messageIds, ['m-1']);
});

test('an expired history id falls back to a bounded search', async () => {
  const {gmail, queries} = fakeGmail({historyExpired: true, listed: ['m-3']});
  const result = await syncMailbox(gmail, {historyId: '100', lastSyncedAt: daysAgo(1)}, {now: NOW});

  assert.equal(result.historyExpired, true);
  assert.equal(result.plan.mode, 'catch_up');
  assert.deepEqual(result.messageIds, ['m-3']);
  assert.deepEqual(queries, ['newer_than:2d']);
});

test('a long outage searches a widened window and reports truncation', async () => {
  const {gmail, queries} = fakeGmail({listed: ['m-4']});
  const result = await syncMailbox(gmail, {historyId: '100', lastSyncedAt: daysAgo(60)}, {now: NOW});

  assert.equal(result.plan.mode, 'catch_up');
  assert.deepEqual(queries, ['newer_than:14d']);
  assert.equal(result.truncated, true, 'mail older than the cap is skipped and must be reported');
});

test('a cycle never fetches more than its message bound', async () => {
  const {gmail} = fakeGmail({history: [{id: 'a'}, {id: 'b'}, {id: 'c'}]});
  const result = await syncMailbox(gmail, {historyId: '100', lastSyncedAt: daysAgo(1)}, {now: NOW, maxMessages: 2});
  assert.deepEqual(result.messageIds, ['a', 'b']);
});

test('an inbox backfill searches current StreetEasy mail and ignores a fresh history cursor', async () => {
  const {gmail, queries} = fakeGmail({
    history: [{id: 'should-not-run'}],
    listed: ['inbox-1', 'inbox-2'],
  });
  const result = await syncMailbox(gmail, {historyId: '100', lastSyncedAt: daysAgo(1)}, {
    now: NOW,
    inboxBackfill: true,
  });

  assert.equal(result.plan.mode, 'inbox_backfill');
  assert.deepEqual(result.messageIds, ['inbox-1', 'inbox-2']);
  assert.deepEqual(queries, ['in:inbox from:noreply@email.streeteasy.com']);
  assert.equal(result.historyId, '99999');
  assert.equal(result.truncated, false);
});
