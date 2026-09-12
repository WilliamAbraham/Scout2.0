/**
 * The database schema, and the coordination seam between the backend agent and
 * the dashboard. Split by subsystem so the two tracks of work add tables
 * without colliding in one long file.
 *
 * Broker enrichment's tables are deliberately absent: they are being designed
 * against live research and belong in a `brokerages.ts` here when settled.
 * Until then `pursuits.contactSnapshot` carries what outreach needs.
 */
export * from './enums.ts';
export * from './rls.ts';
export * from './listings.ts';
export * from './gmail.ts';
export * from './profiles.ts';
export * from './pursuits.ts';
export * from './worker.ts';
