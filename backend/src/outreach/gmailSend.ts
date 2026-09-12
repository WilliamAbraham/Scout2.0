import {CONTROLLED_TEST_RECIPIENT, isValidEmail, redirectForTestSend} from './recipients.ts';
import type {SendMailInput} from './types.ts';

type GmailSendClient = {
  users: {
    messages: {
      send(request: {
        userId?: string;
        requestBody: {raw?: string | null; threadId?: string | null};
      }): Promise<{data: {id?: string | null; threadId?: string | null}}>;
    };
  };
};

export function buildRawMessage(input: {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  threadId: string | null;
  rfc822MessageId?: string | undefined;
  inReplyTo?: string | undefined;
}): {raw: string; threadId: string | null} {
  const headers = [
    `To: ${input.to.join(', ')}`,
    ...(input.cc.length > 0 ? [`Cc: ${input.cc.join(', ')}`] : []),
    `Subject: ${input.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  if (input.rfc822MessageId) {
    headers.push(`Message-ID: ${input.rfc822MessageId}`);
  }
  if (input.inReplyTo) {
    headers.push(`In-Reply-To: ${input.inReplyTo}`);
    headers.push(`References: ${input.inReplyTo}`);
  }
  const mime = `${headers.join('\r\n')}\r\n\r\n${input.body}`;
  return {
    raw: Buffer.from(mime, 'utf8').toString('base64url'),
    threadId: input.threadId,
  };
}

function assertSendable(message: SendMailInput): void {
  if (!message.body.trim()) {
    throw new Error('Cannot send an empty draft');
  }
  if (!message.subject.trim()) {
    throw new Error('Cannot send a message without a subject');
  }
  const recipients = [...message.to, ...message.cc];
  if (recipients.length === 0) {
    throw new Error('Cannot send a message without a recipient');
  }
  const invalid = recipients.find(address => !isValidEmail(address));
  if (invalid) {
    throw new Error(`Invalid recipient: ${invalid}`);
  }
}

export function createGmailSender(
  gmail: GmailSendClient,
  options: {allowRealRecipients?: boolean} = {},
): (message: SendMailInput) => Promise<{threadId: string; messageId: string}> {
  return async message => {
    assertSendable(message);
    const route = options.allowRealRecipients
      ? {to: message.to, cc: message.cc}
      : redirectForTestSend(message);
    const built = buildRawMessage({
      to: route.to,
      cc: route.cc,
      subject: message.threadId && !/^re:/i.test(message.subject)
        ? `Re: ${message.subject}`
        : message.subject,
      body: message.body,
      threadId: message.threadId,
    });
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: built.raw,
        ...(built.threadId ? {threadId: built.threadId} : {}),
      },
    });
    const threadId = response.data.threadId;
    const messageId = response.data.id;
    if (!threadId || !messageId) {
      throw new Error('Gmail send returned no message or thread id');
    }
    return {threadId, messageId};
  };
}

export {CONTROLLED_TEST_RECIPIENT};
