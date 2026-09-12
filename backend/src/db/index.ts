import path from 'node:path';
import {loadEnvFile} from 'node:process';
import {drizzle} from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {REPO_ROOT} from '../paths.ts';
import * as schema from './schema.ts';

// Resolve the root .env even when launched from the backend workspace.
try {
  loadEnvFile(path.join(REPO_ROOT, '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

// Supabase transaction pooling does not support prepared statements.
export const client = postgres(databaseUrl, {prepare: false});
export const db = drizzle(client, {schema});
