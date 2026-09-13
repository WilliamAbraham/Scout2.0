import process from 'node:process';

import {client} from '../src/db/index.ts';
import {runRefreshListings} from '../src/pipeline/refreshRun.ts';

/**
 * Re-parse stored StreetEasy alerts and enrich only new matches.
 *
 *   npm run refresh-listings -w backend
 *   npm run refresh-listings -w backend -- --user <uuid>
 */
const userFlag = process.argv.indexOf('--user');
const userId = userFlag >= 0
  ? process.argv[userFlag + 1]
  : process.env.SCOUT_OWNER_USER_ID;

const log = (message: string) => console.error(`[refresh] ${message}`);

if (!userId) {
  console.error('Pass --user <uuid> or set SCOUT_OWNER_USER_ID');
  process.exit(1);
}

try {
  const report = await runRefreshListings(userId, log);
  console.log(JSON.stringify(report));
} finally {
  await client.end();
}
