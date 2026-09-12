import assert from 'node:assert/strict';
import test from 'node:test';

import type {AlertMessageResult} from '../pipeline/alert.ts';
import type {MessageRoute} from '../pipeline/routing.ts';
import type {OutreachPorts, Pursuit, TurnInput} from './types.ts';
import {runWorkerCycle} from './worker.ts';
import type {SyncReport, SyncedMessage, WorkerStore, WorkerUser} from './worker.ts';

const NOW = new Date('2026-09-12T12:00:00Z');

function syncedMessage(overrides: Partial<SyncedMessage> = {}): SyncedMessage {
  return {
    id: 'msg-1',
    threadId: 'thread-1',
    from: 'ben@broker.example',
    to: ['me@example.com'],
    cc: [],
    subject: 'Re: Tour request',
    date: NOW.toISOString(),
    sentAt: NOW,
    body: 'Tuesday works',
    textBody: 'Tuesday works',
    htmlBody: null,
    rfcMessageId: '<abc@mail>',
    inReplyTo: null,
    route: 'reply',
    routeReason: 'thread_match',
    pursuitId: 'p-2',
    ...overrides,
  };
}

function alertResult(overrides: Partial<AlertMessageResult> = {}): AlertMessageResult {
  return {messageId: 'msg-a', layout: 'listing_cards', listings: [], malformed: [], ...overrides};
}

type Recorder = {
  processed: Array<{id: string; route: MessageRoute; outcome: Record<string, unknown>}>;
  retried: Array<{id: string; error: string}>;
  checkpoints: string[];
  inbound: string[];
  persisted: Array<{pursuitId: string; trigger: string}>;
  turnInputs: TurnInput[];
  syncErrors: string[];
};

function makeStore(state: {
  users?: WorkerUser[];
  pursuits?: Record<string, Pursuit>;
  messages?: SyncedMessage[];
  sendsToday?: number;
  alert?: () => Promise<AlertMessageResult>;
  failTurn?: boolean;
  syncThrows?: boolean;
  done?: Set<string>;
  attempts?: Map<string, number>;
}) {
  const done = state.done ?? new Set<string>();
  const attempts = state.attempts ?? new Map<string, number>();
  const recorder: Recorder = {
    processed: [], retried: [], checkpoints: [], inbound: [], persisted: [], turnInputs: [], syncErrors: [],
  };

  const store: WorkerStore = {
    async listActiveUsers() {
      return state.users ?? [{userId: 'user-1', sendCap: 10, paused: false}];
    },
    async syncUser(): Promise<SyncReport> {
      if (state.syncThrows) throw new Error('mailbox unreachable');
      return {
        messages: state.messages ?? [],
        checkpoint: 'history-77',
        mailbox: 'me@example.com',
        mode: 'incremental',
        truncated: false,
        historyExpired: false,
        fetched: (state.messages ?? []).length,
        retried: 0,
      };
    },
    async saveCheckpoint(_userId, checkpoint) {
      recorder.checkpoints.push(checkpoint);
    },
    async recordSyncError(_userId, error) {
      recorder.syncErrors.push(error);
    },
    async isProcessed(_userId, messageId) {
      return done.has(messageId);
    },
    async markProcessed(_userId, messageId, route, outcome = {}) {
      done.add(messageId);
      recorder.processed.push({id: messageId, route, outcome});
    },
    async markRetry(_userId, messageId, _route, error) {
      const next = (attempts.get(messageId) ?? 0) + 1;
      attempts.set(messageId, next);
      recorder.retried.push({id: messageId, error});
      return next >= 4 ? {status: 'exhausted', attempts: next} : {status: 'retry', attempts: next};
    },
    async saveInboundMessage(_userId, message) {
      recorder.inbound.push(message.id);
    },
    async loadTurnInput(_userId, pursuitId, trigger, inbound) {
      const pursuit = state.pursuits?.[pursuitId];
      if (!pursuit) return null;
      const input: TurnInput = {
        pursuit, trigger, inbound,
        thread: inbound ? [inbound] : [],
        alreadyProcessed: false,
        sendsToday: state.sendsToday ?? 0,
        sendCap: 10,
        now: NOW,
      };
      recorder.turnInputs.push(input);
      return input;
    },
    async countSendsToday() {
      return state.sendsToday ?? 0;
    },
    async persistTurn(_userId, pursuitId, trigger) {
      if (state.failTurn) throw new Error('database unavailable');
      recorder.persisted.push({pursuitId, trigger});
    },
    async listDueFollowUps(_userId, at) {
      return Object.entries(state.pursuits ?? {})
        .filter(([, pursuit]) => pursuit.nextFollowUpAt && pursuit.nextFollowUpAt <= at)
        .map(([id]) => id);
    },
    async listReadyToOpen() {
      return Object.entries(state.pursuits ?? {})
        .filter(([, pursuit]) => pursuit.stage === 'matched' && pursuit.needsHumanReason === null)
        .map(([id]) => id);
    },
    async recordIngestProblem() {},
  };

  return {store, recorder, done, attempts};
}

function pursuit(overrides: Partial<Pursuit> & {id: string}): Pursuit {
  return {
    stage: 'matched',
    needsHumanReason: null,
    threadId: null,
    nextFollowUpAt: null,
    followUpCount: 0,
    listing: {address: '118 Mulberry', price: 7000, bedrooms: 2, bathrooms: 1, brokerage: 'Example'},
    agents: [{name: 'Ava', email: 'ava@broker.example', role: 'primary'}],
    profile: {budgetMax: 8000, bedrooms: 2, availabilityNote: 'evenings', freeText: '', learnedAnswers: []},
    ...overrides,
  };
}

function stubPorts(): OutreachPorts {
  return {
    llm: {
      complete: async input => ({
        text: input.tools.length === 0 ? 'Hello from Scout' : undefined,
        toolCalls: input.tools.length === 0 ? [] : [{name: 'send_reply', arguments: {body: 'Thanks!'}}],
      }),
    },
    checkAvailability: async () => ({free: true}),
    bookTour: async () => ({eventId: 'evt-1'}),
    sendMail: async message => ({threadId: message.threadId ?? 'thread-new', messageId: 'msg-out-1'}),
    sendPacket: async () => {},
  };
}

test('worker opens matched pursuits and processes broker replies', async () => {
  const {store, recorder} = makeStore({
    pursuits: {
      'p-1': pursuit({id: 'p-1'}),
      'p-2': pursuit({id: 'p-2', stage: 'contacted', threadId: 'thread-1'}),
    },
    messages: [syncedMessage()],
  });

  const report = await runWorkerCycle(store, {now: NOW, createPorts: () => stubPorts()});

  assert.equal(report.opened, 1);
  assert.equal(report.replies, 1);
  assert.deepEqual(recorder.persisted.map(row => row.trigger).sort(), ['open', 'reply']);
});

test('a broker reply is persisted before the agent acts on it', async () => {
  // A crash mid-turn must still leave the broker's own words on record.
  const {store, recorder} = makeStore({
    pursuits: {'p-2': pursuit({id: 'p-2', stage: 'contacted', threadId: 'thread-1'})},
    messages: [syncedMessage()],
    failTurn: true,
  });

  await runWorkerCycle(store, {now: NOW, createPorts: () => stubPorts()});

  assert.deepEqual(recorder.inbound, ['msg-1']);
  assert.equal(recorder.processed.length, 0, 'a failed turn must not mark the reply handled');
  assert.equal(recorder.retried.length, 1);
});

test('worker sends due follow-ups on contacted pursuits', async () => {
  const due = new Date('2026-09-11T12:00:00Z');
  const {store, recorder} = makeStore({
    pursuits: {'p-3': pursuit({id: 'p-3', stage: 'contacted', threadId: 'thread-9', nextFollowUpAt: due})},
  });

  const report = await runWorkerCycle(store, {now: NOW, createPorts: () => stubPorts()});

  assert.equal(report.followUps, 1);
  assert.deepEqual(recorder.persisted, [{pursuitId: 'p-3', trigger: 'follow_up'}]);
});

test('worker skips already-processed messages', async () => {
  const {store} = makeStore({
    messages: [syncedMessage({id: 'msg-dup', route: 'noise', pursuitId: null})],
    done: new Set(['msg-dup']),
  });

  const report = await runWorkerCycle(store, {now: NOW, createPorts: () => stubPorts()});
  assert.equal(report.skippedProcessed, 1);
});

test('an alert is marked handled only after every card is accounted for', async () => {
  const {store, recorder} = makeStore({
    messages: [syncedMessage({id: 'msg-a', route: 'alert', pursuitId: null, from: 'noreply@email.streeteasy.com'})],
  });

  const report = await runWorkerCycle(store, {
    now: NOW,
    createPorts: () => stubPorts(),
    processAlert: async () => alertResult({
      listings: [
        {rentalId: '1', status: 'ready', pursuitId: 'p-1'},
        {rentalId: '2', status: 'skipped', reason: 'not_matched'},
      ],
    }),
  });

  assert.equal(report.alerts, 1);
  assert.equal(report.listings, 2);
  assert.equal(report.alertReady, 1);
  assert.deepEqual(recorder.processed.map(row => row.id), ['msg-a']);
  assert.deepEqual(recorder.checkpoints, ['history-77']);
});

test('a listing that failed before persistence leaves the alert for a retry', async () => {
  const {store, recorder} = makeStore({
    messages: [syncedMessage({id: 'msg-a', route: 'alert', pursuitId: null})],
  });

  const report = await runWorkerCycle(store, {
    now: NOW,
    createPorts: () => stubPorts(),
    processAlert: async () => alertResult({
      listings: [{rentalId: '1', status: 'error', reason: 'connection reset'}],
    }),
  });

  assert.equal(recorder.processed.length, 0);
  assert.equal(report.retries, 1);
  assert.match(recorder.retried[0]?.error ?? '', /connection reset/);
  assert.deepEqual(recorder.checkpoints, [], 'the cursor must not pass mail awaiting a retry');
});

test('a deferred listing brings the alert back instead of escalating it', async () => {
  const {store, recorder} = makeStore({
    messages: [syncedMessage({id: 'msg-a', route: 'alert', pursuitId: null})],
  });

  const report = await runWorkerCycle(store, {
    now: NOW,
    createPorts: () => stubPorts(),
    processAlert: async () => alertResult({
      listings: [
        {rentalId: '1', status: 'ready', pursuitId: 'p-1'},
        {rentalId: '2', status: 'deferred', pursuitId: 'p-2', reason: 'budget_exhausted', detail: 'daily allowance spent'},
      ],
    }),
  });

  assert.equal(report.deferredListings, 1);
  assert.equal(recorder.processed.length, 0, 'the alert is not finished while a card still needs enriching');
  assert.equal(report.retries, 1);
  assert.match(recorder.retried[0]?.error ?? '', /budget_exhausted/);
});

test('malformed cards do not discard the alert, and are reported', async () => {
  const problems: Array<Record<string, unknown>> = [];
  const {store, recorder} = makeStore({
    messages: [syncedMessage({id: 'msg-a', route: 'alert', pursuitId: null})],
  });
  store.recordIngestProblem = async (_userId, detail) => { problems.push(detail); };

  const report = await runWorkerCycle(store, {
    now: NOW,
    createPorts: () => stubPorts(),
    processAlert: async () => alertResult({
      listings: [{rentalId: '1', status: 'ready', pursuitId: 'p-1'}],
      malformed: [{index: 1, reason: 'missing price', address: '9 Grand'}],
    }),
  });

  assert.equal(report.malformedCards, 1);
  assert.equal(report.alertReady, 1);
  assert.deepEqual(recorder.processed.map(row => row.id), ['msg-a'], 'the readable cards still land');
  assert.equal(problems.length, 1);
});

test('an unsupported alert layout is surfaced, not silently marked empty', async () => {
  const {store, recorder} = makeStore({
    messages: [syncedMessage({id: 'msg-a', route: 'alert', pursuitId: null})],
  });

  const report = await runWorkerCycle(store, {
    now: NOW,
    createPorts: () => stubPorts(),
    processAlert: async () => alertResult({layout: 'unsupported'}),
  });

  assert.equal(report.unsupportedAlerts, 1);
  assert.equal(recorder.processed[0]?.outcome.layout, 'unsupported');
});

test('a message that keeps failing is exhausted rather than retried forever', async () => {
  const attempts = new Map([['msg-1', 3]]);
  const {store, recorder} = makeStore({
    pursuits: {'p-2': pursuit({id: 'p-2', stage: 'contacted', threadId: 'thread-1'})},
    messages: [syncedMessage()],
    failTurn: true,
    attempts,
  });

  const report = await runWorkerCycle(store, {now: NOW, createPorts: () => stubPorts()});

  assert.equal(report.exhausted, 1);
  assert.equal(report.retries, 0);
  assert.equal(recorder.retried.length, 1);
});

test('a mailbox that cannot be read is recorded, not thrown', async () => {
  const {store, recorder} = makeStore({syncThrows: true});
  const report = await runWorkerCycle(store, {now: NOW, createPorts: () => stubPorts()});

  assert.equal(report.synced, 0);
  assert.deepEqual(recorder.syncErrors, ['mailbox unreachable']);
  assert.deepEqual(recorder.checkpoints, []);
});

test('a paused owner is left alone', async () => {
  const {store, recorder} = makeStore({
    users: [{userId: 'user-1', sendCap: 10, paused: true}],
    pursuits: {'p-1': pursuit({id: 'p-1'})},
    messages: [syncedMessage()],
  });

  const report = await runWorkerCycle(store, {now: NOW, createPorts: () => stubPorts()});
  assert.deepEqual({opened: report.opened, replies: report.replies}, {opened: 0, replies: 0});
  assert.deepEqual(recorder.processed, []);
});

test('a shutdown request stops the cycle without advancing the cursor', async () => {
  const {store, recorder} = makeStore({
    pursuits: {'p-1': pursuit({id: 'p-1'})},
    messages: [syncedMessage(), syncedMessage({id: 'msg-2'})],
  });

  await runWorkerCycle(store, {now: NOW, createPorts: () => stubPorts(), shouldStop: () => true});

  assert.deepEqual(recorder.processed, []);
  assert.deepEqual(recorder.checkpoints, []);
});
