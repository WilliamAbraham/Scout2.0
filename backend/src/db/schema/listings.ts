import {sql} from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {authUsers, authenticatedRole} from 'drizzle-orm/supabase';

import {ownedBy} from './rls.ts';

/**
 * Listings are global, not per-tenant: one row per StreetEasy `rental_id`,
 * shared by every user whose alerts surfaced it. Two users watching the same
 * neighborhood parse, score and enrich that apartment once between them.
 * Per-user state lives in `userListings`.
 */
export const listings = pgTable('listings', {
  // Postgres generates the authoritative ID; omit it when importing listings.
  id: uuid('id').defaultRandom().primaryKey(),
  rentalId: text('rental_id').notNull().unique(),
  brokerage: text('brokerage'),
  address: text('address').notNull(),
  price: numeric('price', {precision: 12, scale: 2, mode: 'number'}).notNull(),
  // Unknown counts remain null; studios have zero bedrooms.
  bedrooms: numeric('bedrooms', {precision: 4, scale: 1, mode: 'number'}),
  bathrooms: numeric('bathrooms', {precision: 4, scale: 1, mode: 'number'}),
  listingUrl: text('listing_url').notNull(),
  // The importer supplies email timestamps, rather than the import time.
  firstSeenAt: timestamp('first_seen_at', {withTimezone: true}).notNull(),
  lastSeenAt: timestamp('last_seen_at', {withTimezone: true}).notNull(),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [
  check('listings_rental_id_valid', sql`${table.rentalId} ~ '^[0-9]+$'`),
  check('listings_address_not_empty', sql`length(trim(${table.address})) > 0`),
  check('listings_price_positive', sql`${table.price} > 0`),
  check('listings_bedrooms_nonnegative', sql`${table.bedrooms} >= 0`),
  check('listings_bathrooms_nonnegative', sql`${table.bathrooms} >= 0`),
  check('listings_seen_at_order', sql`${table.lastSeenAt} >= ${table.firstSeenAt}`),
  // StreetEasy listing facts are shared. Match decisions, dismissals, and
  // pursuits stay per-user on `user_listings`.
  pgPolicy('listings_select_authenticated', {
    for: 'select',
    to: authenticatedRole,
    using: sql`true`,
  }),
]);

/**
 * One row per (user, listing): the dashboard feed, including listings that did
 * not match. `isMatch` is null until the matcher has scored it.
 */
export const userListings = pgTable('user_listings', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => authUsers.id, {onDelete: 'cascade'}),
  listingId: uuid('listing_id').notNull().references(() => listings.id, {onDelete: 'cascade'}),
  // The Gmail message whose alert surfaced this listing to this user.
  sourceMessageId: text('source_message_id'),
  // Null until scored. Non-matches stay visible in the feed.
  isMatch: boolean('is_match'),
  matchScore: numeric('match_score', {precision: 4, scale: 3, mode: 'number'}),
  // The model's stated justification, shown in the feed so a user can correct it.
  matchReason: text('match_reason'),
  scoredAt: timestamp('scored_at', {withTimezone: true}),
  dismissedAt: timestamp('dismissed_at', {withTimezone: true}),
  firstSeenAt: timestamp('first_seen_at', {withTimezone: true}).notNull(),
  createdAt: timestamp('created_at', {withTimezone: true}).defaultNow().notNull(),
}, table => [
  unique('user_listings_user_listing_unique').on(table.userId, table.listingId),
  check('user_listings_score_range',
    sql`${table.matchScore} is null or (${table.matchScore} >= 0 and ${table.matchScore} <= 1)`),
  // The feed's default query: this user's rows, newest first.
  index('user_listings_feed_idx').on(table.userId, table.firstSeenAt.desc()),
  // The matcher's work queue.
  index('user_listings_unscored_idx').on(table.userId).where(sql`is_match is null`),
  pgPolicy('user_listings_select_own', {
    for: 'select', to: authenticatedRole, using: ownedBy(table.userId),
  }),
  // Dismissing a listing from the feed is the only write the dashboard makes.
  pgPolicy('user_listings_update_own', {
    for: 'update', to: authenticatedRole, using: ownedBy(table.userId),
    withCheck: ownedBy(table.userId),
  }),
]);

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type UserListing = typeof userListings.$inferSelect;
export type NewUserListing = typeof userListings.$inferInsert;
