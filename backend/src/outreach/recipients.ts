import type {ListingAgent} from './types.ts';

/**
 * Every live send is redirected here instead of reaching the agent it was
 * written to. Outreach is addressed to real brokers found by enrichment, and a
 * demo must not cold-email them, so the redirect is the default rather than an
 * opt-in: `allowRealRecipients` on the sender is the only way past it.
 *
 * It is a mailbox separate from the one the agent sends from, so a redirected
 * send is visibly received rather than looking like a note to self.
 */
export const CONTROLLED_TEST_RECIPIENT =
  process.env.SCOUT_TEST_RECIPIENT?.trim() || 'williamja100@gmail.com';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function outreachRecipients(agents: ListingAgent[]): {to: string[]; cc: string[]} | null {
  const seen = new Set<string>();
  const reachable: Array<ListingAgent & {email: string}> = [];
  for (const agent of agents) {
    if (!agent.email || !isValidEmail(agent.email)) {
      continue;
    }
    const email = normalizeEmail(agent.email);
    if (seen.has(email)) {
      continue;
    }
    seen.add(email);
    reachable.push({...agent, email});
  }
  const primary = reachable.find(agent => agent.role === 'primary') ?? reachable[0];
  if (!primary) {
    return null;
  }
  return {
    to: [primary.email],
    cc: reachable.filter(agent => agent !== primary).map(agent => agent.email),
  };
}

export function redirectForTestSend(route: {to: string[]; cc: string[]}): {
  to: string[];
  cc: string[];
  intendedTo: string[];
  intendedCc: string[];
} {
  return {
    to: [CONTROLLED_TEST_RECIPIENT],
    cc: [],
    intendedTo: route.to,
    intendedCc: route.cc,
  };
}
