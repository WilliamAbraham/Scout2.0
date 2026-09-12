import {sql} from 'drizzle-orm';
import {
  check,
  index,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
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

/**
 * Idempotency for an at-least-once poller. Without it, a retry after a partial
 * failure sends a second email to a broker from the user's real address.
 *
 * Gmail message ids are unique per mailbox, not globally, so the key is the
 * pair. Worker-only, like `gmailTokens`.
 */
export const processedMessages = pgTable('processed_messages', {
  userId: uuid('user_id').notNull().references(() => authUsers.id, {onDelete: 'cascade'}),
  gmailMessageId: text('gmail_message_id').notNull(),
  // How the router classified it: 'alert' | 'reply' | 'noise'. Free text
  // because the set of parsers grows; nothing coordinates on these values.
  route: text('route').notNull(),
  processedAt: timestamp('processed_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [
  primaryKey({columns: [table.userId, table.gmailMessageId]}),
  index('processed_messages_recent_idx').on(table.userId, table.processedAt.desc()),
]).enableRLS();

export type GmailAccount = typeof gmailAccounts.$inferSelect;
export type NewGmailAccount = typeof gmailAccounts.$inferInsert;
export type GmailToken = typeof gmailTokens.$inferSelect;
export type NewGmailToken = typeof gmailTokens.$inferInsert;
export type ProcessedMessage = typeof processedMessages.$inferSelect;
export type NewProcessedMessage = typeof processedMessages.$inferInsert;
