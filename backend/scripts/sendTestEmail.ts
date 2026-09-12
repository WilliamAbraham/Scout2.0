import {getGmailSendClient} from '../src/gmail/auth.ts';
import {createGmailSender} from '../src/outreach/gmailSend.ts';
import {CONTROLLED_TEST_RECIPIENT} from '../src/outreach/recipients.ts';

/**
 * Authorized live verification only. Recipients are rewritten to the
 * controlled test address; this never emails a broker.
 */
const body = process.argv.slice(2).join(' ').trim()
  || 'Scout outreach test: delivery works. This is not a broker email.';

const send = createGmailSender(await getGmailSendClient());
const result = await send({
  to: [CONTROLLED_TEST_RECIPIENT],
  cc: [],
  subject: 'Scout outreach test',
  body,
  threadId: null,
  actionKey: 'test',
  pursuitId: 'test',
});

console.log(JSON.stringify({
  ok: true,
  redirectedTo: CONTROLLED_TEST_RECIPIENT,
  ...result,
}, null, 2));
