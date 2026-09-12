import type {RawMessage} from '../gmail/message.ts';
import {isStreetEasyAlert} from './brokerage.ts';

export type MessageRoute = 'alert' | 'reply' | 'noise';

/** What the worker needs to know about a mailbox before routing its mail. */
export type RoutingContext = {
  /** Gmail thread ids of this user's open pursuits, mapped to the pursuit. */
  threads: Map<string, string>;
  /** Broker addresses this user has written to, mapped to the pursuit. */
  contacts: Map<string, string>;
  /** The connected mailbox's own address, so self-sent mail is never a reply. */
  selfAddress: string | null;
};

export type RoutedMessage = {
  route: MessageRoute;
  pursuitId: string | null;
  reason: string;
};

/** "Ava Agent <ava@broker.example>" → "ava@broker.example". */
export function emailAddress(header: string): string | null {
  const angled = /<([^>]+)>/.exec(header)?.[1];
  const bare = (angled ?? header).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bare) ? bare : null;
}

/**
 * Decide what a message is. Three outcomes, in priority order:
 *
 * 1. A StreetEasy alert, parsed for listings.
 * 2. A broker reply, matched to a pursuit by Gmail thread id first and sender
 *    address second. The thread id is the reliable join; the address covers a
 *    broker replying from a colleague's mailbox on the same thread.
 * 3. Noise, recorded as handled so it is never looked at again.
 *
 * Mail the mailbox sent itself is never a reply: the worker's own outbound
 * copy lands in the same thread and would otherwise trigger a reply turn.
 */
export function routeMessage(message: RawMessage, context: RoutingContext): RoutedMessage {
  const from = emailAddress(message.from);

  if (context.selfAddress && from === context.selfAddress.toLowerCase()) {
    return {route: 'noise', pursuitId: null, reason: 'self_sent'};
  }
  if (isStreetEasyAlert(message.from)) {
    return {route: 'alert', pursuitId: null, reason: 'streeteasy_alert'};
  }

  const byThread = message.threadId ? context.threads.get(message.threadId) : undefined;
  if (byThread) {
    return {route: 'reply', pursuitId: byThread, reason: 'thread_match'};
  }
  const bySender = from ? context.contacts.get(from) : undefined;
  if (bySender) {
    return {route: 'reply', pursuitId: bySender, reason: 'sender_match'};
  }

  return {route: 'noise', pursuitId: null, reason: 'unrecognized_sender'};
}

/**
 * Bounded backoff for a message whose processing failed for a reason that
 * might not repeat: a database blip, a rate-limited redirect resolve. Grows
 * roughly 5m, 20m, 80m, then gives up, so a permanently broken message costs
 * four attempts rather than one every cycle forever.
 */
export const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 5 * 60_000;

export function nextAttemptAt(attempts: number, at: Date): Date | null {
  if (attempts >= MAX_ATTEMPTS) {
    return null;
  }
  return new Date(at.getTime() + BASE_BACKOFF_MS * 4 ** (attempts - 1));
}
