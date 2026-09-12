import process from 'node:process';

import {getGmailClient} from '../src/gmail/auth.ts';
import {formatInboxEvent, listInboxMessageIds, pollInbox} from '../src/gmail/inboxWatch.ts';

/**
 * Poll the inbox and print whenever a new message arrives.
 *
 *   npm run watch-inbox -w backend
 *   POLL_MS=15000 npm run watch-inbox -w backend   # check every 15s
 *
 * On startup the current inbox is recorded silently; only messages that
 * arrive after that are printed. Use --catch-up to print everything visible
 * on the first poll too.
 */
const POLL_MS = Number(process.env.POLL_MS ?? 30_000);
const catchUp = process.argv.includes('--catch-up');
const once = process.argv.includes('--once');

const seen = new Set<string>();

async function tick(label: string) {
  const gmail = await getGmailClient();
  if (!catchUp && seen.size === 0) {
    const ids = await listInboxMessageIds(gmail);
    for (const id of ids) {
      seen.add(id);
    }
    console.error(`[${label}] watching inbox (${ids.length} messages already here, not printing)`);
    return;
  }

  const result = await pollInbox(gmail, seen);
  if (result.newMessages.length === 0) {
    console.error(`[${label}] no new mail (${result.checked} in inbox)`);
    return;
  }

  for (const message of result.newMessages) {
    console.log(formatInboxEvent(message));
  }
}

const label = () => new Date().toISOString();

console.error(`Inbox watcher started (poll every ${POLL_MS}ms). Send yourself a test email.`);

await tick(label());
if (!once) {
  setInterval(() => {
    tick(label()).catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
  }, POLL_MS);
}
