import type {gmail_v1} from 'googleapis';

/**
 * A Gmail message flattened into the pieces a listing parser cares about.
 * Nothing here is apartment-specific yet — this is the raw material.
 */
export interface RawMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  textBody: string | null;
  htmlBody: string | null;
}

/**
 * Look up a header by name, case-insensitively — Gmail does not promise a
 * particular casing. Returns '' when the header is absent.
 */
function header(payload: gmail_v1.Schema$MessagePart, name: string): string {
  const wanted = name.toLowerCase();
  const found = payload.headers?.find(h => h.name?.toLowerCase() === wanted);
  return found?.value ?? '';
}

/**
 * Walk the MIME tree depth-first and return the decoded body of the first
 * part matching `mimeType`, or null if there is none.
 *
 * Handles the three shapes StreetEasy mail arrives in: a flat single-part
 * message, a multipart/alternative pair, and that pair nested inside a
 * multipart/mixed when images ride along.
 */
function findBody(
  part: gmail_v1.Schema$MessagePart,
  mimeType: string,
): string | null {
  if (part.mimeType === mimeType && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }

  for (const child of part.parts ?? []) {
    const found = findBody(child, mimeType);
    if (found !== null) {
      return found;
    }
  }

  return null;
}

/**
 * Flatten a Gmail message resource into a RawMessage. Pure — no I/O.
 */
export function parseMessage(message: gmail_v1.Schema$Message): RawMessage {
  const payload = message.payload ?? {};

  return {
    id: message.id ?? '',
    threadId: message.threadId ?? '',
    subject: header(payload, 'Subject'),
    from: header(payload, 'From'),
    date: header(payload, 'Date'),
    snippet: message.snippet ?? '',
    textBody: findBody(payload, 'text/plain'),
    htmlBody: findBody(payload, 'text/html'),
  };
}

/**
 * Fetch one message by id and return its raw elements.
 *
 * Takes the client as a parameter so a single authorization covers a whole
 * batch of lookups.
 */
export async function getRawMessage(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<RawMessage> {
  const result = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  return parseMessage(result.data);
}
