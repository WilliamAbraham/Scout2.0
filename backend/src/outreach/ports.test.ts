import assert from 'node:assert/strict';
import test from 'node:test';

import {createOutreachPorts} from './ports.ts';

test('dry-run sendMail does not fabricate a live Gmail id', async () => {
  const ports = createOutreachPorts({openRouterApiKey: 'test', mode: 'dry-run'});
  const sent = await ports.sendMail({
    to: ['williamja100@gmail.com'],
    cc: [],
    subject: 'Tour request',
    body: 'Can we tour this week?',
    threadId: null,
  });
  assert.equal(sent.messageId, 'dry-run');
});

test('live sendMail without a real sender refuses silent success', async () => {
  const ports = createOutreachPorts({openRouterApiKey: 'test', mode: 'live'});
  await assert.rejects(
    () => ports.sendMail({
      to: ['williamja100@gmail.com'],
      cc: [],
      subject: 'Tour request',
      body: 'Can we tour this week?',
      threadId: null,
    }),
    /not configured/,
  );
});
