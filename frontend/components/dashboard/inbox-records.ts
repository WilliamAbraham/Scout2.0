import type { BlockerReason, InboxListing, Stage } from "./inbox-model";

export type StoredUserListing = {
  id: string;
  is_match: boolean | null;
  match_reason: string | null;
  dismissed_at: string | null;
  first_seen_at: string;
  listings: {
    rental_id: string;
    address: string;
    price: number | string;
    bedrooms: number | string | null;
    bathrooms: number | string | null;
    listing_url: string;
  };
  pursuits: {
    id: string;
    stage: Stage;
    needs_human_reason: BlockerReason | null;
    needs_human_note: string | null;
    needs_human_at: string | null;
    updated_at: string;
    contact_snapshot: {
      contacts: { name: string | null; email: string | null }[];
      sourceUrl: string | null;
    } | null;
    pursuit_events: { id: string; type: string; created_at: string }[];
  } | null;
};
const requests: Record<BlockerReason, string> = {
  no_contact: "Add a broker contact",
  unanswerable_question: "Answer the broker’s question",
  no_fitting_slot: "Choose a tour time",
  portal_link: "Complete the application portal",
  missing_document: "Provide a missing document",
  decision: "Review the broker’s decision",
};
export function safeSourceUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
// Use only facts stored in the schema. Do not infer send state, appointment
// details or thread contents until the worker supplies a versioned contract.
export function projectRecords(rows: StoredUserListing[]): InboxListing[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.listings.rental_id)) return false;
      seen.add(row.listings.rental_id);
      return true;
    })
    .map((row) => {
      const source = row.listings;
      const pursuit = row.pursuits;
      return {
        id: row.id,
        sourceId: source.rental_id,
        address: source.address,
        unit: null,
        area: null,
        rent: Number(source.price),
        beds: source.bedrooms === null ? null : Number(source.bedrooms),
        baths: source.bathrooms === null ? null : Number(source.bathrooms),
        sourceUrl: safeSourceUrl(source.listing_url),
        observedAt: row.first_seen_at,
        assessment:
          row.is_match === null
            ? "checking"
            : row.is_match
              ? "matched"
              : "not_fit",
        matchReason: row.match_reason,
        dismissed: Boolean(row.dismissed_at),
        unknowns: ["Amenities and fees are not recorded in the listing feed."],
        pursuit: pursuit
          ? {
              id: pursuit.id,
              stage: pursuit.stage,
              blocker: pursuit.needs_human_reason
                ? {
                    reason: pursuit.needs_human_reason,
                    question:
                      pursuit.needs_human_note ??
                      requests[pursuit.needs_human_reason],
                    detail: "This request was recorded by Scout.",
                    raisedAt: pursuit.needs_human_at ?? pursuit.updated_at,
                  }
                : null,
              work: "unknown",
              nextStep:
                pursuit.stage === "tour_scheduled"
                  ? "Tour marked scheduled. Time and calendar confirmation are not connected yet."
                  : "Next action is not reported yet. Review the recorded progress below.",
              updatedAt: pursuit.updated_at,
              tour: null,
              closedReason: null,
              contacts: pursuit.contact_snapshot?.contacts ?? [],
              contactEvidenceUrl: safeSourceUrl(
                pursuit.contact_snapshot?.sourceUrl ?? null,
              ),
              submittedValue: null,
            }
          : null,
        events:
          pursuit?.pursuit_events.map((event) => ({
            id: event.id,
            title: event.type.replaceAll("_", " "),
            detail: "Recorded agent event",
            at: event.created_at,
          })) ?? [],
        messages: [],
      };
    });
}
