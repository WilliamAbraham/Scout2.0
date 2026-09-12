import {CREDENTIALS_PATH, TOKEN_PATH, reconsentGmailSend} from '../src/gmail/auth.ts';

/**
 * Browser re-consent that adds gmail.send alongside the existing read scope.
 * Existing token.json is read-only and cannot be upgraded in place.
 */
const gmail = await reconsentGmailSend();
const profile = await gmail.users.getProfile({userId: 'me'});
console.log(JSON.stringify({
  ok: true,
  emailAddress: profile.data.emailAddress ?? null,
  credentials: CREDENTIALS_PATH,
  token: TOKEN_PATH,
}, null, 2));
