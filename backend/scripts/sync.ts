import {getGmailClient} from '../src/gmail/auth.ts';
import {
  LISTINGS_QUERY,
  MESSAGE_IDS_PATH,
  listMessageIds,
  saveMessageIds,
} from '../src/gmail/mailbox.ts';

/**
 * Collect the ids of every apartment listing email and save them, so the
 * other scripts have a corpus to work from.
 *
 *   npm run sync -w backend
 */
async function sync() {
  const gmail = await getGmailClient();
  const ids = await listMessageIds(gmail, LISTINGS_QUERY);

  if (ids.length === 0) {
    console.log('No message ids found.');
    return;
  }

  await saveMessageIds(ids);
  console.log(`Wrote ${ids.length} message ids to ${MESSAGE_IDS_PATH}`);
}

await sync();
