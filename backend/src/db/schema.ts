import {sql} from 'drizzle-orm';
import {check, numeric, pgTable, text, timestamp, uuid} from 'drizzle-orm/pg-core';

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
]);

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
