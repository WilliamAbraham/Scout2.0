import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import type {gmail_v1} from 'googleapis';

import {DATA_DIR} from '../paths.ts';

// The set of message ids a query matched, saved so later runs (and the
// dev scripts) can work from the same corpus without re-querying Gmail.
export const MESSAGE_IDS_PATH = path.join(DATA_DIR, 'messages.json');

// Full message resources are cached here so anything reading the corpus can
// be re-run and re-sliced without spending Gmail quota or re-authorizing.
export const RAW_DIR = path.join(DATA_DIR, 'raw');

// Apartment listings arrive from this sender.
export const LISTINGS_QUERY = 'from:noreply@email.streeteasy.com';

// Gmail's per-user rate limit is generous but not unlimited; a handful of
// concurrent gets keeps a few hundred messages under a few seconds without
// tripping it.
const CONCURRENCY = 8;

/**
 * Every message id matching `query`, following Gmail's pagination to the
 * end — it hands back at most 500 ids per page.
 */
export async function listMessageIds(
  gmail: gmail_v1.Gmail,
  query: string,
): Promise<string[]> {
  const ids: string[] = [];
  let nextPage: string | undefined;

  do {
    const result = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 500,
      ...(nextPage ? {pageToken: nextPage} : {}),
    });

    for (const message of result.data.messages ?? []) {
      if (message.id) {
        ids.push(message.id);
      }
    }

    nextPage = result.data.nextPageToken ?? undefined;
  } while (nextPage);

  return ids;
}

/** Persist the id list to MESSAGE_IDS_PATH, creating the data dir if needed. */
export async function saveMessageIds(ids: string[]): Promise<void> {
  await mkdir(DATA_DIR, {recursive: true});
  await writeFile(MESSAGE_IDS_PATH, JSON.stringify(ids, null, 4), 'utf8');
}

/**
 * The saved id list, or null when nothing has been collected yet.
 */
export async function readMessageIds(): Promise<string[] | null> {
  try {
    return JSON.parse(await readFile(MESSAGE_IDS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Fetch one full message resource, preferring the on-disk cache. Returns
 * null if the id no longer resolves (deleted mail) so one bad id can't sink
 * a whole run, or if it is uncached and no client was supplied.
 */
export async function loadMessage(
  gmail: gmail_v1.Gmail | null,
  id: string,
): Promise<gmail_v1.Schema$Message | null> {
  const cached = path.join(RAW_DIR, `${id}.json`);

  try {
    return JSON.parse(await readFile(cached, 'utf8'));
  } catch {
    // Not cached yet — fall through to the API.
  }

  if (!gmail) {
    return null;
  }

  try {
    const result = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'full',
    });
    await mkdir(RAW_DIR, {recursive: true});
    await writeFile(cached, JSON.stringify(result.data, null, 2), 'utf8');
    return result.data;
  } catch (error) {
    console.error(`  ! ${id}: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Load many messages a batch at a time, skipping any that fail to resolve.
 */
export async function loadMessages(
  gmail: gmail_v1.Gmail | null,
  ids: string[],
): Promise<gmail_v1.Schema$Message[]> {
  const messages: gmail_v1.Schema$Message[] = [];

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      ids.slice(i, i + CONCURRENCY).map(id => loadMessage(gmail, id)),
    );
    for (const message of batch) {
      if (message) {
        messages.push(message);
      }
    }
  }

  return messages;
}
