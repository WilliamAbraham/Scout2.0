import type {NeedsHumanReason, PursuitStage} from '../db/schema/enums.ts';

export type {NeedsHumanReason, PursuitStage};

export type AgentRole = 'primary' | 'secondary' | 'unspecified';

export type ListingAgent = {
  name: string;
  email: string | null;
  role: AgentRole;
};

export type Listing = {
  address: string;
  price: number;
  bedrooms: number | null;
  bathrooms: number | null;
  brokerage: string | null;
};

export type SearchProfile = {
  budgetMax: number | null;
  bedrooms: number | null;
  availabilityNote: string;
  freeText: string;
  learnedAnswers: Array<{question: string; answer: string}>;
};

export type Pursuit = {
  id: string;
  stage: PursuitStage;
  needsHumanReason: NeedsHumanReason | null;
  threadId: string | null;
  nextFollowUpAt: Date | null;
  followUpCount: number;
  listing: Listing;
  agents: ListingAgent[];
  profile: SearchProfile;
};

export type ThreadMessage = {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  body: string;
};

export type TurnTrigger = 'open' | 'follow_up' | 'reply';

export type TurnInput = {
  pursuit: Pursuit;
  trigger: TurnTrigger;
  inbound: ThreadMessage | null;
  thread: ThreadMessage[];
  alreadyProcessed: boolean;
  sendsToday: number;
  sendCap: number;
  now?: Date | undefined;
  paused?: boolean | undefined;
  mailboxEmail?: string | null | undefined;
};

export type ToolName =
  | 'check_availability'
  | 'book_tour'
  | 'send_reply'
  | 'send_packet'
  | 'escalate'
  | 'mark_dead'
  | 'schedule_follow_up';

export type LlmToolCall = {
  name: ToolName;
  arguments: Record<string, unknown>;
};

export type LlmCompletion = {
  text?: string | undefined;
  toolCalls: LlmToolCall[];
};

export type LlmClient = {
  complete(input: {
    system: string;
    user: string;
    tools: readonly ToolName[];
  }): Promise<LlmCompletion>;
};

export type SendMailInput = {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  threadId: string | null;
  /** Stable outbox identity, e.g. `open`, `follow_up:1`, `reply:<inboundId>`. */
  actionKey?: string | undefined;
  pursuitId?: string | undefined;
};

export type OutreachPorts = {
  llm: LlmClient;
  checkAvailability(window: {start: string; end: string}): Promise<{free: boolean}>;
  bookTour(event: {start: string; end: string; summary: string}): Promise<{eventId: string}>;
  sendMail(message: SendMailInput): Promise<{threadId: string; messageId: string}>;
  sendPacket(input: {threadId: string}): Promise<void>;
  reserveModelSpend?(kind: 'draft' | 'reply', estimateUsd: number): Promise<{ok: boolean}>;
};

export type TurnAction =
  | {type: 'send'; to: string[]; cc: string[]; subject: string; body: string; threadId: string | null}
  | {type: 'escalate'; reason: NeedsHumanReason; detail: string}
  | {type: 'mark_dead'; reason: string}
  | {type: 'book_tour'; start: string; end: string}
  | {type: 'send_packet'}
  | {type: 'schedule_follow_up'; at: string}
  | {type: 'noop'; reason: string};

export type TurnResult = {
  actions: TurnAction[];
  pursuit: {
    stage: PursuitStage;
    needsHumanReason: NeedsHumanReason | null;
    threadId: string | null;
    nextFollowUpAt: Date | null;
    followUpCount: number;
  };
};

export const FIRST_FOLLOW_UP_DAYS = 3;
export const SECOND_FOLLOW_UP_DAYS = 5;
export const MAX_FOLLOW_UPS = 2;
