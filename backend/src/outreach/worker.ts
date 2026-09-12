import type {AlertMessageResult} from '../pipeline/alert.ts';
import type {MessageRoute} from '../pipeline/routing.ts';
import {runTurn} from './turn.ts';
import type {OutreachPorts, ThreadMessage, TurnInput, TurnResult, TurnTrigger} from './types.ts';

export type {MessageRoute};

/** One mailbox message, with everything a router or a reply turn needs. */
export type SyncedMessage = ThreadMessage & {
  threadId: string;
  subject: string;
  sentAt: Date;
  textBody: string | null;
  htmlBody: string | null;
  rfcMessageId: string | null;
  inReplyTo: string | null;
  route: MessageRoute;
  routeReason: string;
  pursuitId: string | null;
};

/** What one mailbox poll found, and where the cursor should move to. */
export type SyncReport = {
  messages: SyncedMessage[];
  /** The Gmail history id to persist once the cycle completes. */
  checkpoint: string;
  mailbox: string;
  mode: 'incremental' | 'catch_up';
  /** The catch-up window did not reach back to the last successful sync. */
  truncated: boolean;
  historyExpired: boolean;
  fetched: number;
  retried: number;
};

export type WorkerUser = {
  userId: string;
  sendCap: number;
  paused: boolean;
};

export type WorkerStore = {
  listActiveUsers(): Promise<WorkerUser[]>;
  syncUser(userId: string, at: Date): Promise<SyncReport>;
  saveCheckpoint(userId: string, checkpoint: string, at: Date): Promise<void>;
  recordSyncError(userId: string, error: string): Promise<void>;
  isProcessed(userId: string, messageId: string): Promise<boolean>;
  markProcessed(
    userId: string,
    messageId: string,
    route: MessageRoute,
    outcome?: Record<string, unknown>,
    threadId?: string | null,
  ): Promise<void>;
  markRetry(
    userId: string,
    messageId: string,
    route: MessageRoute,
    error: string,
    at: Date,
  ): Promise<{status: 'done' | 'retry' | 'exhausted'; attempts: number}>;
  saveInboundMessage(userId: string, message: SyncedMessage): Promise<void>;
  loadTurnInput(userId: string, pursuitId: string, trigger: TurnTrigger, inbound: ThreadMessage | null): Promise<TurnInput | null>;
  countSendsToday(userId: string, at: Date): Promise<number>;
  persistTurn(userId: string, pursuitId: string, trigger: TurnTrigger, result: TurnResult): Promise<void>;
  listDueFollowUps(userId: string, at: Date): Promise<string[]>;
  listReadyToOpen(userId: string): Promise<string[]>;
  recordIngestProblem(userId: string, detail: Record<string, unknown>): Promise<void>;
};

export type WorkerCycleReport = {
  users: number;
  synced: number;
  alerts: number;
  listings: number;
  alertReady: number;
  /** Cards the parser could not read; the rest of their alert still landed. */
  malformedCards: number;
  /** Alerts whose layout no card selector matched. */
  unsupportedAlerts: number;
  /** Listings whose enrichment is worth another attempt later. */
  deferredListings: number;
  /** Messages left for a later attempt after a failure. */
  retries: number;
  /** Messages that used up their attempts and now need a human. */
  exhausted: number;
  replies: number;
  opened: number;
  followUps: number;
  skippedProcessed: number;
  /** Mailboxes whose catch-up window could not cover the whole outage. */
  truncatedSyncs: number;
};

export type WorkerOptions = {
  now?: Date;
  createPorts(userId: string): OutreachPorts;
  /** StreetEasy alert → persist → enrich. Ready pursuits are opened below. */
  processAlert?: (userId: string, message: SyncedMessage, ports: OutreachPorts, at: Date) => Promise<AlertMessageResult>;
  /** Called between messages so a long cycle can hold its mailbox lease. */
  heartbeat?: () => Promise<void>;
  /** Set when the process is shutting down; the cycle stops at a safe point. */
  shouldStop?: () => boolean;
};

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message.split('\n')[0] ?? error.message}${cause}`;
}

async function runTrigger(
  store: WorkerStore,
  user: WorkerUser,
  pursuitId: string,
  trigger: TurnTrigger,
  inbound: ThreadMessage | null,
  ports: OutreachPorts,
  at: Date,
): Promise<boolean> {
  const turnInput = await store.loadTurnInput(user.userId, pursuitId, trigger, inbound);
  if (!turnInput) {
    return false;
  }
  const sendsToday = await store.countSendsToday(user.userId, at);
  const result = await runTurn({...turnInput, sendsToday, now: at}, ports);
  await store.persistTurn(user.userId, pursuitId, trigger, result);
  return result.actions.some(action => action.type !== 'noop');
}

/**
 * One full pass over every active mailbox.
 *
 * The ordering is what keeps an at-least-once poller from losing or
 * duplicating work: a message is marked handled only after everything it
 * carried is durably represented, a failure schedules a bounded retry instead
 * of being swallowed, and the mailbox cursor advances only once every message
 * in the batch reached one of those two states.
 */
export async function runWorkerCycle(store: WorkerStore, options: WorkerOptions): Promise<WorkerCycleReport> {
  const at = options.now ?? new Date();
  const report: WorkerCycleReport = {
    users: 0,
    synced: 0,
    alerts: 0,
    listings: 0,
    alertReady: 0,
    malformedCards: 0,
    unsupportedAlerts: 0,
    deferredListings: 0,
    retries: 0,
    exhausted: 0,
    replies: 0,
    opened: 0,
    followUps: 0,
    skippedProcessed: 0,
    truncatedSyncs: 0,
  };

  const users = await store.listActiveUsers();
  report.users = users.length;

  for (const user of users) {
    if (user.paused || options.shouldStop?.()) {
      continue;
    }
    const ports = options.createPorts(user.userId);

    let sync: SyncReport;
    try {
      sync = await store.syncUser(user.userId, at);
    } catch (error) {
      // A mailbox that cannot be read is visible on the account row rather
      // than crashing the cycle for every other user.
      await store.recordSyncError(user.userId, errorMessage(error));
      continue;
    }
    report.synced += sync.messages.length;
    if (sync.truncated) report.truncatedSyncs += 1;

    let allAccountedFor = true;
    for (const message of sync.messages) {
      if (options.shouldStop?.()) {
        allAccountedFor = false;
        break;
      }
      await options.heartbeat?.();

      if (await store.isProcessed(user.userId, message.id)) {
        report.skippedProcessed += 1;
        continue;
      }

      try {
        if (message.route === 'alert' && options.processAlert) {
          const result = await options.processAlert(user.userId, message, ports, at);
          report.alerts += 1;
          report.listings += result.listings.length;
          report.alertReady += result.listings.filter(listing => listing.status === 'ready').length;
          report.malformedCards += result.malformed.length;
          if (result.layout === 'unsupported') report.unsupportedAlerts += 1;

          if (result.layout === 'unsupported' || result.malformed.length > 0) {
            await store.recordIngestProblem(user.userId, {
              messageId: message.id,
              subject: message.subject,
              layout: result.layout,
              malformed: result.malformed,
            });
          }

          const deferred = result.listings.filter(listing => listing.status === 'deferred');
          report.deferredListings += deferred.length;

          const failed = result.listings.filter(listing => listing.status === 'error');
          if (failed.length > 0) {
            // Something failed before it was persisted: retry the whole alert.
            throw new Error(`${failed.length} listing(s) failed: ${failed.map(listing => listing.reason).join('; ')}`);
          }
          if (deferred.length > 0) {
            // Persisted, but a source or the budget stopped enrichment. The
            // alert comes back after the backoff; cards already enriched are
            // skipped then, so nothing is paid for twice.
            throw new Error(
              `${deferred.length} listing(s) deferred: ` +
              deferred.map(listing => `${listing.reason} (${listing.detail})`).join('; '),
            );
          }

          await store.markProcessed(user.userId, message.id, 'alert', {
            layout: result.layout,
            listings: result.listings,
            malformed: result.malformed,
          }, message.threadId);
          continue;
        }

        if (message.route === 'reply' && message.pursuitId) {
          // Persist the broker's words before acting on them, so a crash
          // mid-turn still leaves the conversation intact.
          await store.saveInboundMessage(user.userId, message);
          const acted = await runTrigger(store, user, message.pursuitId, 'reply', message, ports, at);
          if (acted) report.replies += 1;
          await store.markProcessed(user.userId, message.id, 'reply', {
            pursuitId: message.pursuitId, acted,
          }, message.threadId);
          continue;
        }

        await store.markProcessed(user.userId, message.id, message.route, {
          reason: message.routeReason,
        }, message.threadId);
      } catch (error) {
        const outcome = await store.markRetry(user.userId, message.id, message.route, errorMessage(error), at);
        if (outcome.status === 'retry') report.retries += 1;
        else report.exhausted += 1;
        // The cursor must not move past mail still awaiting another attempt.
        allAccountedFor = false;
      }
    }

    // Only now is it safe to forget everything before this point.
    if (allAccountedFor) {
      await store.saveCheckpoint(user.userId, sync.checkpoint, at);
    }

    if (options.shouldStop?.()) continue;

    for (const pursuitId of await store.listReadyToOpen(user.userId)) {
      if (options.shouldStop?.()) break;
      await options.heartbeat?.();
      const acted = await runTrigger(store, user, pursuitId, 'open', null, ports, at);
      if (acted) report.opened += 1;
    }

    for (const pursuitId of await store.listDueFollowUps(user.userId, at)) {
      if (options.shouldStop?.()) break;
      await options.heartbeat?.();
      const acted = await runTrigger(store, user, pursuitId, 'follow_up', null, ports, at);
      if (acted) report.followUps += 1;
    }
  }

  return report;
}
