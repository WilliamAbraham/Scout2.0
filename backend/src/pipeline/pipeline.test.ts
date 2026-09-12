import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {REPO_ROOT} from '../paths.ts';
import type {EmailListing, EnrichmentResult} from '../enrichment/service.ts';
import {runWorkerCycle} from '../outreach/worker.ts';
import type {SyncedMessage} from '../outreach/worker.ts';
import type {OutreachPorts} from '../outreach/types.ts';
import {processStreetEasyAlert} from './alert.ts';
import type {AlertPipelineDeps} from './alert.ts';
import {MemoryStore} from './memoryStore.ts';
import {routeMessage} from './routing.ts';

/**
 * The whole ingestion path, end to end, with no database and no network:
 * a real alert email → the real parser → listing and pursuit records →
 * matching → enrichment → the outreach handoff.
 *
 * The cases below are the failures that would otherwise lose mail quietly:
 * duplicate delivery, a restart mid-conversation, two workers on one mailbox,
 * a malformed card, an unknown template, a transient outage, and an exhausted
 * budget.
 */

const NOW = new Date('2026-09-12T12:00:00Z');
const FIXTURE = path.join(REPO_ROOT, 'backend/fixtures/alerts/two-listings.html');

async function alertHtml(): Promise<string> {
  return readFile(FIXTURE, 'utf8');
}

/** The tracking links in the fixture, resolved without touching the network. */
function stubRedirects(): () => void {
  const original = globalThis.fetch;
  const ids: Record<string, string> = {aaa: '111', bbb: '222', ccc: '333'};
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const token = /_t=(\w+)/.exec(url)?.[1] ?? '';
    if (init?.redirect === 'manual' && ids[token]) {
      return new Response(null, {
        status: 302,
        headers: {Location: `https://streeteasy.com/rental/${ids[token]}`},
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function message(overrides: Partial<SyncedMessage> = {}): SyncedMessage {
  return {
    id: 'alert-1',
    threadId: 'thread-alert-1',
    from: 'StreetEasy <noreply@email.streeteasy.com>',
    to: ['renter@example.com'],
    cc: [],
    subject: '3 Results for Manhattan - 9/12/26',
    date: NOW.toISOString(),
    sentAt: NOW,
    body: '',
    textBody: null,
    htmlBody: null,
    rfcMessageId: '<alert-1@streeteasy>',
    inReplyTo: null,
    route: 'alert',
    routeReason: 'streeteasy_alert',
    pursuitId: null,
    ...overrides,
  };
}

function enrichmentFor(input: EmailListing, overrides: Partial<EnrichmentResult> = {}): EnrichmentResult {
  return {
    status: 'source_matched',
    execution: 'completed',
    input,
    brokerageUrl: 'https://broker.example',
    listingUrl: 'https://broker.example/listing',
    agents: [{
      name: 'Ava Agent',
      profileUrl: null,
      email: 'ava@broker.example',
      phone: null,
      role: 'primary',
      attributionEvidence: 'Listed by Ava Agent',
      contactEvidence: 'ava@broker.example',
      sourceUrl: 'https://broker.example/listing',
      attributionSourceUrl: 'https://broker.example/listing',
      emailSourceUrl: 'https://broker.example/listing',
      phoneSourceUrl: null,
    }],
    candidateAgents: [],
    sourceListing: null,
    rosterCompleteness: 'source_only',
    outreachReady: true,
    checkedAt: NOW.toISOString(),
    issues: [],
    warnings: [],
    attempts: [],
    contactRoutes: [],
    resolution: 'agents_verified',
    ...overrides,
  };
}

function ports(): OutreachPorts {
  return {
    llm: {
      complete: async input => input.tools.length === 0
        ? {text: 'Hi, could I see this apartment this week?', toolCalls: []}
        : {toolCalls: [{name: 'send_reply' as const, arguments: {body: 'Thursday at 6 works for me.'}}]},
    },
    checkAvailability: async () => ({free: true}),
    bookTour: async () => ({eventId: 'evt-1'}),
    sendMail: async message => ({threadId: message.threadId ?? 'thread-broker-1', messageId: 'sent-1'}),
    sendPacket: async () => {},
  };
}

/** Drive one cycle with the real alert stage wired to `store`. */
async function cycle(
  store: MemoryStore,
  html: string,
  enrich: AlertPipelineDeps['enrich'],
  at = NOW,
) {
  const deps: AlertPipelineDeps = {store, enrich};
  return runWorkerCycle(store, {
    now: at,
    createPorts: () => ports(),
    processAlert: async (userId, synced) => processStreetEasyAlert(userId, {
      id: synced.id,
      from: synced.from,
      date: synced.date,
      subject: synced.subject,
      htmlBody: html,
    }, deps),
  });
}

test('an alert becomes listings, pursuits, contacts, and an outreach draft', async () => {
  const restore = stubRedirects();
  try {
    const html = await alertHtml();
    const store = new MemoryStore({dryRun: true, inbox: [[message()]]});
    const report = await cycle(store, html, async input => enrichmentFor(input));

    // Both readable cards are persisted; the priceless third is not invented.
    assert.equal(store.listings.size, 2);
    assert.deepEqual([...store.listings.keys()].sort(), ['111', '222']);
    assert.equal(report.malformedCards, 1);
    assert.equal(report.listings, 2);
    assert.equal(report.alertReady, 2);

    // Every pursuit reached a verified contact and a composed draft.
    assert.equal(store.pursuits.size, 2);
    for (const pursuit of store.pursuits.values()) {
      assert.equal(pursuit.contactSnapshot?.contacts[0]?.email, 'ava@broker.example');
      assert.equal(pursuit.needsHumanReason, null);
    }
    assert.equal(report.opened, 2);
    assert.equal(store.events.filter(event => event.type === 'draft_composed').length, 2);

    // Dry-run sends nothing and advances no pursuit.
    assert.equal(store.events.filter(event => event.type === 'email_sent').length, 0);
    assert.equal(store.checkpoint, 'history-1');
  } finally {
    restore();
  }
});

test('listings that miss the profile stay visible without a pursuit', async () => {
  const restore = stubRedirects();
  try {
    const store = new MemoryStore({
      dryRun: true,
      // $7,495 is over budget; $6,995 is not.
      profile: {budgetMin: null, budgetMax: 7000, bedroomsMin: null, bedroomsMax: null, bathroomsMin: null},
      inbox: [[message()]],
    });
    await cycle(store, await alertHtml(), async input => enrichmentFor(input));

    assert.equal(store.userListings.length, 2, 'a non-match is still in the feed');
    assert.equal(store.userListings.filter(row => row.isMatch).length, 1);
    assert.equal(store.pursuits.size, 1, 'only the match is pursued');
    assert.match(store.userListings.find(row => !row.isMatch)?.reason ?? '', /over the \$7000 budget/);
  } finally {
    restore();
  }
});

test('the same alert delivered twice does not open outreach twice', async () => {
  const restore = stubRedirects();
  try {
    const html = await alertHtml();
    const store = new MemoryStore({dryRun: true, inbox: [[message()], [message()]]});
    const enrich = async (input: EmailListing) => enrichmentFor(input);

    const first = await cycle(store, html, enrich);
    const second = await cycle(store, html, enrich);

    assert.equal(first.opened, 2);
    // The ledger filters the repeat out at sync, so the alert is never parsed
    // a second time and no pursuit gets a second draft.
    assert.equal(second.synced, 0);
    assert.equal(second.opened, 0);
    assert.equal(store.pursuits.size, 2);
    assert.equal(store.events.filter(event => event.type === 'draft_composed').length, 2);
    assert.equal(store.ledgerFor('user-1', 'alert-1')?.attempts, 1);
  } finally {
    restore();
  }
});

test('a transient enrichment outage is retried, not escalated', async () => {
  const restore = stubRedirects();
  try {
    const html = await alertHtml();
    const store = new MemoryStore({dryRun: true, inbox: [[message()], [message()]]});

    let attempt = 0;
    const enrich = async (input: EmailListing) => {
      attempt += 1;
      if (attempt <= 2) throw new Error('source timed out');
      return enrichmentFor(input);
    };

    const first = await cycle(store, html, enrich);
    assert.equal(first.deferredListings, 2);
    assert.equal(first.retries, 1);
    assert.equal(store.checkpoint, null, 'the cursor waits for the retry');
    for (const pursuit of store.pursuits.values()) {
      assert.equal(pursuit.needsHumanReason, null, 'an outage is not the owner’s problem to resolve');
    }

    // After the backoff, the same message is re-read and finishes.
    const later = new Date(NOW.getTime() + 6 * 60_000);
    const second = await cycle(store, html, enrich, later);
    assert.equal(second.alertReady, 2);
    assert.equal(store.ledgerFor('user-1', 'alert-1')?.status, 'done');
    assert.equal(store.checkpoint, 'history-2');
  } finally {
    restore();
  }
});

test('an exhausted budget defers without charging the same listing twice', async () => {
  const restore = stubRedirects();
  try {
    const html = await alertHtml();
    const store = new MemoryStore({dryRun: true, inbox: [[message()], [message()]]});

    let calls = 0;
    const enrich = async (input: EmailListing) => {
      calls += 1;
      if (calls <= 2) {
        return enrichmentFor(input, {execution: 'budget_exhausted', agents: [], outreachReady: false});
      }
      return enrichmentFor(input);
    };

    const first = await cycle(store, html, enrich);
    assert.equal(first.deferredListings, 2);
    assert.equal(first.opened, 0);
    for (const pursuit of store.pursuits.values()) {
      assert.equal(pursuit.enrichedAt, null, 'a budget stop must not look like a finished enrichment');
    }

    const second = await cycle(store, html, enrich, new Date(NOW.getTime() + 6 * 60_000));
    assert.equal(second.alertReady, 2);
    assert.equal(calls, 4, 'each listing is enriched once per attempt, never twice in one');
  } finally {
    restore();
  }
});

test('a listing with no verified contact escalates instead of emailing', async () => {
  const restore = stubRedirects();
  try {
    const store = new MemoryStore({dryRun: true, inbox: [[message()]]});
    const report = await cycle(store, await alertHtml(), async input =>
      enrichmentFor(input, {agents: [], outreachReady: false, resolution: 'unresolved'}));

    assert.equal(report.alertReady, 0);
    assert.equal(report.opened, 0);
    for (const pursuit of store.pursuits.values()) {
      assert.equal(pursuit.needsHumanReason, 'no_contact');
    }
    assert.equal(store.events.filter(event => event.type === 'escalated').length, 2);
  } finally {
    restore();
  }
});

test('an unknown template is recorded as unsupported, not as an empty alert', async () => {
  const store = new MemoryStore({dryRun: true, inbox: [[message()]]});
  const report = await cycle(
    store,
    '<div class="ListingTile">A redesigned card</div><a href="https://streeteasy.com/rental/404">See it</a>',
    async input => enrichmentFor(input),
  );

  assert.equal(report.unsupportedAlerts, 1);
  assert.equal(store.listings.size, 0);
  assert.equal(store.ledgerFor('user-1', 'alert-1')?.outcome.layout, 'unsupported');
});

test('a broker reply routes to its pursuit, and still does after a restart', async () => {
  const restore = stubRedirects();
  try {
    const html = await alertHtml();
    const live = new MemoryStore({inbox: [[message()]], clock: () => NOW});
    await cycle(live, html, async input => enrichmentFor(input));

    const pursuit = [...live.pursuits.values()][0]!;
    assert.equal(pursuit.stage, 'contacted');
    assert.ok(pursuit.threadId, 'the opening email recorded a thread id');

    // A fresh process: nothing in memory but what the store persisted.
    const reply = {
      id: 'reply-1',
      threadId: pursuit.threadId!,
      from: 'Ava Agent <ava@broker.example>',
      to: ['renter@example.com'],
      cc: [],
      subject: 'Re: Tour request',
      date: NOW.toISOString(),
      sentAt: new Date(NOW.getTime() + 3_600_000),
      body: 'Thursday at 6 works.',
      textBody: 'Thursday at 6 works.',
      htmlBody: null,
      rfcMessageId: '<reply-1@broker>',
      inReplyTo: '<alert-1@streeteasy>',
      route: 'noise' as const,
      routeReason: '',
      pursuitId: null,
    };

    const routed = routeMessage({
      id: reply.id, threadId: reply.threadId, subject: reply.subject, from: reply.from,
      date: reply.date, snippet: '', textBody: reply.textBody, htmlBody: null,
    }, {
      threads: new Map([[pursuit.threadId!, pursuit.id]]),
      contacts: new Map([['ava@broker.example', pursuit.id]]),
      selfAddress: 'renter@example.com',
    });
    assert.deepEqual({route: routed.route, pursuitId: routed.pursuitId}, {route: 'reply', pursuitId: pursuit.id});

    live.cycles = 0;
    const restarted = new MemoryStore({
      inbox: [[{...reply, ...routed}]],
      clock: () => new Date(NOW.getTime() + 7_200_000),
    });
    // Carry over exactly what a database would have kept.
    for (const [id, row] of live.pursuits) restarted.pursuits.set(id, row);
    restarted.threads.push(...live.threads);

    const report = await runWorkerCycle(restarted, {now: NOW, createPorts: () => ports()});

    assert.equal(report.replies, 1);
    const thread = await restarted.loadThread('user-1', pursuit.id);
    assert.deepEqual(
      thread.map(row => row.from),
      ['me', 'Ava Agent <ava@broker.example>', 'me'],
      'the opening email survived the restart, and the reply and answer joined it',
    );
    assert.match(thread[2]?.body ?? '', /Thursday/);
  } finally {
    restore();
  }
});

test('a second worker on the same mailbox declines the lease', async () => {
  const store = new MemoryStore();
  assert.equal(store.acquireLease('mailbox:default', 'worker-a', 600_000, NOW), true);
  assert.equal(store.acquireLease('mailbox:default', 'worker-b', 600_000, NOW), false);

  // Only after the holder's lease lapses can another process take over.
  const later = new Date(NOW.getTime() + 601_000);
  assert.equal(store.acquireLease('mailbox:default', 'worker-b', 600_000, later), true);

  store.releaseLease('mailbox:default', 'worker-b');
  assert.equal(store.acquireLease('mailbox:default', 'worker-a', 600_000, later), true);
});

test('a message that never succeeds is exhausted and stays visible', async () => {
  const restore = stubRedirects();
  try {
    const html = await alertHtml();
    const inbox = Array.from({length: MemoryStore.MAX_ATTEMPTS}, () => [message()]);
    const store = new MemoryStore({dryRun: true, inbox});
    const enrich = async () => { throw new Error('source permanently down'); };

    let at = NOW;
    for (let cycleIndex = 0; cycleIndex < MemoryStore.MAX_ATTEMPTS; cycleIndex++) {
      await cycle(store, html, enrich, at);
      at = new Date(at.getTime() + 7 * 86_400_000);
    }

    const row = store.ledgerFor('user-1', 'alert-1');
    assert.equal(row?.status, 'exhausted');
    assert.equal(row?.attempts, MemoryStore.MAX_ATTEMPTS);
    assert.match(row?.lastError ?? '', /permanently down/);
    assert.equal(store.pursuits.size, 2, 'the listings themselves were still persisted');
  } finally {
    restore();
  }
});
