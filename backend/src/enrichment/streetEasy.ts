/**
 * StreetEasy is the only public source that names the person holding a given
 * rental. A brokerage's own site carries the exact unit only occasionally, and
 * the wider web reports the brokerage rather than the agent ("Listing by Voro
 * New York"), so the alert's own listing page is where a name comes from.
 *
 * The page yields a name, licence role, brokerage and profile URL. It does not
 * yield an email, and its phone sits behind a client-side reveal, so contact
 * details still have to be recovered from the brokerage.
 */
import {normalizeAddress, normalizeUnit} from './service.ts';
import type {EmailListing} from './service.ts';

/** The alert's listing page: who it names, and whether it is still live. */
export interface ListedBy {
  url: string;
  agents: ListedByAgent[];
  availability: string | null;
  issues: string[];
}

export interface ListedByAgent {
  name: string;
  profileUrl: string;
  role: string | null;
  brokerage: string | null;
  /** Whether the profile is the brokerage's own account rather than a person. */
  isCompanyAccount: boolean;
  evidence: string;
}

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
const profileLink = /^\[([^\]]{2,80})\]\((https:\/\/streeteasy\.com\/profile\/\d+[^)]*)\)/;
const roleLine = /licensed|broker|salesperson|associate|agent/i;
// Chrome that sits between the profile link and the brokerage name.
const furniture = /^(?:show phone number|save|share|hide|add notes|contact agent|message)/i;

/**
 * Only the alert's own listing and the profiles it links to are ever read.
 * `/rental/<id>` canonicalises to `/building/<slug>/<unit>`, so the redirect
 * target has to be admitted too or every read fails on its own redirect.
 */
export function permittedStreetEasyUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && url.hostname === 'streeteasy.com'
      && (/^\/rental\/\d+\/?$/.test(url.pathname)
        || /^\/building\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)
        || /^\/profile\/\d+(?:-[\w-]+)?\/?$/.test(url.pathname));
  } catch {return false;}
}

/**
 * The people in the page's "Listed by" block, in source order. The block ends
 * at the "Listing by <brokerage>, ... Broker" disclosure, which names the firm
 * rather than a person and must not be read as one.
 */
export function parseListedBy(markdown: string): ListedByAgent[] {
  const lines = markdown.split('\n')
    // Inline avatars are megabytes of data URI between the heading and the name.
    .map(line => line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim())
    .filter(line => line.length > 0);
  const start = lines.findIndex(line => /^listed by\b/i.test(line));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && /^listing by\b/i.test(line));
  const block = lines.slice(start + 1, end < 0 ? start + 40 : end);

  const agents: ListedByAgent[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < block.length; i++) {
    const link = profileLink.exec(block[i]!);
    if (!link) continue;
    const name = compact(link[1]!), profileUrl = link[2]!;
    if (!permittedStreetEasyUrl(profileUrl) || seen.has(profileUrl)) continue;
    seen.add(profileUrl);
    // Role and brokerage follow the link, separated by reveal/save controls.
    let role: string | null = null, brokerage: string | null = null;
    for (let j = i + 1; j < Math.min(i + 6, block.length); j++) {
      const line = block[j]!;
      if (profileLink.test(line)) break;
      if (furniture.test(line)) continue;
      if (!role && roleLine.test(line) && line.length <= 60) {role = line; continue;}
      if (role && !brokerage && line.length <= 80) {brokerage = line; break;}
    }
    agents.push({name, profileUrl, role, brokerage,
      isCompanyAccount: !!brokerage && normalizeAddress(name) === normalizeAddress(brokerage),
      evidence: compact([name, role, brokerage].filter(Boolean).join(' — '))});
  }
  return agents;
}

/**
 * The page must be this apartment before its roster means anything. Reasons
 * are returned rather than thrown so a caller can report exactly what differed.
 */
export function verifyStreetEasyListing(input: EmailListing, markdown: string): string[] {
  const issues: string[] = [];
  const text = normalizeAddress(markdown);
  const identity = `${normalizeAddress(input.address)} ${normalizeUnit(input.unit).toLowerCase()}`;
  if (!(` ${text} `).includes(` ${identity} `)) issues.push('StreetEasy page does not show this address and unit together');
  const prices = [...markdown.matchAll(/\$\s?([\d,]{3,})/g)].map(match => Number(match[1]!.replaceAll(',', '')));
  if (!prices.includes(input.price)) issues.push(`StreetEasy page does not show the alert price ${input.price}`);
  return issues;
}

/** A delisted or rented page still names the agent; the caller should know. */
export function listingAvailability(markdown: string): string | null {
  const match = /\b(Delisted|No longer available|Rented|In Contract)\b[^\n]{0,24}/i.exec(markdown);
  return match ? compact(match[0]) : null;
}
