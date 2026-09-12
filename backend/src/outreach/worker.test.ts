import assert from 'node:assert/strict';
import test from 'node:test';

import type {OutreachPorts, Pursuit, TurnInput} from './types.ts';
import {runWorkerCycle} from './worker.ts';
import type {MessageRoute, SyncedMessage, WorkerStore, WorkerUser} from './worker.ts';

const NOW = new Date('2026-09-12T12:00:00Z');

function makeStore(state: {
  users?: WorkerUser[];
  pursuits?: Record<string, Pursuit>;
  synced?: SyncedMessage[];
  sendsToday?: number;
}) {
  const processed = new Set<string>();
  const turnInputs: TurnInput[] = [];
  const persisted: Array<{pursuitId: string; trigger: string}> = [];

  const store: WorkerStore = {
    async listActiveUsers() {
      return state.users ?? [{userId: 'user-1', sendCap: 10, paused: false}];
    },
    async syncUser() {
      return state.synced ?? [];
    },
    async isProcessed(_userId, messageId) {
      return processed.has(messageId);
    },
    async markProcessed(_userId, messageId, _route: MessageRoute) {
      processed.add(messageId);
    },
    async loadTurnInput(_userId, pursuitId, trigger, inbound) {
      const pursuit = state.pursuits?.[pursuitId];
      if (!pursuit) {
        return null;
      }
      const input: TurnInput = {
        pursuit,
        trigger,
        inbound,
        thread: inbound ? [inbound] : [],
        alreadyProcessed: false,
        sendsToday: state.sendsToday ?? 0,
        sendCap: 10,
        now: NOW,
      };
      turnInputs.push(input);
      return input;
    },
    async countSendsToday() {
      return state.sendsToday ?? 0;
    },
    async persistTurn(_userId, pursuitId, trigger) {
      persisted.push({pursuitId, trigger});
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
  };

  return {store, turnInputs, persisted, processed};
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
    sendMail: async message => ({
      threadId: message.threadId ?? 'thread-new',
      messageId: 'msg-out-1',
    }),
    sendPacket: async () => {},
  };
}

test('worker opens matched pursuits and processes broker replies', async () => {
  const {store, persisted} = makeStore({
    pursuits: {
      'p-1': {
        id: 'p-1',
        stage: 'matched',
        needsHumanReason: null,
        threadId: null,
        nextFollowUpAt: null,
        followUpCount: 0,
        listing: {address: '118 Mulberry', price: 7000, bedrooms: 2, bathrooms: 1, brokerage: 'Example'},
        agents: [{name: 'Ava', email: 'ava@broker.example', role: 'primary'}],
        profile: {budgetMax: 8000, bedrooms: 2, availabilityNote: 'evenings', freeText: '', learnedAnswers: []},
      },
      'p-2': {
        id: 'p-2',
        stage: 'contacted',
        needsHumanReason: null,
        threadId: 'thread-1',
        nextFollowUpAt: null,
        followUpCount: 0,
        listing: {address: '200 Grand', price: 6000, bedrooms: 1, bathrooms: 1, brokerage: 'Example'},
        agents: [{name: 'Ben', email: 'ben@broker.example', role: 'primary'}],
        profile: {budgetMax: 7000, bedrooms: 1, availabilityNote: 'evenings', freeText: '', learnedAnswers: []},
      },
    },
    synced: [{
      id: 'msg-1',
      from: 'ben@broker.example',
      to: ['me@example.com'],
      cc: [],
      date: NOW.toISOString(),
      body: 'Tuesday works',
      route: 'reply',
      pursuitId: 'p-2',
    }],
  });

  const report = await runWorkerCycle(store, {
    now: NOW,
    createPorts: () => stubPorts(),
  });

  assert.equal(report.opened, 1);
  assert.equal(report.replies, 1);
  assert.deepEqual(persisted.map(row => row.trigger).sort(), ['open', 'reply']);
});

test('worker sends due follow-ups on contacted pursuits', async () => {
  const due = new Date('2026-09-11T12:00:00Z');
  const {store, persisted} = makeStore({
    pursuits: {
      'p-3': {
        id: 'p-3',
        stage: 'contacted',
        needsHumanReason: null,
        threadId: 'thread-9',
        nextFollowUpAt: due,
        followUpCount: 0,
        listing: {address: '55 Water', price: 5000, bedrooms: 1, bathrooms: 1, brokerage: 'Example'},
        agents: [{name: 'Cara', email: 'cara@broker.example', role: 'primary'}],
        profile: {budgetMax: 6000, bedrooms: 1, availabilityNote: 'evenings', freeText: '', learnedAnswers: []},
      },
    },
  });

  const report = await runWorkerCycle(store, {
    now: NOW,
    createPorts: () => stubPorts(),
  });

  assert.equal(report.followUps, 1);
  assert.deepEqual(persisted, [{pursuitId: 'p-3', trigger: 'follow_up'}]);
});

test('worker skips already-processed messages', async () => {
  const {store, processed} = makeStore({
    synced: [{
      id: 'msg-dup',
      from: 'ava@broker.example',
      to: ['me@example.com'],
      cc: [],
      date: NOW.toISOString(),
      body: 'duplicate',
      route: 'noise',
      pursuitId: null,
    }],
  });
  processed.add('msg-dup');

  const report = await runWorkerCycle(store, {
    now: NOW,
    createPorts: () => stubPorts(),
  });

  assert.equal(report.skippedProcessed, 1);
});
