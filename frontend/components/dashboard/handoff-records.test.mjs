import { test } from "node:test";
import assert from "node:assert/strict";
import { groupFor, statusLabel } from "./inbox-model.ts";
import { projectRecords, rowsFromListingFeed } from "./inbox-records.ts";

const at = "2026-09-12T18:00:00-04:00";
const base = (pursuit = null) => ({
  id: "user-listing",
  is_match: true,
  match_reason: "Within budget",
  dismissed_at: null,
  first_seen_at: at,
  listings: {
    rental_id: "rental-1",
    address: "1 Example St",
    price: 3200,
    bedrooms: 1,
    bathrooms: 1,
    listing_url: "https://example.com/listing",
  },
  pursuits: pursuit,
});
const pursuit = (overrides = {}) => ({
  id: "pursuit-1",
  stage: "matched",
  needs_human_reason: null,
  needs_human_note: null,
  needs_human_at: null,
  updated_at: at,
  thread_id: null,
  enriched_at: at,
  next_follow_up_at: null,
  follow_up_count: 0,
  contact_snapshot: null,
  pursuit_events: [],
  ...overrides,
});
const sendPayload = {
  type: "send",
  to: ["agent@example.com"],
  cc: ["leasing@example.com"],
  subject: "Tour request",
  body: "Could I tour this apartment?",
  threadId: null,
};

test("brokerage and phone-only research remain visible without becoming outreach-ready", () => {
  const row = base(pursuit({
    needs_human_reason: "no_contact",
    needs_human_note: "No verified contact email found",
    pursuit_events: [{id: "research", type: "enriched", created_at: at, payload: {
      checkedAt: at, agents: [], contactRoutes: [{
        name: "Centennial Properties NY", phone: "212-228-9300", email: null,
        relationship: "brokerage", sourceUrls: ["javascript:alert(1)", "https://centpropny.com/"], fetchedAt: at,
      }],
    }}],
  }));
  row.listings.brokerage = "Centennial Properties NY";
  const [item] = projectRecords([row]);
  assert.equal(item.brokerage, "Centennial Properties NY");
  assert.deepEqual(item.pursuit.contacts, []);
  assert.equal(item.pursuit.recoveredContacts[0].phone, "212-228-9300");
  assert.equal(item.pursuit.recoveredContacts[0].sourceUrl, "https://centpropny.com/");
  assert.match(item.pursuit.recoveredContacts[0].label, /Brokerage office/);
  assert.equal(item.pursuit.blocker.reason, "no_contact");
  assert.equal(item.pursuit.work, "unknown");
});

test("older agent-only summaries are recovered, but candidates and superseded contacts are excluded", () => {
  const row = base(pursuit({pursuit_events: [{id: "research", type: "enriched", created_at: at, payload: {
    agents: [{name: "Agent", phone: "212-555-0123"}], candidateAgents: ["Unverified Person"],
  }}]}));
  assert.equal(projectRecords([row])[0].pursuit.recoveredContacts.length, 1);
  row.pursuits.pursuit_events.push({id: "newer", type: "enriched", created_at: "2026-09-13T12:00:00Z", payload: {
    agents: [null, 1, {}], contactRoutes: "invalid",
  }});
  assert.deepEqual(projectRecords([row])[0].pursuit.recoveredContacts, []);
});

test("a unit-conflict email is visible for review and cannot mark a pursuit ready", () => {
  const row = base(pursuit({pursuit_events: [{id: "research", type: "enriched", created_at: at, payload: {
    contactRoutes: [{name: "Leasing", email: "leasing@example.com", relationship: "unit_conflict"}],
  }}]}));
  const [item] = projectRecords([row]);
  assert.match(item.pursuit.recoveredContacts[0].label, /unit differs/);
  assert.deepEqual(item.pursuit.contacts, []);
  assert.notEqual(item.pursuit.work, "ready");
  assert.doesNotMatch(item.pursuit.nextStep, /Ready for Scout/);
});

test("dry-run drafts stay drafts and get their own active group without advancing stage", () => {
  const [item] = projectRecords([
    base(
      pursuit({
        pursuit_events: [
          {
            id: "draft-1",
            type: "draft_composed",
            created_at: at,
            payload: { ...sendPayload, trigger: "open", dryRun: true },
          },
        ],
      }),
    ),
  ]);
  assert.equal(item.pursuit.stage, "matched");
  assert.equal(item.pursuit.work, "draft_ready");
  assert.equal(statusLabel(item), "Draft ready");
  assert.equal(groupFor(item, "Active"), "Drafts ready");
  assert.deepEqual(item.messages[0], {
    id: "draft-1",
    from: "Scout",
    text: sendPayload.body,
    at,
    kind: "draft",
    subject: sendPayload.subject,
    to: sendPayload.to,
    cc: sendPayload.cc,
  });

  const [blocked] = projectRecords([
    base(
      pursuit({
        needs_human_reason: "unanswerable_question",
        needs_human_at: at,
        pursuit_events: [
          {
            id: "draft-1",
            type: "draft_composed",
            created_at: at,
            payload: sendPayload,
          },
        ],
      }),
    ),
  ]);
  assert.equal(blocked.pursuit.work, "unknown");
  assert.equal(groupFor(blocked, "Active"), "Needs you");
});

test("malformed payloads stay generic and cannot claim a draft, send, or unsafe evidence", () => {
  const [item] = projectRecords([
    base(
      pursuit({
        contact_snapshot: {
          contacts: [
            {
              name: { html: "<b>Agent</b>" },
              email: "not-an-email",
              profileUrl: "javascript:alert(1)",
            },
            { name: "Valid Agent", email: "valid@example.com" },
          ],
          sourceUrl: "https://user:secret@example.com/evidence",
        },
        pursuit_events: [
          {
            id: "bad-draft",
            type: "draft_composed",
            created_at: "2026-09-12T18:00:00",
            payload: { body: { html: "<b>Hi</b>" }, to: "agent@example.com" },
          },
          {
            id: "bad-send",
            type: "email_sent",
            created_at: at,
            payload: { ...sendPayload, cc: ["leasing@example.com", "broken"] },
          },
          {
            id: "unknown",
            type: "<img src=x onerror=alert(1)>",
            created_at: at,
            payload: ["not", "an", "object"],
          },
        ],
      }),
    ),
  ]);
  assert.equal(item.pursuit.work, "unknown");
  assert.equal(item.pursuit.nextStep, "Draft recorded; contents unavailable");
  assert.deepEqual(item.messages, []);
  assert.equal(item.pursuit.contactEvidenceUrl, null);
  assert.deepEqual(item.pursuit.contacts[0], {
    name: null,
    email: null,
    phone: null,
    profileUrl: null,
    role: "unspecified",
  });
  assert.equal(item.events[2].title, "Recorded activity");
  assert.equal(item.events[2].detail, "Scout recorded an event.");
});

test("events and messages are chronological, and only an uncontradicted send means waiting", () => {
  const [waiting] = projectRecords([
    base(
      pursuit({
        stage: "contacted",
        thread_id: "thread-1",
        pursuit_events: [
          {
            id: "b",
            type: "email_sent",
            created_at: "2026-09-12T20:00:00Z",
            payload: sendPayload,
          },
          {
            id: "a",
            type: "created",
            created_at: "2026-09-12T19:00:00Z",
            payload: {},
          },
        ],
      }),
    ),
  ]);
  assert.deepEqual(
    waiting.events.map((event) => event.id),
    ["a", "b"],
  );
  assert.equal(waiting.pursuit.work, "waiting_for_broker");
  assert.equal(waiting.messages[0].kind, "sent");

  const [answered] = projectRecords([
    base(
      pursuit({
        stage: "contacted",
        thread_id: "thread-1",
        pursuit_events: [
          {
            id: "send",
            type: "email_sent",
            created_at: "2026-09-12T19:00:00Z",
            payload: sendPayload,
          },
          {
            id: "reply",
            type: "reply_received",
            created_at: "2026-09-12T20:00:00Z",
            payload: {},
          },
        ],
      }),
    ),
  ]);
  assert.equal(answered.pursuit.work, "unknown");
});

test("user-provided contacts and valid tour/follow-up facts project without invented metadata", () => {
  const [item] = projectRecords([
    base(
      pursuit({
        stage: "tour_scheduled",
        thread_id: "thread-1",
        next_follow_up_at: "2026-09-16T10:30:00-04:00",
        follow_up_count: 2,
        contact_snapshot: {
          providedBy: "user",
          providedAt: "2026-09-12T17:00:00-04:00",
          sourceUrl: "https://example.com/agent",
          contacts: [
            {
              name: "Alex Agent",
              email: "alex@example.com",
              phone: "212-555-0100",
              profileUrl: "https://example.com/alex",
              role: "primary",
            },
          ],
        },
        pursuit_events: [
          {
            id: "tour",
            type: "tour_booked",
            created_at: at,
            payload: {
              start: "2026-09-20T15:00:00-04:00",
              end: "2026-09-20T15:30:00-04:00",
            },
          },
        ],
      }),
    ),
  ]);
  assert.equal(item.pursuit.contactProvidedByUser, true);
  assert.equal(item.pursuit.nextFollowUpAt, "2026-09-16T10:30:00-04:00");
  assert.equal(item.pursuit.followUpCount, 2);
  assert.deepEqual(item.pursuit.tour, {
    at: "2026-09-20T15:00:00-04:00",
    endsAt: "2026-09-20T15:30:00-04:00",
    location: "Not recorded",
    calendarStatus: "Unknown",
  });

  const [invalid] = projectRecords([
    base(
      pursuit({
        next_follow_up_at: "2026-09-16T10:30:00",
        pursuit_events: [
          {
            id: "tour",
            type: "tour_booked",
            created_at: at,
            payload: {
              start: "2026-09-20T15:00:00-04:00",
              end: "2026-09-20T14:30:00-04:00",
            },
          },
        ],
      }),
    ),
  ]);
  assert.equal(invalid.pursuit.nextFollowUpAt, null);
  assert.equal(invalid.pursuit.tour, null);
});

test("reachable persisted contacts are ready for the next cycle, never a verification queue", () => {
  const [item] = projectRecords([
    base(
      pursuit({
        contact_snapshot: {
          contacts: [{ email: "agent@example.com" }],
          sourceUrl: null,
        },
      }),
    ),
  ]);
  assert.equal(item.pursuit.work, "ready_to_contact");
  assert.equal(item.pursuit.nextStep, "Ready for Scout’s next cycle");

  const missingThreadField = pursuit({
    contact_snapshot: {
      contacts: [{ email: "agent@example.com" }],
      sourceUrl: null,
    },
  });
  delete missingThreadField.thread_id;
  const [unknown] = projectRecords([base(missingThreadField)]);
  assert.equal(unknown.pursuit.work, "unknown");
  assert.notEqual(unknown.pursuit.nextStep, "Ready for Scout’s next cycle");
});

test("stored closure needs a dead transition reason and a decision is not inferred closed", () => {
  const [closed] = projectRecords([
    base(
      pursuit({
        stage: "dead",
        pursuit_events: [
          {
            id: "draft",
            type: "draft_composed",
            created_at: at,
            payload: sendPayload,
          },
          {
            id: "dead",
            type: "stage_changed",
            created_at: "2026-09-12T23:00:00Z",
            payload: { from: "matched", to: "dead", reason: "Listing rented" },
          },
        ],
      }),
    ),
  ]);
  assert.equal(closed.pursuit.work, "unknown");
  assert.equal(closed.pursuit.closedReason, "Listing rented");
  assert.equal(groupFor(closed, "Active"), null);

  const [decision] = projectRecords([
    base(
      pursuit({
        stage: "decided",
        pursuit_events: [
          {
            id: "decision",
            type: "stage_changed",
            created_at: at,
            payload: {
              from: "applied",
              to: "decided",
              reason: "Application declined",
            },
          },
        ],
      }),
    ),
  ]);
  assert.equal(decision.pursuit.closedReason, null);
  assert.equal(groupFor(decision, "Closed"), null);
});

test("listings without a user overlay still appear and do not count as a match", () => {
  const [item] = projectRecords(rowsFromListingFeed([{
    rental_id: "5155790",
    address: "118 Mulberry Street #F5",
    price: 7495,
    bedrooms: 3,
    bathrooms: 2,
    listing_url: "https://streeteasy.com/rental/5155790",
    brokerage: "DALLAL",
    last_seen_at: at,
    first_seen_at: at,
    user_listings: [],
  }]));
  assert.equal(item.address, "118 Mulberry Street #F5");
  assert.equal(item.assessment, "not_fit");
  assert.equal(item.pursuit, null);
  assert.equal(groupFor(item, "All listings"), "Not a fit");
  assert.equal(groupFor(item, "Active"), null);
});

test("a listing feed keeps this user's match and pursuit when present", () => {
  const [item] = projectRecords(rowsFromListingFeed([{
    rental_id: "rental-1",
    address: "1 Example St",
    price: 3200,
    bedrooms: 1,
    bathrooms: 1,
    listing_url: "https://example.com/listing",
    brokerage: null,
    last_seen_at: at,
    first_seen_at: at,
    user_listings: [{
      id: "user-listing",
      is_match: true,
      match_reason: "Within budget",
      dismissed_at: null,
      first_seen_at: at,
      pursuits: pursuit(),
    }],
  }]));
  assert.equal(item.assessment, "matched");
  assert.equal(item.pursuit.stage, "matched");
});
