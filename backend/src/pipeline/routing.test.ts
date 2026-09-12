import assert from 'node:assert/strict';
import test from 'node:test';

import type {RawMessage} from '../gmail/message.ts';
import {MAX_ATTEMPTS, emailAddress, nextAttemptAt, routeMessage} from './routing.ts';
import type {RoutingContext} from './routing.ts';

function message(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    id: 'msg-1',
    threadId: 'thread-1',
    subject: 'Re: Tour request',
    from: 'Ava Agent <ava@broker.example>',
    date: '2026-09-12T12:00:00Z',
    snippet: '',
    textBody: 'Tuesday works',
    htmlBody: null,
    ...overrides,
  };
}

function context(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    threads: new Map([['thread-1', 'pursuit-1']]),
    contacts: new Map([['ava@broker.example', 'pursuit-1']]),
    selfAddress: 'renter@example.com',
    ...overrides,
  };
}

test('emailAddress unwraps a display-name header', () => {
  assert.equal(emailAddress('Ava Agent <Ava@Broker.example>'), 'ava@broker.example');
  assert.equal(emailAddress('ava@broker.example'), 'ava@broker.example');
  assert.equal(emailAddress('no address here'), null);
});

test('StreetEasy mail routes to the alert parser', () => {
  const routed = routeMessage(
    message({from: 'StreetEasy <noreply@email.streeteasy.com>', threadId: 'thread-x'}),
    context(),
  );
  assert.equal(routed.route, 'alert');
});

test('a broker reply matches its pursuit by thread id', () => {
  const routed = routeMessage(message({from: 'Colleague <ben@broker.example>'}), context());
  assert.deepEqual(
    {route: routed.route, pursuitId: routed.pursuitId, reason: routed.reason},
    {route: 'reply', pursuitId: 'pursuit-1', reason: 'thread_match'},
  );
});

test('a broker reply on a new thread matches by sender address', () => {
  const routed = routeMessage(message({threadId: 'thread-unknown'}), context());
  assert.equal(routed.route, 'reply');
  assert.equal(routed.reason, 'sender_match');
});

test("the mailbox's own outbound copy is never treated as a reply", () => {
  // The worker's sent mail lands in the same thread; treating it as inbound
  // would have the agent answer itself.
  const routed = routeMessage(message({from: 'renter@example.com'}), context());
  assert.equal(routed.route, 'noise');
  assert.equal(routed.reason, 'self_sent');
});

test('unrelated mail is noise, not a reply', () => {
  const routed = routeMessage(
    message({from: 'newsletter@example.org', threadId: 'thread-zzz'}),
    context(),
  );
  assert.deepEqual({route: routed.route, pursuitId: routed.pursuitId}, {route: 'noise', pursuitId: null});
});

test('retry backoff grows and then gives up', () => {
  const at = new Date('2026-09-12T12:00:00Z');
  const first = nextAttemptAt(1, at);
  const second = nextAttemptAt(2, at);
  assert.ok(first && second);
  assert.equal(first!.getTime() - at.getTime(), 5 * 60_000);
  assert.ok(second!.getTime() > first!.getTime());
  assert.equal(nextAttemptAt(MAX_ATTEMPTS, at), null);
});
