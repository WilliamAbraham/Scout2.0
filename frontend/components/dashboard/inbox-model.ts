// Stage/reason values mirror backend/src/db/schema/enums.ts. This is a UI
// projection; work, tour and message fields need the worker's outcome contract.
export type Stage =
  | "matched"
  | "contacted"
  | "tour_scheduled"
  | "toured"
  | "applied"
  | "decided"
  | "dead";
export type BlockerReason =
  | "no_contact"
  | "unanswerable_question"
  | "no_fitting_slot"
  | "portal_link"
  | "missing_document"
  | "decision";
export type Work =
  | "finding_contact"
  | "ready_to_contact"
  | "draft_ready"
  | "waiting_for_broker"
  | "replying"
  | "answer_submitted"
  | "contact_submitted"
  | "retrying"
  | "unknown";
export type View = "Active" | "All listings" | "Closed";
export type Blocker = {
  reason: BlockerReason;
  question: string;
  detail: string;
  raisedAt: string;
};
export type InboxEvent = {
  id: string;
  title: string;
  detail: string;
  at: string;
};
export type InboxListing = {
  id: string;
  sourceId: string;
  address: string;
  unit: string | null;
  area: string | null;
  rent: number;
  beds: number | null;
  baths: number | null;
  sourceUrl: string | null;
  brokerage?: string | null;
  lastSeenAt?: string | null;
  observedAt: string;
  assessment: "checking" | "matched" | "not_fit";
  matchReason: string | null;
  unknowns: string[];
  dismissed: boolean;
  pursuit: {
    id: string;
    stage: Stage;
    blocker: Blocker | null;
    work: Work;
    nextStep: string;
    updatedAt: string;
    tour: {
      at: string;
      endsAt?: string;
      location: string;
      calendarStatus: string;
    } | null;
    closedReason: string | null;
    contacts: {
      name: string | null;
      email: string | null;
      phone?: string | null;
      profileUrl?: string | null;
      role?: "primary" | "secondary" | "unspecified";
    }[];
    contactProvidedByUser?: boolean;
    recoveredContacts?: {
      name: string | null;
      email: string | null;
      phone: string | null;
      label: string;
      sourceUrl: string | null;
      checkedAt: string | null;
    }[];
    nextFollowUpAt?: string | null;
    followUpCount?: number;
    contactEvidenceUrl: string | null;
    submittedValue: string | null;
  } | null;
  events: InboxEvent[];
  messages: {
    id: string;
    from: string;
    text: string;
    at: string;
    kind?: "draft" | "sent";
    subject?: string;
    to?: string[];
    cc?: string[];
  }[];
};
export const stageLabels: Record<Stage, string> = {
  matched: "Matched",
  contacted: "Contacted",
  tour_scheduled: "Tour scheduled",
  toured: "Toured",
  applied: "Applied",
  decided: "Decision received",
  dead: "Closed",
};
export const activeGroups = [
  "Needs you",
  "Tours scheduled",
  "Drafts ready",
  "Scout working",
  "Waiting for broker",
  "Recorded progress",
];
export const assessmentGroups = [
  "Checking fit",
  "Matched",
  "Not a fit",
  "Dismissed",
];
export function isClosed(listing: InboxListing) {
  return (
    listing.pursuit?.stage === "dead" ||
    (listing.pursuit?.stage === "decided" &&
      !listing.pursuit.blocker &&
      Boolean(listing.pursuit.closedReason))
  );
}
export function assessmentLabel(listing: InboxListing) {
  if (listing.dismissed) return "Dismissed";
  return { checking: "Checking fit", matched: "Matched", not_fit: "Not a fit" }[
    listing.assessment
  ];
}
export function groupFor(listing: InboxListing, view: View): string | null {
  if (view === "All listings") return assessmentLabel(listing);
  if (view === "Closed") return isClosed(listing) ? "Closed" : null;
  if (!listing.pursuit || isClosed(listing)) return null;
  if (listing.pursuit.blocker) return "Needs you";
  if (listing.pursuit.stage === "tour_scheduled") return "Tours scheduled";
  if (listing.pursuit.work === "draft_ready") return "Drafts ready";
  if (listing.pursuit.work === "waiting_for_broker")
    return "Waiting for broker";
  if (listing.pursuit.work === "unknown") return "Recorded progress";
  return "Scout working";
}
export function statusLabel(listing: InboxListing): string {
  const pursuit = listing.pursuit;
  if (!pursuit) return assessmentLabel(listing);
  if (isClosed(listing)) return "Closed";
  if (
    pursuit.blocker ||
    (pursuit.stage !== "matched" && pursuit.stage !== "contacted")
  )
    return stageLabels[pursuit.stage];
  const labels: Record<Work, string> = {
    finding_contact: "Finding contact",
    ready_to_contact: "Ready to contact",
    draft_ready: "Draft ready",
    waiting_for_broker: "Waiting for broker",
    replying: "Scout replying",
    answer_submitted: "Answer submitted",
    contact_submitted: "Contact supplied",
    retrying: "Contact search delayed",
    unknown: stageLabels[pursuit.stage],
  };
  return labels[pursuit.work];
}
export function nextStep(listing: InboxListing) {
  if (isClosed(listing))
    return listing.pursuit?.closedReason ?? "Pursuit ended";
  if (listing.pursuit)
    return listing.pursuit.blocker?.question ?? listing.pursuit.nextStep;
  if (listing.dismissed) return "Hidden from your incoming listings";
  if (listing.assessment === "checking")
    return "Waiting for Scout to evaluate this listing";
  if (listing.assessment === "matched")
    return "Matched · Waiting to start pursuit";
  return listing.matchReason ?? "Does not match your search";
}
export function actionOwner(listing: InboxListing) {
  if (isClosed(listing)) return "Complete";
  if (
    !listing.pursuit &&
    (listing.assessment === "not_fit" || listing.dismissed)
  )
    return "No action needed";
  if (listing.pursuit?.blocker) return "Your turn";
  if (listing.pursuit?.work === "waiting_for_broker") return "Broker’s turn";
  return "Scout’s next step";
}
export function compareListings(a: InboxListing, b: InboxListing, view: View) {
  if (view === "All listings")
    return Date.parse(b.observedAt) - Date.parse(a.observedAt);
  const aTime = a.pursuit?.blocker?.raisedAt ?? a.pursuit?.tour?.at;
  const bTime = b.pursuit?.blocker?.raisedAt ?? b.pursuit?.tour?.at;
  if (aTime && bTime) return Date.parse(aTime) - Date.parse(bTime);
  return (
    Date.parse(b.pursuit?.updatedAt ?? b.observedAt) -
    Date.parse(a.pursuit?.updatedAt ?? a.observedAt)
  );
}
// Demo receipts deliberately preserve stage and never manufacture a send,
// verified contact, or calendar outcome. The live worker must confirm those.
export function submitDemoResolution(
  listing: InboxListing,
  value: string,
  at: string,
): InboxListing {
  const pursuit = listing.pursuit;
  const blocker = pursuit?.blocker;
  if (!pursuit || !blocker || isClosed(listing) || !value.trim())
    return listing;
  if (
    !["no_contact", "unanswerable_question", "no_fitting_slot"].includes(
      blocker.reason,
    )
  )
    return listing;
  const contact = blocker.reason === "no_contact";
  return {
    ...listing,
    pursuit: {
      ...pursuit,
      blocker: null,
      work: contact ? "contact_submitted" : "answer_submitted",
      nextStep: contact
        ? "Contact supplied in this demo. No outreach sent."
        : "Answer submitted. Scout’s next action is queued; no reply sent.",
      submittedValue: value.trim(),
      updatedAt: at,
    },
    events: [
      ...listing.events,
      {
        id: `receipt-${at}`,
        title: contact ? "Contact supplied" : "Answer submitted",
        detail: `${value.trim()} · Demo receipt only`,
        at,
      },
    ],
  };
}
export function stopDemoPursuit(
  listing: InboxListing,
  at: string,
): InboxListing {
  if (!listing.pursuit || isClosed(listing)) return listing;
  return {
    ...listing,
    pursuit: {
      ...listing.pursuit,
      stage: "dead",
      blocker: null,
      closedReason: "Stopped by you",
      updatedAt: at,
    },
    events: [
      ...listing.events,
      {
        id: `stop-${at}`,
        title: "Pursuit stopped",
        detail: "Stopped by you in the demo",
        at,
      },
    ],
  };
}
export function dismissDemoListing(listing: InboxListing): InboxListing {
  // Dismissal is available for incoming rows only; it never stops an agent.
  return listing.pursuit
    ? listing
    : { ...listing, dismissed: !listing.dismissed };
}
