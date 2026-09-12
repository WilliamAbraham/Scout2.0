import {sql} from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {authUsers, authenticatedRole} from 'drizzle-orm/supabase';

import {ownedBy} from './rls.ts';

/** A weekly recurring window the user is free to tour. `day` is 0=Sunday. */
export type AvailabilityWindow = {
  day: number;
  /** Local NYC time, 24h "HH:MM". */
  start: string;
  end: string;
};

/** An answer the agent learned from an escalation, so it is never asked twice. */
export type LearnedAnswer = {
  question: string;
  answer: string;
  /** ISO 8601. The pursuit whose escalation produced it, for provenance. */
  learnedAt: string;
  pursuitId: string | null;
};

/**
 * One profile per user: what the matcher scores against, and the facts the
 * outreach agent is allowed to state on the user's behalf.
 */
export const searchProfiles = pgTable('search_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().unique()
    .references(() => authUsers.id, {onDelete: 'cascade'}),

  budgetMin: numeric('budget_min', {precision: 12, scale: 2, mode: 'number'}),
  budgetMax: numeric('budget_max', {precision: 12, scale: 2, mode: 'number'}),
  bedroomsMin: numeric('bedrooms_min', {precision: 4, scale: 1, mode: 'number'}),
  bedroomsMax: numeric('bedrooms_max', {precision: 4, scale: 1, mode: 'number'}),
  bathroomsMin: numeric('bathrooms_min', {precision: 4, scale: 1, mode: 'number'}),

  neighborhoods: text('neighborhoods').array().notNull().default(sql`'{}'::text[]`),
  mustHaves: text('must_haves').array().notNull().default(sql`'{}'::text[]`),
  dealbreakers: text('dealbreakers').array().notNull().default(sql`'{}'::text[]`),

  availability: jsonb('availability').$type<AvailabilityWindow[]>()
    .notNull().default(sql`'[]'::jsonb`),

  // Written by the user. Quoted by the agent when a broker asks something the
  // structured fields cannot answer.
  preferences: text('preferences'),
  // Written by the agent, from resolved `unanswerable_question` escalations.
  // Kept apart from `preferences` so the UI can show where an answer came from
  // and the user can correct it.
  learnedAnswers: jsonb('learned_answers').$type<LearnedAnswer[]>()
    .notNull().default(sql`'[]'::jsonb`),

  // A hard guardrail, not a tuning knob: a loose profile could otherwise fire
  // dozens of emails in one morning from someone's personal Gmail.
  dailySendCap: integer('daily_send_cap').notNull().default(10),
  // Set while the user wants the agent to stop acting without disconnecting.
  pausedAt: timestamp('paused_at', {withTimezone: true}),

  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [
  check('search_profiles_budget_order',
    sql`${table.budgetMin} is null or ${table.budgetMax} is null
        or ${table.budgetMax} >= ${table.budgetMin}`),
  check('search_profiles_bedrooms_order',
    sql`${table.bedroomsMin} is null or ${table.bedroomsMax} is null
        or ${table.bedroomsMax} >= ${table.bedroomsMin}`),
  check('search_profiles_budget_positive',
    sql`${table.budgetMin} is null or ${table.budgetMin} >= 0`),
  check('search_profiles_send_cap_sane',
    sql`${table.dailySendCap} between 0 and 100`),
  pgPolicy('search_profiles_select_own', {
    for: 'select', to: authenticatedRole, using: ownedBy(table.userId),
  }),
  pgPolicy('search_profiles_insert_own', {
    for: 'insert', to: authenticatedRole, withCheck: ownedBy(table.userId),
  }),
  pgPolicy('search_profiles_update_own', {
    for: 'update', to: authenticatedRole,
    using: ownedBy(table.userId), withCheck: ownedBy(table.userId),
  }),
]);

/** Application-packet files. Bytes live in Supabase Storage; this is metadata. */
export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => authUsers.id, {onDelete: 'cascade'}),
  // 'id' | 'pay_stub' | 'employment_letter' | 'bank_statement' | 'reference'
  // | 'guarantor' | 'other'. Free text: the packet's contents vary by landlord
  // and nothing coordinates on the exact set.
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  // Path within the Storage bucket. The bucket's own policies are the access
  // control for the bytes; this row only says the file exists.
  storagePath: text('storage_path').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  uploadedAt: timestamp('uploaded_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [
  check('documents_size_positive', sql`${table.sizeBytes} > 0`),
  check('documents_label_not_empty', sql`length(trim(${table.label})) > 0`),
  pgPolicy('documents_select_own', {
    for: 'select', to: authenticatedRole, using: ownedBy(table.userId),
  }),
  pgPolicy('documents_insert_own', {
    for: 'insert', to: authenticatedRole, withCheck: ownedBy(table.userId),
  }),
  pgPolicy('documents_delete_own', {
    for: 'delete', to: authenticatedRole, using: ownedBy(table.userId),
  }),
]);

export type SearchProfile = typeof searchProfiles.$inferSelect;
export type NewSearchProfile = typeof searchProfiles.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
