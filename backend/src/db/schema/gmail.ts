import {sql} from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {authUsers, authenticatedRole} from 'drizzle-orm/supabase';

import {ownedBy} from './rls.ts';

/**
 * Connection state for a user's Google account. Deliberately holds nothing
 * secret: onboarding needs to show whether Gmail is connected and whether sync
 * is healthy, and RLS is row-level, so a table the dashboard can read is a
 * table the dashboard can read *entirely*. The tokens live next door in
 * `gmailTokens`, which has no policies at all.
 */
export const gmailAccounts = pgTable('gmail_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique()
    .references(() => authUsers.id, {onDelete: 'cascade'}),
  emailAddress: text('email_address').notNull(),
  // Gmail's incremental sync cursor. A uint64 delivered as a JSON string, so
  // it is stored as text rather than risking a float64 round-trip.
  historyId: text('history_id'),
  lastSyncedAt: timestamp('last_synced_at', {withTimezone: true}),
  // Set when sync fails in a way the user must fix (revoked grant, say), so
  // onboarding can prompt a reconnect. Cleared on the next successful sync.
  syncError: text('sync_error'),
  connectedAt: timestamp('connected_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [
  check('gmail_accounts_email_not_empty', sql`length(trim(${table.emailAddress})) > 0`),
  pgPolicy('gmail_accounts_select_own', {
    for: 'select', to: authenticatedRole, using: ownedBy(table.userId),
  }),
  // Disconnecting Google is a dashboard action; the cascade clears the tokens.
  pgPolicy('gmail_accounts_delete_own', {
    for: 'delete', to: authenticatedRole, using: ownedBy(table.userId),
  }),
]);

/**
 * OAuth material, readable only by the worker.
 *
 * RLS is enabled with *zero* policies, which denies every request arriving
 * through PostgREST — the publishable key is in the browser bundle, so the
 * frontend must never be able to reach a refresh token. The worker connects as
 * the table owner over DATABASE_URL and bypasses RLS.
 *
 * Do not add `force row level security` to this table: that would lock out the
 * owner too, and with it the worker.
 */
export const gmailTokens = pgTable('gmail_tokens', {
  gmailAccountId: uuid('gmail_account_id').primaryKey()
    .references(() => gmailAccounts.id, {onDelete: 'cascade'}),
  refreshToken: text('refresh_token').notNull(),
  accessToken: text('access_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', {withTimezone: true}),
  // The scopes actually granted, which can be narrower than those requested.
  // Sending mail on someone's behalf without the send scope should fail early.
  scopes: text('scopes').array().notNull(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
}).enableRLS();

/** Where a message sits in the worker's ledger. */
export type ProcessedStatus = 'done' | 'retry' | 'exhausted';

/**
 * The worker's per-message ledger: idempotency for an at-least-once poller,
 * plus the retry state that keeps a transient failure from either looping
 * every cycle or silently dropping mail.
 *
 * A row exists once the worker has looked at a message. `status` says whether
 * it is finished (`done`), waiting for a bounded retry (`retry`, with
 * `nextAttemptAt` and `attempts`), or gave up (`exhausted`, visible in the
 * status report until someone resolves it). `outcome` carries the per-card
 * summary so "what happened to that alert" is answerable without re-parsing.
 *
 * Gmail message ids are unique per mailbox, not globally, so the key is the
 * pair. Worker-only, like `gmailTokens`.
 */
export const processedMessages = pgTable('processed_messages', {
  userId: uuid('user_id').notNull().references(() => authUsers.id, {onDelete: 'cascade'}),
  gmailMessageId: text('gmail_message_id').notNull(),
  gmailThreadId: text('gmail_thread_id'),
  // How the router classified it: 'alert' | 'reply' | 'noise'. Free text
  // because the set of parsers grows; nothing coordinates on these values.
  route: text('route').notNull(),
  status: text('status').$type<ProcessedStatus>().notNull().default('done'),
  attempts: integer('attempts').notNull().default(1),
  nextAttemptAt: timestamp('next_attempt_at', {withTimezone: true}),
  lastError: text('last_error'),
  outcome: jsonb('outcome').$type<Record<string, unknown>>(),
  processedAt: timestamp('processed_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [
  primaryKey({columns: [table.userId, table.gmailMessageId]}),
  index('processed_messages_recent_idx').on(table.userId, table.processedAt.desc()),
  index('processed_messages_retry_idx').on(table.userId, table.nextAttemptAt)
    .where(sql`${table.status} = 'retry'`),
  check('processed_messages_status_valid',
    sql`${table.status} in ('done', 'retry', 'exhausted')`),
  check('processed_messages_attempts_positive', sql`${table.attempts} >= 1`),
]).enableRLS();

/**
 * Every email in a pursuit's conversation, inbound and outbound, as the worker
 * saw it. This is the thread history the reply turn reads and the record of
 * what a broker actually wrote, kept verbatim because the model's reading of
 * it is not the source of truth.
 *
 * Readable by the owner: it is their own mailbox. Written only by the worker.
 */
export const threadMessages = pgTable('thread_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => authUsers.id, {onDelete: 'cascade'}),
  // Null for an outbound draft the sender has not yet given a Gmail id.
  gmailMessageId: text('gmail_message_id'),
  gmailThreadId: text('gmail_thread_id').notNull(),
  // The pursuit this thread belongs to at the time of writing. `pursuits` is
  // named literally: the two files would otherwise import each other.
  pursuitId: uuid('pursuit_id'),
  direction: text('direction').$type<'inbound' | 'outbound'>().notNull(),
  fromAddress: text('from_address').notNull(),
  toAddresses: text('to_addresses').array().notNull().default(sql`'{}'::text[]`),
  ccAddresses: text('cc_addresses').array().notNull().default(sql`'{}'::text[]`),
  subject: text('subject').notNull().default(''),
  // RFC 822 Message-ID / In-Reply-To / References, for reply headers.
  rfcMessageId: text('rfc_message_id'),
  inReplyTo: text('in_reply_to'),
  sentAt: timestamp('sent_at', {withTimezone: true}).notNull(),
  textBody: text('text_body'),
  htmlBody: text('html_body'),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [
  unique('thread_messages_user_message_unique').on(table.userId, table.gmailMessageId),
  index('thread_messages_thread_idx').on(table.userId, table.gmailThreadId, table.sentAt),
  index('thread_messages_pursuit_idx').on(table.pursuitId, table.sentAt),
  check('thread_messages_direction_valid', sql`${table.direction} in ('inbound', 'outbound')`),
  pgPolicy('thread_messages_select_own', {
    for: 'select', to: authenticatedRole, using: ownedBy(table.userId),
  }),
]);

export type GmailAccount = typeof gmailAccounts.$inferSelect;
export type NewGmailAccount = typeof gmailAccounts.$inferInsert;
export type GmailToken = typeof gmailTokens.$inferSelect;
export type NewGmailToken = typeof gmailTokens.$inferInsert;
export type ProcessedMessage = typeof processedMessages.$inferSelect;
export type NewProcessedMessage = typeof processedMessages.$inferInsert;
export type ThreadMessageRow = typeof threadMessages.$inferSelect;
export type NewThreadMessageRow = typeof threadMessages.$inferInsert;
