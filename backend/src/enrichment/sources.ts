import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {load} from 'cheerio';
import {normalizeAddress, normalizeUnit} from './service.ts';
import type {EmailListing, EnrichmentOptions, EnrichmentResult} from './service.ts';

export interface ContactRoute {
  kind: 'leasing_team' | 'brokerage_office';
  name: string;
  email: string | null;
  phone: string | null;
  relationship: 'exact_listing' | 'unit_conflict' | 'brokerage';
  sourceUrls: string[];
  evidence: string;
  fetchedAt: string;
}
type DirectResult = Pick<EnrichmentResult, 'status' | 'execution' | 'resolution' | 'brokerageUrl' | 'listingUrl' | 'contactRoutes' | 'issues' | 'warnings' | 'attempts' | 'outreachReady' | 'rosterCompleteness'>;
type Page = {url: string; body: string; fetchedAt: string};
type Reader = (url: string) => Promise<Page>;
const compact = (s: string) => s.replace(/\s+/g, ' ').trim();
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const amount = (v: unknown) => typeof v === 'number' ? v : typeof v === 'string' && /\d/.test(v) ? Number(v.replace(/[^\d.]/g, '')) : NaN;
const email = (v: unknown): string | null => typeof v === 'string' && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.trim()) ? v.trim() : null;

export function businessPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  // NANP syntax plus common placeholders. This is syntax validation, not a reachability check.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits) || /^(\d)\1{9}$/.test(digits) || digits === '2345678901') return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Curated organization identities, not listing/agent answers. Extend only after
// reviewing primary company evidence. No fuzzy match to a different brokerage.
const registry = [
  {names: ['canvas property group'], home: 'https://canvaspg.com/', adapter: 'canvas'},
  {names: ['centennial properties ny'], home: 'https://centpropny.com/', adapter: 'centennial'},
  {names: ['next step realty new york llc', 'the next step realty new york llc', 'next step realty'], home: 'https://www.thenextsteprealty.com/', adapter: 'nextstep'},
] as const;
const allowedHosts = new Set(['canvaspg.com', 'mc.wlep1.com', 'centpropny.com', 'www.centpropny.com', 'www.thenextsteprealty.com', 'thenextsteprealty.com']);
export function permittedDirectUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443')
      && allowedHosts.has(u.hostname) && (u.hostname !== 'mc.wlep1.com' || u.pathname.startsWith('/api/ajax/canvas/'));
  } catch {return false;}
}

function reader(options: EnrichmentOptions, attempts: DirectResult['attempts']): Reader {
  let calls = 0;
  return async (url: string) => {
    if (!permittedDirectUrl(url)) throw new Error('Direct source outside verified registry');
    const key = createHash('sha256').update(`direct-v1:${url}`).digest('hex');
    const file = path.join(options.cacheDir, `${key}.json`);
    if (!options.refresh) {
      try {
        const cached: unknown = JSON.parse(await readFile(file, 'utf8'));
        if (record(cached) && cached.url === url && typeof cached.body === 'string' && typeof cached.fetchedAt === 'string'
          && Date.now() - Date.parse(cached.fetchedAt) >= 0 && Date.now() - Date.parse(cached.fetchedAt) < (options.cacheTtlMs ?? 3_600_000)) {
          attempts.push({provider: 'direct', url, cached: true, fetchedAt: cached.fetchedAt});
          return cached as Page;
        }
      } catch (error) {if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
    }
    let next = url;
    for (let hop = 0; hop <= 3; hop++) {
      if (!permittedDirectUrl(next)) throw new Error('Direct source redirected outside verified registry');
      if (++calls > Math.min(options.maxCalls ?? 16, 16)) throw new Error('Direct source request budget exhausted');
      const began = Date.now(), fetchedAt = new Date().toISOString();
      const attempt: Record<string, unknown> = {provider: 'direct', url: next, cached: false, fetchedAt}; attempts.push(attempt);
      const response = await (options.fetch ?? fetch)(next, {redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)});
      attempt.httpStatus = response.status; attempt.durationMs = Date.now() - began;
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new Error('Direct redirect missing location');
        next = new URL(location, next).href; continue;
      }
      if (!response.ok) {await response.body?.cancel(); throw new Error(`Direct source HTTP ${response.status}`);}
      if (!response.body) throw new Error('Direct source has no body');
      const stream = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const {done, value} = await stream.read(); if (done) break;
        size += value.byteLength;
        if (size > 4_000_000) {await stream.cancel(); throw new Error('Direct source response too large');}
        chunks.push(value);
      }
      const page = {url, body: Buffer.concat(chunks).toString('utf8'), fetchedAt};
      await mkdir(options.cacheDir, {recursive: true});
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(page)); await rename(temporary, file);
      return page;
    }
    throw new Error('Too many direct source redirects');
  };
}

function linkedScript(html: string, pageUrl: string, suffix: string): string {
  const $ = load(html);
  const raw = $('script[src]').toArray().map(el => $(el).attr('src')!.trim()).find(src => src.endsWith(suffix));
  if (!raw) throw new Error(`Expected linked source script missing: ${suffix}`);
  return new URL(raw, pageUrl).href;
}

export function parseCanvasListing(value: unknown, input: EmailListing, sourceUrls: string[], fetchedAt: string): {routes: ContactRoute[]; issues: string[]; warnings: string[]} {
  if (!record(value) || !record(value.Location) || !record(value.Details) || !Array.isArray(value.Agents)) throw new Error('Canvas feed schema changed');
  const loc = value.Location, details = value.Details;
  const issues: string[] = [], warnings: string[] = [];
  if (typeof loc.Address !== 'string' || normalizeAddress(loc.Address) !== normalizeAddress(input.address)) issues.push('Canvas street mismatch');
  if (typeof loc.Apartment !== 'string' || normalizeUnit(loc.Apartment) !== normalizeUnit(input.unit)) issues.push('Canvas unit mismatch');
  if (typeof loc.City !== 'string' || normalizeAddress(loc.City) !== normalizeAddress(input.city)) issues.push('Canvas city mismatch');
  if (amount(details.Bedrooms) !== input.bedrooms || amount(details.Bathrooms) !== input.bathrooms) issues.push('Canvas bed/bath mismatch');
  if (typeof details.Description !== 'string' || !details.Description.includes('Canvas Property Group is the exclusive broker/agent')) issues.push('Canvas brokerage attribution absent');
  if (amount(details.Price) !== input.price) issues.push('Canvas price differs from email; campaign review required');
  if (issues.length) return {routes: [], issues, warnings};
  const routes: ContactRoute[] = [];
  for (const agent of value.Agents) {
    if (!record(agent)) {issues.push('Malformed Canvas agent record'); continue;}
    const address = email(agent.Email), phone = businessPhone(agent.PhoneNumber ?? agent.phone);
    if ((agent.PhoneNumber || agent.phone) && !phone) warnings.push('Rejected invalid or placeholder phone in Canvas feed');
    if (!address) {issues.push('Canvas agent record has no valid email'); continue;}
    // A mailbox in Name is a team route, never a fabricated person.
    if (typeof agent.Name !== 'string' || (agent.Name !== agent.Email && !/leasing|canvas/i.test(agent.Name))) {
      issues.push('Canvas named-person record requires agent extraction'); continue;
    }
    routes.push({kind: 'leasing_team', name: agent.Name === agent.Email ? 'Canvas listing contact' : agent.Name,
      email: address, phone, relationship: 'exact_listing', sourceUrls, fetchedAt,
      evidence: JSON.stringify({Location: loc, Price: details.Price, Agent: agent})});
  }
  return {routes, issues, warnings};
}

async function canvas(input: EmailListing, get: Reader, result: DirectResult) {
  const catalog = await get('https://canvaspg.com/luxury-rentals/');
  const script = await get(linkedScript(catalog.body, catalog.url, '/js/canvas/alllisting.js'));
  const catalogUrl = 'https://mc.wlep1.com/api/ajax/canvas/property';
  if (!script.body.includes(catalogUrl)) throw new Error('Canvas catalogue feed no longer linked');
  const feed = await get(catalogUrl), rows: unknown = JSON.parse(feed.body);
  if (!record(rows) || typeof rows.html !== 'string') throw new Error('Canvas catalogue schema changed');
  const $ = load(rows.html), candidates: string[] = [];
  for (const el of $('.unit').toArray()) {
    const card = $(el);
    if (normalizeAddress(card.find('.unit-address').text()) !== normalizeAddress(input.address)) continue;
    const href = card.find('a.unit-link').attr('href'); if (href) candidates.push(new URL(href, catalog.url).href);
  }
  const unique = [...new Set(candidates)];
  if (unique.length > 4) {result.issues.push('Canvas candidate page budget exceeded'); return;}
  let exactMatches = 0;
  for (const url of unique) {
    const page = await get(url), js = await get(linkedScript(page.body, page.url, '/js/canvas/singlelisting.js'));
    const prefix = 'https://mc.wlep1.com/api/ajax/canvas/single?propertyid=';
    if (!js.body.includes(prefix)) throw new Error('Canvas detail feed no longer linked');
    const id = new URL(url).searchParams.get('propertyid');
    if (!id || !/^\d+$/.test(id)) throw new Error('Invalid Canvas property id');
    const detail = await get(prefix + id), data: unknown = JSON.parse(detail.body);
    const parsed = parseCanvasListing(data, input, [catalog.url, script.url, feed.url, url, js.url, detail.url], detail.fetchedAt);
    if (parsed.routes.length) {
      exactMatches++; result.contactRoutes.push(...parsed.routes); result.listingUrl = url;
      result.issues.push(...parsed.issues); result.warnings.push(...parsed.warnings);
    } else result.issues.push(`${url}: ${parsed.issues.join('; ')}`);
  }
  if (exactMatches === 1 && result.contactRoutes.length && !result.issues.some(s => /Malformed|requires agent|no valid email/.test(s))) {
    result.status = 'source_matched'; result.resolution = 'leasing_team_verified';
    result.outreachReady = true; result.rosterCompleteness = 'source_only';
  } else if (exactMatches > 1) {result.status = 'needs_review'; result.issues.push('Multiple matching Canvas source pages require review');}
  if (!exactMatches) result.issues.push('No exact Canvas listing found in active catalogue');
}

export function parseVcard(text: string): {name: string | null; email: string | null; phone: string | null} {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const field = (name: string) => new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, 'im').exec(unfolded)?.[1]?.trim() ?? null;
  const tel = /^TEL;[^\n]*WORK[^\n]*VOICE[^:]*:(.*)$/im.exec(unfolded)?.[1]?.trim();
  return {name: field('FN'), email: email(field('EMAIL')), phone: businessPhone(tel)};
}

async function centennial(input: EmailListing, get: Reader, result: DirectResult) {
  const catalog = await get('https://centpropny.com/index.cfm?page=properties'), $ = load(catalog.body);
  const footer = compact($('footer').text());
  const officePhone = businessPhone(footer.match(/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/)?.[0]);
  const officeEmail = email($('footer a[href^="mailto:"]').first().attr('href')?.slice(7));
  if (footer.includes('Centennial Properties NY') && (officePhone || officeEmail)) {
    result.contactRoutes.push({kind: 'brokerage_office', name: 'Centennial Properties NY',
      email: officeEmail, phone: officePhone, relationship: 'brokerage',
      sourceUrls: [catalog.url], evidence: footer, fetchedAt: catalog.fetchedAt});
    result.status = 'needs_review'; result.resolution = 'brokerage_only';
  }
  const matches: Array<{url: string; unit: string}> = [];
  for (const el of $('.property-card').toArray()) {
    const card = $(el), title = compact(card.find('h3').text()), parts = /^(.*?)\s*,?\s*#(.+)$/.exec(title);
    if (!parts || normalizeAddress(parts[1]!) !== normalizeAddress(input.address)) continue;
    if (!/available now/i.test(card.find('.mx-available').text())) continue;
    const href = card.find('h3 a').attr('href'); if (!href) continue;
    const specs = compact(card.find('.bedrooms').text());
    if (Number(/([\d.]+) BR/.exec(specs)?.[1]) !== input.bedrooms || Number(/([\d.]+) BT/.exec(specs)?.[1]) !== input.bathrooms) continue;
    if (amount(card.find('.price > span').first().text()) !== input.price) continue;
    matches.push({url: new URL(href, catalog.url).href, unit: parts[2]!.trim()});
  }
  const exact = matches.filter(row => normalizeUnit(row.unit) === normalizeUnit(input.unit));
  const selected = exact.length ? exact : matches;
  if (selected.length !== 1) {result.issues.push('No unique Centennial candidate on first catalogue page; further discovery required'); return;}
  const candidate = selected[0]!, page = await get(candidate.url), detail = load(page.body);
  // Verify again on the detail page; a catalogue link alone is insufficient.
  const heading = compact(detail('h1').first().text());
  const detailIdentity = /^(.*?)\s*,?\s*#(.+)$/.exec(heading);
  if (!detailIdentity || normalizeAddress(detailIdentity[1]!) !== normalizeAddress(input.address)
    || normalizeUnit(detailIdentity[2]!) !== normalizeUnit(candidate.unit)) throw new Error('Centennial detail identity changed');
  detail('script,style').remove();
  detail('p,div,h1,h2,h3').append(' ');
  const text = compact(detail('body').text());
  const detailPrice = Number(/\$\s*([\d,]+)/.exec(text)?.[1]?.replaceAll(',', ''));
  const detailBeds = Number(/([\d.]+)\s*Beds?\b/i.exec(text)?.[1]), detailBaths = Number(/([\d.]+)\s*Baths?\b/i.exec(text)?.[1]);
  if (detailPrice !== input.price || detailBeds !== input.bedrooms || detailBaths !== input.bathrooms) throw new Error('Centennial detail price or room count changed');
  const attribution = detail('.agent').filter((_, el) => compact(detail(el).find('.name').text()) === 'Centennial Properties').first();
  const profileHref = attribution.find('.name a').attr('href');
  if (!profileHref) throw new Error('Centennial listing team attribution missing');
  const profile = await get(new URL(profileHref, page.url).href), profileDoc = load(profile.body);
  const vcardHref = profileDoc('a[href]').toArray().map(el => profileDoc(el).attr('href')!).find(href => /\.vcf$/i.test(href));
  if (!vcardHref) throw new Error('Centennial contact card missing');
  const vcard = await get(new URL(vcardHref, profile.url).href), contact = parseVcard(vcard.body);
  if (contact.name !== 'Centennial Properties' || !contact.email) throw new Error('Centennial contact identity mismatch');
  if (detail('input[name="agentEmail"]').attr('value') !== contact.email) throw new Error('Centennial listing and vCard email disagree');
  const directPhone = businessPhone(attribution.find('.phone').text());
  if (contact.phone !== directPhone) throw new Error('Centennial listing and contact card disagree');
  const conflict = !exact.length;
  result.listingUrl = page.url;
  result.contactRoutes = [{kind: 'leasing_team', name: contact.name, email: contact.email, phone: contact.phone,
    relationship: conflict ? 'unit_conflict' : 'exact_listing', sourceUrls: [catalog.url, page.url, profile.url, vcard.url],
    evidence: `${heading}; Listing Agent ${compact(attribution.text())}; ${vcard.body}`, fetchedAt: vcard.fetchedAt}];
  result.status = conflict ? 'needs_review' : 'source_matched';
  result.resolution = conflict ? 'brokerage_only' : 'leasing_team_verified';
  result.outreachReady = !conflict; result.rosterCompleteness = conflict ? 'unverified' : 'source_only';
  if (conflict) result.issues.push(`Unit conflict: email #${input.unit}; brokerage #${candidate.unit}. No automatic unit reversal.`);
  result.warnings.push('Contact card office address may be stale; only corroborated team identity and phone are used');
}

async function nextstep(get: Reader, result: DirectResult) {
  const home = await get('https://www.thenextsteprealty.com/');
  const $ = load(home.body), link = $('a[href]').toArray().map(el => $(el).attr('href')!).find(href => /^https:\/\/www\.thenextsteprealty\.com\/contact\/?$|^\/contact\/?$/.test(href));
  if (!link || !normalizeAddress($('body').text()).includes('the next step realty new york llc')) throw new Error('Next Step company identity no longer verified');
  const page = await get(new URL(link, home.url).href), contact = load(page.body);
  const mail = contact('a[href^="mailto:"]').toArray().map(el => email(contact(el).attr('href')!.slice(7).split('?')[0])).find(Boolean);
  const text = compact(contact('body').text());
  const phone = businessPhone(/For general inquiries:\s*Tel:\s*([+\d(). -]+)/i.exec(text)?.[1]);
  if (!mail || !mail.endsWith('@nextstepny.com') || !phone || !normalizeAddress(text).includes('4 e 8th st')) throw new Error('Next Step contact identity incomplete');
  result.contactRoutes.push({kind: 'brokerage_office', name: 'Next Step Realty client services', email: mail, phone,
    relationship: 'brokerage', sourceUrls: [home.url, page.url], fetchedAt: page.fetchedAt,
    evidence: `${mail}; ${phone}; 4 East 8th Street`});
  result.status = 'needs_review'; result.resolution = 'brokerage_only';
  result.issues.push('Office contact verified; no listing roster established by the company contact page');
}

export async function resolveDirect(input: EmailListing, options: EnrichmentOptions): Promise<DirectResult | undefined> {
  const result: DirectResult = {status: 'not_found', execution: 'completed', resolution: 'unresolved', brokerageUrl: null, listingUrl: null,
    contactRoutes: [], issues: [], warnings: [], attempts: [], outreachReady: false, rosterCompleteness: 'unverified'};
  if (normalizeAddress(input.brokerage) === 'owner') {
    return {...result, status: 'needs_review', resolution: 'owner_listed', issues: ['Email explicitly says Owner. No broker identity or public contact supplied; retain original listing inquiry route.']};
  }
  if (normalizeAddress(input.city) !== 'new york') return undefined;
  const business = registry.find(row => (row.names as readonly string[]).includes(normalizeAddress(input.brokerage)));
  if (!business) return undefined;
  result.brokerageUrl = business.home;
  const get = reader(options, result.attempts);
  try {
    if (business.adapter === 'canvas') await canvas(input, get, result);
    if (business.adapter === 'centennial') await centennial(input, get, result);
    if (business.adapter === 'nextstep') await nextstep(get, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.issues.push(message); result.status = 'needs_review'; result.execution = message.includes('budget exhausted') ? 'budget_exhausted' : 'partial';
    result.outreachReady = false;
  }
  return result;
}
