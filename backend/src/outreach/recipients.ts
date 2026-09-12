import type {ListingAgent} from './types.ts';

export const CONTROLLED_TEST_RECIPIENT = 'williamja100@gmail.com';

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
