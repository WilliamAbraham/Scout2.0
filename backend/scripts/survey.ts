import {mkdir, readdir} from 'node:fs/promises';
import process from 'node:process';

import type {gmail_v1} from 'googleapis';

import {getGmailClient} from '../src/gmail/auth.ts';
import {RAW_DIR, loadMessages, readMessageIds} from '../src/gmail/mailbox.ts';
import {parseMessage} from '../src/gmail/message.ts';

/**
 * Render a MIME tree as a compact one-line shape, e.g.
 * `multipart/alternative(text/plain, text/html)`. Two messages with the same
 * shape can be parsed by the same code path.
 */
function mimeShape(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) {
    return '(no payload)';
  }
  const type = part.mimeType ?? '?';
  const children = part.parts ?? [];
  if (children.length === 0) {
    return type;
  }
  return `${type}(${children.map(mimeShape).join(', ')})`;
}

/**
 * Collapse a subject into a template so variants of the same notification
 * collapse together: digits, prices and quoted names become placeholders.
 */
function subjectTemplate(subject: string): string {
  return subject
    .replace(/\$[\d,]+(\.\d+)?/g, '$N')
    .replace(/\b\d[\d,]*\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

function header(
  payload: gmail_v1.Schema$MessagePart | undefined,
  name: string,
): string {
  const wanted = name.toLowerCase();
  return (
    payload?.headers?.find(h => h.name?.toLowerCase() === wanted)?.value ?? ''
  );
}

/** Count occurrences into a map, for the tallies printed below. */
function tally<T>(map: Map<T, number>, key: T) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Print a tally largest-first. */
function report<T>(title: string, map: Map<T, number>, limit = Infinity) {
  console.log(`\n## ${title} (${map.size} distinct)`);
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  for (const [key, count] of rows) {
    console.log(`  ${String(count).padStart(4)}  ${String(key)}`);
  }
}

/**
 * Fetch (or load from cache) every saved message id and print what shapes
 * the corpus actually contains — the input a parser has to survive.
 *
 *   npm run survey -w backend               # cache misses hit the API
 *   npm run survey -w backend -- --offline  # cache only, no auth
 */
async function survey() {
  const offline = process.argv.includes('--offline');

  const ids = await readMessageIds();
  if (!ids) {
    console.error(
      'No message ids saved yet. Run `npm run sync -w backend` first.',
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(RAW_DIR, {recursive: true});

  let gmail: gmail_v1.Gmail | null = null;
  if (!offline) {
    const cached = new Set(
      (await readdir(RAW_DIR)).map(f => f.replace(/\.json$/, '')),
    );
    if (ids.some(id => !cached.has(id))) {
      gmail = await getGmailClient();
    }
  }

  const messages = await loadMessages(gmail, ids);

  console.log(`# ${messages.length} of ${ids.length} ids resolved\n`);

  const senders = new Map<string, number>();
  const shapes = new Map<string, number>();
  const templates = new Map<string, number>();
  const headerNames = new Map<string, number>();
  const labels = new Map<string, number>();
  const bodies = new Map<string, number>();
  const charsets = new Map<string, number>();
  const dates: number[] = [];
  const sizes: number[] = [];

  // One example id per subject template, so any cluster can be eyeballed
  // with `npm run inspect -- <id>`.
  const examples = new Map<string, string>();

  for (const message of messages) {
    const raw = parseMessage(message);
    const payload = message.payload;

    tally(senders, raw.from);
    tally(shapes, mimeShape(payload));

    const template = subjectTemplate(raw.subject);
    tally(templates, template);
    if (!examples.has(template)) {
      examples.set(template, raw.id);
    }

    for (const h of payload?.headers ?? []) {
      if (h.name) {
        tally(headerNames, h.name.toLowerCase());
      }
    }
    for (const label of message.labelIds ?? []) {
      tally(labels, label);
    }

    const has = [
      raw.textBody === null ? null : 'text',
      raw.htmlBody === null ? null : 'html',
    ].filter(Boolean);
    tally(bodies, has.length ? has.join('+') : 'NEITHER');

    const contentType = header(payload, 'Content-Type');
    const charset = /charset="?([\w-]+)"?/i.exec(contentType)?.[1] ?? '(none)';
    tally(charsets, charset.toLowerCase());

    const parsed = Date.parse(raw.date);
    if (!Number.isNaN(parsed)) {
      dates.push(parsed);
    }
    if (typeof message.sizeEstimate === 'number') {
      sizes.push(message.sizeEstimate);
    }
  }

  report('Senders (From header)', senders);
  report('Subject templates', templates);
  report('MIME shapes', shapes);
  report('Body parts present', bodies);
  report('Charsets on the top-level Content-Type', charsets);
  report('Labels', labels);
  report('Headers seen', headerNames, 40);

  console.log('\n## Example id per subject template');
  for (const [template, id] of examples) {
    console.log(`  ${id}  ${template}`);
  }

  if (dates.length) {
    dates.sort((a, b) => a - b);
    console.log(
      `\n## Date range\n  ${new Date(dates[0]!).toISOString()} .. ` +
        `${new Date(dates[dates.length - 1]!).toISOString()}`,
    );
  }
  if (sizes.length) {
    sizes.sort((a, b) => a - b);
    console.log(
      `\n## sizeEstimate bytes\n  min ${sizes[0]}  ` +
        `median ${sizes[Math.floor(sizes.length / 2)]}  ` +
        `max ${sizes[sizes.length - 1]}`,
    );
  }

  console.log(`\nRaw resources cached in ${RAW_DIR}`);
}

await survey();
