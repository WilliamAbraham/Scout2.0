import {and, desc, eq, sql} from 'drizzle-orm';

import type {db as Database} from '../db/index.ts';
import {listings, userListings} from '../db/schema/listings.ts';
import {pursuitEvents, pursuits} from '../db/schema/pursuits.ts';
import type {EmailListing, EnrichmentResult} from '../enrichment/service.ts';
import type {Listing as GmailListing} from '../gmail/listings.ts';
import {processListingAlert} from './alert.ts';
import type {AlertPipelineDeps, AlertListingOutcome, AlertStore} from './alert.ts';

/**
 * "Start search" over the shared listing pool.
 *
 * Listings are global (one row per StreetEasy rental id); ownership is the
 * per-user `user_listings` row. A new user therefore starts with an empty feed
 * even though the pool already holds every listing the mailbox ever surfaced.
 * This pass scores that pool against their profile and creates the matches,
 * pursuits and enrichment they own — the same path an incoming alert takes,
 * so a listing reached this way is indistinguishable from one that arrived by
 * mail.
 *
 * Enrichment is the expensive half, and the answer is a fact about the
 * apartment rather than about the user, so a result already recorded for the
 * same rental id is reused instead of paid for again. Anything with no such
 * record runs the real engine.
 */

export type PoolSearchReport = {
  /** Pool rows this user had no verdict on yet. */
  considered: number;
  matched: number;
  notMatched: number;
  /** Ready to open: enrichment produced a usable contact. */
  ready: number;
  /** Enrichment finished but the owner has to supply a contact. */
  needsHuman: number;
  /** A source or budget stopped enrichment; worth another attempt later. */
  deferred: number;
  errors: number;
  /** Of the enrichments above, how many reused a recorded result. */
  fromCache: number;
  fromLive: number;
  /** Rows left unscored because the time budget ran out. */
  remaining: number;
};

export type PoolSearchDeps = {
  db: typeof Database;
  store: AlertStore;
  /** The real engine, for listings with no recorded result. */
  enrich(input: EmailListing): Promise<EnrichmentResult>;
  /** Stop after this many pool rows. Unset means the whole pool. */
  limit?: number | undefined;
  /**
   * Stop starting new listings once this many milliseconds have passed. Live
   * enrichment is tens of seconds per listing, so a pass over a large pool can
   * run for an hour; a caller that is holding a request open needs to bound
   * that. The listing in flight always finishes, so nothing is left half
   * persisted, and the untouched rows stay queued for the next pass.
   */
  budgetMs?: number | undefined;
  /** Re-score listings this user already has a verdict on. */
  rescore?: boolean | undefined;
  log?: ((message: string) => void) | undefined;
  onProgress?: ((done: number, total: number) => void) | undefined;
};

type PoolRow = {
  rentalId: string;
  address: string;
  price: number;
  bedrooms: number | null;
  bathrooms: number | null;
  listingUrl: string;
  brokerage: string | null;
  firstSeenAt: Date;
  sourceMessageId: string | null;
};

/**
 * `ingestListing` speaks the alert parser's shape, so a stored row is
 * converted back into it rather than duplicating the ingest logic here.
 * That shape is numerically typed, so an unknown room count travels as NaN —
 * the same thing the alert parser emits, which the store maps back to null.
 */
function toGmailListing(row: PoolRow): GmailListing {
  return {
    address: row.address,
    price: row.price,
    bedrooms: row.bedrooms ?? Number.NaN,
    bathrooms: row.bathrooms ?? Number.NaN,
    listingUrl: row.listingUrl,
    rentalId: row.rentalId,
    brokerage: row.brokerage ?? '',
  };
}

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * Rebuild the part of an `EnrichmentResult` that the pipeline actually reads
 * from a saved `enriched` event payload. `summarizeEnrichment` writes that
 * payload, so every field below is one it preserved; the research transcript
 * and raw attempts are not restored, because nothing downstream reads them.
 */
export function enrichmentFromSummary(
  summary: Record<string, unknown>,
  input: EmailListing,
): EnrichmentResult | null {
  const status = text(summary.status);
  const resolution = text(summary.resolution);
  if (!status || !resolution) return null;

  const agents = (Array.isArray(summary.agents) ? summary.agents : []).flatMap(entry => {
    const agent = record(entry);
    const name = agent && text(agent.name);
    if (!agent || !name) return [];
    const sourceUrl = text(agent.sourceUrl) ?? '';
    return [{
      name,
      email: text(agent.email),
      phone: text(agent.phone),
      role: text(agent.role),
      profileUrl: text(agent.profileUrl),
      attributionEvidence: 'Recorded by an earlier enrichment of this listing',
      contactEvidence: 'Recorded by an earlier enrichment of this listing',
      sourceUrl,
      attributionSourceUrl: sourceUrl,
      emailSourceUrl: text(agent.email) ? sourceUrl || null : null,
      phoneSourceUrl: text(agent.phone) ? sourceUrl || null : null,
    }];
  });

  const contactRoutes = (Array.isArray(summary.contactRoutes) ? summary.contactRoutes : []).flatMap(entry => {
    const route = record(entry);
    const name = route && text(route.name);
    const kind = route && text(route.kind);
    const relationship = route && text(route.relationship);
    if (!route || !name || !kind || !relationship) return [];
    return [{
      kind: kind as 'leasing_team' | 'brokerage_office',
      name,
      email: text(route.email),
      phone: text(route.phone),
      relationship: relationship as 'exact_listing' | 'unit_conflict' | 'brokerage',
      sourceUrls: strings(route.sourceUrls),
      evidence: text(route.evidence) ?? 'Recorded by an earlier enrichment of this listing',
      fetchedAt: text(route.fetchedAt) ?? text(summary.checkedAt) ?? new Date().toISOString(),
    }];
  });

  // Nothing reachable was recorded, so there is no saving in reusing it: let
  // the caller run the engine, which may do better than the attempt that
  // produced this payload.
  if (agents.length === 0 && contactRoutes.length === 0) return null;

  return {
    status: status as EnrichmentResult['status'],
    execution: (text(summary.execution) ?? 'completed') as EnrichmentResult['execution'],
    resolution: resolution as EnrichmentResult['resolution'],
    input,
    brokerageUrl: text(summary.brokerageUrl),
    listingUrl: text(summary.listingUrl) ?? input.listingUrl ?? null,
    agents,
    candidateAgents: [],
    sourceListing: null,
    rosterCompleteness: 'unverified',
    outreachReady: summary.outreachReady === true,
    checkedAt: text(summary.checkedAt) ?? new Date().toISOString(),
    issues: strings(summary.issues),
    warnings: [...strings(summary.warnings), REUSED_WARNING],
    attempts: [],
    contactRoutes,
  };
}

/** An enrichment event that recorded at least one way to reach someone. */
const HAS_CONTACT = sql`(
  jsonb_array_length(coalesce(${pursuitEvents.payload}->'agents', '[]'::jsonb)) > 0
  or jsonb_array_length(coalesce(${pursuitEvents.payload}->'contactRoutes', '[]'::jsonb)) > 0
)`;

export const REUSED_WARNING = 'Reused a recorded enrichment of this listing rather than researching it again';

/**
 * The newest recorded enrichment for this rental id that actually reached
 * someone, from any pursuit. The pool row is shared, so the research is too.
 *
 * "That reached someone" is the whole condition. A listing often has several
 * recorded attempts, and a later one can be an empty retry that found nothing
 * — taking the newest unconditionally would discard a good earlier result and
 * pay to research the same apartment again.
 */
async function recordedEnrichment(db: typeof Database, rentalId: string): Promise<Record<string, unknown> | null> {
  const rows = await db.select({payload: pursuitEvents.payload})
    .from(pursuitEvents)
    .innerJoin(pursuits, eq(pursuits.id, pursuitEvents.pursuitId))
    .innerJoin(userListings, eq(userListings.id, pursuits.userListingId))
    .innerJoin(listings, eq(listings.id, userListings.listingId))
    .where(and(
      eq(listings.rentalId, rentalId),
      eq(pursuitEvents.type, 'enriched'),
      HAS_CONTACT,
    ))
    .orderBy(desc(pursuitEvents.createdAt))
    .limit(1);
  return rows[0]?.payload ?? null;
}

/** Pool rows this user has no `user_listings` verdict on yet. */
async function unscoredPool(db: typeof Database, userId: string, options: {limit?: number | undefined; rescore?: boolean | undefined}): Promise<PoolRow[]> {
  const owned = sql`exists (
    select 1 from ${userListings}
    where ${userListings.listingId} = ${listings.id}
      and ${userListings.userId} = ${userId}
      ${options.rescore ? sql`and ${userListings.isMatch} is not null` : sql``}
  )`;
  // Does this listing have an enrichment worth reusing? Same condition as
  // `recordedEnrichment`, so the ordering below cannot promise a cache hit
  // that the lookup then declines.
  const reusable = sql`exists (
    select 1 from ${userListings} ul
    join ${pursuits} p on p.user_listing_id = ul.id
    join ${pursuitEvents} e on e.pursuit_id = p.id
    where ul.listing_id = ${listings.id} and e.type = 'enriched'
      and (jsonb_array_length(coalesce(e.payload->'agents', '[]'::jsonb)) > 0
        or jsonb_array_length(coalesce(e.payload->'contactRoutes', '[]'::jsonb)) > 0)
  )`;
  const query = db.select({
    rentalId: listings.rentalId,
    address: listings.address,
    price: listings.price,
    bedrooms: listings.bedrooms,
    bathrooms: listings.bathrooms,
    listingUrl: listings.listingUrl,
    brokerage: listings.brokerage,
    firstSeenAt: listings.firstSeenAt,
    // The alert that first surfaced this listing to anyone, so the new row
    // points at a real message instead of inventing one.
    sourceMessageId: sql<string | null>`(
      select ul.source_message_id from ${userListings} ul
      where ul.listing_id = ${listings.id} and ul.source_message_id is not null
      order by ul.first_seen_at asc limit 1
    )`,
  }).from(listings)
    .where(options.rescore ? sql`true` : sql`not ${owned}`)
    // Listings whose research is already recorded come first. They cost
    // nothing and resolve in milliseconds, so the feed fills with usable
    // contacts straight away instead of making the owner wait behind a queue
    // of live lookups; the rest follow in recency order.
    .orderBy(sql`${reusable} desc`, desc(listings.lastSeenAt));
  return options.limit ? query.limit(options.limit) : query;
}

export async function runPoolSearch(userId: string, deps: PoolSearchDeps): Promise<PoolSearchReport> {
  const report: PoolSearchReport = {
    considered: 0, matched: 0, notMatched: 0, ready: 0,
    needsHuman: 0, deferred: 0, errors: 0, fromCache: 0, fromLive: 0, remaining: 0,
  };
  const deadline = deps.budgetMs === undefined ? null : Date.now() + deps.budgetMs;
  const pool = await unscoredPool(deps.db, userId, {limit: deps.limit, rescore: deps.rescore});
  deps.log?.(`pool search: ${pool.length} listing(s) to score for ${userId}`);

  for (const row of pool) {
    if (deadline !== null && Date.now() >= deadline) {
      report.remaining = pool.length - report.considered;
      deps.log?.(`time budget reached; ${report.remaining} listing(s) left for the next pass`);
      break;
    }
    report.considered += 1;
    let usedCache = false;
    const pipeline: AlertPipelineDeps = {
      store: deps.store,
      enrich: async input => {
        const saved = await recordedEnrichment(deps.db, row.rentalId);
        const reused = saved ? enrichmentFromSummary(saved, input) : null;
        if (reused) {
          usedCache = true;
          deps.log?.(`${row.rentalId}: reusing recorded enrichment`);
          return reused;
        }
        deps.log?.(`${row.rentalId}: enriching ${row.address}`);
        return deps.enrich(input);
      },
    };

    const outcome: AlertListingOutcome = await processListingAlert(
      userId,
      {
        messageId: row.sourceMessageId ?? `pool:${row.rentalId}`,
        receivedAt: row.firstSeenAt,
      },
      toGmailListing(row),
      pipeline,
    );

    switch (outcome.status) {
      case 'ready': report.matched += 1; report.ready += 1; break;
      case 'needs_human': report.matched += 1; report.needsHuman += 1; break;
      case 'deferred': report.matched += 1; report.deferred += 1; break;
      case 'error': report.errors += 1; break;
      case 'skipped':
        if (outcome.reason === 'not_matched') report.notMatched += 1;
        else report.matched += 1;
        break;
    }
    if (outcome.status !== 'skipped' && outcome.status !== 'error') {
      if (usedCache) report.fromCache += 1; else report.fromLive += 1;
    }
    deps.onProgress?.(report.considered, pool.length);
  }

  deps.log?.(`pool search done: ${JSON.stringify(report)}`);
  return report;
}
