import path from 'node:path';
import {migrate} from 'drizzle-orm/postgres-js/migrator';
import {client, db} from '../src/db/index.ts';
import {REPO_ROOT} from '../src/paths.ts';

try {
  await migrate(db, {migrationsFolder: path.join(REPO_ROOT, 'backend/drizzle')});
  console.log('Database migrations applied.');
} finally {
  await client.end();
}
