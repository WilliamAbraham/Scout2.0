import {parseListing} from '../gmail/listings.ts';
import type {Listing as GmailListing} from '../gmail/listings.ts';
import type {RawMessage} from '../gmail/message.ts';
import type {EmailListing, EnrichmentResult} from '../enrichment/service.ts';
import {runTurn} from '../outreach/turn.ts';
import type {OutreachPorts, Pursuit, SearchProfile, TurnResult} from '../outreach/types.ts';
import {isStreetEasyAlert} from './brokerage.ts';
import {agentsForOutreach, contactSnapshotFromEnrichment} from './contacts.ts';
import {gmailListingToEmailInput} from './listingInput.ts';

export type AlertListingOutcome =
  | {rentalId: string; status: 'outreach_sent'; enrichment: EnrichmentResult; turn: TurnResult}
  | {rentalId: string; status: 'needs_human'; reason: string; enrichment: EnrichmentResult}
  | {rentalId: string; status: 'skipped'; reason: string}
  | {rentalId: string; status: 'error'; reason: string};

export type AlertPipelineDeps = {
  enrich(input: EmailListing): Promise<EnrichmentResult>;
  ports: OutreachPorts;
  profile: SearchProfile;
  sendsToday: number;
  sendCap: number;
  now?: Date;
};

export type AlertMessageResult = {
  messageId: string;
  listings: AlertListingOutcome[];
};

function pursuitFromListing(
  listing: GmailListing,
  enrichment: EnrichmentResult,
  profile: SearchProfile,
): Pursuit | null {
  const snapshot = contactSnapshotFromEnrichment(enrichment);
  if (!snapshot) {
    return null;
  }
  return {
    id: listing.rentalId,
    stage: 'matched',
    needsHumanReason: null,
    threadId: null,
    nextFollowUpAt: null,
    followUpCount: 0,
    listing: {
      address: listing.address,
      price: listing.price,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      brokerage: listing.brokerage,
    },
    agents: agentsForOutreach(snapshot),
    profile,
  };
}

export async function processListingAlert(
  listing: GmailListing,
  deps: AlertPipelineDeps,
): Promise<AlertListingOutcome> {
  try {
    const input = gmailListingToEmailInput(listing);
    const enrichment = await deps.enrich(input);
    const pursuit = pursuitFromListing(listing, enrichment, deps.profile);

    if (!pursuit) {
      return {
        rentalId: listing.rentalId,
        status: 'needs_human',
        reason: enrichment.resolution === 'owner_listed' ? 'owner_listed' : 'no_contact',
        enrichment,
      };
    }

    if (!enrichment.outreachReady) {
      return {
        rentalId: listing.rentalId,
        status: 'needs_human',
        reason: 'enrichment_incomplete',
        enrichment,
      };
    }

    const turn = await runTurn({
      pursuit,
      trigger: 'open',
      inbound: null,
      thread: [],
      alreadyProcessed: false,
      sendsToday: deps.sendsToday,
      sendCap: deps.sendCap,
      now: deps.now,
    }, deps.ports);

    const escalated = turn.actions.find(action => action.type === 'escalate');
    if (escalated) {
      return {
        rentalId: listing.rentalId,
        status: 'needs_human',
        reason: escalated.reason,
        enrichment,
      };
    }

    const sent = turn.actions.some(action => action.type === 'send');
    if (!sent) {
      return {rentalId: listing.rentalId, status: 'skipped', reason: 'send_blocked'};
    }

    return {rentalId: listing.rentalId, status: 'outreach_sent', enrichment, turn};
  } catch (error) {
    return {
      rentalId: listing.rentalId,
      status: 'error',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function processStreetEasyAlert(
  message: RawMessage,
  deps: AlertPipelineDeps,
): Promise<AlertMessageResult> {
  if (!isStreetEasyAlert(message.from)) {
    return {messageId: message.id, listings: []};
  }
  if (!message.htmlBody) {
    return {messageId: message.id, listings: [{rentalId: 'unknown', status: 'error', reason: 'missing_html'}]};
  }

  const cards = await parseListing(message.htmlBody);
  const listings: AlertListingOutcome[] = [];
  let sendsToday = deps.sendsToday;

  for (const listing of cards) {
    const outcome = await processListingAlert(listing, {...deps, sendsToday});
    listings.push(outcome);
    if (outcome.status === 'outreach_sent') {
      sendsToday += 1;
    }
  }

  return {messageId: message.id, listings};
}
