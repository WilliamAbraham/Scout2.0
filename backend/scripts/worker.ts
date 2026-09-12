import process from 'node:process';

import {createOpenRouterClient} from '../src/outreach/openrouter.ts';
import {runWorkerCycle} from '../src/outreach/worker.ts';
import type {OutreachPorts} from '../src/outreach/types.ts';

/**
 * Worker entry point. The store is not wired to Postgres yet — this script
 * validates env and runs one cycle against an empty in-memory store until
 * the database adapter lands.
 */
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 300_000);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const emptyStore = {
  async listActiveUsers() {
    return [];
  },
  async syncUser() {
    return [];
  },
  async isProcessed() {
    return false;
  },
  async markProcessed() {},
  async loadTurnInput() {
    return null;
  },
  async countSendsToday() {
    return 0;
  },
  async persistTurn() {},
  async listDueFollowUps() {
    return [];
  },
  async listReadyToOpen() {
    return [];
  },
};

function createPorts(_userId: string): OutreachPorts {
  const llm = createOpenRouterClient({
    apiKey: requireEnv('OPENROUTER_API_KEY'),
    model: process.env.OPENROUTER_MODEL,
    appUrl: process.env.OPENROUTER_APP_URL,
  });
  return {
    llm,
    checkAvailability: async () => ({free: true}),
    bookTour: async () => ({eventId: 'stub'}),
    sendMail: async message => ({
      threadId: message.threadId ?? 'stub-thread',
      messageId: 'stub-message',
    }),
    sendPacket: async () => {},
  };
}

async function tick() {
  const report = await runWorkerCycle(emptyStore, {createPorts});
  console.log(JSON.stringify({at: new Date().toISOString(), ...report}));
}

const once = process.argv.includes('--once');
if (once) {
  await tick();
} else {
  await tick();
  setInterval(() => {
    tick().catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
  }, POLL_MS);
}
