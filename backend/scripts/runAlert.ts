import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {and, eq, inArray} from 'drizzle-orm';

import {client, db} from '../src/db/index.ts';
import {userListings} from '../src/db/schema/listings.ts';
import {pursuits} from '../src/db/schema/pursuits.ts';
import type {ContactSnapshot} from '../src/db/schema/pursuits.ts';
import {enrichWithAgent} from '../src/enrichment/agent.ts';
import type {AgentEnrichmentResult} from '../src/enrichment/agent.ts';
import {EnrichmentBudget} from '../src/enrichment/spend.ts';
import {getGmailClient} from '../src/gmail/auth.ts';
import {parseListing} from '../src/gmail/listings.ts';
import {LISTINGS_QUERY, RAW_DIR, listMessageIds, loadMessage} from '../src/gmail/mailbox.ts';
import {parseMessage} from '../src/gmail/message.ts';
import {createOutreachPorts} from '../src/outreach/ports.ts';
import {runTurn} from '../src/outreach/turn.ts';
import {DATA_DIR, REPO_ROOT} from '../src/paths.ts';
import {gmailListingToEmailInput} from '../src/pipeline/listingInput.ts';
import {PostgresStore} from '../src/pipeline/postgresStore.ts';
import {agentResultForPipeline} from '../src/pipeline/agentEnrichment.ts';
import {classifyEnrichment, summarizeEnrichment} from '../src/pipeline/alert.ts';
import {contactSnapshotFromEnrichment} from '../src/pipeline/contacts.ts';
import {isRetryable} from '../src/pipeline/contracts.ts';

/**
 * Run the whole pipeline for ONE StreetEasy alert email, end to end:
 *
 *   parse listing cards -> persist listings/pursuits -> enrich broker contacts
 *   (OpenRouter agent) -> compose outreach drafts (dry-run, recorded as
 *   `draft_composed` events) -> print everything.
 *
 *   npm run alert -- --subject "3 Results for Manhattan - 9/11/26"
 *   npm run alert -- --message 1a09215a7f1b1589
 *
 * Flags:
 *   --budget-usd <n>   paid enrichment budget shared across the email's listings
 *                      (default 0: cached results and direct brokerage reads only)
 *   --re-enrich        clear previous enrichment on this email's pursuits and run again
 *
 * The message is read from data/raw when cached, otherwise searched in Gmail by
 * subject and cached. Nothing is sent: sendMail is still a stub.
 *
 * Env: DATABASE_URL, OPENROUTER_API_KEY, SCOUT_OWNER_USER_ID (falls back to the
 * only search_profiles row), optional OPENROUTER_MODEL.
 */

try {process.loadEnvFile(path.join(REPO_ROOT, '.env'));} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const usage = 'npm run alert -- (--subject "<exact subject>" | --message <gmailId>) [--budget-usd n] [--re-enrich]';
const args = process.argv.slice(2);
let subject: string | undefined;
let messageId: string | undefined;
let budgetUsd = 0;
let reEnrich = false;
while (args.length) {
  const flag = args.shift();
  if (flag === '--re-enrich') {reEnrich = true; continue;}
  if (flag === '--help') {console.log(usage); process.exit(0);}
  const value = args.shift();
  if (!value) throw new Error(usage);
  if (flag === '--subject') subject = value;
  else if (flag === '--message') messageId = value;
  else if (flag === '--budget-usd') budgetUsd = Number(value);
  else throw new Error(usage);
}
if (!subject && !messageId) throw new Error(usage);
if (!Number.isFinite(budgetUsd) || budgetUsd < 0) throw new Error('--budget-usd must be a non-negative number');

const openRouterApiKey = process.env.OPENROUTER_API_KEY;
if (!openRouterApiKey) throw new Error('OPENROUTER_API_KEY is not set');

const log = (message: string) => console.error(`[alert] ${message}`);

// ---- 1. find the email ------------------------------------------------------

async function findCachedBySubject(wanted: string): Promise<string | null> {
  let files: string[];
  try {files = await readdir(RAW_DIR);} catch {return null;}
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = JSON.parse(await readFile(path.join(RAW_DIR, file), 'utf8'));
    const headers: {name?: string; value?: string}[] = raw.payload?.headers ?? [];
    const found = headers.find(h => h.name?.toLowerCase() === 'subject')?.value;
    if (found === wanted) return raw.id as string;
  }
  return null;
}

let gmailPromise: ReturnType<typeof getGmailClient> | null = null;
const gmail = () => (gmailPromise ??= getGmailClient());

if (!messageId && subject) {
  messageId = await findCachedBySubject(subject) ?? undefined;
  if (messageId) {
    log(`found "${subject}" in the local cache: ${messageId}`);
  } else {
    log(`"${subject}" is not cached; searching Gmail`);
    const ids = await listMessageIds(await gmail(), `${LISTINGS_QUERY} subject:"${subject}"`);
    if (ids.length === 0) throw new Error(`No Gmail message from StreetEasy with subject "${subject}"`);
    if (ids.length > 1) log(`${ids.length} messages match; using the first (${ids[0]})`);
    messageId = ids[0];
  }
}

// Cache first; only open Gmail on a miss.
const rawMessage = await loadMessage(null, messageId!) ?? await loadMessage(await gmail(), messageId!);
if (!rawMessage) throw new Error(`Could not load message ${messageId}`);
const message = parseMessage(rawMessage);
if (!message.htmlBody) throw new Error(`Message ${message.id} has no HTML body`);
log(`email: "${message.subject}" (${message.date})`);

// ---- 2. owner + store -------------------------------------------------------

const store = new PostgresStore({db, gmail, dryRun: true, log});
let userId = process.env.SCOUT_OWNER_USER_ID;
if (userId) {
  await store.ensureOwner(userId);
} else {
  const users = await store.listActiveUsers();
  if (users.length !== 1) throw new Error(`SCOUT_OWNER_USER_ID is not set and there are ${users.length} search profiles`);
  userId = users[0]!.userId;
}
log(`owner: ${userId}`);

// ---- 3. parse cards ---------------------------------------------------------

const cards = await parseListing(message.htmlBody);
log(`parsed ${cards.length} listing card(s)`);
if (cards.length === 0) {
  await client.end();
  process.exit(0);
}

if (reEnrich) {
  const rows = await db.select({id: pursuits.id}).from(pursuits)
    .innerJoin(userListings, eq(userListings.id, pursuits.userListingId))
    .where(and(eq(userListings.userId, userId), eq(userListings.sourceMessageId, message.id)));
  if (rows.length > 0) {
    await db.update(pursuits).set({
      contactSnapshot: null, enrichedAt: null,
      needsHumanReason: null, needsHumanNote: null, needsHumanAt: null,
      updatedAt: new Date(),
    }).where(inArray(pursuits.id, rows.map(row => row.id)));
    log(`--re-enrich: cleared enrichment on ${rows.length} pursuit(s)`);
  }
}

// ---- 4. enrich --------------------------------------------------------------

const budget = new EnrichmentBudget(budgetUsd);
const receivedAt = Number.isNaN(new Date(message.date).getTime()) ? new Date() : new Date(message.date);
const source = {messageId: message.id, receivedAt};

type Outcome = {rentalId: string; address: string; pursuitId: string | null; status: string; contacts: ContactSnapshot['contacts']};
const outcomes: Outcome[] = [];

for (const listing of cards) {
  const ingested = await store.ingestListing(userId, source, listing);
  const base = {rentalId: listing.rentalId, address: listing.address, pursuitId: ingested.pursuitId, contacts: []};
  if (!ingested.isMatch || !ingested.pursuitId) {
    outcomes.push({...base, status: 'not matched'});
    continue;
  }
  if (!ingested.needsEnrichment) {
    outcomes.push({...base, status: 'already enriched (use --re-enrich to redo)'});
    continue;
  }
  log(`enriching ${listing.address} (${listing.brokerage})`);
  let result: AgentEnrichmentResult;
  try {
    result = await enrichWithAgent(gmailListingToEmailInput(listing), {
      apiKey: openRouterApiKey, budget, log,
      ...(process.env.TAVILY_API_KEY ? {tavilyKey: process.env.TAVILY_API_KEY} : {}),
      ...(process.env.FIRECRAWL_API_KEY ? {firecrawlKey: process.env.FIRECRAWL_API_KEY} : {}),
      cacheDir: path.join(DATA_DIR, 'enrichment', 'agent-cache'),
    });
  } catch (error) {
    const note = `Enrichment failed: ${(error as Error).message}`;
    await store.noteEnrichmentDeferred(userId, ingested.pursuitId, {status: 'error', note});
    outcomes.push({...base, status: `deferred: ${note}`});
    continue;
  }
  const mapped = agentResultForPipeline(result);
  const failure = classifyEnrichment(mapped);
  const snapshot = failure ? null : contactSnapshotFromEnrichment(mapped);
  const summary = {...summarizeEnrichment(mapped), ...(failure ? {note: failure.detail} : {})};
  if (failure && isRetryable(failure)) {
    await store.noteEnrichmentDeferred(userId, ingested.pursuitId, summary);
    outcomes.push({...base, status: `deferred: ${failure.detail}`});
    continue;
  }
  await store.saveEnrichment(userId, ingested.pursuitId, snapshot, summary);
  outcomes.push({...base, status: snapshot ? 'ready' : 'needs you: no contact', contacts: snapshot?.contacts ?? []});
}

// ---- 5. draft outreach (dry-run) --------------------------------------------

const ports = createOutreachPorts({
  openRouterApiKey,
  ...(process.env.OPENROUTER_MODEL ? {model: process.env.OPENROUTER_MODEL} : {}),
});
const drafts: {address: string; to: string[]; subject: string; body: string}[] = [];
for (const outcome of outcomes) {
  if (outcome.status !== 'ready' || !outcome.pursuitId) continue;
  const input = await store.loadTurnInput(userId, outcome.pursuitId, 'open', null);
  if (!input) continue;
  log(`drafting outreach for ${outcome.address}`);
  const result = await runTurn({...input, sendsToday: 0, now: new Date()}, ports);
  await store.persistTurn(userId, outcome.pursuitId, 'open', result);
  for (const action of result.actions) {
    if (action.type === 'send') drafts.push({address: outcome.address, to: action.to, subject: action.subject, body: action.body});
    else if (action.type === 'noop') log(`no draft for ${outcome.address}: ${action.reason}`);
  }
}

if (!outcomes.some(outcome => outcome.status.startsWith('deferred:')) && !(await store.isProcessed(userId, message.id))) {
  await store.markProcessed(userId, message.id, 'alert');
}

// ---- 6. report --------------------------------------------------------------

console.log(`\n${message.subject}\n${'='.repeat(message.subject.length)}\n`);
for (const outcome of outcomes) {
  console.log(`- ${outcome.address} [${outcome.rentalId}] -> ${outcome.status}`);
  for (const contact of outcome.contacts) console.log(`    ${contact.name ?? 'Unnamed'} <${contact.email}>`);
}
console.log(`\nEnrichment spend: $${budget.reportedUsd.toFixed(4)} of $${budgetUsd.toFixed(2)}`);
for (const draft of drafts) {
  console.log(`\n--- Draft for ${draft.address} (dry-run, not sent) ---`);
  console.log(`To: ${draft.to.join(', ')}\nSubject: ${draft.subject}\n\n${draft.body}`);
}
if (drafts.length === 0) console.log('\nNo drafts composed.');

await client.end();
