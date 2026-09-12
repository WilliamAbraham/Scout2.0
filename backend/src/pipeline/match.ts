import type {SearchProfile as ProfileRow} from '../db/schema/profiles.ts';

export type MatchInput = {
  price: number;
  bedrooms: number | null;
  bathrooms: number | null;
};

/** The deterministic subset of a profile the hard filter reads. */
export type MatchCriteria = Pick<ProfileRow,
  'budgetMin' | 'budgetMax' | 'bedroomsMin' | 'bedroomsMax' | 'bathroomsMin'>;

export type MatchResult = {
  isMatch: boolean;
  /** Human-readable justification for the feed. */
  reason: string;
};

/**
 * Hard filters only: budget and room counts. Unknown listing counts do not
 * fail a bound (the alert simply omitted them), and a missing profile bound
 * is unconstrained. Subjective preference scoring is a later, additive step.
 */
export function matchListing(listing: MatchInput, criteria: MatchCriteria | null): MatchResult {
  if (!criteria) {
    return {isMatch: true, reason: 'No search profile; every listing matches'};
  }

  const failures: string[] = [];
  const passes: string[] = [];

  if (criteria.budgetMax !== null && listing.price > criteria.budgetMax) {
    failures.push(`$${listing.price} is over the $${criteria.budgetMax} budget`);
  } else if (criteria.budgetMin !== null && listing.price < criteria.budgetMin) {
    failures.push(`$${listing.price} is under the $${criteria.budgetMin} floor`);
  } else if (criteria.budgetMax !== null) {
    passes.push(`$${listing.price} is within the $${criteria.budgetMax} budget`);
  }

  if (listing.bedrooms !== null) {
    if (criteria.bedroomsMin !== null && listing.bedrooms < criteria.bedroomsMin) {
      failures.push(`${listing.bedrooms} bed is under the ${criteria.bedroomsMin} bed minimum`);
    } else if (criteria.bedroomsMax !== null && listing.bedrooms > criteria.bedroomsMax) {
      failures.push(`${listing.bedrooms} bed is over the ${criteria.bedroomsMax} bed maximum`);
    } else if (criteria.bedroomsMin !== null || criteria.bedroomsMax !== null) {
      passes.push(`${listing.bedrooms} bed fits`);
    }
  }

  if (listing.bathrooms !== null && criteria.bathroomsMin !== null && listing.bathrooms < criteria.bathroomsMin) {
    failures.push(`${listing.bathrooms} bath is under the ${criteria.bathroomsMin} bath minimum`);
  }

  if (failures.length > 0) {
    return {isMatch: false, reason: failures.join('; ')};
  }
  return {isMatch: true, reason: passes.length > 0 ? passes.join('; ') : 'No hard constraints violated'};
}
