import type { InboxListing } from "./inbox-model";

export const demoNow = "2026-09-12T16:00:00Z";
const yesterday = "2026-09-11T16:00:00Z";
const today = "2026-09-12T14:00:00Z";
function listing(
  id: string,
  address: string,
  area: string,
  rent: number,
  unit: string,
): InboxListing {
  return {
    id,
    sourceId: `demo-${id}`,
    address,
    unit,
    area,
    rent,
    beds: 1,
    baths: 1,
    sourceUrl: null,
    observedAt: yesterday,
    assessment: "matched",
    matchReason: "Within budget · 1 bedroom · In your search area",
    unknowns: [
      "Pet policy needs confirmation.",
      "Fees and laundry details are not provided.",
    ],
    dismissed: false,
    pursuit: {
      id: `pursuit-${id}`,
      stage: "matched",
      blocker: null,
      work: "finding_contact",
      nextStep: "Finding a source-supported broker contact",
      updatedAt: today,
      tour: null,
      closedReason: null,
      contacts: [],
      contactEvidenceUrl: null,
      submittedValue: null,
    },
    events: [
      {
        id: `${id}-found`,
        title: "Listing received",
        detail: "StreetEasy alert · Fictional example",
        at: yesterday,
      },
      {
        id: `${id}-match`,
        title: "Matched your search",
        detail: "Budget, bedrooms and area fit the sample profile",
        at: yesterday,
      },
    ],
    messages: [],
  };
}
const clinton = listing(
  "clinton",
  "87 Clinton Street",
  "Lower East Side",
  3200,
  "3A",
);
clinton.pursuit = {
  ...clinton.pursuit!,
  stage: "contacted",
  work: "unknown",
  updatedAt: "2026-09-12T15:48:00Z",
  blocker: {
    reason: "unanswerable_question",
    question: "Does an October 1 move-in work?",
    detail:
      "The broker needs your move-in date before arranging a tour. This answer applies to this apartment.",
    raisedAt: "2026-09-12T15:48:00Z",
  },
};
clinton.messages = [
  {
    id: "clinton-out",
    from: "Scout",
    text: "Hi, I’m interested in the apartment. Are there any tour times available this week?",
    at: yesterday,
  },
  {
    id: "clinton-in",
    from: "Broker",
    text: "We can arrange a viewing. Does an October 1 move-in work for you?",
    at: "2026-09-12T15:48:00Z",
  },
];
clinton.events.push(
  {
    id: "clinton-sent",
    title: "Tour request sent",
    detail: "Sample outreach",
    at: yesterday,
  },
  {
    id: "clinton-reply",
    title: "Broker replied",
    detail: "Move-in date requested",
    at: "2026-09-12T15:48:00Z",
  },
);
const bergen = listing("bergen", "42 Bergen Street", "Boerum Hill", 3100, "5");
bergen.pursuit!.blocker = {
  reason: "no_contact",
  question: "Can you add a broker contact?",
  detail:
    "Scout couldn’t recover a verified contact for this apartment. Supply an email for verification, or stop pursuing it.",
  raisedAt: "2026-09-12T15:00:00Z",
};
bergen.pursuit!.updatedAt = "2026-09-12T15:00:00Z";
const wythe = listing("wythe", "234 Wythe Avenue", "Williamsburg", 3450, "4B");
wythe.pursuit = {
  ...wythe.pursuit!,
  stage: "tour_scheduled",
  work: "unknown",
  nextStep: "Meet the broker at the building entrance",
  tour: {
    at: "2026-09-14T15:00:00Z",
    location: "234 Wythe Avenue · Building entrance",
    calendarStatus: "Added to calendar · Demo",
  },
};
wythe.messages = [
  {
    id: "wythe-confirm",
    from: "Broker",
    text: "Confirmed for Monday, September 14 at 11 AM. Meet me at the building entrance.",
    at: today,
  },
];
wythe.events.push({
  id: "wythe-tour",
  title: "Tour confirmed",
  detail: "September 14 · 11 AM ET · Sample booking",
  at: today,
});
const franklin = listing(
  "franklin",
  "156 Franklin Street",
  "Greenpoint",
  3350,
  "2R",
);
franklin.pursuit = {
  ...franklin.pursuit!,
  stage: "contacted",
  work: "waiting_for_broker",
  nextStep: "Asked for available tour times. Waiting for a reply.",
  updatedAt: yesterday,
};
franklin.messages = [
  {
    id: "franklin-out",
    from: "Scout",
    text: "Hi, could you share the available tour times for this apartment?",
    at: yesterday,
  },
];
franklin.events.push({
  id: "franklin-sent",
  title: "Tour request sent",
  detail: "Sample outreach",
  at: yesterday,
});
const court = listing("court", "118 Court Street", "Cobble Hill", 3400, "3");
court.pursuit = {
  ...court.pursuit!,
  work: "ready_to_contact",
  nextStep: "Contact verified. Tour request is queued.",
  contacts: [{ name: "Sample leasing office", email: "leasing@example.com" }],
};
court.events.push({
  id: "court-contact",
  title: "Contact verified",
  detail: "Fictional contact evidence for this demo",
  at: today,
});
const dekalb = listing("dekalb", "215 DeKalb Avenue", "Fort Greene", 3300, "2");
const checking = listing(
  "willoughby",
  "68 Willoughby Street",
  "Downtown Brooklyn",
  3250,
  "8C",
);
checking.assessment = "checking";
checking.matchReason = null;
checking.pursuit = null;
checking.observedAt = "2026-09-12T15:55:00Z";
checking.events = [
  {
    id: "willoughby-found",
    title: "Listing received",
    detail: "Waiting for evaluation",
    at: checking.observedAt,
  },
];
const nonmatch = listing("kent", "360 Kent Avenue", "Williamsburg", 4200, "6D");
nonmatch.assessment = "not_fit";
nonmatch.matchReason = "$700 above your $3,500 monthly budget";
nonmatch.pursuit = null;
nonmatch.events = [
  {
    id: "kent-found",
    title: "Listing received",
    detail: "StreetEasy alert · Fictional example",
    at: yesterday,
  },
  {
    id: "kent-fit",
    title: "Outside your budget",
    detail: nonmatch.matchReason,
    at: today,
  },
];
export const demoListings: InboxListing[] = [
  clinton,
  bergen,
  wythe,
  court,
  dekalb,
  franklin,
  checking,
  nonmatch,
];
