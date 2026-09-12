import assert from 'node:assert/strict';
import test from 'node:test';

import {findNewMessageIds, formatInboxEvent} from './inboxWatch.ts';
import type {InboxMessage} from './inboxWatch.ts';

test('findNewMessageIds returns only unseen ids in order', () => {
  const seen = new Set(['a', 'b']);
  assert.deepEqual(findNewMessageIds(seen, ['c', 'b', 'a']), ['c']);
  assert.deepEqual(findNewMessageIds(seen, ['b', 'a']), []);
});

test('formatInboxEvent includes from and subject', () => {
  const message: InboxMessage = {
    id: 'msg-1',
    threadId: 'thread-1',
    from: 'Alice <alice@example.com>',
    subject: 'Hello',
    date: 'Sat, 12 Sep 2026 12:00:00 -0400',
    snippet: 'Just testing',
  };
  const formatted = formatInboxEvent(message);
  assert.match(formatted, /new inbox message/);
  assert.match(formatted, /alice@example.com/);
  assert.match(formatted, /Hello/);
});
