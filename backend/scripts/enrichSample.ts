/**
 * Enrich a random sample of stored listings and print a one-line-per-listing
 * summary. Discovery quality is only visible across a spread of brokerages, so
 * this samples the `listings` table rather than a single fixture.
 *
 * Usage: npm run enrich:sample -- [--count N] [--seed S] [--concurrency N] [--refresh]
 */
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {sql} from 'drizzle-orm';
import {db, client} from '../src/db/index.ts';
import type {EmailListing, EnrichmentResult} from '../src/enrichment/service.ts';
import {splitBrokerage} from '../src/pipeline/brokerage.ts';
import {parseEmailListing} from '../src/enrichment/service.ts';
import {EnrichmentBudget} from '../src/enrichment/spend.ts';
import {enrichForPipeline} from '../src/pipeline/agentEnrichment.ts';
import {DATA_DIR} from '../src/paths.ts';

const args = process.argv.slice(2);
const usage = 'Usage: npm run enrich:sample -- [--count N] [--seed S] [--concurrency N] [--refresh]';
if (args.includes('--help')) {console.log(usage); process.exit(0);}
let count = 10, seed = Math.random(), concurrency = 3;
let refresh = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  const value = () => {
    const next = args[++i];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    return next;
  };
  if (arg === '--refresh') refresh = true;
  else if (arg === '--count') count = Number(value());
  else if (arg === '--seed') seed = Number(value());
  else if (arg === '--concurrency') concurrency = Number(value());
  else throw new Error(`Unexpected argument: ${arg}\n${usage}`);
}
for (const [name, n] of [['count', count], ['concurrency', concurrency]] as const) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
}
if (!Number.isFinite(seed) || seed < -1 || seed > 1) throw new Error('--seed must be between -1 and 1');

// setseed makes a sample reproducible, so a fix can be compared on the same rows.
await db.execute(sql`select setseed(${seed})`);
const rows = await db.execute(sql`
  select rental_id, brokerage, address, price, bedrooms, bathrooms, listing_url
  from listings
  where brokerage is not null and bedrooms is not null and bathrooms is not null
  order by random() limit ${count}`);

type Row = {rental_id: string; brokerage: string; address: string; price: string; bedrooms: string; bathrooms: string; listing_url: string};
const inputs = (rows as unknown as Row[]).map(row => {
  const {brokerageName, officeAddress} = splitBrokerage(row.brokerage);
  return {
    rentalId: row.rental_id,
    input: parseEmailListing({
      address: row.address, listingUrl: row.listing_url, price: Number(row.price),
      bedrooms: Number(row.bedrooms), bathrooms: Number(row.bathrooms),
      brokerage: brokerageName, brokerageOfficeAddress: officeAddress, city: 'New York',
    }),
  };
});

const budgetUsd = Number(process.env.SCOUT_ENRICHMENT_BUDGET_USD ?? 0);
const options = {
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
  budget: new EnrichmentBudget(budgetUsd),
  cacheDir: path.join(DATA_DIR, 'enrichment', 'agent-cache'),
  refresh,
  ...(process.env.TAVILY_API_KEY ? {tavilyKey: process.env.TAVILY_API_KEY} : {}),
  ...(process.env.FIRECRAWL_API_KEY ? {firecrawlKey: process.env.FIRECRAWL_API_KEY} : {}),
};

type Outcome = {rentalId: string; input: EmailListing; result: EnrichmentResult; ms: number};
const outcomes: Outcome[] = [];
let next = 0;
async function worker(): Promise<void> {
  for (let i = next++; i < inputs.length; i = next++) {
    const {rentalId, input} = inputs[i]!;
    const began = Date.now();
    const result = await enrichForPipeline(input, {
      ...options, log: message => console.error(`[${rentalId}] ${message}`),
    }).catch((error: unknown) => ({
      status: 'error' as const, execution: 'error' as const, input, brokerageUrl: null, listingUrl: null,
      agents: [], candidateAgents: [], sourceListing: null, rosterCompleteness: 'unverified' as const,
      outreachReady: false, checkedAt: new Date().toISOString(),
      issues: [error instanceof Error ? error.message : String(error)], warnings: [], attempts: [],
      contactRoutes: [], resolution: 'unresolved' as const,
    }));
    outcomes.push({rentalId, input, result, ms: Date.now() - began});
    console.error(`[${rentalId}] ${result.status}/${result.resolution} in ${((Date.now() - began) / 1000).toFixed(1)}s`);
  }
}
await Promise.all(Array.from({length: Math.min(concurrency, inputs.length)}, worker));
outcomes.sort((a, b) => inputs.findIndex(row => row.rentalId === a.rentalId) - inputs.findIndex(row => row.rentalId === b.rentalId));

const contacts = (result: EnrichmentResult) => [
  ...result.agents.map(agent => `${agent.name} <${agent.email ?? agent.phone ?? 'no contact'}>`),
  ...result.contactRoutes.map(route => `${route.name} <${route.email ?? route.phone ?? 'no contact'}> (${route.relationship})`),
];

console.log(`\nSeed ${seed} · ${outcomes.length} listings · enrichWithAgent\n`);
for (const {rentalId, input, result} of outcomes) {
  const found = contacts(result);
  console.log(`${input.address} #${input.unit} — ${input.brokerage} ($${input.price})`);
  console.log(`  ${result.status} / ${result.resolution}${result.outreachReady ? ' / outreach-ready' : ''}`);
  if (found.length) console.log(`  contacts: ${found.join(', ')}`);
  else console.log(`  contacts: none — ${result.issues[0] ?? 'no issue reported'}`);
  console.log(`  streeteasy.com/rental/${rentalId}`);
}

const outputDir = path.join(DATA_DIR, 'enrichment', 'results');
await mkdir(outputDir, {recursive: true});
const file = path.join(outputDir, `sample-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(file, JSON.stringify({seed, count, outcomes}, null, 2) + '\n');
console.log(`\nSaved ${file}`);
await client.end();
