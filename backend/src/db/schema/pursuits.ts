import {sql} from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {authUsers, authenticatedRole} from 'drizzle-orm/supabase';

import {needsHumanReason, pursuitStage} from './enums.ts';
import {userListings} from './listings.ts';
import {ownedBy} from './rls.ts';

/**
 * The contacts enrichment resolved for a listing, copied onto the pursuit at
 * the moment outreach opened.
 *
 * This is a deliberate seam. Enrichment's own tables are being designed in
 * parallel and its result contract is still moving; a snapshot lets the
 * outreach agent depend on a small, stable shape instead. It is also the
 * honest representation: who the agent actually emailed is a historical fact
 * that must not change when a brokerage page is re-scraped months later.
 * Attaching a foreign key to the enrichment tables later is additive.
 */
export type ContactSnapshot = {
  /** Which fallback tier produced these contacts. */
  tier: 'listing_agents' | 'building_leasing' | 'brokerage';
  contacts: Array<{
    name: string | null;
    email: string | null;
    phone: string | null;
    profileUrl: string | null;
    /** Only 'primary'/'secondary' where the source explicitly said so. */
    role: 'primary' | 'secondary' | 'unspecified';
  }>;
  /** Page the contacts were read from, for auditing a bad send. */
  sourceUrl: string | null;
};

/**
 * A listing the user is actively pursuing. At most one per user-listing: a
 * single apartment is a single conversation.
 */
export const pursuits = pgTable('pursuits', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => authUsers.id, {onDelete: 'cascade'}),
  userListingId: uuid('user_listing_id').notNull().unique()
    .references(() => userListings.id, {onDelete: 'cascade'}),

  stage: pursuitStage('stage').notNull().default('matched'),

  // Escalation is not a stage: a pursuit can be mid-conversation and blocked at
  // the same time. The reason IS the flag — a separate boolean could disagree
  // with it. Null means the agent has control.
  needsHumanReason: needsHumanReason('needs_human_reason'),
  needsHumanNote: text('needs_human_note'),
  needsHumanAt: timestamp('needs_human_at', {withTimezone: true}),

  // The entire join between an inbound broker reply and the state it belongs
  // to. Set once the opening email is sent.
  threadId: text('thread_id'),

  contactSnapshot: jsonb('contact_snapshot').$type<ContactSnapshot>(),
  enrichedAt: timestamp('enriched_at', {withTimezone: true}),

  lastAgentRunAt: timestamp('last_agent_run_at', {withTimezone: true}),

  // When the worker should send the next bump if the broker has not replied.
  nextFollowUpAt: timestamp('next_follow_up_at', {withTimezone: true}),
  followUpCount: integer('follow_up_count').notNull().default(0),

  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [
  // Gmail thread ids are unique per mailbox, not globally.
  unique('pursuits_user_thread_unique').on(table.userId, table.threadId),
  // The reason and its timestamp are set and cleared together.
  check('pursuits_needs_human_consistent',
    sql`(${table.needsHumanReason} is null) = (${table.needsHumanAt} is null)`),
  // Anything past `matched` means an email went out, which requires a thread.
  check('pursuits_contacted_has_thread',
    sql`${table.stage} in ('matched', 'dead') or ${table.threadId} is not null`),
  // The Needs you queue: the dashboard's first screen.
  index('pursuits_needs_human_idx').on(table.userId, table.needsHumanAt)
    .where(sql`${table.needsHumanReason} is not null`),
  // The worker's queue of pursuits it can still act on.
  index('pursuits_actionable_idx').on(table.stage)
    .where(sql`${table.needsHumanReason} is null`),
  index('pursuits_follow_up_idx').on(table.nextFollowUpAt)
    .where(sql`${table.nextFollowUpAt} is not null and ${table.needsHumanReason} is null`),
  check('pursuits_follow_up_count_nonnegative', sql`${table.followUpCount} >= 0`),
  index('pursuits_thread_idx').on(table.userId, table.threadId),
  pgPolicy('pursuits_select_own', {
    for: 'select', to: authenticatedRole, using: ownedBy(table.userId),
  }),
  // Resolving a Needs you item clears the flag and hands control back.
  pgPolicy('pursuits_update_own', {
    for: 'update', to: authenticatedRole,
    using: ownedBy(table.userId), withCheck: ownedBy(table.userId),
  }),
]);

/**
 * Append-only record of everything the agent did on a pursuit.
 *
 * Not optional bookkeeping. This agent sends mail from the user's own address,
 * so "what did it say to my broker?" has to be answerable. It also makes the
 * daily send cap a count over this table rather than a counter column that can
 * drift away from reality after a crash.
 */
export const pursuitEvents = pgTable('pursuit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Denormalized from the pursuit so the RLS policy needs no join.
  userId: uuid('user_id').notNull().references(() => authUsers.id, {onDelete: 'cascade'}),
  pursuitId: uuid('pursuit_id').notNull()
    .references(() => pursuits.id, {onDelete: 'cascade'}),
  // 'email_sent' | 'reply_received' | 'tour_booked' | 'packet_sent'
  // | 'escalated' | 'resolved' | 'stage_changed' | 'error'. Free text: Person A
  // will add kinds continuously and nothing coordinates on the exact set.
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [
  // Counts sends for the daily cap, and drives the pursuit timeline.
  index('pursuit_events_cap_idx').on(table.userId, table.type, table.createdAt),
  index('pursuit_events_timeline_idx').on(table.pursuitId, table.createdAt),
  // Read-only to the dashboard: the agent's log is not the user's to rewrite.
  pgPolicy('pursuit_events_select_own', {
    for: 'select', to: authenticatedRole, using: ownedBy(table.userId),
  }),
]);

export type Pursuit = typeof pursuits.$inferSelect;
export type NewPursuit = typeof pursuits.$inferInsert;
export type PursuitEvent = typeof pursuitEvents.$inferSelect;
export type NewPursuitEvent = typeof pursuitEvents.$inferInsert;
