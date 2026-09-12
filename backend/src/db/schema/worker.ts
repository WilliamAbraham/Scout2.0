import {sql} from 'drizzle-orm';
import {check, index, jsonb, pgTable, text, timestamp, uuid} from 'drizzle-orm/pg-core';

/**
 * Operational tables for the continuous worker. Both are worker-only: RLS is
 * enabled with zero policies, the same arrangement as `gmailTokens`.
 */

/**
 * A lease per mailbox so two worker processes (a restart racing a stuck
 * predecessor, say) never process the same mail twice. Lease-based rather
 * than a Postgres advisory lock because the Supabase transaction pooler does
 * not keep a session open across the minutes an enrichment cycle takes.
 */
export const workerLeases = pgTable('worker_leases', {
  // e.g. `mailbox:<email>`.
  name: text('name').primaryKey(),
  holder: text('holder').notNull(),
  acquiredAt: timestamp('acquired_at', {withTimezone: true}).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
}, table => [
  check('worker_leases_expiry_after_acquire', sql`${table.expiresAt} > ${table.acquiredAt}`),
]).enableRLS();

/**
 * One row per worker cycle: what it did, or why it stopped. The status
 * command reads the latest row; the dashboard can later show "last synced".
 */
export const workerRuns = pgTable('worker_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  holder: text('holder').notNull(),
  startedAt: timestamp('started_at', {withTimezone: true}).notNull(),
  finishedAt: timestamp('finished_at', {withTimezone: true}),
  // 'dry-run' | 'live'.
  mode: text('mode').notNull(),
  report: jsonb('report').$type<Record<string, unknown>>(),
  error: text('error'),
}, table => [
  index('worker_runs_recent_idx').on(table.startedAt.desc()),
]).enableRLS();

export type WorkerLease = typeof workerLeases.$inferSelect;
export type WorkerRun = typeof workerRuns.$inferSelect;
