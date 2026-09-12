/**
 * Where the mailbox poller resumes.
 *
 * Gmail's `history.list` is the precise cursor, but Google keeps only about a
 * week of history and invalidates the id outright after longer gaps. So the
 * checkpoint is two-sided: a history id when it is fresh enough to trust, and
 * a timestamp that bounds the catch-up query when it is not.
 */
export type MailboxCheckpoint = {
  historyId: string | null;
  lastSyncedAt: Date | null;
};

export type SyncPlan =
  /** Ask Gmail for everything that changed since `historyId`. */
  | {mode: 'incremental'; historyId: string}
  /** Search a bounded window instead, because history is missing or stale. */
  | {mode: 'catch_up'; newerThanDays: number; reason: string};

/**
 * Google's retention is about a week; stopping short of it keeps a run that
 * starts near the boundary from expiring mid-sync.
 */
export const MAX_HISTORY_AGE_DAYS = 5;

/** The widest window a catch-up will ever scan, so a long outage is bounded. */
export const MAX_CATCH_UP_DAYS = 14;

export const DEFAULT_CATCH_UP_DAYS = 2;

/**
 * Choose how to sync. Downtime longer than Gmail's history retention falls
 * back to a date-bounded search sized to the outage, capped so a mailbox left
 * off for a month does not try to reprocess the month. Mail older than the cap
 * is genuinely skipped — the caller reports that rather than hiding it.
 */
export function planSync(
  checkpoint: MailboxCheckpoint,
  now: Date,
  defaultDays = DEFAULT_CATCH_UP_DAYS,
): SyncPlan {
  const {historyId, lastSyncedAt} = checkpoint;
  if (!historyId || !lastSyncedAt) {
    return {mode: 'catch_up', newerThanDays: defaultDays, reason: 'no checkpoint yet'};
  }

  const ageMs = now.getTime() - lastSyncedAt.getTime();
  const ageDays = ageMs / 86_400_000;
  if (ageDays <= MAX_HISTORY_AGE_DAYS) {
    return {mode: 'incremental', historyId};
  }

  const days = Math.min(Math.ceil(ageDays) + 1, MAX_CATCH_UP_DAYS);
  return {
    mode: 'catch_up',
    newerThanDays: days,
    reason: `last sync was ${Math.floor(ageDays)}d ago, beyond Gmail's history retention`,
  };
}

/** True when the catch-up window could not cover the whole gap. */
export function catchUpTruncated(checkpoint: MailboxCheckpoint, plan: SyncPlan, now: Date): boolean {
  if (plan.mode !== 'catch_up' || !checkpoint.lastSyncedAt) {
    return false;
  }
  const ageDays = (now.getTime() - checkpoint.lastSyncedAt.getTime()) / 86_400_000;
  return ageDays > plan.newerThanDays;
}
