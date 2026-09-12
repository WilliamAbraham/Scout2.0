import type {AlertMessageResult} from '../pipeline/alert.ts';
import {runTurn} from './turn.ts';
import type {OutreachPorts, ThreadMessage, TurnInput, TurnResult, TurnTrigger} from './types.ts';

export type MessageRoute = 'alert' | 'reply' | 'noise';

export type SyncedMessage = ThreadMessage & {
  route: MessageRoute;
  pursuitId: string | null;
};

export type WorkerUser = {
  userId: string;
  sendCap: number;
  paused: boolean;
};

export type WorkerStore = {
  listActiveUsers(): Promise<WorkerUser[]>;
  syncUser(userId: string): Promise<SyncedMessage[]>;
  isProcessed(userId: string, messageId: string): Promise<boolean>;
  markProcessed(userId: string, messageId: string, route: MessageRoute): Promise<void>;
  loadTurnInput(userId: string, pursuitId: string, trigger: TurnTrigger, inbound: ThreadMessage | null): Promise<TurnInput | null>;
  countSendsToday(userId: string, at: Date): Promise<number>;
  persistTurn(userId: string, pursuitId: string, trigger: TurnTrigger, result: TurnResult): Promise<void>;
  listDueFollowUps(userId: string, at: Date): Promise<string[]>;
  listReadyToOpen(userId: string): Promise<string[]>;
};

export type WorkerCycleReport = {
  users: number;
  synced: number;
  alerts: number;
  alertOutreach: number;
  replies: number;
  opened: number;
  followUps: number;
  skippedProcessed: number;
};

export type WorkerOptions = {
  now?: Date;
  createPorts(userId: string): OutreachPorts;
  /** StreetEasy alert → enrich → outreach. Returns outreach count per message. */
  processAlert?: (userId: string, message: SyncedMessage, ports: OutreachPorts, at: Date) => Promise<AlertMessageResult>;
};

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

export async function runWorkerCycle(store: WorkerStore, options: WorkerOptions): Promise<WorkerCycleReport> {
  const at = options.now ?? new Date();
  const report: WorkerCycleReport = {
    users: 0,
    synced: 0,
    alerts: 0,
    alertOutreach: 0,
    replies: 0,
    opened: 0,
    followUps: 0,
    skippedProcessed: 0,
  };

  const users = await store.listActiveUsers();
  report.users = users.length;

  for (const user of users) {
    if (user.paused) {
      continue;
    }
    const ports = options.createPorts(user.userId);
    const synced = await store.syncUser(user.userId);
    report.synced += synced.length;

    for (const message of synced) {
      if (await store.isProcessed(user.userId, message.id)) {
        report.skippedProcessed += 1;
        continue;
      }

      if (message.route === 'alert' && options.processAlert) {
        const alertResult = await options.processAlert(user.userId, message, ports, at);
        report.alerts += 1;
        report.alertOutreach += alertResult.listings.filter(listing => listing.status === 'outreach_sent').length;
      }

      if (message.route === 'reply' && message.pursuitId) {
        const acted = await runTrigger(store, user, message.pursuitId, 'reply', message, ports, at);
        if (acted) {
          report.replies += 1;
        }
      }

      await store.markProcessed(user.userId, message.id, message.route);
    }

    for (const pursuitId of await store.listReadyToOpen(user.userId)) {
      const acted = await runTrigger(store, user, pursuitId, 'open', null, ports, at);
      if (acted) {
        report.opened += 1;
      }
    }

    for (const pursuitId of await store.listDueFollowUps(user.userId, at)) {
      const acted = await runTrigger(store, user, pursuitId, 'follow_up', null, ports, at);
      if (acted) {
        report.followUps += 1;
      }
    }
  }

  return report;
}
