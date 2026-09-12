import process from 'node:process';

import {getGmailClient} from '../src/gmail/auth.ts';
import {readMessageIds} from '../src/gmail/mailbox.ts';
import {getRawMessage} from '../src/gmail/message.ts';

// How much of the HTML body to show before truncating. StreetEasy mail runs
// to tens of kilobytes, which is unreadable in a terminal.
const HTML_PREVIEW = 2000;

/**
 * Print one message's raw elements so its shape can be eyeballed before
 * anything tries to parse listings out of it.
 *
 *   npm run inspect -w backend                 # first saved id
 *   npm run inspect -w backend -- <messageId>  # a specific id
 *   npm run inspect -w backend -- --full       # untruncated HTML
 */
async function inspect() {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  let messageId = args.find(arg => !arg.startsWith('--'));

  if (!messageId) {
    const ids = await readMessageIds();
    messageId = ids?.[0];

    if (!messageId) {
      console.error(
        'No message id given and none are saved yet. ' +
          'Run `npm run sync -w backend` first to collect ids.',
      );
      process.exitCode = 1;
      return;
    }
  }

  const gmail = await getGmailClient();
  const message = await getRawMessage(gmail, messageId);

  console.log(`id:       ${message.id}`);
  console.log(`threadId: ${message.threadId}`);
  console.log(`from:     ${message.from}`);
  console.log(`date:     ${message.date}`);
  console.log(`subject:  ${message.subject}`);
  console.log(`snippet:  ${message.snippet}`);

  console.log('\n--- text/plain ---');
  console.log(message.textBody ?? '(none)');

  console.log('\n--- text/html ---');
  if (message.htmlBody === null) {
    console.log('(none)');
  } else if (full || message.htmlBody.length <= HTML_PREVIEW) {
    console.log(message.htmlBody);
  } else {
    console.log(message.htmlBody.slice(0, HTML_PREVIEW));
    console.log(
      `\n... truncated, ${message.htmlBody.length} chars total. ` +
        'Pass --full to see all of it.',
    );
  }
}

await inspect();
