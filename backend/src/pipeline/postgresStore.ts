import {and, eq, gte, inArray, isNull, isNotNull, lte, notExists, sql} from 'drizzle-orm';
import type {gmail_v1} from 'googleapis';

import type {db as Database} from '../db/index.ts';
import type {ContactSnapshot} from '../db/schema/pursuits.ts';
import type {SearchProfile as ProfileRow} from '../db/schema/profiles.ts';
import {
  listings,
  processedMessages,
  pursuitEvents,
  pursuits,
  searchProfiles,
  userListings,
} from '../db/schema/index.ts';
import type {Listing as GmailListing} from '../gmail/listings.ts';
import {LISTINGS_QUERY, listMessageIds, loadMessages} from '../gmail/mailbox.ts';
import {parseMessage} from '../gmail/message.ts';
import type {
  MessageRoute,
  SyncedMessage,
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

/** Event kinds this store writes. B renders the pursuit timeline from these. */
export const EVENT = {
  created: 'created',
  enriched: 'enriched',
  escalated: 'escalated',
  emailSent: 'email_sent',
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
  /** Gmail search appended to the StreetEasy sender filter, e.g. `newer_than:2d`. */
  alertQuery?: string | undefined;
  /** Upper bound on alert messages returned per sync, to bound enrichment spend. */
  maxAlertsPerSync?: number | undefined;
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

/**
 * The one persistence adapter for the worker: Gmail alert discovery, listing
 * and pursuit rows, enrichment results, and turn outcomes. Connects as the
 * table owner over `DATABASE_URL`, so RLS does not apply; every query scopes
 * by `userId` explicitly instead.
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

  /**
   * Give the demo owner a default profile if they have none, so the worker
   * sees them. Idempotent; never overwrites a profile B has written.
   */
  async ensureOwner(userId: string): Promise<void> {
    await this.db.insert(searchProfiles).values({userId}).onConflictDoNothing();
  }

  async listActiveUsers(): Promise<WorkerUser[]> {
    const rows = await this.db.select({
      userId: searchProfiles.userId,
      sendCap: searchProfiles.dailySendCap,
      pausedAt: searchProfiles.pausedAt,
    }).from(searchProfiles);
    return rows.map(row => ({userId: row.userId, sendCap: row.sendCap, paused: row.pausedAt !== null}));
  }

  async syncUser(userId: string): Promise<SyncedMessage[]> {
    const gmail = await this.gmail();
    const query = [LISTINGS_QUERY, this.options.alertQuery].filter(Boolean).join(' ');
    const ids = await listMessageIds(gmail, query);
    if (ids.length === 0) {
      return [];
    }

    const done = await this.db.select({id: processedMessages.gmailMessageId})
      .from(processedMessages)
      .where(and(eq(processedMessages.userId, userId), inArray(processedMessages.gmailMessageId, ids)));
    const doneIds = new Set(done.map(row => row.id));
    const pending = ids.filter(id => !doneIds.has(id)).slice(0, this.options.maxAlertsPerSync ?? ids.length);
    this.log(`sync ${userId}: ${ids.length} alerts match "${query}", ${pending.length} pending`);

    const messages = await loadMessages(gmail, pending);
    return messages.map(raw => {
      const message = parseMessage(raw);
      return {
        id: message.id,
        from: message.from,
        to: [],
        cc: [],
        date: message.date,
        body: message.htmlBody ?? '',
        route: 'alert' as const,
        pursuitId: null,
      };
    });
  }

  async isProcessed(userId: string, messageId: string): Promise<boolean> {
    const rows = await this.db.select({id: processedMessages.gmailMessageId})
      .from(processedMessages)
      .where(and(eq(processedMessages.userId, userId), eq(processedMessages.gmailMessageId, messageId)))
      .limit(1);
    return rows.length > 0;
  }

  async markProcessed(userId: string, messageId: string, route: MessageRoute): Promise<void> {
    await this.db.insert(processedMessages)
      .values({userId, gmailMessageId: messageId, route})
      .onConflictDoNothing();
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
        bedrooms: listing.bedrooms,
        bathrooms: listing.bathrooms,
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
        const match = matchListing(listing, profile ?? null);
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

      await tx.insert(pursuitEvents).values({userId, pursuitId, type: EVENT.enriched, payload: summary});
      if (!snapshot) {
        await tx.insert(pursuitEvents).values({
          userId, pursuitId, type: EVENT.escalated, payload: {reason: 'no_contact', detail: summary.note ?? null},
        });
      }
    });
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

    return {
      pursuit,
      trigger,
      inbound,
      // No thread table yet: the reply turn sees only the inbound message.
      thread: [],
      alreadyProcessed: false,
      sendsToday: 0,
      sendCap: row.profile?.dailySendCap ?? 10,
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
