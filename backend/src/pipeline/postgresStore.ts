import {and, asc, desc, eq, gte, inArray, isNull, isNotNull, lte, notExists, or, sql} from 'drizzle-orm';
import type {gmail_v1} from 'googleapis';

import type {db as Database} from '../db/index.ts';
import type {ContactSnapshot} from '../db/schema/pursuits.ts';
import type {SearchProfile as ProfileRow} from '../db/schema/profiles.ts';
import {
  gmailAccounts,
  listings,
  processedMessages,
  pursuitEvents,
  pursuits,
  searchProfiles,
  threadMessages,
  userListings,
  workerLeases,
  workerRuns,
} from '../db/schema/index.ts';
import type {ProcessedStatus} from '../db/schema/gmail.ts';
import type {Listing as GmailListing} from '../gmail/listings.ts';
import {loadMessages} from '../gmail/mailbox.ts';
import {parseMessage} from '../gmail/message.ts';
import type {RawMessage} from '../gmail/message.ts';
import {syncMailbox} from '../gmail/sync.ts';
import type {
  SyncedMessage,
  SyncReport,
  WorkerStore,
  WorkerUser,
} from '../outreach/worker.ts';
import type {
  Pursuit,
  SearchProfile,
  ThreadMessage,
  TurnInput,
  TurnResult,
  TurnTrigger,
} from '../outreach/types.ts';
import type {AlertStore, IngestOutcome} from './alert.ts';
import {agentsForOutreach} from './contacts.ts';
import {matchListing} from './match.ts';
import {MAX_ATTEMPTS, emailAddress, nextAttemptAt, routeMessage} from './routing.ts';
import type {MessageRoute, RoutingContext} from './routing.ts';

export type {MessageRoute};

/** Event kinds this store writes. B renders the pursuit timeline from these. */
export const EVENT = {
  created: 'created',
  enriched: 'enriched',
  escalated: 'escalated',
  emailSent: 'email_sent',
  replyReceived: 'reply_received',
  draftComposed: 'draft_composed',
  followUpScheduled: 'follow_up_scheduled',
  tourBooked: 'tour_booked',
  packetSent: 'packet_sent',
  stageChanged: 'stage_changed',
  error: 'error',
} as const;

export type PostgresStoreOptions = {
  db: typeof Database;
  /** Lazily resolved so a cycle with nothing to sync never touches OAuth. */
  gmail: () => Promise<gmail_v1.Gmail>;
  /**
   * Compose drafts and record them, but never advance a pursuit or record a
   * send. The default until Gmail sending is real; the worker script flips it.
   */
  dryRun: boolean;
  /** Signs outgoing mail. Without it the agent sends no signature block. */
  renterName?: string | null;
  /** Extra Gmail search terms for a catch-up sync, e.g. `-category:promotions`. */
  extraQuery?: string | undefined;
  /** Window a first run scans, in days. */
  catchUpDays?: number | undefined;
  /** Upper bound on messages fetched per cycle, to bound enrichment spend. */
  maxMessagesPerSync?: number | undefined;
  log?: ((message: string) => void) | undefined;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function availabilityNote(profile: ProfileRow): string {
  if (profile.availability.length === 0) {
    return 'flexible';
  }
  return profile.availability
    .map(window => `${DAYS[window.day] ?? '?'} ${window.start}-${window.end}`)
    .join(', ');
}

function freeText(profile: ProfileRow): string {
  const parts: string[] = [];
  if (profile.neighborhoods.length > 0) parts.push(`Neighborhoods: ${profile.neighborhoods.join(', ')}`);
  if (profile.mustHaves.length > 0) parts.push(`Must haves: ${profile.mustHaves.join(', ')}`);
  if (profile.dealbreakers.length > 0) parts.push(`Dealbreakers: ${profile.dealbreakers.join(', ')}`);
  if (profile.preferences) parts.push(profile.preferences);
  return parts.join('\n');
}

function toSearchProfile(profile: ProfileRow | null): SearchProfile {
  if (!profile) {
    return {budgetMax: null, bedrooms: null, availabilityNote: 'flexible', freeText: '', learnedAnswers: []};
  }
  return {
    budgetMax: profile.budgetMax,
    bedrooms: profile.bedroomsMin,
    availabilityNote: availabilityNote(profile),
    freeText: freeText(profile),
    learnedAnswers: profile.learnedAnswers.map(row => ({question: row.question, answer: row.answer})),
  };
}

function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** Alert cards carry NaN for a count the mail did not state; the column is nullable. */
function roomCount(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Addresses in a comma-separated header, normalized and de-duplicated. */
function addressList(header: string): string[] {
  const seen = new Set<string>();
  for (const part of header.split(',')) {
    const address = emailAddress(part);
    if (address) seen.add(address);
  }
  return [...seen];
}

function headerOf(raw: gmail_v1.Schema$Message, name: string): string {
  const wanted = name.toLowerCase();
  return raw.payload?.headers?.find(header => header.name?.toLowerCase() === wanted)?.value ?? '';
}

function sentAtOf(message: RawMessage, raw: gmail_v1.Schema$Message): Date {
  const parsed = new Date(message.date);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const internal = Number(raw.internalDate);
  return Number.isFinite(internal) ? new Date(internal) : new Date();
}

/**
 * The one persistence adapter for the worker: mailbox sync and routing, the
 * per-message ledger, listing and pursuit rows, enrichment results, thread
 * history, and turn outcomes. Connects as the table owner over `DATABASE_URL`,
 * so RLS does not apply; every query scopes by `userId` explicitly instead.
 */
export class PostgresStore implements WorkerStore, AlertStore {
  private readonly db: typeof Database;
  private readonly options: PostgresStoreOptions;
  private gmailClient: Promise<gmail_v1.Gmail> | null = null;

  constructor(options: PostgresStoreOptions) {
    this.db = options.db;
    this.options = options;
  }

  private log(message: string): void {
    this.options.log?.(message);
  }

  private gmail(): Promise<gmail_v1.Gmail> {
    this.gmailClient ??= this.options.gmail();
    return this.gmailClient;
  }

  // ---- ownership and mailbox ---------------------------------------------

  /**
   * Give the demo owner a default profile if they have none, so the worker
   * sees them. Idempotent; never overwrites a profile B has written.
   */
  async ensureOwner(userId: string): Promise<void> {
    await this.db.insert(searchProfiles).values({userId}).onConflictDoNothing();
  }

  /**
   * Bind the one locally authorized mailbox to exactly one user.
   *
   * Until per-user OAuth exists there is a single `token.json`, so processing
   * a second user against it would read one person's mail as another's. This
   * refuses rather than doing that.
   */
  async bindMailbox(userId: string, address: string): Promise<void> {
    const claimed = await this.db.select({userId: gmailAccounts.userId})
      .from(gmailAccounts)
      .where(eq(gmailAccounts.emailAddress, address))
      .limit(1);
    const owner = claimed[0]?.userId;
    if (owner && owner !== userId) {
      throw new Error(
        `${address} is already bound to user ${owner}; refusing to process one mailbox as two users`,
      );
    }
    await this.db.insert(gmailAccounts)
      .values({userId, emailAddress: address})
      .onConflictDoUpdate({target: gmailAccounts.userId, set: {emailAddress: address, syncError: null}});
  }

  /** The user bound to the connected mailbox, or null before the first bind. */
  async mailboxOwner(address: string): Promise<string | null> {
    const rows = await this.db.select({userId: gmailAccounts.userId})
      .from(gmailAccounts).where(eq(gmailAccounts.emailAddress, address)).limit(1);
    return rows[0]?.userId ?? null;
  }

  async listActiveUsers(): Promise<WorkerUser[]> {
    const rows = await this.db.select({
      userId: searchProfiles.userId,
      sendCap: searchProfiles.dailySendCap,
      pausedAt: searchProfiles.pausedAt,
    }).from(searchProfiles);
    return rows.map(row => ({userId: row.userId, sendCap: row.sendCap, paused: row.pausedAt !== null}));
  }

  // ---- leases -------------------------------------------------------------

  /**
   * Claim the mailbox for `ttlMs`. Returns false when another worker holds an
   * unexpired lease, which is how a second process — or a restart racing a
   * hung predecessor — declines to process the same mail twice.
   */
  async acquireLease(name: string, holder: string, ttlMs: number, at = new Date()): Promise<boolean> {
    const expiresAt = new Date(at.getTime() + ttlMs);
    // `or` is variadic, so its return type admits undefined; with two operands
    // it never is. A raw sql fragment here would bind the Date as text.
    const takeover = or(eq(workerLeases.holder, holder), lte(workerLeases.expiresAt, at))!;
    const claimed = await this.db.insert(workerLeases)
      .values({name, holder, acquiredAt: at, expiresAt})
      .onConflictDoUpdate({
        target: workerLeases.name,
        set: {holder, acquiredAt: at, expiresAt},
        // Only take it over once the incumbent's lease has actually lapsed.
        setWhere: takeover,
      })
      .returning({holder: workerLeases.holder});
    return claimed[0]?.holder === holder;
  }

  /** Extend a lease this holder still owns; false if it was taken over. */
  async renewLease(name: string, holder: string, ttlMs: number, at = new Date()): Promise<boolean> {
    const renewed = await this.db.update(workerLeases)
      .set({expiresAt: new Date(at.getTime() + ttlMs)})
      .where(and(eq(workerLeases.name, name), eq(workerLeases.holder, holder)))
      .returning({holder: workerLeases.holder});
    return renewed.length > 0;
  }

  async releaseLease(name: string, holder: string): Promise<void> {
    await this.db.delete(workerLeases)
      .where(and(eq(workerLeases.name, name), eq(workerLeases.holder, holder)));
  }

  // ---- run log ------------------------------------------------------------

  async startRun(holder: string, at = new Date()): Promise<string> {
    const [row] = await this.db.insert(workerRuns)
      .values({holder, startedAt: at, mode: this.options.dryRun ? 'dry-run' : 'live'})
      .returning({id: workerRuns.id});
    if (!row) throw new Error('worker_runs insert returned nothing');
    return row.id;
  }

  async finishRun(runId: string, report: Record<string, unknown>, error: string | null): Promise<void> {
    await this.db.update(workerRuns)
      .set({finishedAt: new Date(), report, error})
      .where(eq(workerRuns.id, runId));
  }

  /** What the status command prints: last run, backlog, and stuck work. */
  async statusReport(): Promise<Record<string, unknown>> {
    const [run] = await this.db.select().from(workerRuns).orderBy(desc(workerRuns.startedAt)).limit(1);
    const [account] = await this.db.select().from(gmailAccounts).limit(1);
    const ledger = await this.db.select({
      status: processedMessages.status,
      n: sql<number>`count(*)::int`,
    }).from(processedMessages).groupBy(processedMessages.status);
    const [blocked] = await this.db.select({n: sql<number>`count(*)::int`})
      .from(pursuits).where(isNotNull(pursuits.needsHumanReason));
    const stages = await this.db.select({
      stage: pursuits.stage,
      n: sql<number>`count(*)::int`,
    }).from(pursuits).groupBy(pursuits.stage);
    const [sends] = await this.db.select({n: sql<number>`count(*)::int`})
      .from(pursuitEvents)
      .where(and(eq(pursuitEvents.type, EVENT.emailSent), gte(pursuitEvents.createdAt, startOfUtcDay(new Date()))));

    return {
      mode: this.options.dryRun ? 'dry-run' : 'live',
      mailbox: account
        ? {address: account.emailAddress, lastSyncedAt: account.lastSyncedAt, syncError: account.syncError}
        : null,
      lastRun: run
        ? {startedAt: run.startedAt, finishedAt: run.finishedAt, mode: run.mode, error: run.error, report: run.report}
        : null,
      messages: Object.fromEntries(ledger.map(row => [row.status, row.n])),
      pursuitsByStage: Object.fromEntries(stages.map(row => [row.stage, row.n])),
      needsHuman: blocked?.n ?? 0,
      sendsToday: sends?.n ?? 0,
    };
  }

  // ---- mailbox sync -------------------------------------------------------

  /** Thread ids and broker addresses that identify a reply to this user. */
  private async routingContext(userId: string, selfAddress: string | null): Promise<RoutingContext> {
    const rows = await this.db.select({
      id: pursuits.id,
      threadId: pursuits.threadId,
      snapshot: pursuits.contactSnapshot,
    }).from(pursuits).where(and(eq(pursuits.userId, userId), sql`${pursuits.stage} <> 'dead'`));

    const threads = new Map<string, string>();
    const contacts = new Map<string, string>();
    for (const row of rows) {
      if (row.threadId) threads.set(row.threadId, row.id);
      for (const contact of row.snapshot?.contacts ?? []) {
        const address = contact.email ? emailAddress(contact.email) : null;
        // A thread match wins, so only the first pursuit per address is kept.
        if (address && !contacts.has(address)) contacts.set(address, row.id);
      }
    }
    return {threads, contacts, selfAddress};
  }

  /** Ids already finished, and ids waiting on a backoff that has not elapsed. */
  private async ledgerFilter(userId: string, ids: string[], at: Date): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db.select({
      id: processedMessages.gmailMessageId,
      status: processedMessages.status,
      nextAttemptAt: processedMessages.nextAttemptAt,
    }).from(processedMessages)
      .where(and(eq(processedMessages.userId, userId), inArray(processedMessages.gmailMessageId, ids)));

    const skip = new Set<string>();
    for (const row of rows) {
      if (row.status === 'done' || row.status === 'exhausted') skip.add(row.id);
      else if (row.nextAttemptAt && row.nextAttemptAt > at) skip.add(row.id);
    }
    return skip;
  }

  /**
   * Poll the mailbox and hand back what still needs work: new mail since the
   * checkpoint, plus messages whose earlier attempt failed and whose backoff
   * has elapsed. The checkpoint itself is only advanced by `saveCheckpoint`,
   * after the cycle has durably accounted for everything it saw.
   */
  async syncUser(userId: string, at = new Date()): Promise<SyncReport> {
    const gmail = await this.gmail();
    const [account] = await this.db.select().from(gmailAccounts)
      .where(eq(gmailAccounts.userId, userId)).limit(1);

    const sync = await syncMailbox(gmail, {
      historyId: account?.historyId ?? null,
      lastSyncedAt: account?.lastSyncedAt ?? null,
    }, {
      now: at,
      ...(this.options.catchUpDays === undefined ? {} : {defaultCatchUpDays: this.options.catchUpDays}),
      ...(this.options.extraQuery === undefined ? {} : {extraQuery: this.options.extraQuery}),
      ...(this.options.maxMessagesPerSync === undefined ? {} : {maxMessages: this.options.maxMessagesPerSync}),
    });

    await this.bindMailbox(userId, sync.emailAddress);

    const retryIds = await this.listRetryable(userId, at);
    const skip = await this.ledgerFilter(userId, sync.messageIds, at);
    const candidates = [...new Set([...retryIds, ...sync.messageIds.filter(id => !skip.has(id))])];

    const context = await this.routingContext(userId, sync.emailAddress);
    const raws = await loadMessages(gmail, candidates);
    const messages: SyncedMessage[] = [];
    for (const raw of raws) {
      const parsed = parseMessage(raw);
      const routed = routeMessage(parsed, context);
      messages.push({
        id: parsed.id,
        threadId: parsed.threadId,
        from: parsed.from,
        to: addressList(headerOf(raw, 'To')),
        cc: addressList(headerOf(raw, 'Cc')),
        subject: parsed.subject,
        date: parsed.date,
        sentAt: sentAtOf(parsed, raw),
        body: parsed.htmlBody ?? parsed.textBody ?? '',
        textBody: parsed.textBody,
        htmlBody: parsed.htmlBody,
        rfcMessageId: headerOf(raw, 'Message-ID') || null,
        inReplyTo: headerOf(raw, 'In-Reply-To') || null,
        route: routed.route,
        routeReason: routed.reason,
        pursuitId: routed.pursuitId,
      });
    }

    this.log(
      `sync ${userId}: ${sync.plan.mode}, ${sync.messageIds.length} from Gmail, ` +
      `${retryIds.length} retrying, ${messages.length} to process`,
    );
    if (sync.truncated) {
      this.log(`sync ${userId}: WARNING catch-up window did not cover the whole outage; older mail was skipped`);
    }

    return {
      messages,
      checkpoint: sync.historyId,
      mailbox: sync.emailAddress,
      mode: sync.plan.mode,
      truncated: sync.truncated,
      historyExpired: sync.historyExpired,
      fetched: sync.messageIds.length,
      retried: retryIds.length,
    };
  }

  /** Advance the durable cursor. Only called once a cycle finishes cleanly. */
  async saveCheckpoint(userId: string, historyId: string, at = new Date()): Promise<void> {
    await this.db.update(gmailAccounts)
      .set({historyId, lastSyncedAt: at, syncError: null})
      .where(eq(gmailAccounts.userId, userId));
  }

  async recordSyncError(userId: string, error: string): Promise<void> {
    await this.db.update(gmailAccounts).set({syncError: error})
      .where(eq(gmailAccounts.userId, userId));
  }

  // ---- message ledger -----------------------------------------------------

  async isProcessed(userId: string, messageId: string): Promise<boolean> {
    const rows = await this.db.select({status: processedMessages.status})
      .from(processedMessages)
      .where(and(eq(processedMessages.userId, userId), eq(processedMessages.gmailMessageId, messageId)))
      .limit(1);
    const status = rows[0]?.status;
    return status === 'done' || status === 'exhausted';
  }

  /** Mail whose last attempt failed and whose backoff has now elapsed. */
  async listRetryable(userId: string, at: Date): Promise<string[]> {
    const rows = await this.db.select({id: processedMessages.gmailMessageId})
      .from(processedMessages)
      .where(and(
        eq(processedMessages.userId, userId),
        eq(processedMessages.status, 'retry'),
        lte(processedMessages.nextAttemptAt, at),
      ));
    return rows.map(row => row.id);
  }

  /**
   * Record a message as finished. Called only after every listing it carried
   * is durably completed, queued, skipped with a stated reason, or recorded as
   * a visible failure.
   */
  async markProcessed(
    userId: string,
    messageId: string,
    route: MessageRoute,
    outcome: Record<string, unknown> = {},
    threadId: string | null = null,
  ): Promise<void> {
    await this.db.insert(processedMessages)
      .values({
        userId, gmailMessageId: messageId, gmailThreadId: threadId, route,
        status: 'done', attempts: 1, nextAttemptAt: null, lastError: null, outcome,
      })
      .onConflictDoUpdate({
        target: [processedMessages.userId, processedMessages.gmailMessageId],
        set: {
          route, status: 'done', nextAttemptAt: null, lastError: null, outcome,
          processedAt: new Date(),
        },
      });
  }

  /**
   * Record a failed attempt and schedule the next one. After `MAX_ATTEMPTS`
   * the message becomes `exhausted`: no longer retried, but still listed by
   * the status report rather than disappearing.
   */
  async markRetry(
    userId: string,
    messageId: string,
    route: MessageRoute,
    error: string,
    at = new Date(),
  ): Promise<{status: ProcessedStatus; attempts: number}> {
    const [existing] = await this.db.select({attempts: processedMessages.attempts})
      .from(processedMessages)
      .where(and(eq(processedMessages.userId, userId), eq(processedMessages.gmailMessageId, messageId)))
      .limit(1);

    const attempts = (existing?.attempts ?? 0) + 1;
    const next = nextAttemptAt(attempts, at);
    const status: ProcessedStatus = next ? 'retry' : 'exhausted';

    await this.db.insert(processedMessages)
      .values({
        userId, gmailMessageId: messageId, route, status, attempts,
        nextAttemptAt: next, lastError: error,
      })
      .onConflictDoUpdate({
        target: [processedMessages.userId, processedMessages.gmailMessageId],
        set: {route, status, attempts, nextAttemptAt: next, lastError: error, processedAt: at},
      });

    if (status === 'exhausted') {
      this.log(`message ${messageId} exhausted after ${MAX_ATTEMPTS} attempts: ${error}`);
    }
    return {status, attempts};
  }

  // ---- thread history -----------------------------------------------------

  /** Persist an inbound broker email verbatim, before any turn reads it. */
  async saveInboundMessage(userId: string, message: SyncedMessage): Promise<void> {
    await this.db.insert(threadMessages).values({
      userId,
      gmailMessageId: message.id,
      gmailThreadId: message.threadId,
      pursuitId: message.pursuitId,
      direction: 'inbound',
      fromAddress: message.from,
      toAddresses: message.to,
      ccAddresses: message.cc,
      subject: message.subject,
      rfcMessageId: message.rfcMessageId,
      inReplyTo: message.inReplyTo,
      sentAt: message.sentAt,
      textBody: message.textBody,
      htmlBody: message.htmlBody,
    }).onConflictDoNothing();

    if (message.pursuitId) {
      await this.db.insert(pursuitEvents).values({
        userId,
        pursuitId: message.pursuitId,
        type: EVENT.replyReceived,
        payload: {messageId: message.id, from: message.from, subject: message.subject},
      });
    }
  }

  /** Persist an email the agent sent, so the next turn sees its own words. */
  private async saveOutboundMessage(
    userId: string,
    pursuitId: string,
    action: {to: string[]; cc: string[]; subject: string; body: string},
    threadId: string,
    messageId: string | null,
    at: Date,
  ): Promise<void> {
    await this.db.insert(threadMessages).values({
      userId,
      gmailMessageId: messageId,
      gmailThreadId: threadId,
      pursuitId,
      direction: 'outbound',
      fromAddress: 'me',
      toAddresses: action.to,
      ccAddresses: action.cc,
      subject: action.subject,
      sentAt: at,
      textBody: action.body,
    }).onConflictDoNothing();
  }

  /** The conversation so far, oldest first, as the reply turn reads it. */
  async loadThread(userId: string, pursuitId: string): Promise<ThreadMessage[]> {
    const rows = await this.db.select().from(threadMessages)
      .where(and(eq(threadMessages.userId, userId), eq(threadMessages.pursuitId, pursuitId)))
      .orderBy(asc(threadMessages.sentAt));
    return rows.map(row => ({
      id: row.gmailMessageId ?? row.id,
      from: row.direction === 'outbound' ? 'me' : row.fromAddress,
      to: row.toAddresses,
      cc: row.ccAddresses,
      date: row.sentAt.toISOString(),
      body: row.textBody ?? row.htmlBody ?? '',
    }));
  }

  // ---- ingest -------------------------------------------------------------

  async ingestListing(
    userId: string,
    source: {messageId: string; receivedAt: Date},
    listing: GmailListing,
  ): Promise<IngestOutcome> {
    return this.db.transaction(async tx => {
      const [listingRow] = await tx.insert(listings).values({
        rentalId: listing.rentalId,
        address: listing.address,
        price: listing.price,
        bedrooms: roomCount(listing.bedrooms),
        bathrooms: roomCount(listing.bathrooms),
        listingUrl: listing.listingUrl,
        brokerage: listing.brokerage || null,
        firstSeenAt: source.receivedAt,
        lastSeenAt: source.receivedAt,
      }).onConflictDoUpdate({
        target: listings.rentalId,
        set: {
          price: sql`excluded.price`,
          brokerage: sql`coalesce(nullif(${listings.brokerage}, ''), nullif(excluded.brokerage, ''))`,
          firstSeenAt: sql`least(${listings.firstSeenAt}, excluded.first_seen_at)`,
          lastSeenAt: sql`greatest(${listings.lastSeenAt}, excluded.last_seen_at)`,
        },
      }).returning({id: listings.id});
      if (!listingRow) throw new Error(`listing upsert returned nothing for ${listing.rentalId}`);

      const existing = await tx.select({
        id: userListings.id,
        isMatch: userListings.isMatch,
      }).from(userListings)
        .where(and(eq(userListings.userId, userId), eq(userListings.listingId, listingRow.id)))
        .limit(1);

      let userListingId: string;
      let isMatch: boolean;
      let isNew = false;
      if (existing[0] && existing[0].isMatch !== null) {
        userListingId = existing[0].id;
        isMatch = existing[0].isMatch;
      } else {
        const [profile] = await tx.select().from(searchProfiles)
          .where(eq(searchProfiles.userId, userId)).limit(1);
        const match = matchListing({
          price: listing.price,
          bedrooms: roomCount(listing.bedrooms),
          bathrooms: roomCount(listing.bathrooms),
        }, profile ?? null);
        isMatch = match.isMatch;
        if (existing[0]) {
          userListingId = existing[0].id;
          await tx.update(userListings)
            .set({isMatch, matchReason: match.reason, scoredAt: source.receivedAt})
            .where(eq(userListings.id, userListingId));
        } else {
          isNew = true;
          const [inserted] = await tx.insert(userListings).values({
            userId,
            listingId: listingRow.id,
            sourceMessageId: source.messageId,
            isMatch,
            matchReason: match.reason,
            scoredAt: source.receivedAt,
            firstSeenAt: source.receivedAt,
          }).returning({id: userListings.id});
          if (!inserted) throw new Error('user_listings insert returned nothing');
          userListingId = inserted.id;
        }
      }

      if (!isMatch) {
        // The row stays in the feed: a non-match is visible, not dropped.
        return {listingId: listingRow.id, userListingId, isMatch, isNew, pursuitId: null, needsEnrichment: false};
      }

      const [pursuit] = await tx.insert(pursuits).values({userId, userListingId})
        .onConflictDoNothing({target: pursuits.userListingId})
        .returning({id: pursuits.id});
      let pursuitId: string;
      let needsEnrichment: boolean;
      if (pursuit) {
        pursuitId = pursuit.id;
        needsEnrichment = true;
        await tx.insert(pursuitEvents).values({
          userId,
          pursuitId,
          type: EVENT.created,
          payload: {rentalId: listing.rentalId, sourceMessageId: source.messageId},
        });
      } else {
        const [found] = await tx.select({id: pursuits.id, enrichedAt: pursuits.enrichedAt})
          .from(pursuits).where(eq(pursuits.userListingId, userListingId)).limit(1);
        if (!found) throw new Error('pursuit missing after conflict');
        pursuitId = found.id;
        needsEnrichment = found.enrichedAt === null;
      }

      return {listingId: listingRow.id, userListingId, isMatch, isNew, pursuitId, needsEnrichment};
    });
  }

  async saveEnrichment(
    userId: string,
    pursuitId: string,
    snapshot: ContactSnapshot | null,
    summary: Record<string, unknown>,
  ): Promise<void> {
    const at = new Date();
    await this.db.transaction(async tx => {
      await tx.update(pursuits).set({
        contactSnapshot: snapshot,
        enrichedAt: at,
        updatedAt: at,
        ...(snapshot ? {} : {
          needsHumanReason: 'no_contact' as const,
          needsHumanNote: typeof summary.note === 'string' ? summary.note : 'No verified contact email found',
          needsHumanAt: at,
        }),
      }).where(and(eq(pursuits.id, pursuitId), eq(pursuits.userId, userId)));

      // A pursuit parked for want of a contact is unblocked by finding one, so
      // a re-run after an enrichment improvement clears its own escalation.
      // Any other blocker is the owner's to resolve and is left alone.
      if (snapshot) {
        await tx.update(pursuits).set({needsHumanReason: null, needsHumanNote: null, needsHumanAt: null})
          .where(and(eq(pursuits.id, pursuitId), eq(pursuits.userId, userId), eq(pursuits.needsHumanReason, 'no_contact')));
      }

      await tx.insert(pursuitEvents).values({userId, pursuitId, type: EVENT.enriched, payload: summary});
      if (!snapshot) {
        await tx.insert(pursuitEvents).values({
          userId, pursuitId, type: EVENT.escalated, payload: {reason: 'no_contact', detail: summary.note ?? null},
        });
      }
    });
  }

  /**
   * An enrichment attempt worth repeating. `enrichedAt` deliberately stays
   * null so the pursuit is picked up again, and no `needs_human_reason` is
   * set: the owner has nothing to resolve while the worker is still trying.
   */
  async noteEnrichmentDeferred(
    userId: string,
    pursuitId: string,
    summary: Record<string, unknown>,
  ): Promise<void> {
    await this.db.insert(pursuitEvents).values({
      userId, pursuitId, type: EVENT.error, payload: {...summary, deferred: true},
    });
    await this.db.update(pursuits).set({updatedAt: new Date()})
      .where(and(eq(pursuits.id, pursuitId), eq(pursuits.userId, userId)));
  }

  /** A card the parser could not read, or an alert layout it does not know. */
  async recordIngestProblem(userId: string, detail: Record<string, unknown>): Promise<void> {
    this.log(`ingest problem for ${userId}: ${JSON.stringify(detail)}`);
  }

  // ---- turns --------------------------------------------------------------

  async loadTurnInput(
    userId: string,
    pursuitId: string,
    trigger: TurnTrigger,
    inbound: ThreadMessage | null,
  ): Promise<TurnInput | null> {
    const [row] = await this.db.select({
      pursuit: pursuits,
      listing: listings,
      profile: searchProfiles,
    }).from(pursuits)
      .innerJoin(userListings, eq(userListings.id, pursuits.userListingId))
      .innerJoin(listings, eq(listings.id, userListings.listingId))
      .leftJoin(searchProfiles, eq(searchProfiles.userId, pursuits.userId))
      .where(and(eq(pursuits.id, pursuitId), eq(pursuits.userId, userId)))
      .limit(1);
    if (!row) {
      return null;
    }

    const pursuit: Pursuit = {
      id: row.pursuit.id,
      stage: row.pursuit.stage,
      needsHumanReason: row.pursuit.needsHumanReason,
      threadId: row.pursuit.threadId,
      nextFollowUpAt: row.pursuit.nextFollowUpAt,
      followUpCount: row.pursuit.followUpCount,
      listing: {
        address: row.listing.address,
        price: row.listing.price,
        bedrooms: row.listing.bedrooms,
        bathrooms: row.listing.bathrooms,
        brokerage: row.listing.brokerage,
      },
      agents: row.pursuit.contactSnapshot ? agentsForOutreach(row.pursuit.contactSnapshot) : [],
      profile: toSearchProfile(row.profile),
    };

    // The persisted conversation, so a reply after a restart still has context.
    const thread = await this.loadThread(userId, pursuitId);

    return {
      pursuit,
      trigger,
      inbound,
      thread,
      alreadyProcessed: false,
      sendsToday: 0,
      sendCap: row.profile?.dailySendCap ?? 10,
      renterName: this.options.renterName ?? null,
    };
  }

  async countSendsToday(userId: string, at: Date): Promise<number> {
    const [row] = await this.db.select({n: sql<number>`count(*)::int`})
      .from(pursuitEvents)
      .where(and(
        eq(pursuitEvents.userId, userId),
        eq(pursuitEvents.type, EVENT.emailSent),
        gte(pursuitEvents.createdAt, startOfUtcDay(at)),
      ));
    return row?.n ?? 0;
  }

  async persistTurn(userId: string, pursuitId: string, trigger: TurnTrigger, result: TurnResult): Promise<void> {
    const at = new Date();
    if (this.options.dryRun) {
      const drafts = result.actions.filter(action => action.type === 'send');
      if (drafts.length === 0) {
        return;
      }
      await this.db.insert(pursuitEvents).values(drafts.map(draft => ({
        userId,
        pursuitId,
        type: EVENT.draftComposed,
        payload: {...draft, trigger, dryRun: true},
      })));
      return;
    }

    await this.db.transaction(async tx => {
      const [before] = await tx.select({stage: pursuits.stage}).from(pursuits)
        .where(and(eq(pursuits.id, pursuitId), eq(pursuits.userId, userId))).limit(1);

      const escalation = result.pursuit.needsHumanReason;
      await tx.update(pursuits).set({
        stage: result.pursuit.stage,
        needsHumanReason: escalation,
        ...(escalation ? {needsHumanAt: at} : {needsHumanNote: null, needsHumanAt: null}),
        threadId: result.pursuit.threadId,
        nextFollowUpAt: result.pursuit.nextFollowUpAt,
        followUpCount: result.pursuit.followUpCount,
        lastAgentRunAt: at,
        updatedAt: at,
      }).where(and(eq(pursuits.id, pursuitId), eq(pursuits.userId, userId)));

      const events: Array<{type: string; payload: Record<string, unknown>}> = [];
      for (const action of result.actions) {
        switch (action.type) {
          case 'send':
            events.push({type: EVENT.emailSent, payload: {...action, trigger}});
            break;
          case 'escalate':
            events.push({type: EVENT.escalated, payload: {reason: action.reason, detail: action.detail, trigger}});
            break;
          case 'book_tour':
            events.push({type: EVENT.tourBooked, payload: {start: action.start, end: action.end}});
            break;
          case 'send_packet':
            events.push({type: EVENT.packetSent, payload: {}});
            break;
          case 'schedule_follow_up':
            events.push({type: EVENT.followUpScheduled, payload: {at: action.at}});
            break;
          case 'mark_dead':
            events.push({type: EVENT.stageChanged, payload: {from: before?.stage ?? null, to: 'dead', reason: action.reason}});
            break;
          case 'noop':
            break;
        }
      }
      if (before && before.stage !== result.pursuit.stage && result.pursuit.stage !== 'dead') {
        events.push({type: EVENT.stageChanged, payload: {from: before.stage, to: result.pursuit.stage, trigger}});
      }
      if (events.length > 0) {
        await tx.insert(pursuitEvents).values(events.map(event => ({userId, pursuitId, ...event})));
      }
    });

    // Outside the transaction: the thread copy is a convenience for the next
    // turn, and must not roll back the stage change if it conflicts.
    const threadId = result.pursuit.threadId;
    if (threadId) {
      for (const action of result.actions) {
        if (action.type === 'send') {
          await this.saveOutboundMessage(userId, pursuitId, action, threadId, null, at);
        }
      }
    }
  }

  async listDueFollowUps(userId: string, at: Date): Promise<string[]> {
    if (this.options.dryRun) {
      return [];
    }
    const rows = await this.db.select({id: pursuits.id}).from(pursuits).where(and(
      eq(pursuits.userId, userId),
      eq(pursuits.stage, 'contacted'),
      isNull(pursuits.needsHumanReason),
      isNotNull(pursuits.threadId),
      lte(pursuits.nextFollowUpAt, at),
    ));
    return rows.map(row => row.id);
  }

  async listReadyToOpen(userId: string): Promise<string[]> {
    const conditions = [
      eq(pursuits.userId, userId),
      eq(pursuits.stage, 'matched'),
      isNull(pursuits.needsHumanReason),
      isNotNull(pursuits.contactSnapshot),
      isNull(pursuits.threadId),
    ];
    if (this.options.dryRun) {
      // One draft per pursuit: do not re-compose on every cycle.
      conditions.push(notExists(
        this.db.select({one: sql`1`}).from(pursuitEvents).where(and(
          eq(pursuitEvents.pursuitId, pursuits.id),
          eq(pursuitEvents.type, EVENT.draftComposed),
        )),
      ));
    }
    const rows = await this.db.select({id: pursuits.id}).from(pursuits).where(and(...conditions));
    return rows.map(row => row.id);
  }
}
