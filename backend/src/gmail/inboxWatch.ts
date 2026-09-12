import type {gmail_v1} from 'googleapis';

import {parseMessage} from './message.ts';

export type InboxMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

/** Latest inbox message ids, newest first. */
export async function listInboxMessageIds(
  gmail: gmail_v1.Gmail,
  maxResults = 50,
): Promise<string[]> {
  const result = await gmail.users.messages.list({
    userId: 'me',
    labelIds: ['INBOX'],
    maxResults,
  });
  return (result.data.messages ?? [])
    .map(message => message.id)
    .filter((id): id is string => Boolean(id));
}

/** Return ids in `current` that were not in `seen`. Preserves newest-first order. */
export function findNewMessageIds(seen: Set<string>, current: string[]): string[] {
  return current.filter(id => !seen.has(id));
}

export async function loadInboxMessage(
  gmail: gmail_v1.Gmail,
  id: string,
): Promise<InboxMessage | null> {
  try {
    const result = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'full',
    });
    const parsed = parseMessage(result.data);
    return {
      id: parsed.id,
      threadId: parsed.threadId,
      from: parsed.from,
      subject: parsed.subject,
      date: parsed.date,
      snippet: parsed.snippet,
    };
  } catch {
    return null;
  }
}

export type InboxPollResult = {
  checked: number;
  newMessages: InboxMessage[];
};

/**
 * One inbox poll. Pass a set of message ids already seen; it is updated in
 * place. Only messages absent from `seen` before the poll are returned.
 */
export async function pollInbox(
  gmail: gmail_v1.Gmail,
  seen: Set<string>,
  options: {maxResults?: number} = {},
): Promise<InboxPollResult> {
  const ids = await listInboxMessageIds(gmail, options.maxResults ?? 50);
  const freshIds = findNewMessageIds(seen, ids);
  const newMessages: InboxMessage[] = [];

  for (const id of freshIds) {
    seen.add(id);
    const message = await loadInboxMessage(gmail, id);
    if (message) {
      newMessages.push(message);
    }
  }

  for (const id of ids) {
    seen.add(id);
  }

  return {checked: ids.length, newMessages};
}

export function formatInboxEvent(message: InboxMessage): string {
  return [
    '--- new inbox message ---',
    `  id:      ${message.id}`,
    `  from:    ${message.from}`,
    `  subject: ${message.subject}`,
    `  date:    ${message.date}`,
    `  snippet: ${message.snippet}`,
  ].join('\n');
}
