import assert from 'node:assert/strict';
import test from 'node:test';

import {CONTROLLED_TEST_RECIPIENT} from './recipients.ts';
import {buildRawMessage, createGmailSender} from './gmailSend.ts';

test('buildRawMessage encodes headers, body, and reply threading', () => {
  const built = buildRawMessage({
    to: [CONTROLLED_TEST_RECIPIENT],
    cc: [],
    subject: 'Tour request: 118 Mulberry',
    body: 'Can we tour this week?',
    threadId: 'thread-1',
    rfc822MessageId: '<open-1@scout.local>',
    inReplyTo: '<prior@mail.gmail.com>',
  });

  const mime = Buffer.from(built.raw, 'base64url').toString('utf8');
  assert.match(mime, new RegExp(`To: ${CONTROLLED_TEST_RECIPIENT}`));
  assert.match(mime, /Subject: Tour request: 118 Mulberry/);
  assert.match(mime, /Can we tour this week\?/);
  assert.match(mime, /Message-ID: <open-1@scout.local>/);
  assert.match(mime, /In-Reply-To: <prior@mail.gmail.com>/);
  assert.match(mime, /References: <prior@mail.gmail.com>/);
  assert.equal(built.threadId, 'thread-1');
});

test('createGmailSender rejects empty drafts and invalid recipients before any API call', async () => {
  let calls = 0;
  const send = createGmailSender({
    users: {
      messages: {
        send: async () => {
          calls += 1;
          return {data: {id: 'msg', threadId: 'th'}};
        },
      },
    },
  });

  await assert.rejects(() => send({
    to: ['ava@broker.example'],
    cc: [],
    subject: 'Tour request',
    body: '   ',
    threadId: null,
  }), /empty/i);
  await assert.rejects(() => send({
    to: [],
    cc: [],
    subject: 'Tour request',
    body: 'Hello',
    threadId: null,
  }), /recipient/i);
  assert.equal(calls, 0);
});

test('createGmailSender redirects live test mail to the controlled recipient', async () => {
  const sent: Array<{raw?: string | null; threadId?: string | null}> = [];
  const send = createGmailSender({
    users: {
      messages: {
        send: async (request: {requestBody: {raw?: string | null; threadId?: string | null}}) => {
          sent.push(request.requestBody);
          return {data: {id: 'gmail-msg-1', threadId: 'gmail-thread-1'}};
        },
      },
    },
  });

  const result = await send({
    to: ['ava@broker.example'],
    cc: ['ben@broker.example'],
    subject: 'Tour request: 118 Mulberry',
    body: 'Can we tour this week after 5pm?',
    threadId: null,
  });

  assert.deepEqual(result, {threadId: 'gmail-thread-1', messageId: 'gmail-msg-1'});
  assert.equal(sent.length, 1);
  const mime = Buffer.from(sent[0]?.raw ?? '', 'base64url').toString('utf8');
  assert.match(mime, new RegExp(`To: ${CONTROLLED_TEST_RECIPIENT}`));
  assert.doesNotMatch(mime, /ava@broker\.example/);
});
