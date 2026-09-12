import type {ContactSnapshot} from '../db/schema/pursuits.ts';
import type {NeedsHumanReason, PursuitStage} from '../db/schema/enums.ts';
import type {Listing as GmailListing} from '../gmail/listings.ts';
import type {
  MessageRoute,
  SyncReport,
  SyncedMessage,
  WorkerStore,
  WorkerUser,
} from '../outreach/worker.ts';
import type {
  Pursuit,
  ThreadMessage,
  TurnInput,
  TurnResult,
  TurnTrigger,
} from '../outreach/types.ts';
import type {AlertStore, IngestOutcome} from './alert.ts';
import {agentsForOutreach} from './contacts.ts';
import {matchListing} from './match.ts';
import type {MatchCriteria} from './match.ts';
import {MAX_ATTEMPTS, nextAttemptAt} from './routing.ts';

/**
 * The same persistence contract as `PostgresStore`, kept in memory.
 *
 * This exists so the worker's durability rules — dedupe, bounded retry,
 * cursor advance, thread history across a restart — can be exercised end to
 * end without a database. It is test scaffolding, not a second production
 * store: nothing in `scripts/` constructs it.
 */

type LedgerRow = {
  route: MessageRoute;
  status: 'done' | 'retry' | 'exhausted';
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  outcome: Record<string, unknown>;
};

type PursuitRow = {
  id: string;
  userId: string;
  rentalId: string;
  stage: PursuitStage;
  needsHumanReason: NeedsHumanReason | null;
  needsHumanNote: string | null;
  threadId: string | null;
  contactSnapshot: ContactSnapshot | null;
  enrichedAt: Date | null;
  nextFollowUpAt: Date | null;
  followUpCount: number;
  listing: GmailListing;
};

export type MemoryStoreOptions = {
  dryRun?: boolean;
  profile?: MatchCriteria | null;
  sendCap?: number;
  paused?: boolean;
  /** Queued mailbox polls, one per cycle. */
  inbox?: SyncedMessage[][];
  /** Test clock, so outbound mail is ordered against inbound deterministically. */
  clock?: () => Date;
};

export class MemoryStore implements WorkerStore, AlertStore {
  readonly listings = new Map<string, GmailListing>();
  /** Every (user, listing) row, matched or not: the dashboard feed. */
  readonly userListings: Array<{userId: string; rentalId: string; isMatch: boolean; reason: string}> = [];
  readonly pursuits = new Map<string, PursuitRow>();
  readonly ledger = new Map<string, LedgerRow>();
  readonly threads: Array<{userId: string; pursuitId: string | null; direction: 'inbound' | 'outbound'; id: string; from: string; body: string; sentAt: Date}> = [];
  readonly events: Array<{pursuitId: string; type: string}> = [];
  readonly leases = new Map<string, {holder: string; expiresAt: Date}>();
  checkpoint: string | null = null;
  syncError: string | null = null;
  /** Cycles this store has served, so an inbox script can vary per cycle. */
  cycles = 0;

  private readonly options: MemoryStoreOptions;
  private nextId = 1;

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }

  constructor(options: MemoryStoreOptions = {}) {
    this.options = options;
  }

  private id(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  private key(userId: string, messageId: string): string {
    return `${userId}:${messageId}`;
  }

  // ---- leases -------------------------------------------------------------

  acquireLease(name: string, holder: string, ttlMs: number, at = new Date()): boolean {
    const held = this.leases.get(name);
    if (held && held.holder !== holder && held.expiresAt > at) {
      return false;
    }
    this.leases.set(name, {holder, expiresAt: new Date(at.getTime() + ttlMs)});
    return true;
  }

  releaseLease(name: string, holder: string): void {
    if (this.leases.get(name)?.holder === holder) this.leases.delete(name);
  }

  // ---- worker store -------------------------------------------------------

  async listActiveUsers(): Promise<WorkerUser[]> {
    return [{userId: 'user-1', sendCap: this.options.sendCap ?? 10, paused: this.options.paused ?? false}];
  }

  async syncUser(_userId: string, at: Date): Promise<SyncReport> {
    const queued = this.options.inbox?.[this.cycles] ?? [];
    this.cycles += 1;

    const retryIds = await this.listRetryable(_userId, at);
    const fresh = queued.filter(message => {
      const row = this.ledger.get(this.key(_userId, message.id));
      if (!row) return true;
      if (row.status === 'done' || row.status === 'exhausted') return false;
      return !row.nextAttemptAt || row.nextAttemptAt <= at;
    });
    const byId = new Map(queued.map(message => [message.id, message]));
    const retried = retryIds.flatMap(id => {
      const message = byId.get(id);
      return message && !fresh.includes(message) ? [message] : [];
    });

    return {
      messages: [...fresh, ...retried],
      checkpoint: `history-${this.cycles}`,
      mailbox: 'renter@example.com',
      mode: 'incremental',
      truncated: false,
      historyExpired: false,
      fetched: queued.length,
      retried: retried.length,
    };
  }

  async saveCheckpoint(_userId: string, checkpoint: string): Promise<void> {
    this.checkpoint = checkpoint;
  }

  async recordSyncError(_userId: string, error: string): Promise<void> {
    this.syncError = error;
  }

  async isProcessed(userId: string, messageId: string): Promise<boolean> {
    const status = this.ledger.get(this.key(userId, messageId))?.status;
    return status === 'done' || status === 'exhausted';
  }

  async listRetryable(userId: string, at: Date): Promise<string[]> {
    const ids: string[] = [];
    for (const [key, row] of this.ledger) {
      if (!key.startsWith(`${userId}:`)) continue;
      if (row.status === 'retry' && row.nextAttemptAt && row.nextAttemptAt <= at) {
        ids.push(key.slice(userId.length + 1));
      }
    }
    return ids;
  }

  async markProcessed(
    userId: string,
    messageId: string,
    route: MessageRoute,
    outcome: Record<string, unknown> = {},
  ): Promise<void> {
    const existing = this.ledger.get(this.key(userId, messageId));
    this.ledger.set(this.key(userId, messageId), {
      route, status: 'done', attempts: existing?.attempts ?? 1,
      nextAttemptAt: null, lastError: null, outcome,
    });
  }

  async markRetry(
    userId: string,
    messageId: string,
    route: MessageRoute,
    error: string,
    at: Date,
  ): Promise<{status: 'done' | 'retry' | 'exhausted'; attempts: number}> {
    const attempts = (this.ledger.get(this.key(userId, messageId))?.attempts ?? 0) + 1;
    const next = nextAttemptAt(attempts, at);
    const status = next ? 'retry' as const : 'exhausted' as const;
    this.ledger.set(this.key(userId, messageId), {
      route, status, attempts, nextAttemptAt: next, lastError: error, outcome: {},
    });
    return {status, attempts};
  }

  async saveInboundMessage(userId: string, message: SyncedMessage): Promise<void> {
    if (this.threads.some(row => row.userId === userId && row.id === message.id)) {
      return;
    }
    this.threads.push({
      userId, pursuitId: message.pursuitId, direction: 'inbound',
      id: message.id, from: message.from, body: message.body, sentAt: message.sentAt,
    });
    if (message.pursuitId) this.events.push({pursuitId: message.pursuitId, type: 'reply_received'});
  }

  async loadThread(userId: string, pursuitId: string): Promise<ThreadMessage[]> {
    return this.threads
      .filter(row => row.userId === userId && row.pursuitId === pursuitId)
      .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
      .map(row => ({id: row.id, from: row.from, to: [], cc: [], date: row.sentAt.toISOString(), body: row.body}));
  }

  async recordIngestProblem(): Promise<void> {}

  // ---- alert store --------------------------------------------------------

  async ingestListing(
    userId: string,
    source: {messageId: string; receivedAt: Date},
    listing: GmailListing,
  ): Promise<IngestOutcome> {
    this.listings.set(listing.rentalId, listing);

    let feed = this.userListings.find(row => row.userId === userId && row.rentalId === listing.rentalId);
    const isNew = !feed;
    if (!feed) {
      const match = matchListing({
        price: listing.price,
        bedrooms: Number.isFinite(listing.bedrooms) ? listing.bedrooms : null,
        bathrooms: Number.isFinite(listing.bathrooms) ? listing.bathrooms : null,
      }, this.options.profile ?? null);
      feed = {userId, rentalId: listing.rentalId, isMatch: match.isMatch, reason: match.reason};
      this.userListings.push(feed);
    }

    if (!feed.isMatch) {
      return {
        listingId: listing.rentalId, userListingId: `ul-${listing.rentalId}`,
        isMatch: false, isNew, pursuitId: null, needsEnrichment: false,
      };
    }

    let pursuit = [...this.pursuits.values()]
      .find(row => row.userId === userId && row.rentalId === listing.rentalId);
    if (!pursuit) {
      pursuit = {
        id: this.id('pursuit'), userId, rentalId: listing.rentalId, stage: 'matched',
        needsHumanReason: null, needsHumanNote: null, threadId: null, contactSnapshot: null,
        enrichedAt: null, nextFollowUpAt: null, followUpCount: 0, listing,
      };
      this.pursuits.set(pursuit.id, pursuit);
      this.events.push({pursuitId: pursuit.id, type: 'created'});
    }

    return {
      listingId: listing.rentalId, userListingId: `ul-${listing.rentalId}`,
      isMatch: true, isNew, pursuitId: pursuit.id,
      needsEnrichment: pursuit.enrichedAt === null,
    };
  }

  async saveEnrichment(
    _userId: string,
    pursuitId: string,
    snapshot: ContactSnapshot | null,
    summary: Record<string, unknown>,
  ): Promise<void> {
    const pursuit = this.pursuits.get(pursuitId);
    if (!pursuit) return;
    pursuit.contactSnapshot = snapshot;
    pursuit.enrichedAt = this.now();
    if (!snapshot) {
      pursuit.needsHumanReason = 'no_contact';
      pursuit.needsHumanNote = typeof summary.note === 'string' ? summary.note : null;
      this.events.push({pursuitId, type: 'escalated'});
    }
    this.events.push({pursuitId, type: 'enriched'});
  }

  async noteEnrichmentDeferred(_userId: string, pursuitId: string): Promise<void> {
    // Deliberately leaves `enrichedAt` null and sets no escalation.
    this.events.push({pursuitId, type: 'error'});
  }

  // ---- turns --------------------------------------------------------------

  async loadTurnInput(
    userId: string,
    pursuitId: string,
    trigger: TurnTrigger,
    inbound: ThreadMessage | null,
  ): Promise<TurnInput | null> {
    const row = this.pursuits.get(pursuitId);
    if (!row || row.userId !== userId) return null;

    const pursuit: Pursuit = {
      id: row.id,
      stage: row.stage,
      needsHumanReason: row.needsHumanReason,
      threadId: row.threadId,
      nextFollowUpAt: row.nextFollowUpAt,
      followUpCount: row.followUpCount,
      listing: {
        address: row.listing.address,
        price: row.listing.price,
        bedrooms: Number.isFinite(row.listing.bedrooms) ? row.listing.bedrooms : null,
        bathrooms: Number.isFinite(row.listing.bathrooms) ? row.listing.bathrooms : null,
        brokerage: row.listing.brokerage || null,
      },
      agents: row.contactSnapshot ? agentsForOutreach(row.contactSnapshot) : [],
      profile: {budgetMax: null, bedrooms: null, availabilityNote: 'flexible', freeText: '', learnedAnswers: []},
    };

    return {
      pursuit,
      trigger,
      inbound,
      thread: await this.loadThread(userId, pursuitId),
      alreadyProcessed: false,
      sendsToday: 0,
      sendCap: this.options.sendCap ?? 10,
    };
  }

  async countSendsToday(): Promise<number> {
    return this.events.filter(event => event.type === 'email_sent').length;
  }

  async persistTurn(userId: string, pursuitId: string, _trigger: TurnTrigger, result: TurnResult): Promise<void> {
    const row = this.pursuits.get(pursuitId);
    if (!row) return;

    if (this.options.dryRun) {
      for (const action of result.actions) {
        if (action.type === 'send') this.events.push({pursuitId, type: 'draft_composed'});
      }
      return;
    }

    row.stage = result.pursuit.stage;
    row.needsHumanReason = result.pursuit.needsHumanReason;
    row.threadId = result.pursuit.threadId;
    row.nextFollowUpAt = result.pursuit.nextFollowUpAt;
    row.followUpCount = result.pursuit.followUpCount;

    for (const action of result.actions) {
      if (action.type === 'send') {
        this.events.push({pursuitId, type: 'email_sent'});
        this.threads.push({
          userId, pursuitId, direction: 'outbound',
          id: this.id('out'), from: 'me', body: action.body, sentAt: this.now(),
        });
      } else if (action.type === 'escalate') {
        this.events.push({pursuitId, type: 'escalated'});
      }
    }
  }

  async listDueFollowUps(userId: string, at: Date): Promise<string[]> {
    if (this.options.dryRun) return [];
    return [...this.pursuits.values()]
      .filter(row => row.userId === userId && row.stage === 'contacted'
        && row.needsHumanReason === null && row.threadId !== null
        && row.nextFollowUpAt !== null && row.nextFollowUpAt <= at)
      .map(row => row.id);
  }

  async listReadyToOpen(userId: string): Promise<string[]> {
    return [...this.pursuits.values()]
      .filter(row => row.userId === userId && row.stage === 'matched'
        && row.needsHumanReason === null && row.contactSnapshot !== null && row.threadId === null)
      .filter(row => !this.options.dryRun
        || !this.events.some(event => event.pursuitId === row.id && event.type === 'draft_composed'))
      .map(row => row.id);
  }

  /** Convenience for assertions: the ledger row for one message. */
  ledgerFor(userId: string, messageId: string): LedgerRow | undefined {
    return this.ledger.get(this.key(userId, messageId));
  }

  static readonly MAX_ATTEMPTS = MAX_ATTEMPTS;
}
