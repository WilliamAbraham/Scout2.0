import {outreachRecipients} from './recipients.ts';
import type {
  LlmToolCall,
  NeedsHumanReason,
  OutreachPorts,
  Pursuit,
  ToolName,
  TurnAction,
  TurnInput,
  TurnResult,
} from './types.ts';
import {
  FIRST_FOLLOW_UP_DAYS,
  MAX_FOLLOW_UPS,
  SECOND_FOLLOW_UP_DAYS,
} from './types.ts';

// The renter's identity is the From header plus a signature appended after the
// model returns, so the model is told not to write one. Left to itself it emits
// "[Your Name]", which reaches the broker as a visibly unfinished draft.
const NO_PLACEHOLDERS = [
  'Return only the email body: no Subject line, no headers.',
  'Never write a placeholder such as [Your Name] or [Your Contact Information],',
  'and never end with a sign-off or signature name — one is appended for you.',
].join(' ');

const OPEN_SYSTEM = [
  'Write one short tour-request email from the renter.',
  'Ask for a tour. Use the profile availability and preferences.',
  'Do not invent facts.',
  NO_PLACEHOLDERS,
].join(' ');

const FOLLOW_UP_SYSTEM = [
  'Write a brief, polite follow-up on an unanswered tour request.',
  'Reference the same apartment. Do not invent facts.',
  NO_PLACEHOLDERS,
].join(' ');

const REPLY_SYSTEM = [
  'You handle a broker email for an NYC rental tour.',
  'Use tools. Escalate portal links, questions the profile cannot answer, missing documents, and lease decisions.',
  'Use schedule_follow_up when the broker asks for time or goes quiet after a partial answer.',
  'One listing is one thread. Do not invent facts.',
].join(' ');

const REPLY_TOOLS = [
  'check_availability',
  'book_tour',
  'send_reply',
  'send_packet',
  'escalate',
  'mark_dead',
  'schedule_follow_up',
] as const satisfies readonly ToolName[];

const NEEDS_HUMAN_REASONS: readonly NeedsHumanReason[] = [
  'no_contact',
  'unanswerable_question',
  'no_fitting_slot',
  'portal_link',
  'missing_document',
  'decision',
];

function now(input: TurnInput): Date {
  return input.now ?? new Date();
}

function snapshot(pursuit: Pursuit): TurnResult['pursuit'] {
  return {
    stage: pursuit.stage,
    needsHumanReason: pursuit.needsHumanReason,
    threadId: pursuit.threadId,
    nextFollowUpAt: pursuit.nextFollowUpAt,
    followUpCount: pursuit.followUpCount,
  };
}

function addDays(from: Date, days: number): Date {
  const at = new Date(from);
  at.setUTCDate(at.getUTCDate() + days);
  return at;
}

function scheduleAfterOpen(at: Date): Date {
  return addDays(at, FIRST_FOLLOW_UP_DAYS);
}

function scheduleAfterFollowUp(at: Date, count: number): Date | null {
  if (count >= MAX_FOLLOW_UPS) {
    return null;
  }
  return addDays(at, count === 0 ? FIRST_FOLLOW_UP_DAYS : SECOND_FOLLOW_UP_DAYS);
}

function recipients(pursuit: Pursuit): {to: string[]; cc: string[]} | null {
  return outreachRecipients(pursuit.agents);
}

function isSelfSent(input: TurnInput): boolean {
  const mailbox = input.mailboxEmail?.trim().toLowerCase();
  const from = input.inbound?.from.toLowerCase() ?? '';
  return Boolean(mailbox && from.includes(mailbox));
}

async function admitModelSpend(
  input: TurnInput,
  ports: OutreachPorts,
  kind: 'draft' | 'reply',
): Promise<TurnResult | null> {
  if (!ports.reserveModelSpend) {
    return null;
  }
  const reserved = await ports.reserveModelSpend(kind, 0.01);
  if (reserved.ok) {
    return null;
  }
  return {actions: [{type: 'noop', reason: 'budget_exhausted'}], pursuit: snapshot(input.pursuit)};
}

function pursuitContext(pursuit: Pursuit): string {
  const {listing, profile, agents} = pursuit;
  const learned = profile.learnedAnswers.length
    ? profile.learnedAnswers.map(row => `Q: ${row.question}\nA: ${row.answer}`).join('\n')
    : 'none';
  return [
    `Address: ${listing.address}`,
    `Price: ${listing.price}`,
    `Beds/baths: ${listing.bedrooms ?? '?'} / ${listing.bathrooms ?? '?'}`,
    `Brokerage: ${listing.brokerage ?? 'unknown'}`,
    `Agents: ${agents.map(agent => `${agent.name}${agent.role === 'primary' ? ' (primary)' : ''}`).join(', ')}`,
    `Budget max: ${profile.budgetMax ?? 'unspecified'}`,
    `Availability: ${profile.availabilityNote}`,
    `Preferences: ${profile.freeText}`,
    `Learned answers:\n${learned}`,
  ].join('\n');
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asReason(value: unknown): NeedsHumanReason | null {
  return NEEDS_HUMAN_REASONS.find(reason => reason === value) ?? null;
}

/**
 * Remove anything the model still produced in place of a signature, then append
 * the renter's own. A model-written sign-off is a guess at the user's identity;
 * a configured one is either a real name or nothing.
 */
export function signOff(body: string, renterName: string | null | undefined): string {
  const cleaned = body
    .replace(/^\s*subject:.*$/im, '')
    .replace(/^\s*(?:best|kind|warm)\s+(?:regards|wishes)\b[\s\S]*$/im, '')
    .replace(/^\s*(?:sincerely|thanks|thank you|cheers)\s*,\s*$[\s\S]*$/im, '')
    .replace(/\[[^\]\n]{2,60}\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return renterName ? `${cleaned}\n\nBest regards,\n${renterName}` : cleaned;
}

async function composeAndSend(
  input: TurnInput,
  ports: OutreachPorts,
  toCc: {to: string[]; cc: string[]},
  system: string,
  threadId: string | null,
  actionKey: string,
): Promise<{action: TurnAction; threadId: string} | {empty: true}> {
  const composed = await ports.llm.complete({
    system,
    user: pursuitContext(input.pursuit),
    tools: [],
  });
  const drafted = composed.text?.trim() ?? '';
  if (!drafted) {
    return {empty: true};
  }
  const body = signOff(drafted, input.renterName);
  const message = {
    to: toCc.to,
    cc: toCc.cc,
    subject: `Tour request: ${input.pursuit.listing.address}`,
    body,
    threadId,
    actionKey,
    pursuitId: input.pursuit.id,
  };
  const sent = await ports.sendMail(message);
  return {action: {type: 'send', ...message}, threadId: sent.threadId};
}

async function openThread(input: TurnInput, ports: OutreachPorts): Promise<TurnResult> {
  const toCc = recipients(input.pursuit);
  if (!toCc) {
    return {
      actions: [{type: 'escalate', reason: 'no_contact', detail: 'No agent email on the listing'}],
      pursuit: {...snapshot(input.pursuit), needsHumanReason: 'no_contact', nextFollowUpAt: null},
    };
  }
  if (input.sendsToday >= input.sendCap) {
    return {actions: [{type: 'noop', reason: 'send_cap'}], pursuit: snapshot(input.pursuit)};
  }
  const blocked = await admitModelSpend(input, ports, 'draft');
  if (blocked) {
    return blocked;
  }

  const sent = await composeAndSend(input, ports, toCc, OPEN_SYSTEM, null, 'open');
  if ('empty' in sent) {
    return {actions: [{type: 'noop', reason: 'empty_draft'}], pursuit: snapshot(input.pursuit)};
  }
  const at = now(input);
  return {
    actions: [sent.action],
    pursuit: {
      ...snapshot(input.pursuit),
      stage: 'contacted',
      threadId: sent.threadId,
      nextFollowUpAt: scheduleAfterOpen(at),
      followUpCount: 0,
    },
  };
}

async function followUpThread(input: TurnInput, ports: OutreachPorts): Promise<TurnResult> {
  const toCc = recipients(input.pursuit);
  if (!toCc || !input.pursuit.threadId) {
    return {actions: [{type: 'noop', reason: 'missing_thread'}], pursuit: snapshot(input.pursuit)};
  }
  if (input.sendsToday >= input.sendCap) {
    return {actions: [{type: 'noop', reason: 'send_cap'}], pursuit: snapshot(input.pursuit)};
  }
  const blocked = await admitModelSpend(input, ports, 'draft');
  if (blocked) {
    return blocked;
  }

  const actionKey = `follow_up:${input.pursuit.followUpCount + 1}`;
  const sent = await composeAndSend(input, ports, toCc, FOLLOW_UP_SYSTEM, input.pursuit.threadId, actionKey);
  if ('empty' in sent) {
    return {actions: [{type: 'noop', reason: 'empty_draft'}], pursuit: snapshot(input.pursuit)};
  }
  const at = now(input);
  const followUpCount = input.pursuit.followUpCount + 1;
  const nextFollowUpAt = scheduleAfterFollowUp(at, followUpCount);
  const actions: TurnAction[] = [sent.action];
  let stage = input.pursuit.stage;
  if (followUpCount >= MAX_FOLLOW_UPS && !nextFollowUpAt) {
    stage = 'dead';
    actions.push({type: 'mark_dead', reason: 'No reply after follow-ups'});
  }
  return {
    actions,
    pursuit: {
      ...snapshot(input.pursuit),
      stage,
      threadId: sent.threadId,
      followUpCount,
      nextFollowUpAt,
    },
  };
}

async function sendReply(
  input: TurnInput,
  ports: OutreachPorts,
  body: string,
  toCc: {to: string[]; cc: string[]},
): Promise<{action: TurnAction; threadId: string} | {empty: true}> {
  const trimmed = body.trim();
  if (!trimmed) {
    return {empty: true};
  }
  const message = {
    to: toCc.to,
    cc: toCc.cc,
    subject: `Tour request: ${input.pursuit.listing.address}`,
    body: trimmed,
    threadId: input.pursuit.threadId,
    actionKey: `reply:${input.inbound?.id ?? 'unknown'}`,
    pursuitId: input.pursuit.id,
  };
  const sent = await ports.sendMail(message);
  return {action: {type: 'send', ...message}, threadId: sent.threadId};
}

async function applyTool(
  call: LlmToolCall,
  input: TurnInput,
  ports: OutreachPorts,
  toCc: {to: string[]; cc: string[]} | null,
  pursuit: TurnResult['pursuit'],
): Promise<{
  actions: TurnAction[];
  pursuit: TurnResult['pursuit'];
  observation: string | null;
  stop: boolean;
}> {
  if (call.name === 'check_availability') {
    const start = str(call.arguments.start);
    const end = str(call.arguments.end);
    const {free} = await ports.checkAvailability({start, end});
    if (!free) {
      return {
        actions: [{type: 'escalate', reason: 'no_fitting_slot', detail: 'Offered time is not free'}],
        pursuit: {...pursuit, needsHumanReason: 'no_fitting_slot', nextFollowUpAt: null},
        observation: null,
        stop: true,
      };
    }
    return {
      actions: [],
      pursuit,
      observation: `check_availability ${start} to ${end}: free`,
      stop: false,
    };
  }

  if (call.name === 'book_tour') {
    return {
      actions: [{
        type: 'escalate',
        reason: 'unanswerable_question',
        detail: 'Calendar booking is not available yet',
      }],
      pursuit: {...pursuit, needsHumanReason: 'unanswerable_question', nextFollowUpAt: null},
      observation: null,
      stop: true,
    };
  }

  if (call.name === 'send_reply') {
    if (input.sendsToday >= input.sendCap) {
      return {actions: [{type: 'noop', reason: 'send_cap'}], pursuit, observation: null, stop: true};
    }
    const blocked = await admitModelSpend(input, ports, 'reply');
    if (blocked) {
      return {actions: blocked.actions, pursuit, observation: null, stop: true};
    }
    if (!toCc) {
      return {
        actions: [{type: 'escalate', reason: 'no_contact', detail: 'No agent email on the listing'}],
        pursuit: {...pursuit, needsHumanReason: 'no_contact', nextFollowUpAt: null},
        observation: null,
        stop: true,
      };
    }
    const sent = await sendReply(input, ports, str(call.arguments.body), toCc);
    if ('empty' in sent) {
      return {actions: [{type: 'noop', reason: 'empty_draft'}], pursuit, observation: null, stop: true};
    }
    return {
      actions: [sent.action],
      pursuit: {...pursuit, threadId: sent.threadId, nextFollowUpAt: null},
      observation: null,
      stop: false,
    };
  }

  if (call.name === 'send_packet') {
    return {
      actions: [{
        type: 'escalate',
        reason: 'missing_document',
        detail: 'Document release is not available yet',
      }],
      pursuit: {...pursuit, needsHumanReason: 'missing_document', nextFollowUpAt: null},
      observation: null,
      stop: true,
    };
  }

  if (call.name === 'schedule_follow_up') {
    const days = num(call.arguments.days);
    if (days === null || days < 1) {
      return {actions: [], pursuit, observation: null, stop: false};
    }
    const at = addDays(now(input), days);
    return {
      actions: [{type: 'schedule_follow_up', at: at.toISOString()}],
      pursuit: {...pursuit, nextFollowUpAt: at},
      observation: null,
      stop: false,
    };
  }

  if (call.name === 'escalate') {
    const reason = asReason(call.arguments.reason) ?? 'unanswerable_question';
    const detail = str(call.arguments.detail);
    return {
      actions: [{type: 'escalate', reason, detail}],
      pursuit: {...pursuit, needsHumanReason: reason, nextFollowUpAt: null},
      observation: null,
      stop: true,
    };
  }

  if (call.name === 'mark_dead') {
    return {
      actions: [{type: 'mark_dead', reason: str(call.arguments.reason)}],
      pursuit: {...pursuit, stage: 'dead', nextFollowUpAt: null},
      observation: null,
      stop: true,
    };
  }

  return {actions: [], pursuit, observation: null, stop: false};
}

async function handleReply(input: TurnInput, ports: OutreachPorts): Promise<TurnResult> {
  const inbound = input.inbound;
  if (!inbound) {
    return {actions: [{type: 'noop', reason: 'unhandled'}], pursuit: snapshot(input.pursuit)};
  }

  const toCc = recipients(input.pursuit);
  const actions: TurnAction[] = [];
  let pursuit = snapshot(input.pursuit);
  const observations: string[] = [];

  for (let round = 0; round < 4; round++) {
    const completion = await ports.llm.complete({
      system: REPLY_SYSTEM,
      user: [
        pursuitContext(input.pursuit),
        `Thread id: ${input.pursuit.threadId ?? 'none'}`,
        'Thread:',
        ...input.thread.map(message => `- ${message.from}: ${message.body}`),
        `Latest from ${inbound.from}: ${inbound.body}`,
        ...observations,
      ].join('\n'),
      tools: REPLY_TOOLS,
    });

    if (completion.toolCalls.length === 0) {
      break;
    }

    let askedAvailability = false;
    for (const call of completion.toolCalls) {
      const applied = await applyTool(call, input, ports, toCc, pursuit);
      actions.push(...applied.actions);
      pursuit = applied.pursuit;
      if (applied.observation) {
        observations.push(applied.observation);
        askedAvailability = true;
      }
      if (applied.stop) {
        return {actions, pursuit};
      }
    }
    if (!askedAvailability) {
      break;
    }
  }

  if (actions.length === 0) {
    return {actions: [{type: 'noop', reason: 'unhandled'}], pursuit};
  }
  return {actions, pursuit};
}

export async function runTurn(input: TurnInput, ports: OutreachPorts): Promise<TurnResult> {
  if (input.alreadyProcessed) {
    return {actions: [{type: 'noop', reason: 'already_processed'}], pursuit: snapshot(input.pursuit)};
  }
  if (input.paused) {
    return {actions: [{type: 'noop', reason: 'paused'}], pursuit: snapshot(input.pursuit)};
  }
  if (input.pursuit.stage === 'dead') {
    return {actions: [{type: 'noop', reason: 'stopped'}], pursuit: snapshot(input.pursuit)};
  }
  if (input.pursuit.needsHumanReason) {
    return {actions: [{type: 'noop', reason: 'waiting_for_human'}], pursuit: snapshot(input.pursuit)};
  }
  if (input.trigger === 'reply' && isSelfSent(input)) {
    return {actions: [{type: 'noop', reason: 'self_sent'}], pursuit: snapshot(input.pursuit)};
  }

  switch (input.trigger) {
    case 'open':
      return openThread(input, ports);
    case 'follow_up':
      return followUpThread(input, ports);
    case 'reply':
      return handleReply(input, ports);
  }
}
