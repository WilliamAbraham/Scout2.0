import type {gmail_v1} from 'googleapis';

import {getGmailSendClient, hasGmailSendScope, readGrantedScopes} from '../gmail/auth.ts';
import {createGmailSender} from './gmailSend.ts';
import {dispatchOutboxSend, type Outbox} from './outbox.ts';
import {CONTROLLED_TEST_RECIPIENT} from './recipients.ts';
import type {OutreachPorts, SendMailInput} from './types.ts';

export {CONTROLLED_TEST_RECIPIENT};

export async function assertLiveSendReady(): Promise<void> {
  const scopes = await readGrantedScopes();
  if (!hasGmailSendScope(scopes)) {
    throw new Error(
      '--live requires gmail.send. Existing tokens are read-only. ' +
      'Run `npm run outreach:reconsent -w backend` and retry. ' +
      `Test mail is redirected to ${CONTROLLED_TEST_RECIPIENT}.`,
    );
  }
}

export function createOutboxSendMail(options: {
  outbox: Outbox;
  userId: string;
  mode: 'dry-run' | 'live';
  send: (message: SendMailInput) => Promise<{threadId: string; messageId: string}>;
}): OutreachPorts['sendMail'] {
  return message => dispatchOutboxSend({
    outbox: options.outbox,
    userId: options.userId,
    message,
    send: options.send,
    mode: options.mode,
  });
}

export function createLiveSendMail(options: {
  outbox: Outbox;
  userId: string;
  gmail: gmail_v1.Gmail;
}): OutreachPorts['sendMail'] {
  return createOutboxSendMail({
    outbox: options.outbox,
    userId: options.userId,
    mode: 'live',
    send: createGmailSender(options.gmail),
  });
}

export async function createAuthorizedLiveSendMail(options: {
  outbox: Outbox;
  userId: string;
}): Promise<OutreachPorts['sendMail']> {
  await assertLiveSendReady();
  return createLiveSendMail({
    outbox: options.outbox,
    userId: options.userId,
    gmail: await getGmailSendClient(),
  });
}
