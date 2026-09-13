import type {gmail_v1} from 'googleapis';

import {catchUpTruncated, planSync} from './checkpoint.ts';
import type {MailboxCheckpoint, SyncPlan} from './checkpoint.ts';
import {LISTINGS_QUERY, listMessageIds} from './mailbox.ts';

export type MailboxProfile = {
  emailAddress: string;
  /** The mailbox's current history id, which becomes the next checkpoint. */
  historyId: string;
};

export type MailboxSync = {
  messageIds: string[];
  plan: SyncPlan;
  /** The checkpoint to persist once every message has been handled. */
  historyId: string;
  emailAddress: string;
  /** The catch-up window could not reach back to the last successful sync. */
  truncated: boolean;
  /** Gmail rejected the stored history id, so a catch-up ran instead. */
  historyExpired: boolean;
};

export type SyncOptions = {
  now?: Date;
  /** Window for a first run, and the floor for any catch-up. */
  defaultCatchUpDays?: number | undefined;
  /** Extra Gmail search terms appended to a catch-up query. */
  extraQuery?: string | undefined;
  /** Upper bound on ids returned, so one cycle cannot fetch a whole mailbox. */
  maxMessages?: number | undefined;
  /**
   * Scan StreetEasy alerts currently in the inbox instead of history. Already
   * handled ids stay skipped by the processed-message ledger.
   */
  inboxBackfill?: boolean | undefined;
};

/** The mailbox's own address and current history position. */
export async function fetchMailboxProfile(gmail: gmail_v1.Gmail): Promise<MailboxProfile> {
  const {data} = await gmail.users.getProfile({userId: 'me'});
  if (!data.emailAddress || !data.historyId) {
    throw new Error('Gmail profile is missing an address or history id');
  }
  return {emailAddress: data.emailAddress, historyId: String(data.historyId)};
}

function isHistoryExpired(error: unknown): boolean {
  const status = (error as {code?: number; status?: number})?.code ?? (error as {status?: number})?.status;
  // Gmail answers 404 once the start id has aged out of its history log.
  return status === 404;
}

/** Message ids added since `startHistoryId`, following Gmail's pagination. */
async function listAddedSince(gmail: gmail_v1.Gmail, startHistoryId: string): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const {data} = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      ...(pageToken ? {pageToken} : {}),
    });
    for (const entry of data.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const id = added.message?.id;
        // Drafts are not mail the worker has any business reading.
        const labels = added.message?.labelIds ?? [];
        if (id && !labels.includes('DRAFT')) {
          ids.add(id);
        }
      }
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return [...ids];
}

/**
 * One mailbox poll.
 *
 * Uses the stored history id when it is fresh, and a bounded date search when
 * it is not — a restart, a first run, or downtime longer than Gmail keeps
 * history. Returns the new checkpoint rather than writing it: the caller
 * persists it only after every message has been durably accounted for, so a
 * crash mid-cycle replays instead of skipping.
 */
export async function syncMailbox(
  gmail: gmail_v1.Gmail,
  checkpoint: MailboxCheckpoint,
  options: SyncOptions = {},
): Promise<MailboxSync> {
  const now = options.now ?? new Date();
  const profile = await fetchMailboxProfile(gmail);
  let plan: SyncPlan = options.inboxBackfill
    ? {mode: 'inbox_backfill', reason: 'scan current inbox'}
    : planSync(checkpoint, now, options.defaultCatchUpDays);
  let historyExpired = false;
  let messageIds: string[] = [];

  if (plan.mode === 'incremental') {
    try {
      messageIds = await listAddedSince(gmail, plan.historyId);
    } catch (error) {
      if (!isHistoryExpired(error)) throw error;
      historyExpired = true;
      plan = planSync({historyId: null, lastSyncedAt: checkpoint.lastSyncedAt}, now, options.defaultCatchUpDays);
    }
  }

  if (plan.mode === 'catch_up') {
    const query = [`newer_than:${plan.newerThanDays}d`, options.extraQuery].filter(Boolean).join(' ');
    messageIds = await listMessageIds(gmail, query);
  }

  if (plan.mode === 'inbox_backfill') {
    const query = [`in:inbox`, LISTINGS_QUERY, options.extraQuery].filter(Boolean).join(' ');
    messageIds = await listMessageIds(gmail, query);
  }

  const max = options.maxMessages;
  return {
    messageIds: max === undefined ? messageIds : messageIds.slice(0, max),
    plan,
    historyId: profile.historyId,
    emailAddress: profile.emailAddress,
    truncated: catchUpTruncated(checkpoint, plan, now),
    historyExpired,
  };
}
