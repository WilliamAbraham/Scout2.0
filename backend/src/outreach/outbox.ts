import type {SendMailInput} from './types.ts';

export type OutboxState = 'intended' | 'claimed' | 'sent' | 'failed' | 'uncertain' | 'cancelled';

export type OutboxRow = {
  id: string;
  userId: string;
  pursuitId: string;
  actionKey: string;
  state: OutboxState;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  threadId: string | null;
  rfc822MessageId: string | null;
  providerMessageId: string | null;
  providerThreadId: string | null;
  error: string | null;
};

export type IntendInput = {
  userId: string;
  pursuitId: string;
  actionKey: string;
  message: SendMailInput;
};

export type Outbox = {
  intend(input: IntendInput): Promise<OutboxRow> | OutboxRow;
  get(userId: string, pursuitId: string, actionKey: string): Promise<OutboxRow | null> | OutboxRow | null;
  claim(id: string): Promise<boolean> | boolean;
  markSent(id: string, ids: {threadId: string; messageId: string}): Promise<void> | void;
  markFailed(id: string, error: string): Promise<void> | void;
  markUncertain(id: string, error: string): Promise<void> | void;
  cancelFollowUps(userId: string, pursuitId: string): Promise<void> | void;
};

function keyOf(userId: string, pursuitId: string, actionKey: string): string {
  return `${userId}\0${pursuitId}\0${actionKey}`;
}

export class MemoryOutbox implements Outbox {
  private readonly rows = new Map<string, OutboxRow>();
  private seq = 0;

  intend(input: IntendInput): OutboxRow {
    const existing = this.get(input.userId, input.pursuitId, input.actionKey);
    if (existing) {
      return existing;
    }
    this.seq += 1;
    const row: OutboxRow = {
      id: `outbox-${this.seq}`,
      userId: input.userId,
      pursuitId: input.pursuitId,
      actionKey: input.actionKey,
      state: 'intended',
      to: input.message.to,
      cc: input.message.cc,
      subject: input.message.subject,
      body: input.message.body,
      threadId: input.message.threadId,
      rfc822MessageId: null,
      providerMessageId: null,
      providerThreadId: null,
      error: null,
    };
    this.rows.set(keyOf(input.userId, input.pursuitId, input.actionKey), row);
    return row;
  }

  get(userId: string, pursuitId: string, actionKey: string): OutboxRow | null {
    return this.rows.get(keyOf(userId, pursuitId, actionKey)) ?? null;
  }

  claim(id: string): boolean {
    const row = this.findById(id);
    if (!row || row.state !== 'intended') {
      return false;
    }
    row.state = 'claimed';
    return true;
  }

  markSent(id: string, ids: {threadId: string; messageId: string}): void {
    const row = this.findById(id);
    if (!row) {
      return;
    }
    row.state = 'sent';
    row.providerThreadId = ids.threadId;
    row.providerMessageId = ids.messageId;
    row.error = null;
  }

  markFailed(id: string, error: string): void {
    const row = this.findById(id);
    if (!row) {
      return;
    }
    row.state = 'failed';
    row.error = error;
  }

  markUncertain(id: string, error: string): void {
    const row = this.findById(id);
    if (!row) {
      return;
    }
    row.state = 'uncertain';
    row.error = error;
  }

  cancelFollowUps(userId: string, pursuitId: string): void {
    for (const row of this.rows.values()) {
      if (row.userId === userId && row.pursuitId === pursuitId && row.actionKey.startsWith('follow_up:')) {
        if (row.state === 'intended' || row.state === 'claimed') {
          row.state = 'cancelled';
        }
      }
    }
  }

  private findById(id: string): OutboxRow | undefined {
    return [...this.rows.values()].find(row => row.id === id);
  }
}

function isUncertainError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /timeout|uncertain|ECONNRESET|ETIMEDOUT|socket hang up/i.test(text);
}

export async function dispatchOutboxSend(options: {
  outbox: Outbox;
  userId: string;
  message: SendMailInput;
  send: (message: SendMailInput) => Promise<{threadId: string; messageId: string}>;
  mode?: 'dry-run' | 'live';
}): Promise<{threadId: string; messageId: string}> {
  const pursuitId = options.message.pursuitId;
  const actionKey = options.message.actionKey;
  if (!pursuitId || !actionKey) {
    throw new Error('sendMail requires pursuitId and actionKey so the outbox can claim the action once');
  }

  const row = await options.outbox.intend({
    userId: options.userId,
    pursuitId,
    actionKey,
    message: options.message,
  });

  if (row.state === 'sent' && row.providerMessageId && row.providerThreadId) {
    return {threadId: row.providerThreadId, messageId: row.providerMessageId};
  }
  if (row.state === 'uncertain') {
    throw new Error(`outbox action ${actionKey} is uncertain; reconcile before sending again`);
  }
  if (row.state === 'cancelled') {
    throw new Error(`outbox action ${actionKey} was cancelled`);
  }
  if (row.state === 'claimed') {
    throw new Error(`outbox action ${actionKey} is already claimed`);
  }

  if (options.mode === 'dry-run') {
    return {threadId: options.message.threadId ?? 'dry-run', messageId: 'dry-run'};
  }

  if (!await options.outbox.claim(row.id)) {
    throw new Error(`outbox action ${actionKey} could not be claimed`);
  }

  try {
    const sent = await options.send(options.message);
    await options.outbox.markSent(row.id, sent);
    return sent;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (isUncertainError(error)) {
      await options.outbox.markUncertain(row.id, text);
      throw new Error(`uncertain send for ${actionKey}: ${text}`);
    }
    await options.outbox.markFailed(row.id, text);
    throw error;
  }
}
