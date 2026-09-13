import type {
  BlockerReason,
  InboxEvent,
  InboxListing,
  Stage,
  Work,
} from "./inbox-model";

type StoredContact = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  profileUrl?: unknown;
  role?: unknown;
};

type StoredPursuit = {
  id: string;
  stage: Stage;
  needs_human_reason: BlockerReason | null;
  needs_human_note: string | null;
  needs_human_at: string | null;
  updated_at: string;
  thread_id?: string | null;
  enriched_at?: string | null;
  next_follow_up_at?: string | null;
  follow_up_count?: number;
  contact_snapshot: {
    contacts?: StoredContact[];
    sourceUrl?: unknown;
    providedBy?: unknown;
    providedAt?: unknown;
  } | null;
  pursuit_events: {
    id: string;
    type: string;
    created_at: string;
    payload?: unknown;
  }[];
};

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
    brokerage?: string | null;
    last_seen_at?: string | null;
  };
  pursuits: StoredPursuit | null;
};

const requests: Record<BlockerReason, string> = {
  no_contact: "Add a broker contact",
  unanswerable_question: "Answer the broker’s question",
  no_fitting_slot: "Choose a tour time",
  portal_link: "Complete the application portal",
  missing_document: "Provide a missing document",
  decision: "Review the broker’s decision",
};

function plainString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function payloadOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function offsetTimestamp(value: unknown): string | null {
  const text = plainString(value);
  if (!text || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return null;
  return Number.isNaN(Date.parse(text)) ? null : text;
}

function emails(value: unknown, allowEmpty = false): string[] | null {
  if (!Array.isArray(value)) return null;
  const result = value.map(plainString);
  if (
    result.some((email) => !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
  )
    return null;
  return result.length || allowEmpty ? (result as string[]) : null;
}

export function safeSourceUrl(value: unknown) {
  const text = plainString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function projectedContacts(snapshot: StoredPursuit["contact_snapshot"]) {
  if (!snapshot || !Array.isArray(snapshot.contacts)) return [];
  return snapshot.contacts
    .filter(
      (contact): contact is StoredContact =>
        contact !== null &&
        typeof contact === "object" &&
        !Array.isArray(contact),
    )
    .map((contact) => {
      const role = ["primary", "secondary", "unspecified"].includes(
        String(contact.role),
      )
        ? (contact.role as "primary" | "secondary" | "unspecified")
        : "unspecified";
      return {
        name: plainString(contact.name),
        email: emails([contact.email])?.[0] ?? null,
        phone: plainString(contact.phone),
        profileUrl: safeSourceUrl(contact.profileUrl),
        role,
      };
    });
}

type OrderedEvent = StoredPursuit["pursuit_events"][number] & {
  payload: Record<string, unknown>;
  at: string;
};

// Keep research results visible without making them outreach recipients.
function recoveredContacts(events: OrderedEvent[]) {
  const latest = events.findLast((event) => event.type === "enriched" || (
    event.type === "error" && event.payload.deferred === true &&
    [event.payload.agents, event.payload.contactRoutes].some((contacts) => Array.isArray(contacts) && contacts.length > 0)
  ));
  if (!latest) return [];
  const summary = latest.payload;
  const agents = Array.isArray(summary.agents) ? summary.agents : [];
  const routes = Array.isArray(summary.contactRoutes) ? summary.contactRoutes : [];
  return [
    ...agents.map((value) => ({ value, agent: true })),
    ...routes.map((value) => ({ value, agent: false })),
  ].flatMap(({ value, agent }) => {
    const contact = payloadOf(value);
    const name = plainString(contact.name);
    const email = emails([contact.email])?.[0] ?? null;
    const phone = plainString(contact.phone);
    if (!name && !email && !phone) return [];
    const sources = Array.isArray(contact.sourceUrls) ? contact.sourceUrls : [];
    return [{
      name, email, phone,
      label: agent
        ? "Listing agent · recovered contact"
        : contact.relationship === "unit_conflict"
          ? "Brokerage contact · unit differs; review needed"
          : contact.relationship === "exact_listing"
            ? "Listing leasing team"
            : "Brokerage office · listing association unconfirmed",
      sourceUrl: safeSourceUrl(contact.sourceUrl) ?? sources.map(safeSourceUrl).find(Boolean)
        ?? safeSourceUrl(summary.listingUrl) ?? safeSourceUrl(summary.brokerageUrl),
      checkedAt: offsetTimestamp(contact.fetchedAt) ?? offsetTimestamp(summary.checkedAt),
    }];
  });
}

function orderedEvents(
  pursuit: StoredPursuit,
  observedAt: string,
): OrderedEvent[] {
  const fallback =
    offsetTimestamp(pursuit.updated_at) ?? offsetTimestamp(observedAt) ?? "";
  return pursuit.pursuit_events
    .map((event) => ({
      ...event,
      payload: payloadOf(event.payload),
      at: offsetTimestamp(event.created_at) ?? fallback,
    }))
    .sort((a, b) => {
      const difference = Date.parse(a.at) - Date.parse(b.at);
      return (
        (Number.isNaN(difference) ? 0 : difference) || a.id.localeCompare(b.id)
      );
    });
}

function eventSummary(event: OrderedEvent): InboxEvent {
  const payload = event.payload;
  const detail = plainString(payload.detail) ?? plainString(payload.note);
  switch (event.type) {
    case "created":
      return {
        id: event.id,
        title: "Pursuit started",
        detail: "Scout started tracking this listing.",
        at: event.at,
      };
    case "enriched":
      return {
        id: event.id,
        title: "Contact search completed",
        detail: detail ?? "Scout recorded contact research.",
        at: event.at,
      };
    case "escalated":
      return {
        id: event.id,
        title: "Your input requested",
        detail: detail ?? "Scout recorded a request for your input.",
        at: event.at,
      };
    case "draft_composed":
      return {
        id: event.id,
        title: "Draft composed",
        detail:
          plainString(payload.subject) ??
          "An outreach draft is ready for review.",
        at: event.at,
      };
    case "email_sent":
      return {
        id: event.id,
        title: "Email sent",
        detail: plainString(payload.subject) ?? "Scout recorded a sent email.",
        at: event.at,
      };
    case "reply_received":
      return {
        id: event.id,
        title: "Reply received",
        detail: detail ?? "A broker reply was recorded.",
        at: event.at,
      };
    case "follow_up_scheduled": {
      const at = offsetTimestamp(payload.at);
      return {
        id: event.id,
        title: "Follow-up scheduled",
        detail: at
          ? `Scheduled for ${at}`
          : "Scout recorded a follow-up without a valid time.",
        at: event.at,
      };
    }
    case "tour_booked": {
      const start = offsetTimestamp(payload.start);
      const end = offsetTimestamp(payload.end);
      const validRange = start && end && Date.parse(end) > Date.parse(start);
      return {
        id: event.id,
        title: "Tour recorded",
        detail: validRange
          ? `Starts ${start} · Ends ${end}`
          : "Tour timing was not recorded in a usable format.",
        at: event.at,
      };
    }
    case "packet_sent":
      return {
        id: event.id,
        title: "Application packet sent",
        detail: "Scout recorded the packet send.",
        at: event.at,
      };
    case "stage_changed": {
      const from = plainString(payload.from);
      const to = plainString(payload.to);
      const change =
        from && to
          ? `${from.replaceAll("_", " ")} → ${to.replaceAll("_", " ")}`
          : "Scout recorded a stage change.";
      return {
        id: event.id,
        title: "Stage changed",
        detail: plainString(payload.reason) ?? change,
        at: event.at,
      };
    }
    case "error":
      return {
        id: event.id,
        title: "Scout encountered an error",
        detail:
          detail ??
          plainString(payload.message) ??
          "No error detail was recorded.",
        at: event.at,
      };
    default:
      return {
        id: event.id,
        title: "Recorded activity",
        detail: "Scout recorded an event.",
        at: event.at,
      };
  }
}

function messageFrom(
  event: OrderedEvent,
): InboxListing["messages"][number] | null {
  if (event.type !== "draft_composed" && event.type !== "email_sent")
    return null;
  const text = plainString(event.payload.body);
  const subject = plainString(event.payload.subject);
  const to = emails(event.payload.to);
  const cc = emails(event.payload.cc, true);
  if (!text || !subject || !to || !cc) return null;
  return {
    id: event.id,
    from: "Scout",
    text,
    at: event.at,
    kind: event.type === "draft_composed" ? "draft" : "sent",
    subject,
    to,
    cc,
  };
}

function workState(
  pursuit: StoredPursuit,
  events: OrderedEvent[],
  messages: InboxListing["messages"],
  contacts: ReturnType<typeof projectedContacts>,
): Work {
  if (
    pursuit.stage === "dead" ||
    pursuit.stage === "decided" ||
    pursuit.needs_human_reason
  )
    return "unknown";
  const validDraft = messages.some((message) => message.kind === "draft");
  const hasDraftRecord = events.some(
    (event) => event.type === "draft_composed",
  );
  if (pursuit.stage === "matched" && validDraft) return "draft_ready";
  if (pursuit.stage === "matched" && hasDraftRecord) return "unknown";
  if (
    pursuit.stage === "matched" &&
    pursuit.thread_id === null &&
    contacts.some((contact) => contact.email !== null)
  )
    return "ready_to_contact";

  const lastSend = events.findLastIndex(
    (event) => event.type === "email_sent" && messageFrom(event) !== null,
  );
  const isContrary = (event: OrderedEvent) => {
    if (
      [
        "reply_received",
        "escalated",
        "tour_booked",
        "packet_sent",
        "error",
      ].includes(event.type)
    )
      return true;
    return (
      event.type === "stage_changed" &&
      plainString(event.payload.to) !== "contacted"
    );
  };
  const lastSendEvent = events[lastSend];
  const lastSendAt = lastSendEvent ? Date.parse(lastSendEvent.at) : Number.NaN;
  const laterContrary = events.some(
    (event) => isContrary(event) && Date.parse(event.at) >= lastSendAt,
  );
  return pursuit.stage === "contacted" && lastSend >= 0 && !laterContrary
    ? "waiting_for_broker"
    : "unknown";
}

function closedReason(events: OrderedEvent[]): string | null {
  const closure = events.findLast(
    (event) =>
      event.type === "stage_changed" &&
      plainString(event.payload.to) === "dead",
  );
  return closure ? plainString(closure.payload.reason) : null;
}

function tourFrom(events: OrderedEvent[]) {
  const event = events.findLast(
    (candidate) => candidate.type === "tour_booked",
  );
  if (!event) return null;
  const at = offsetTimestamp(event.payload.start);
  const endsAt = offsetTimestamp(event.payload.end);
  if (!at || !endsAt || Date.parse(endsAt) <= Date.parse(at)) return null;
  return {
    at,
    endsAt,
    location: "Not recorded",
    calendarStatus: "Unknown",
  };
}

// Project only persisted facts. Malformed payloads remain generic so partial
// worker records cannot become claims about sends, replies, or appointments.
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
      const events = pursuit ? orderedEvents(pursuit, row.first_seen_at) : [];
      const messages = events
        .map(messageFrom)
        .filter(
          (message): message is NonNullable<typeof message> => message !== null,
        );
      const contacts = projectedContacts(pursuit?.contact_snapshot ?? null);
      const validDraft = messages.some((message) => message.kind === "draft");
      const hasDraftRecord = events.some(
        (event) => event.type === "draft_composed",
      );
      const reachableContact = contacts.some((contact) => contact.email);
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
        brokerage: plainString(source.brokerage),
        lastSeenAt: offsetTimestamp(source.last_seen_at),
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
              work: workState(pursuit, events, messages, contacts),
              nextStep:
                pursuit.stage === "matched" &&
                !pursuit.needs_human_reason &&
                validDraft
                  ? "Review the saved outreach draft before any message is sent."
                  : pursuit.stage === "matched" &&
                      !pursuit.needs_human_reason &&
                      hasDraftRecord
                    ? "Draft recorded; contents unavailable"
                    : pursuit.stage === "matched" &&
                        !pursuit.needs_human_reason &&
                        pursuit.thread_id === null &&
                        reachableContact
                      ? "Ready for Scout’s next cycle"
                      : "Next action is not reported yet. Review the recorded progress below.",
              updatedAt: pursuit.updated_at,
              tour: tourFrom(events),
              closedReason: closedReason(events),
              contacts,
              recoveredContacts: recoveredContacts(events).filter((recovered) =>
                !contacts.some((contact) => contact.name === recovered.name
                  && contact.email === recovered.email && contact.phone === recovered.phone)),
              contactEvidenceUrl: safeSourceUrl(
                pursuit.contact_snapshot?.sourceUrl,
              ),
              contactProvidedByUser:
                pursuit.contact_snapshot?.providedBy === "user" &&
                offsetTimestamp(pursuit.contact_snapshot.providedAt) !== null,
              nextFollowUpAt: offsetTimestamp(pursuit.next_follow_up_at),
              ...(Number.isInteger(pursuit.follow_up_count) &&
              (pursuit.follow_up_count ?? -1) >= 0
                ? { followUpCount: pursuit.follow_up_count as number }
                : {}),
              submittedValue: null,
            }
          : null,
        events: events.map(eventSummary),
        messages,
      };
    });
}
