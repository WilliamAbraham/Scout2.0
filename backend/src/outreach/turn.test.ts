import assert from 'node:assert/strict';
import test from 'node:test';

import {runTurn} from './turn.ts';
import {FIRST_FOLLOW_UP_DAYS, MAX_FOLLOW_UPS} from './types.ts';
import type {ListingAgent, OutreachPorts, Pursuit, TurnInput} from './types.ts';

const NOW = new Date('2026-09-12T12:00:00Z');

function agent(name: string, email: string | null, role: ListingAgent['role'] = 'unspecified'): ListingAgent {
  return {name, email, role};
}

function pursuit(overrides: Partial<Pursuit> = {}): Pursuit {
  return {
    id: 'pursuit-1',
    stage: 'matched',
    needsHumanReason: null,
    threadId: null,
    nextFollowUpAt: null,
    followUpCount: 0,
    listing: {
      address: '118 Mulberry Street #R4',
      price: 7495,
      bedrooms: 3,
      bathrooms: 1,
      brokerage: 'Example Realty',
    },
    agents: [agent('Ava', 'ava@broker.example', 'primary'), agent('Ben', 'ben@broker.example')],
    profile: {
      budgetMax: 8000,
      bedrooms: 3,
      availabilityNote: 'weekdays after 5pm',
      freeText: 'quiet, dishwasher',
      learnedAnswers: [],
    },
    ...overrides,
  };
}

function recordingPorts(
  complete: OutreachPorts['llm']['complete'] | OutreachPorts['llm']['complete'][] = async () => ({toolCalls: []}),
  options: {free?: boolean} = {},
) {
  const queue = Array.isArray(complete) ? [...complete] : [complete];
  const sent: Array<Parameters<OutreachPorts['sendMail']>[0]> = [];
  const booked: Array<Parameters<OutreachPorts['bookTour']>[0]> = [];
  const packets: Array<Parameters<OutreachPorts['sendPacket']>[0]> = [];
  const rec = {ports: null as unknown as OutreachPorts, sent, booked, packets, llmCalls: 0, llmTools: [] as string[][]};
  rec.ports = {
    llm: {
      complete: async input => {
        rec.llmCalls += 1;
        rec.llmTools.push([...input.tools]);
        const next = queue.shift() ?? (async () => ({toolCalls: []}));
        return next(input);
      },
    },
    checkAvailability: async () => ({free: options.free ?? true}),
    bookTour: async event => {
      booked.push(event);
      return {eventId: 'evt-1'};
    },
    sendMail: async message => {
      sent.push(message);
      return {threadId: message.threadId ?? 'thread-new', messageId: 'msg-out-1'};
    },
    sendPacket: async packet => {
      packets.push(packet);
    },
  };
  return rec;
}

function contacted(overrides: Partial<Pursuit> = {}): Pursuit {
  return pursuit({stage: 'contacted', threadId: 'thread-1', ...overrides});
}

function inbound(body: string) {
  return {
    id: 'msg-1',
    from: 'ava@broker.example',
    to: ['me@example.com'],
    cc: ['ben@broker.example'],
    date: '2026-09-12T12:00:00Z',
    body,
  };
}

function input(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    pursuit: pursuit(),
    trigger: 'open',
    inbound: null,
    thread: [],
    alreadyProcessed: false,
    sendsToday: 0,
    sendCap: 10,
    now: NOW,
    ...overrides,
  };
}

test('already-processed inbound is a no-op and does not call the model or send mail', async () => {
  const rec = recordingPorts();
  const result = await runTurn(input({
    trigger: 'reply',
    alreadyProcessed: true,
    inbound: inbound('Are you free Tuesday?'),
  }), rec.ports);

  assert.deepEqual(result.actions, [{type: 'noop', reason: 'already_processed'}]);
  assert.equal(rec.llmCalls, 0);
  assert.equal(rec.sent.length, 0);
});

test('does not act on a pursuit that already needs a human', async () => {
  const rec = recordingPorts();
  const result = await runTurn(input({
    trigger: 'reply',
    pursuit: pursuit({needsHumanReason: 'unanswerable_question'}),
    inbound: inbound('Income?'),
  }), rec.ports);

  assert.deepEqual(result.actions, [{type: 'noop', reason: 'waiting_for_human'}]);
  assert.equal(rec.llmCalls, 0);
});

test('opening without any agent email escalates no_contact', async () => {
  const rec = recordingPorts();
  const result = await runTurn(input({
    pursuit: pursuit({agents: [agent('Ava', null, 'primary')]}),
  }), rec.ports);

  assert.equal(result.pursuit.needsHumanReason, 'no_contact');
  assert.equal(rec.llmCalls, 0);
});

test('opening schedules the first follow-up and sends one email To primary Cc co-agents', async () => {
  const rec = recordingPorts(async () => ({
    text: 'Hi Ava and Ben — can we tour 118 Mulberry this week after 5pm?',
    toolCalls: [],
  }));
  const result = await runTurn(input(), rec.ports);

  assert.equal(rec.sent.length, 1);
  assert.equal(result.pursuit.stage, 'contacted');
  assert.equal(result.pursuit.threadId, 'thread-new');
  assert.equal(result.pursuit.followUpCount, 0);
  const expected = new Date(NOW);
  expected.setUTCDate(expected.getUTCDate() + FIRST_FOLLOW_UP_DAYS);
  assert.equal(result.pursuit.nextFollowUpAt?.toISOString(), expected.toISOString());
});

test('follow-up sends on the stored thread and schedules the next bump', async () => {
  const rec = recordingPorts(async () => ({
    text: 'Just checking in on 118 Mulberry — still interested in a tour.',
    toolCalls: [],
  }));
  const result = await runTurn(input({
    trigger: 'follow_up',
    pursuit: contacted(),
  }), rec.ports);

  assert.equal(rec.sent[0]?.threadId, 'thread-1');
  assert.equal(result.pursuit.followUpCount, 1);
  assert.ok(result.pursuit.nextFollowUpAt);
});

test('final follow-up marks the pursuit dead when max follow-ups are exhausted', async () => {
  const rec = recordingPorts(async () => ({
    text: 'Last check-in on 118 Mulberry.',
    toolCalls: [],
  }));
  const result = await runTurn(input({
    trigger: 'follow_up',
    pursuit: contacted({followUpCount: MAX_FOLLOW_UPS - 1}),
  }), rec.ports);

  assert.equal(result.pursuit.stage, 'dead');
  assert.equal(result.pursuit.nextFollowUpAt, null);
  assert.ok(result.actions.some(action => action.type === 'mark_dead'));
});

test('reply send_reply threads onto the stored Gmail thread', async () => {
  const rec = recordingPorts(async () => ({
    toolCalls: [{name: 'send_reply', arguments: {body: 'Tuesday at 6pm works.'}}],
  }));
  const result = await runTurn(input({
    trigger: 'reply',
    pursuit: contacted(),
    inbound: inbound('Are you free Tuesday at 6?'),
    thread: [inbound('Are you free Tuesday at 6?')],
  }), rec.ports);

  assert.deepEqual(rec.llmTools[0], [
    'check_availability',
    'book_tour',
    'send_reply',
    'send_packet',
    'escalate',
    'mark_dead',
    'schedule_follow_up',
  ]);
  assert.equal(rec.sent[0]?.threadId, 'thread-1');
  assert.equal(result.pursuit.needsHumanReason, null);
});

test('schedule_follow_up tool sets nextFollowUpAt', async () => {
  const rec = recordingPorts(async () => ({
    toolCalls: [{name: 'schedule_follow_up', arguments: {days: 4}}],
  }));
  const result = await runTurn(input({
    trigger: 'reply',
    pursuit: contacted(),
    inbound: inbound('Let me check with the owner and get back to you.'),
  }), rec.ports);

  assert.equal(result.actions[0]?.type, 'schedule_follow_up');
  const expected = new Date(NOW);
  expected.setUTCDate(expected.getUTCDate() + 4);
  assert.equal(result.pursuit.nextFollowUpAt?.toISOString(), expected.toISOString());
});

test('reply escalate portal_link sets needs_human and does not send', async () => {
  const rec = recordingPorts(async () => ({
    toolCalls: [{
      name: 'escalate',
      arguments: {reason: 'portal_link', detail: 'Broker sent an application portal'},
    }],
  }));
  const result = await runTurn(input({
    trigger: 'reply',
    pursuit: contacted(),
    inbound: inbound('Apply here: https://buildium.example/apply'),
  }), rec.ports);

  assert.equal(result.pursuit.needsHumanReason, 'portal_link');
  assert.equal(rec.sent.length, 0);
});

test('mark_dead ends the pursuit without mailing', async () => {
  const rec = recordingPorts(async () => ({
    toolCalls: [{name: 'mark_dead', arguments: {reason: 'Already rented'}}],
  }));
  const result = await runTurn(input({
    trigger: 'reply',
    pursuit: contacted(),
    inbound: inbound('Sorry, this one is gone.'),
  }), rec.ports);

  assert.equal(result.pursuit.stage, 'dead');
  assert.equal(rec.sent.length, 0);
});
