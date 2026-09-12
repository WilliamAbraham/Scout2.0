import {existsSync} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {authenticate} from '@google-cloud/local-auth';
import {google, Auth} from 'googleapis';
import type {gmail_v1} from 'googleapis';

import {REPO_ROOT} from '../paths.ts';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_SCOPES_READ = [GMAIL_READONLY_SCOPE];
export const GMAIL_SCOPES_SEND = [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE];

function firstExisting(...candidates: string[]): string {
  const usable = candidates.filter(Boolean);
  return usable.find(candidate => existsSync(candidate)) ?? usable[0] ?? '';
}

const MAIN_CHECKOUT = path.resolve(REPO_ROOT, '../../..');

// OAuth client secret, downloaded from the Google Cloud console.
export const CREDENTIALS_PATH = firstExisting(
  process.env.GMAIL_CREDENTIALS_PATH ?? '',
  path.join(REPO_ROOT, 'credentials.json'),
  path.join(MAIN_CHECKOUT, 'credentials.json'),
);

// The access/refresh token minted from the credentials above.
export const TOKEN_PATH = firstExisting(
  process.env.GMAIL_TOKEN_PATH ?? '',
  path.join(REPO_ROOT, 'token.json'),
  path.join(MAIN_CHECKOUT, 'token.json'),
);

const SCOPES = GMAIL_SCOPES_READ;

/**
 * Rebuild a client from the refresh token saved by a previous run, or null
 * if this is the first run (or the saved token is missing/unreadable).
 */
export function scopesFromSavedToken(saved: {scopes?: unknown}): string[] {
  if (Array.isArray(saved.scopes) && saved.scopes.every(value => typeof value === 'string')) {
    return saved.scopes;
  }
  return [...GMAIL_SCOPES_READ];
}

export function hasGmailSendScope(scopes: string[]): boolean {
  return scopes.includes(GMAIL_SEND_SCOPE);
}

async function loadSavedToken(): Promise<{
  client: Auth.UserRefreshClient;
  scopes: string[];
} | null> {
  try {
    const saved = JSON.parse(await readFile(TOKEN_PATH, 'utf8'));
    if (!saved.client_id || !saved.client_secret || !saved.refresh_token) {
      return null;
    }

    return {
      client: new Auth.UserRefreshClient({
        clientId: saved.client_id,
        clientSecret: saved.client_secret,
        refreshToken: saved.refresh_token,
      }),
      scopes: scopesFromSavedToken(saved),
    };
  } catch {
    return null;
  }
}

/** The OAuth client id and secret from the downloaded console credentials. */
async function readClientKey(): Promise<{client_id: string; client_secret: string}> {
  const keys = JSON.parse(await readFile(CREDENTIALS_PATH, 'utf8'));
  return keys.installed ?? keys.web;
}

/**
 * Persist the refresh token so later runs skip the browser consent screen.
 */
async function saveToken(refreshToken: string, scopes: string[]) {
  const key = await readClientKey();

  await writeFile(
    TOKEN_PATH,
    JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: refreshToken,
      scopes,
    }),
    // Owner-only: this file grants read access to the whole mailbox.
    {encoding: 'utf8', mode: 0o600},
  );
}

/**
 * An authorized Gmail client. Opens the browser consent flow only on the
 * first run; after that the saved refresh token is reused.
 */
export async function getGmailClient(): Promise<gmail_v1.Gmail> {
  const saved = await loadSavedToken();
  if (saved) {
    return google.gmail({version: 'v1', auth: saved.client});
  }

  const consented = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  // `@google-cloud/local-auth` resolves google-auth-library@8 while
  // `googleapis` uses @10, and the two OAuth2Client classes are not
  // structurally compatible — passing one to `google.gmail()` does not
  // typecheck. Carry the credentials across the boundary instead of the
  // client object; they are plain JSON and identical in both versions.
  //
  // This goes away when per-user OAuth moves into the database: local-auth
  // runs a loopback server against the local browser and cannot serve a
  // multi-tenant backend at all.
  const key = await readClientKey();
  const client = new Auth.OAuth2Client({
    clientId: key.client_id,
    clientSecret: key.client_secret,
  });
  client.setCredentials(consented.credentials);

  // A client that came back without a refresh token can still make this
  // run's calls, it just can't be replayed later — so don't save it. Google
  // withholds one when this client is already authorized for the account,
  // which is silent and leaves every future run stuck at the consent screen.
  // Say so rather than letting the missing token.json look like a bug.
  const refreshToken = consented.credentials.refresh_token;
  if (refreshToken) {
    await saveToken(refreshToken, SCOPES);
  } else {
    console.warn(
      `Google returned no refresh token, so ${TOKEN_PATH} was not written ` +
        'and the next run will prompt again. Revoke this app at ' +
        'https://myaccount.google.com/permissions and re-run to mint one.',
    );
  }

  return google.gmail({version: 'v1', auth: client});
}

export async function readGrantedScopes(): Promise<string[]> {
  const saved = await loadSavedToken();
  return saved?.scopes ?? [];
}

export async function getGmailSendClient(): Promise<gmail_v1.Gmail> {
  const saved = await loadSavedToken();
  if (saved && hasGmailSendScope(saved.scopes)) {
    return google.gmail({version: 'v1', auth: saved.client});
  }
  throw new Error(
    'Gmail send is not authorized. Existing credentials are read-only. ' +
    'Run `npm run outreach:reconsent -w backend` to add gmail.send, then retry.',
  );
}

export async function reconsentGmailSend(): Promise<gmail_v1.Gmail> {
  const consented = await authenticate({
    scopes: GMAIL_SCOPES_SEND,
    keyfilePath: CREDENTIALS_PATH,
  });
  const key = await readClientKey();
  const client = new Auth.OAuth2Client({
    clientId: key.client_id,
    clientSecret: key.client_secret,
  });
  client.setCredentials(consented.credentials);
  const refreshToken = consented.credentials.refresh_token;
  if (refreshToken) {
    await saveToken(refreshToken, GMAIL_SCOPES_SEND);
  } else {
    console.warn(
      `Google returned no refresh token, so ${TOKEN_PATH} was not written. ` +
        'Revoke this app at https://myaccount.google.com/permissions and re-run.',
    );
  }
  return google.gmail({version: 'v1', auth: client});
}
