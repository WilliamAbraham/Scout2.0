import type {ContactSnapshot} from '../db/schema/pursuits.ts';
import type {EmailListing, EnrichmentResult} from '../enrichment/service.ts';
import {parseListing} from '../gmail/listings.ts';
import type {Listing as GmailListing} from '../gmail/listings.ts';
import {isStreetEasyAlert} from './brokerage.ts';
import {contactSnapshotFromEnrichment} from './contacts.ts';
import {gmailListingToEmailInput} from './listingInput.ts';

/** What the pipeline needs from an alert message. `RawMessage` satisfies it. */
export type AlertMessage = {
  id: string;
  from: string;
  date: string;
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
};

export type AlertPipelineDeps = {
  store: AlertStore;
  enrich(input: EmailListing): Promise<EnrichmentResult>;
};

export type AlertListingOutcome =
  /** Persisted with a verified contact; the worker's open step sends outreach. */
  | {rentalId: string; status: 'ready'; pursuitId: string}
  | {rentalId: string; status: 'needs_human'; pursuitId: string; reason: string}
  | {rentalId: string; status: 'skipped'; reason: 'not_matched' | 'already_enriched' | 'missing_html'}
  | {rentalId: string; status: 'error'; reason: string};

export type AlertMessageResult = {
  messageId: string;
  listings: AlertListingOutcome[];
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
    const snapshot = contactSnapshotFromEnrichment(enrichment);
    const summary = summarizeEnrichment(enrichment);

    if (!snapshot) {
      const reason = enrichment.resolution === 'owner_listed' ? 'owner_listed' : 'no_contact';
      await deps.store.saveEnrichment(userId, pursuitId, null, {
        ...summary,
        note: reason === 'owner_listed' ? 'Owner-listed: no broker to contact' : 'No verified contact email found',
      });
      return {rentalId, status: 'needs_human', pursuitId, reason};
    }
    if (!enrichment.outreachReady) {
      await deps.store.saveEnrichment(userId, pursuitId, null, {
        ...summary,
        note: `Enrichment incomplete: ${enrichment.issues.join('; ') || enrichment.status}`,
      });
      return {rentalId, status: 'needs_human', pursuitId, reason: 'enrichment_incomplete'};
    }

    await deps.store.saveEnrichment(userId, pursuitId, snapshot, summary);
    return {rentalId, status: 'ready', pursuitId};
  } catch (error) {
    const reason = errorMessage(error);
    if (!pursuitId) {
      // Nothing persisted: the worker leaves the alert unprocessed so it retries.
      return {rentalId, status: 'error', reason};
    }
    // Enrichment failed after the pursuit exists. Surface it to the owner as a
    // blocker rather than retrying a paid step every cycle.
    try {
      await deps.store.saveEnrichment(userId, pursuitId, null, {status: 'error', note: `Enrichment failed: ${reason}`});
      return {rentalId, status: 'needs_human', pursuitId, reason: 'enrichment_error'};
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
    return {messageId: message.id, listings: []};
  }
  if (!message.htmlBody) {
    return {messageId: message.id, listings: [{rentalId: 'unknown', status: 'skipped', reason: 'missing_html'}]};
  }

  const receivedAt = new Date(message.date);
  const source = {messageId: message.id, receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt};
  const cards = await parseListing(message.htmlBody);
  const listings: AlertListingOutcome[] = [];
  for (const listing of cards) {
    listings.push(await processListingAlert(userId, source, listing, deps));
  }
  return {messageId: message.id, listings};
}
