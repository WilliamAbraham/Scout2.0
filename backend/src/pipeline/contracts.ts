import type {ContactSnapshot} from '../db/schema/pursuits.ts';
import type {EmailListing, EnrichmentResult} from '../enrichment/service.ts';
import type {SendMailInput} from '../outreach/types.ts';

/**
 * The two seams between this workstream and the other two.
 *
 * Ingestion owns the worker, the pipeline and the store. Enrichment and
 * delivery are injected, so either can be replaced without touching the loop:
 * enrichment is a function from a parsed listing to an outcome, delivery is a
 * function from a composed message to a real provider id. Both are narrow on
 * purpose — nothing here imports enrichment prompts or sender internals.
 */

/** Why a listing could not be enriched, and whether trying again is sensible. */
export type EnrichmentFailure =
  /** Nothing to contact. Permanent for this listing: do not pay again. */
  | {kind: 'no_contact'; detail: string}
  /** The listing is owner-listed, so there is no broker at all. */
  | {kind: 'owner_listed'; detail: string}
  /** A source was unreachable or malformed. Worth one bounded retry. */
  | {kind: 'transient'; detail: string}
  /** The shared daily allowance is gone. Retry after it resets, never now. */
  | {kind: 'budget_exhausted'; detail: string}
  /** Enrichment ran but its result is not safe to email. Needs a human. */
  | {kind: 'incomplete'; detail: string};

export type EnrichmentOutcome =
  | {status: 'ready'; snapshot: ContactSnapshot; summary: Record<string, unknown>}
  | {status: 'failed'; failure: EnrichmentFailure; summary: Record<string, unknown>};

/** Failures the worker should come back to rather than escalate. */
export function isRetryable(failure: EnrichmentFailure): boolean {
  return failure.kind === 'transient' || failure.kind === 'budget_exhausted';
}

/**
 * What Codex supplies. A single call per listing; everything it learned comes
 * back in the result, and nothing is written to the database by it.
 */
export type EnrichmentAdapter = (input: EmailListing) => Promise<EnrichmentResult>;

/**
 * What Cursor supplies. The worker never constructs Gmail requests itself: it
 * hands over a composed message and stores whatever provider ids come back.
 */
export type DeliveryService = (message: SendMailInput) => Promise<{threadId: string; messageId: string}>;
