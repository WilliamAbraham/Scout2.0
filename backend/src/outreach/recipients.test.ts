import assert from 'node:assert/strict';
import test from 'node:test';

import type {ListingAgent} from './types.ts';
import {
  CONTROLLED_TEST_RECIPIENT,
  isValidEmail,
  outreachRecipients,
  redirectForTestSend,
} from './recipients.ts';

function agent(name: string, email: string | null, role: ListingAgent['role'] = 'unspecified'): ListingAgent {
  return {name, email, role};
}

test('isValidEmail rejects empty, nameless, and malformed values', () => {
  assert.equal(isValidEmail('ava@broker.example'), true);
  assert.equal(isValidEmail('williamja100@gmail.com'), true);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('Ava'), false);
  assert.equal(isValidEmail('ava at broker.example'), false);
});

test('outreachRecipients keeps person vs office, dedupes, and requires a verified email', () => {
  assert.equal(outreachRecipients([agent('Ava', null, 'primary')]), null);
  assert.equal(outreachRecipients([agent('Ava', 'Ava')]), null);

  const route = outreachRecipients([
    agent('Office', 'leasing@broker.example'),
    agent('Ava', 'ava@broker.example', 'primary'),
    agent('Ava copy', 'AVA@broker.example'),
    agent('Ben', 'ben@broker.example'),
  ]);
  assert.deepEqual(route, {
    to: ['ava@broker.example'],
    cc: ['leasing@broker.example', 'ben@broker.example'],
  });
});

test('redirectForTestSend rewrites every recipient to the controlled address', () => {
  const redirected = redirectForTestSend({
    to: ['ava@broker.example'],
    cc: ['ben@broker.example'],
  });
  assert.deepEqual(redirected, {
    to: [CONTROLLED_TEST_RECIPIENT],
    cc: [],
    intendedTo: ['ava@broker.example'],
    intendedCc: ['ben@broker.example'],
  });
});
