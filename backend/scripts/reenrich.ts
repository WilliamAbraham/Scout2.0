/**
 * Re-run enrichment for pursuits already parked without a contact.
 *
 * `no_contact` is a permanent classification, so the worker never revisits
 * those pursuits: their `enriched_at` is set and their alert message is marked
 * done in the ledger. That is correct while enrichment is unchanged, and wrong
 * the moment it improves — the backlog would stay parked on a limitation that
 * no longer exists. This replays enrichment over the stored listing facts and
 * saves any contact it now finds, which unblocks the pursuit for the next
 * worker cycle.
 *
 * Usage: npm run reenrich -- [--limit N] [--dry-run] [--concurrency N] [--refresh]
 */
import path from 'node:path';
import process from 'node:process';
import {and, eq, ne} from 'drizzle-orm';

import {client, db} from '../src/db/index.ts';
import {listings, userListings} from '../src/db/schema/listings.ts';
import {pursuits} from '../src/db/schema/pursuits.ts';
import {parseEmailListing} from '../src/enrichment/service.ts';
import type {EnrichmentResult} from '../src/enrichment/service.ts';
import {EnrichmentBudget} from '../src/enrichment/spend.ts';
import {splitBrokerage} from '../src/pipeline/brokerage.ts';
import {enrichForPipeline} from '../src/pipeline/agentEnrichment.ts';
import {contactSnapshotFromEnrichment} from '../src/pipeline/contacts.ts';
import {PostgresStore} from '../src/pipeline/postgresStore.ts';
import {DATA_DIR} from '../src/paths.ts';

const args = process.argv.slice(2);
const usage = 'Usage: npm run reenrich -- [--limit N] [--dry-run] [--concurrency N] [--refresh]';
if (args.includes('--help')) {console.log(usage); process.exit(0);}
let limit = 25, concurrency = 2;
const dryRun = args.includes('--dry-run'), refresh = args.includes('--refresh');
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === '--dry-run' || arg === '--refresh') continue;
  if (arg !== '--limit' && arg !== '--concurrency') throw new Error(`Unexpected argument: ${arg}\n${usage}`);
  const value = Number(args[++i]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${arg} needs a positive integer`);
  if (arg === '--limit') limit = value; else concurrency = value;
}

const blocked = await db.select({
  pursuitId: pursuits.id, userId: pursuits.userId, rentalId: listings.rentalId,
  address: listings.address, brokerage: listings.brokerage, price: listings.price,
  bedrooms: listings.bedrooms, bathrooms: listings.bathrooms, listingUrl: listings.listingUrl,
}).from(pursuits)
  .innerJoin(userListings, eq(pursuits.userListingId, userListings.id))
  .innerJoin(listings, eq(userListings.listingId, listings.id))
  .where(and(eq(pursuits.needsHumanReason, 'no_contact'), ne(pursuits.stage, 'dead')))
  .limit(limit);

if (!blocked.length) {
  console.log('No pursuits are parked on no_contact.');
  await client.end();
  process.exit(0);
}
console.log(`Replaying enrichment for ${blocked.length} parked ${blocked.length === 1 ? 'pursuit' : 'pursuits'}${dryRun ? ' (dry run, nothing saved)' : ''}.\n`);

const store = new PostgresStore({db, gmail: () => {throw new Error('Re-enrichment never reads the mailbox');}, dryRun: true,
  log: message => console.error(`[reenrich] ${message}`)});
const options = {
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
  budget: new EnrichmentBudget(Number(process.env.SCOUT_ENRICHMENT_BUDGET_USD ?? 0)),
  cacheDir: path.join(DATA_DIR, 'enrichment', 'agent-cache'), refresh,
  ...(process.env.TAVILY_API_KEY ? {tavilyKey: process.env.TAVILY_API_KEY} : {}),
  ...(process.env.FIRECRAWL_API_KEY ? {firecrawlKey: process.env.FIRECRAWL_API_KEY} : {}),
};

let next = 0, unblocked = 0, stillBlocked = 0, failed = 0;
async function worker(): Promise<void> {
  for (let i = next++; i < blocked.length; i = next++) {
    const row = blocked[i]!;
    const label = `${row.address} (${row.brokerage ?? 'unknown brokerage'})`;
    let result: EnrichmentResult;
    try {
      const {brokerageName, officeAddress} = splitBrokerage(row.brokerage ?? '');
      const input = parseEmailListing({
        address: row.address, listingUrl: row.listingUrl, price: row.price,
        bedrooms: row.bedrooms, bathrooms: row.bathrooms,
        brokerage: brokerageName || 'Unknown', brokerageOfficeAddress: officeAddress, city: 'New York',
      });
      result = await enrichForPipeline(input, {...options, log: message => console.error(`[${row.rentalId}] ${message}`)});
    } catch (error) {
      failed++;
      console.log(`✗ ${label}\n    ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const snapshot = contactSnapshotFromEnrichment(result);
    const named = result.agents.map(agent => agent.name);
    if (!snapshot) {
      stillBlocked++;
      console.log(`· ${label}\n    still no contact${named.length ? ` — named but unreachable: ${named.join(', ')}` : ''}`);
      console.log(`    ${result.issues[0] ?? result.status}`);
      continue;
    }
    const reachable = snapshot.contacts.map(contact => `${contact.name ?? 'Agent'} <${contact.email}>`).join(', ');
    if (!dryRun) {
      await store.saveEnrichment(row.userId, row.pursuitId, snapshot, {
        status: result.status, resolution: result.resolution, listingUrl: result.listingUrl,
        brokerageUrl: result.brokerageUrl, outreachReady: result.outreachReady,
        issues: result.issues, warnings: result.warnings, replayedAt: new Date().toISOString(),
      });
    }
    unblocked++;
    console.log(`✓ ${label}\n    ${reachable}`);
  }
}
await Promise.all(Array.from({length: Math.min(concurrency, blocked.length)}, worker));

console.log(`\n${unblocked} unblocked, ${stillBlocked} still without a contact, ${failed} errored.`);
if (unblocked && !dryRun) console.log('Run the worker to draft and send for them: npm run worker -- --once');
await client.end();
