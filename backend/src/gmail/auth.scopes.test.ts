import assert from 'node:assert/strict';
import test from 'node:test';

import {GMAIL_SEND_SCOPE, hasGmailSendScope, scopesFromSavedToken} from './auth.ts';

test('saved tokens without scopes are treated as read-only', () => {
  assert.equal(hasGmailSendScope(scopesFromSavedToken({})), false);
  assert.equal(hasGmailSendScope(scopesFromSavedToken({scopes: [GMAIL_SEND_SCOPE]})), true);
});
