import {sql} from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {authUsers} from 'drizzle-orm/supabase';

import {pursuits} from './pursuits.ts';

/**
 * Durable send queue. Worker-only: RLS on, no policies, same pattern as
 * `processed_messages`. Claude's persistTurn should claim through this table
 * rather than inventing a second delivery queue.
 */
export const outreachOutbox = pgTable('outreach_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => authUsers.id, {onDelete: 'cascade'}),
  pursuitId: uuid('pursuit_id').notNull().references(() => pursuits.id, {onDelete: 'cascade'}),
  actionKey: text('action_key').notNull(),
  state: text('state').notNull(),
  toAddrs: text('to_addrs').array().notNull(),
  ccAddrs: text('cc_addrs').array().notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  threadId: text('thread_id'),
  rfc822MessageId: text('rfc822_message_id'),
  providerMessageId: text('provider_message_id'),
  providerThreadId: text('provider_thread_id'),
  error: text('error'),
  claimedAt: timestamp('claimed_at', {withTimezone: true}),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [
  unique('outreach_outbox_user_action_unique').on(table.userId, table.pursuitId, table.actionKey),
  check('outreach_outbox_state_known',
    sql`${table.state} in ('intended','claimed','sent','failed','uncertain','cancelled')`),
  check('outreach_outbox_action_key_not_empty', sql`length(trim(${table.actionKey})) > 0`),
  index('outreach_outbox_state_idx').on(table.userId, table.state),
]).enableRLS();

export type OutreachOutboxRow = typeof outreachOutbox.$inferSelect;
export type NewOutreachOutboxRow = typeof outreachOutbox.$inferInsert;
