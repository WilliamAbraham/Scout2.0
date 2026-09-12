import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

import {getTableName} from 'drizzle-orm';
import {getTableConfig} from 'drizzle-orm/pg-core';

import {REPO_ROOT} from '../paths.ts';
import {
  SCOUT_OWNS_FUNCTION,
  documents,
  gmailAccounts,
  gmailTokens,
  listings,
  needsHumanReason,
  processedMessages,
  pursuitEvents,
  pursuitStage,
  pursuits,
  searchProfiles,
  threadMessages,
  userListings,
  workerLeases,
  workerRuns,
} from './schema/index.ts';

/**
 * These assertions guard couplings that nothing else checks: two pieces of
 * hand-written SQL that live outside drizzle's generator, and the RLS
 * invariant that keeps OAuth tokens away from the browser. None of them needs
 * a database.
 */

const MIGRATIONS_DIR = path.join(REPO_ROOT, 'backend/drizzle');

/** Every migration, in the order the migrator applies them. */
function migrations(): Array<{name: string; sql: string}> {
  return readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .map(name => ({name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')}));
}

test('scout_owns is created in a migration of its own, before any policy', () => {
  const all = migrations();
  const definesFunction = all
    .findIndex(file => file.sql.includes('function public.scout_owns'));
  const firstPolicy = all.findIndex(file => file.sql.includes('CREATE POLICY'));

  assert.notEqual(definesFunction, -1, 'no migration defines scout_owns');
  assert.notEqual(firstPolicy, -1, 'no migration creates any policy');

  // The function is hand-written, because drizzle-kit does not generate
  // functions. Keeping it in its own earlier migration is what stops a
  // `db:generate` from silently dropping it.
  assert.ok(definesFunction < firstPolicy,
    `scout_owns is defined in ${all[definesFunction]?.name}, which the migrator ` +
    `applies after ${all[firstPolicy]?.name} creates the policies that call it`);
  assert.ok(!all[firstPolicy]?.sql.includes('function public.scout_owns'),
    'the generated schema migration must not carry the function: regenerating ' +
    'it would drop the definition every policy depends on');
});

test('the migrated function matches the one recorded in rls.ts', () => {
  // Both copies exist so the definition sits next to the code that depends on
  // it. They drift silently unless something compares them.
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const combined = normalize(migrations().map(file => file.sql).join('\n'));
  assert.ok(combined.includes(normalize(SCOUT_OWNS_FUNCTION)),
    'rls.ts and the migration disagree about how scout_owns is defined');
});

test('the listings policy names the user_listings table correctly', () => {
  // The listings policy spells `public.user_listings` literally, because
  // referencing the table object there would make the two table definitions
  // mutually recursive and TypeScript cannot infer through that. A rename
  // would therefore break the policy at runtime rather than at compile time.
  assert.equal(getTableName(userListings), 'user_listings');

  const policy = getTableConfig(listings).policies
    .find(candidate => candidate.name === 'listings_select_own');
  assert.ok(policy, 'listings must keep a select policy');
});

test('tables holding secrets are unreachable through PostgREST', () => {
  // The frontend authenticates with the publishable key, which ships in the
  // browser bundle. RLS enabled with zero policies denies every request that
  // arrives that way, while the worker connects as table owner and bypasses
  // it. A policy added to either table below would expose refresh tokens.
  for (const table of [gmailTokens, processedMessages, workerLeases, workerRuns]) {
    const config = getTableConfig(table);
    assert.equal(config.enableRLS, true, `${config.name} must enable RLS`);
    assert.equal(config.policies.length, 0,
      `${config.name} must have no policies: it is worker-only`);
  }
});

test('every tenant table enables RLS and scopes its policies to the owner', () => {
  const tenantTables = [
    listings, userListings, gmailAccounts, searchProfiles,
    documents, pursuits, pursuitEvents, threadMessages,
  ];

  for (const table of tenantTables) {
    const config = getTableConfig(table);
    assert.ok(config.policies.length > 0,
      `${config.name} has no policies, so authenticated users cannot read it`);
  }

  // Asserted against the emitted SQL rather than drizzle's internal query
  // chunks: this is the text Postgres actually enforces.
  const statements = migrations()
    .flatMap(file => file.sql.split('--> statement-breakpoint'))
    .filter(statement => statement.includes('CREATE POLICY'));

  assert.ok(statements.length >= 12, 'expected a policy per tenant operation');

  for (const statement of statements) {
    const name = /CREATE POLICY "([^"]+)"/.exec(statement)?.[1] ?? statement;
    assert.match(statement, /scout_owns\(/,
      `${name} must route its ownership test through scout_owns, so roommate ` +
      'support stays a one-function change');
    assert.match(statement, /TO "authenticated"/,
      `${name} must target the authenticated role only — never anon`);
  }
});

test('the agent log and the feed stay read-only to the dashboard', () => {
  // The dashboard resolves escalations and dismisses listings. It never writes
  // the record of what the agent emailed on the user's behalf.
  const writable = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).policies
    .filter(policy => policy.for !== 'select')
    .map(policy => policy.for);

  assert.deepEqual(writable(pursuitEvents), [],
    'pursuit_events is an append-only audit trail written by the worker');
  assert.deepEqual(writable(threadMessages), [],
    'thread_messages is the verbatim mail record, written only by the worker');
});

test('the escalation reasons match the ones the dashboard must resolve', () => {
  // Every value here needs a resolve-flow in the Needs you queue. Adding one
  // without building that flow strands a pursuit with no way forward.
  assert.deepEqual([...needsHumanReason.enumValues], [
    'no_contact',
    'unanswerable_question',
    'no_fitting_slot',
    'portal_link',
    'missing_document',
    'decision',
  ]);

  assert.deepEqual([...pursuitStage.enumValues], [
    'matched',
    'contacted',
    'tour_scheduled',
    'toured',
    'applied',
    'decided',
    'dead',
  ]);
});
