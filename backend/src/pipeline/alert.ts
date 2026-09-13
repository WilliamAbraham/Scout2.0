import type {ContactSnapshot} from '../db/schema/pursuits.ts';
import type {EmailListing, EnrichmentResult} from '../enrichment/service.ts';
import {parseAlert} from '../gmail/alert.ts';
import type {AlertLayout, MalformedCard} from '../gmail/alert.ts';
import type {Listing as GmailListing} from '../gmail/listings.ts';
import {isStreetEasyAlert} from './brokerage.ts';
import {contactSnapshotFromEnrichment} from './contacts.ts';
import {isRetryable} from './contracts.ts';
import type {EnrichmentFailure} from './contracts.ts';
import {gmailListingToEmailInput} from './listingInput.ts';

/** What the pipeline needs from an alert message. `RawMessage` satisfies it. */
export type AlertMessage = {
  id: string;
  from: string;
  date: string;
  subject?: string | undefined;
  htmlBody: string | null;
};

export type IngestOutcome = {
  listingId: string;
  userListingId: string;
  isMatch: boolean;
  /** First time this user saw this listing. */
  isNew: boolean;
  pursuitId: string | null;
  /** A pursuit exists and has not been enriched yet. */
  needsEnrichment: boolean;
};

/** The persistence the alert stage needs. `PostgresStore` implements it. */
export type AlertStore = {
  ingestListing(
    userId: string,
    source: {messageId: string; receivedAt: Date},
    listing: GmailListing,
  ): Promise<IngestOutcome>;
  saveEnrichment(
    userId: string,
    pursuitId: string,
    snapshot: ContactSnapshot | null,
    summary: Record<string, unknown>,
  ): Promise<void>;
  /** Record an enrichment attempt worth repeating, without escalating. */
  noteEnrichmentDeferred(
    userId: string,
    pursuitId: string,
    summary: Record<string, unknown>,
  ): Promise<void>;
};

export type AlertPipelineDeps = {
  store: AlertStore;
  enrich(input: EmailListing): Promise<EnrichmentResult>;
};

export type AlertListingOutcome =
  /** Persisted with a verified contact; the worker's open step sends outreach. */
  | {rentalId: string; status: 'ready'; pursuitId: string}
  | {rentalId: string; status: 'needs_human'; pursuitId: string; reason: string}
  /**
   * Persisted, but enrichment could not finish for a reason that may pass:
   * a source outage, or the day's budget. The pursuit stays un-enriched and
   * the message is retried, so nothing is escalated to the owner prematurely
   * and nothing is paid for twice in the same cycle.
   */
  | {rentalId: string; status: 'deferred'; pursuitId: string; reason: string; detail: string}
  | {rentalId: string; status: 'skipped'; reason: 'not_matched' | 'already_enriched' | 'missing_html'}
  | {rentalId: string; status: 'error'; reason: string};

export type AlertMessageResult = {
  messageId: string;
  /** Which template the mail used; `unsupported` means no card matched. */
  layout: AlertLayout;
  listings: AlertListingOutcome[];
  /** Cards that failed validation. Their siblings still landed. */
  malformed: MalformedCard[];
};

/** The subset of an enrichment result worth keeping on the pursuit timeline. */
export function summarizeEnrichment(result: EnrichmentResult): Record<string, unknown> {
  return {
    status: result.status,
    execution: result.execution,
    resolution: result.resolution,
    outreachReady: result.outreachReady,
    listingUrl: result.listingUrl,
    brokerageUrl: result.brokerageUrl,
    contactRoutes: result.contactRoutes,
    agents: result.agents.map(agent => ({
      name: agent.name,
      email: agent.email,
      phone: agent.phone,
      role: agent.role,
      profileUrl: agent.profileUrl,
    })),
    candidateAgents: result.candidateAgents.map(agent => agent.name),
    issues: result.issues,
    warnings: result.warnings,
    checkedAt: result.checkedAt,
  };
}

/**
 * Classify what enrichment came back with. The distinction that matters is
 * whether paying again could produce a different answer: a missing contact is
 * permanent for this listing, a dead source or an exhausted allowance is not.
 */
export function classifyEnrichment(result: EnrichmentResult): EnrichmentFailure | null {
  if (result.execution === 'budget_exhausted') {
    return {kind: 'budget_exhausted', detail: 'Daily enrichment budget is exhausted'};
  }
  if (result.resolution === 'owner_listed') {
    return {kind: 'owner_listed', detail: 'Owner-listed: no broker to contact'};
  }
  if (result.execution === 'error') {
    return {kind: 'transient', detail: result.issues.join('; ') || 'Enrichment source failed'};
  }
  if (contactSnapshotFromEnrichment(result) === null) {
    return {kind: 'no_contact', detail: 'No verified contact email found'};
  }
  if (!result.outreachReady) {
    return {kind: 'incomplete', detail: `Enrichment incomplete: ${result.issues.join('; ') || result.status}`};
  }
  return null;
}

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message : null;
  const head = error.message.split('\n')[0] ?? error.message;
  return cause ? `${head} (${cause})` : head;
}

export async function processListingAlert(
  userId: string,
  source: {messageId: string; receivedAt: Date},
  listing: GmailListing,
  deps: AlertPipelineDeps,
): Promise<AlertListingOutcome> {
  const {rentalId} = listing;
  let pursuitId: string | null = null;
  try {
    const ingested = await deps.store.ingestListing(userId, source, listing);
    pursuitId = ingested.pursuitId;
    if (!ingested.isMatch || !pursuitId) {
      return {rentalId, status: 'skipped', reason: 'not_matched'};
    }
    if (!ingested.needsEnrichment) {
      return {rentalId, status: 'skipped', reason: 'already_enriched'};
    }

    const enrichment = await deps.enrich(gmailListingToEmailInput(listing));
    const summary = summarizeEnrichment(enrichment);
    const failure = classifyEnrichment(enrichment);

    if (failure && isRetryable(failure)) {
      // Leave `enrichedAt` null so the next attempt picks the pursuit back up,
      // and record the reason on the timeline without escalating to the owner.
      await deps.store.noteEnrichmentDeferred(userId, pursuitId, {...summary, note: failure.detail});
      return {rentalId, status: 'deferred', pursuitId, reason: failure.kind, detail: failure.detail};
    }
    if (failure) {
      await deps.store.saveEnrichment(userId, pursuitId, null, {...summary, note: failure.detail});
      return {rentalId, status: 'needs_human', pursuitId, reason: failure.kind};
    }

    const snapshot = contactSnapshotFromEnrichment(enrichment);
    if (!snapshot) throw new Error('enrichment classified as ready but produced no contact');
    await deps.store.saveEnrichment(userId, pursuitId, snapshot, summary);
    return {rentalId, status: 'ready', pursuitId};
  } catch (error) {
    const reason = errorMessage(error);
    if (!pursuitId) {
      // Nothing persisted: the worker leaves the alert unprocessed so it retries.
      return {rentalId, status: 'error', reason};
    }
    // Enrichment threw after the pursuit exists. That is a source or provider
    // failure, not a verdict about the listing, so it is deferred for a
    // bounded retry rather than escalated to the owner or charged again now.
    try {
      await deps.store.noteEnrichmentDeferred(userId, pursuitId, {
        status: 'error',
        note: `Enrichment failed: ${reason}`,
      });
      return {rentalId, status: 'deferred', pursuitId, reason: 'transient', detail: reason};
    } catch (saveError) {
      return {rentalId, status: 'error', reason: `${reason}; and saving the failure also failed: ${errorMessage(saveError)}`};
    }
  }
}

export async function processStreetEasyAlert(
  userId: string,
  message: AlertMessage,
  deps: AlertPipelineDeps,
): Promise<AlertMessageResult> {
  if (!isStreetEasyAlert(message.from)) {
    return {messageId: message.id, layout: 'empty', listings: [], malformed: []};
  }
  if (!message.htmlBody) {
    return {
      messageId: message.id,
      layout: 'unsupported',
      listings: [{rentalId: 'unknown', status: 'skipped', reason: 'missing_html'}],
      malformed: [],
    };
  }

  const receivedAt = new Date(message.date);
  const source = {messageId: message.id, receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt};
  const parsed = await parseAlert(message.htmlBody, {subject: message.subject});
  const listings: AlertListingOutcome[] = [];
  for (const listing of parsed.cards) {
    listings.push(await processListingAlert(userId, source, listing, deps));
  }
  return {messageId: message.id, layout: parsed.layout, listings, malformed: parsed.malformed};
}
