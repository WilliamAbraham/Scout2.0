import {canonicalListingUrl} from './listingPage.ts';
import type {ContactRoute} from './sources.ts';

export interface EmailListing {
  listingUrl?: string;
  address: string;
  unit: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  brokerage: string;
  brokerageOfficeAddress: string;
  city: string;
}

export interface Agent {
  name: string;
  profileUrl: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  attributionEvidence: string;
  contactEvidence: string;
}

export interface ExtractedListing {
  address: string | null;
  unit: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  brokerage: string | null;
  status: string | null;
  listingEvidence: string;
  contradictions: string[];
  agents: Agent[];
}

export interface Contact extends Agent {
  sourceUrl: string;
  attributionSourceUrl: string;
  emailSourceUrl: string | null;
  phoneSourceUrl: string | null;
}

export interface EnrichmentResult {
  research?: {engine: 'enrichWithAgent'; model: string; listingStatus: string; reportedUsd: number | null; cacheHit: boolean};
  status: 'source_matched' | 'partial' | 'needs_review' | 'not_found' | 'error';
  execution: 'completed' | 'partial' | 'error' | 'budget_exhausted';
  input: EmailListing;
  brokerageUrl: string | null;
  listingUrl: string | null;
  agents: Contact[];
  candidateAgents: Contact[];
  sourceListing: ExtractedListing | null;
  rosterCompleteness: 'source_only' | 'partial' | 'unverified';
  outreachReady: boolean;
  checkedAt: string;
  issues: string[];
  warnings: string[];
  attempts: JsonObject[];
  contactRoutes: ContactRoute[];
  resolution: 'agents_verified' | 'leasing_team_verified' | 'brokerage_only' | 'owner_listed' | 'unresolved';
}

export interface EnrichmentOptions {
  cacheDir: string;
  maxCalls?: number;
  refresh?: boolean;
  cacheTtlMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface SearchHit {url: string; title: string; description: string}
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseEmailListing(value: unknown): EmailListing {
  if (!object(value)) throw new Error('Listing input must be an object');
  const parsed = {...value};
  if (typeof parsed.address === 'string' && parsed.unit === undefined) {
    const match = /^(.*?)\s+#([^#]+)$/.exec(parsed.address);
    if (match) {parsed.address = match[1]!.trim(); parsed.unit = match[2]!.trim();}
  }
  if (parsed.brokerageOfficeAddress === undefined || parsed.brokerageOfficeAddress === null) parsed.brokerageOfficeAddress = '';
  if (typeof parsed.brokerageOfficeAddress !== 'string') throw new Error('Invalid brokerageOfficeAddress');
  for (const key of ['address', 'unit', 'brokerage', 'city']) {
    if (typeof parsed[key] !== 'string' || !parsed[key].trim()) throw new Error(`Missing input field: ${key}`);
    parsed[key] = parsed[key].trim();
  }
  for (const key of ['price', 'bedrooms', 'bathrooms']) {
    if (typeof parsed[key] !== 'number' || !Number.isFinite(parsed[key]) || parsed[key] < 0 || (key === 'price' && parsed[key] === 0)) {
      throw new Error(`Invalid input field: ${key}`);
    }
  }
  const listingUrl = canonicalListingUrl(parsed.listingUrl);
  return {
    ...(listingUrl ? {listingUrl} : {}),
    address: String(parsed.address), unit: String(parsed.unit), brokerage: String(parsed.brokerage),
    brokerageOfficeAddress: String(parsed.brokerageOfficeAddress), city: String(parsed.city),
    price: Number(parsed.price), bedrooms: Number(parsed.bedrooms), bathrooms: Number(parsed.bathrooms),
  };
}

// NYC writes the same street both ways: an alert says "151 Eighth Avenue" and
// the listing says "151 8th Avenue". Spelled ordinals become their numeric form
// so the two compare equal.
const ORDINALS: Record<string, string> = {
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th',
  seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th', eleventh: '11th', twelfth: '12th',
};
const ABBREVIATIONS: Record<string, string> = {
  street: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', place: 'pl',
  east: 'e', west: 'w', north: 'n', south: 's',
};

export function normalizeAddress(value: string): string {
  return value.toLowerCase()
    .replace(/\b(street|avenue|road|boulevard|place|east|west|north|south)\b/g, word => ABBREVIATIONS[word]!)
    .replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\b/g, word => ORDINALS[word]!)
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normalizeUnit(value: string): string {
  return value.toUpperCase().replace(/^(?:APT\.?|UNIT|APARTMENT|#)\s*/i, '').trim();
}

/**
 * The alert's brokerage field carries a legal suffix the company's own site
 * usually omits ("Monday Morning Management LLC" against a homepage that says
 * "Monday Morning Management"), which otherwise fails site verification.
 */
export function brokerageIdentity(value: string): string {
  return normalizeAddress(value)
    .replace(/\b(llc|inc|incorporated|corp|corporation|ltd|limited|liability|llp|pllc|the)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Suite and floor designators are written differently on a company's own site
 * ("Ste 1202" against "Suite 1202"), so match on the street line alone.
 */
export function officeStreet(value: string): string {
  return value.split(',')[0]!
    .replace(/\s+(?:\d+(?:st|nd|rd|th)?\s+)?(?:ste|suite|fl|flr|floor|apt|apartment|unit|rm|room|#)\.?\s*[\w-]*$/i, '')
    .trim();
}

/**
 * Does this text name the alert's building? Building and catalogue pages often
 * carry an address range ("188-192 Sixth Avenue") for an alert naming a single
 * number, so the house number may be followed by the rest of a range.
 */
export function mentionsStreetAddress(text: string, address: string): boolean {
  const haystack = normalizeAddress(text), target = normalizeAddress(address);
  if (!target || (` ${haystack} `).includes(` ${target} `)) return true;
  const parts = /^(\d+)\s+(.+)$/.exec(target);
  if (!parts) return false;
  const street = parts[2]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${parts[1]!}\\b[\\d\\s]*\\s${street}\\b`).test(haystack);
}

/** One firm under two spellings: "Tesla Realty Group LLC" against its own page. */
export function sameBrokerage(a: string, b: string): boolean {
  return brokerageIdentity(a) === brokerageIdentity(b);
}

/** Does this mailbox spell the person, rather than the firm (`info@`, `hello@`)? */
export function personalMailbox(email: string, name: string): boolean {
  const local = email.split('@')[0]!.toLowerCase().replace(/[^a-z]/g, '');
  const parts = normalizeAddress(name).split(' ').filter(part => part.length >= 3);
  const [first = '', last = ''] = normalizeAddress(name).split(' ');
  if (!local || !parts.length) return false;
  return parts.some(part => local.includes(part))
    || (first.length >= 1 && last.length >= 3 && local === `${first[0]!}${last}`);
}

// Words too common across brokerage names to identify a domain as theirs.
const genericNameWords = new Set(['real', 'realty', 'realtors', 'estate', 'estates', 'property', 'properties',
  'group', 'management', 'company', 'partners', 'associates', 'homes', 'home', 'apartments', 'rentals',
  'leasing', 'york', 'city', 'nyc', 'brokerage', 'residential', 'international', 'global', 'services']);

/** A brokerage's own domain usually spells part of its name; a directory's never does. */
export function domainMatchesBrokerage(url: string, brokerage: string): boolean {
  try {
    const labels = new URL(url).hostname.replace(/^www\./, '').split('.');
    const slug = labels.slice(0, -1).join('');
    return brokerageIdentity(brokerage).split(' ')
      .some(word => word.length >= 4 && !genericNameWords.has(word) && slug.includes(word));
  } catch {return false;}
}

function containsEvidence(source: string, evidence: string): boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9@]+/g, ' ').trim();
  return evidence.trim().length > 0 && (` ${normalize(source)} `).includes(` ${normalize(evidence)} `);
}

// A search-index hit proposes a candidate; it never verifies the listing roster.
export function indexedHitSupportsAgent(input: EmailListing, hit: SearchHit, name: string): boolean {
  const title = normalizeAddress(hit.title);
  return (` ${title} `).includes(` ${normalizeAddress(input.address)} `)
    && title.split(' ').includes(normalizeUnit(input.unit).toLowerCase())
    && containsEvidence(hit.description, name);
}

export function parseExtraction(value: unknown): ExtractedListing {
  if (!object(value) || !Array.isArray(value.agents) || !Array.isArray(value.contradictions)
      || !value.contradictions.every(item => typeof item === 'string') || typeof value.listingEvidence !== 'string') {
    throw new Error('Invalid structured listing response');
  }
  for (const key of ['address', 'unit', 'brokerage', 'status']) {
    if (value[key] !== null && typeof value[key] !== 'string') throw new Error(`Invalid ${key}`);
  }
  for (const key of ['price', 'bedrooms', 'bathrooms']) {
    if (value[key] !== null && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)) throw new Error(`Invalid ${key}`);
  }
  for (const agent of value.agents) {
    if (!object(agent) || typeof agent.name !== 'string' || !agent.name.trim()
        || typeof agent.attributionEvidence !== 'string' || typeof agent.contactEvidence !== 'string') throw new Error('Invalid agent');
    for (const key of ['profileUrl', 'email', 'phone', 'role']) {
      if (agent[key] !== null && typeof agent[key] !== 'string') throw new Error(`Invalid agent ${key}`);
    }
  }
  return value as unknown as ExtractedListing;
}

export function verifyListing(input: EmailListing, extracted: ExtractedListing, markdown: string): string[] {
  const issues: string[] = [];
  if (!extracted.address || normalizeAddress(extracted.address) !== normalizeAddress(input.address)) issues.push('Street address mismatch or missing');
  if (!extracted.unit || normalizeUnit(extracted.unit) !== normalizeUnit(input.unit)) issues.push('Unit mismatch or missing');
  if (!extracted.brokerage || normalizeAddress(extracted.brokerage) !== normalizeAddress(input.brokerage)) issues.push('Listing brokerage mismatch or missing');
  if (!containsEvidence(markdown, extracted.listingEvidence)) issues.push('Listing evidence missing from source');
  const identity = normalizeAddress(extracted.listingEvidence);
  if (!(` ${identity} `).includes(` ${normalizeAddress(input.address)} `)
      || !identity.split(' ').includes(normalizeUnit(input.unit).toLowerCase())) issues.push('Listing evidence must identify the same address and unit together');
  if (extracted.status && !containsEvidence(markdown, extracted.status)) issues.push('Claimed rental status absent from source');
  if (!extracted.status || !/\b(for rent|available|active|rental)\b/i.test(extracted.status)
      || /\b(rented|off.?market|unavailable|withdrawn|expired|leased|sold|no longer)\b/i.test(extracted.status)) issues.push('Current rental status unsupported');
  if (extracted.bedrooms !== input.bedrooms || extracted.bathrooms !== input.bathrooms) issues.push('Bed/bath mismatch or missing');
  issues.push(...extracted.contradictions);
  return issues;
}

export function supportedAgents(extracted: ExtractedListing, markdown: string): {agents: Agent[]; issues: string[]} {
  const agents: Agent[] = [], issues: string[] = [];
  const seen = new Map<string, Agent>();
  for (const original of extracted.agents) {
    const agent = {...original};
    if (!containsEvidence(markdown, agent.name) || !containsEvidence(markdown, agent.attributionEvidence)
        || !containsEvidence(agent.attributionEvidence, agent.name)) {
      issues.push(`Unsupported attribution: ${agent.name}`); continue;
    }
    const emails = markdown.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
    if (agent.email && (!emails.some(email => email.toLowerCase() === agent.email!.toLowerCase())
        || !containsEvidence(markdown, agent.contactEvidence) || !containsEvidence(agent.contactEvidence, agent.name)
        || !agent.contactEvidence.toLowerCase().includes(agent.email.toLowerCase()))) {
      issues.push(`Unsupported email: ${agent.name}`); agent.email = null;
    }
    const digits = (phone: string) => phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    const phones = markdown.match(/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4}/g) ?? [];
    if (agent.phone && !phones.some(phone => digits(phone) === digits(agent.phone!))) {
      issues.push(`Unsupported phone: ${agent.name}`); agent.phone = null;
    }
    const key = agent.profileUrl ?? agent.name.toLowerCase().replace(/\s+/g, ' ').trim();
    const prior = seen.get(key);
    if (!prior) {agents.push(agent); seen.set(key, agent);}
    else if (prior.email !== agent.email || prior.phone !== agent.phone) issues.push(`Conflicting duplicate contact: ${agent.name}`);
  }
  return {agents, issues};
}
