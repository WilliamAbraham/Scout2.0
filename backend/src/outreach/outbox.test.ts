import assert from 'node:assert/strict';
import test from 'node:test';

import {MemoryOutbox, dispatchOutboxSend} from './outbox.ts';
import type {SendMailInput} from './types.ts';

const MESSAGE: SendMailInput = {
  to: ['ava@broker.example'],
  cc: ['ben@broker.example'],
  subject: 'Tour request: 118 Mulberry',
  body: 'Can we tour this week?',
  threadId: null,
  actionKey: 'open',
  pursuitId: 'pursuit-1',
};

function recordingSender() {
  const sent: SendMailInput[] = [];
  return {
    sent,
    send: async (message: SendMailInput) => {
      sent.push(message);
      return {threadId: message.threadId ?? 'thread-new', messageId: `msg-${sent.length}`};
    },
  };
}

test('dispatch records the action before sending and returns provider ids', async () => {
  const outbox = new MemoryOutbox();
  const sender = recordingSender();
  const result = await dispatchOutboxSend({
    outbox,
    userId: 'user-1',
    send: sender.send,
    message: MESSAGE,
  });

  assert.deepEqual(result, {threadId: 'thread-new', messageId: 'msg-1'});
  assert.equal(sender.sent.length, 1);
  const row = outbox.get('user-1', 'pursuit-1', 'open');
  assert.equal(row?.state, 'sent');
  assert.equal(row?.providerMessageId, 'msg-1');
});

test('replaying a sent opening does not send a second email', async () => {
  const outbox = new MemoryOutbox();
  const sender = recordingSender();
  const first = await dispatchOutboxSend({outbox, userId: 'user-1', send: sender.send, message: MESSAGE});
  const second = await dispatchOutboxSend({outbox, userId: 'user-1', send: sender.send, message: MESSAGE});

  assert.deepEqual(second, first);
  assert.equal(sender.sent.length, 1);
});

test('a crash after Gmail may have accepted marks uncertain and never retries blindly', async () => {
  const outbox = new MemoryOutbox();
  let calls = 0;
  const send = async () => {
    calls += 1;
    throw new Error('timeout after accept');
  };

  await assert.rejects(
    () => dispatchOutboxSend({outbox, userId: 'user-1', send, message: MESSAGE}),
    /uncertain|timeout/i,
  );
  assert.equal(outbox.get('user-1', 'pursuit-1', 'open')?.state, 'uncertain');

  await assert.rejects(
    () => dispatchOutboxSend({
      outbox,
      userId: 'user-1',
      send: async () => {
        calls += 1;
        return {threadId: 'should-not', messageId: 'should-not'};
      },
      message: MESSAGE,
    }),
    /uncertain/,
  );
  assert.equal(calls, 1);
});

test('claim is exclusive: a second worker cannot send the same action', async () => {
  const outbox = new MemoryOutbox();
  const claimed = outbox.intend({
    userId: 'user-1',
    pursuitId: 'pursuit-1',
    actionKey: 'open',
    message: MESSAGE,
  });
  assert.equal(outbox.claim(claimed.id), true);
  assert.equal(outbox.claim(claimed.id), false);
});

test('dry-run dispatch persists the draft and never calls send', async () => {
  const outbox = new MemoryOutbox();
  const sender = recordingSender();
  const result = await dispatchOutboxSend({
    outbox,
    userId: 'user-1',
    send: sender.send,
    message: MESSAGE,
    mode: 'dry-run',
  });

  assert.equal(result.messageId, 'dry-run');
  assert.equal(sender.sent.length, 0);
  assert.equal(outbox.get('user-1', 'pursuit-1', 'open')?.state, 'intended');
});

test('cancelFollowUps marks pending follow-ups cancelled when a reply arrives', () => {
  const outbox = new MemoryOutbox();
  outbox.intend({
    userId: 'user-1',
    pursuitId: 'pursuit-1',
    actionKey: 'follow_up:1',
    message: {...MESSAGE, actionKey: 'follow_up:1', threadId: 'thread-1'},
  });
  outbox.cancelFollowUps('user-1', 'pursuit-1');
  assert.equal(outbox.get('user-1', 'pursuit-1', 'follow_up:1')?.state, 'cancelled');
});
