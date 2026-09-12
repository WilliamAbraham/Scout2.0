import {and, eq, like} from 'drizzle-orm';

import type {db as Database} from '../db/index.ts';
import {outreachOutbox} from '../db/schema/outreach.ts';
import type {IntendInput, Outbox, OutboxRow, OutboxState} from './outbox.ts';

function toRow(row: typeof outreachOutbox.$inferSelect): OutboxRow {
  return {
    id: row.id,
    userId: row.userId,
    pursuitId: row.pursuitId,
    actionKey: row.actionKey,
    state: row.state as OutboxState,
    to: row.toAddrs,
    cc: row.ccAddrs,
    subject: row.subject,
    body: row.body,
    threadId: row.threadId,
    rfc822MessageId: row.rfc822MessageId,
    providerMessageId: row.providerMessageId,
    providerThreadId: row.providerThreadId,
    error: row.error,
  };
}

/**
 * Persistence methods Claude should call from persistTurn / dispatch.
 * This is the only delivery queue; do not add a second one in the store.
 */
export class PostgresOutbox implements Outbox {
  private readonly db: typeof Database;

  constructor(db: typeof Database) {
    this.db = db;
  }

  async intend(input: IntendInput): Promise<OutboxRow> {
    await this.db.insert(outreachOutbox).values({
      userId: input.userId,
      pursuitId: input.pursuitId,
      actionKey: input.actionKey,
      state: 'intended',
      toAddrs: input.message.to,
      ccAddrs: input.message.cc,
      subject: input.message.subject,
      body: input.message.body,
      threadId: input.message.threadId,
    }).onConflictDoNothing();
    const row = await this.get(input.userId, input.pursuitId, input.actionKey);
    if (!row) {
      throw new Error('outbox intend failed to persist');
    }
    return row;
  }

  async get(userId: string, pursuitId: string, actionKey: string): Promise<OutboxRow | null> {
    const [row] = await this.db.select().from(outreachOutbox).where(and(
      eq(outreachOutbox.userId, userId),
      eq(outreachOutbox.pursuitId, pursuitId),
      eq(outreachOutbox.actionKey, actionKey),
    )).limit(1);
    return row ? toRow(row) : null;
  }

  async claim(id: string): Promise<boolean> {
    const claimed = await this.db.update(outreachOutbox).set({
      state: 'claimed',
      claimedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(outreachOutbox.id, id), eq(outreachOutbox.state, 'intended'))).returning({id: outreachOutbox.id});
    return claimed.length > 0;
  }

  async markSent(id: string, ids: {threadId: string; messageId: string}): Promise<void> {
    await this.db.update(outreachOutbox).set({
      state: 'sent',
      providerThreadId: ids.threadId,
      providerMessageId: ids.messageId,
      error: null,
      updatedAt: new Date(),
    }).where(eq(outreachOutbox.id, id));
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db.update(outreachOutbox).set({
      state: 'failed',
      error,
      updatedAt: new Date(),
    }).where(eq(outreachOutbox.id, id));
  }

  async markUncertain(id: string, error: string): Promise<void> {
    await this.db.update(outreachOutbox).set({
      state: 'uncertain',
      error,
      updatedAt: new Date(),
    }).where(eq(outreachOutbox.id, id));
  }

  async cancelFollowUps(userId: string, pursuitId: string): Promise<void> {
    await this.db.update(outreachOutbox).set({
      state: 'cancelled',
      updatedAt: new Date(),
    }).where(and(
      eq(outreachOutbox.userId, userId),
      eq(outreachOutbox.pursuitId, pursuitId),
      like(outreachOutbox.actionKey, 'follow_up:%'),
      eq(outreachOutbox.state, 'intended'),
    ));
  }
}
