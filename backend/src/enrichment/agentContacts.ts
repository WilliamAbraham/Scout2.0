/**
 * Direct email lookup for a named listing agent: search `"<name>" "<brokerage>"`
 * on Tavily, collect every email on the closest pages, and keep the one that
 * belongs to this person at this brokerage. Tavily's page text drops `mailto:`
 * links, so the closest pages are also fetched directly (bounded) when the
 * search text alone gives nothing attributable.
 *
 * No model call. One Tavily credit per agent. Evidence is the page URL plus
 * the excerpt around the email, in the same shape the agent's contact stage
 * records, so downstream verification treats both sources alike.
 */

export type EmailEvidence = {
  value: string;
  evidence: {url: string; excerpt: string; sourceType: 'broker_profile'};
};

type TavilyResult = {url: string; title: string; content: string; raw_content?: string | null; score?: number};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const GENERIC_LOCAL = /^(?:info|contact|hello|leasing|rentals?|sales|office|admin|team|support|inquiries|marketing|press|careers|noreply|no-reply|privacy|legal|compliance|webmaster)$/i;
const GENERIC_DOMAIN = /(?:sentry|wixpress|example|w3\.org|schema\.org|googleapis|cloudflare|\.png$|\.jpg$|\.svg$)/i;
// Profile aggregators and social sites: their text rarely carries the email,
// and fetching them directly is blocked or pointless.
const SOCIAL_RE = /(?:linkedin|facebook|instagram|twitter|x\.com|tiktok|youtube|streeteasy|wikipedia)\./i;
const STOP_WORDS = /^(?:the|real|estate|realty|group|llc|inc|corp|nyc|new|york|brokerage|properties|of|and|co|company)$/;
// A page that never mentions real estate is a namesake, not this broker.
const CONTEXT_RE = /real estate|realty|broker|listing|apartment|rental|leasing|salesperson|properties/i;

function tokens(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
}

/**
 * Brokerage words worth matching. For page ranking the agent's own name is
 * excluded (a namesake's profile would otherwise score as the brokerage); for
 * email domains it is kept, because "DALLAL" really does live at dallalnewyork.com.
 */
function brokerageTokens(brokerage: string, name: string, {forDomain = false} = {}): string[] {
  const nameSet = new Set(tokens(name));
  const strong = tokens(brokerage).filter(t => !STOP_WORDS.test(t) && (forDomain || !nameSet.has(t)));
  if (strong.length > 0) return strong;
  // "REAL New York": nothing distinctive survives; fall back to the longer words.
  return tokens(brokerage).filter(t => t.length > 3 && (forDomain || !nameSet.has(t)));
}

/** How strongly a search result looks like this agent's page at this brokerage. */
export function scoreResult(result: TavilyResult, name: string, brokerage: string): number {
  const haystack = `${result.url} ${result.title} ${result.content}`.toLowerCase();
  const urlLower = result.url.toLowerCase();
  const nameTokens = tokens(name);
  const brokerage_ = brokerageTokens(brokerage, name);
  let score = 0;
  const nameHits = nameTokens.filter(t => haystack.includes(t)).length;
  score += nameHits === nameTokens.length ? 3 : nameHits;
  if (nameTokens.every(t => urlLower.includes(t))) score += 2;
  if (brokerage_.some(t => urlLower.includes(t))) score += 2;
  else if (brokerage_.some(t => haystack.includes(t))) score += 1;
  if (/[/?=](?:agents?|team|profile|our-team|people|staff|brokers?|managers?)\b/.test(urlLower)) score += 1;
  if (SOCIAL_RE.test(urlLower) || /(?:zillow|realtor|trulia|homes|renthop|linecity|datanyze|rocketreach|cityrealty)\./.test(urlLower)) score -= 2;
  return score;
}

function nameMatch(local: string, name: string): boolean {
  const parts = tokens(name);
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  return (last.length > 2 && local.includes(last))
    || (first.length > 2 && local.includes(first))
    || (first.length > 0 && last.length > 3 && local.startsWith(first[0]!) && local.includes(last.slice(0, 4)));
}

export type EmailCandidate = {value: string; index: number; nameMatch: boolean; brokerageDomain: boolean};

/** Every plausible personal address on a page, with what ties it to the agent. */
export function emailCandidates(text: string, name: string, brokerage: string): EmailCandidate[] {
  const brokerage_ = brokerageTokens(brokerage, name, {forDomain: true});
  const seen = new Set<string>();
  const out: EmailCandidate[] = [];
  for (const match of text.matchAll(EMAIL_RE)) {
    let value = match[0].toLowerCase();
    let [local = '', domain = ''] = value.split('@');
    // Text extraction can glue a preceding number onto the address ("Image 6mike@…").
    if (/^\d+[a-z]/.test(local) && (nameMatch(local.replace(/^\d+/, ''), name) || brokerage_.some(t => domain.includes(t)))) {
      local = local.replace(/^\d+/, ''); value = `${local}@${domain}`;
    }
    if (seen.has(value)) continue;
    seen.add(value);
    if (GENERIC_LOCAL.test(local) || GENERIC_DOMAIN.test(domain)) continue;
    out.push({value, index: match.index ?? 0, nameMatch: nameMatch(local, name), brokerageDomain: brokerage_.some(t => domain.includes(t))});
  }
  return out;
}

/** Bounded direct read of a page, returning its text with mailto targets kept. */
async function fetchPageText(url: string, fetcher: typeof fetch, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetcher(url, {
      headers: {'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', accept: 'text/html'},
      signal: AbortSignal.timeout(timeoutMs), redirect: 'follow',
    });
    if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel(); return null;
    }
    const html = (await response.text()).slice(0, 2_000_000);
    return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/mailto:([^"'\s>?]+)/gi, ' $1 ')
      .replace(/<[^>]+>/g, ' ').replace(/&#64;|&commat;/g, '@').replace(/\s+/g, ' ');
  } catch {
    return null;
  }
}

/** Rendered read through Firecrawl for sites that block plain HTTP clients. */
async function firecrawlPageText(url: string, apiKey: string, fetcher: typeof fetch, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetcher('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
      body: JSON.stringify({url, formats: ['markdown'], onlyMainContent: false}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {await response.body?.cancel(); return null;}
    const body = await response.json() as {data?: {markdown?: string; metadata?: {statusCode?: number}}};
    const status = body.data?.metadata?.statusCode;
    if (typeof body.data?.markdown !== 'string' || (status !== undefined && (status < 200 || status >= 300))) return null;
    return body.data.markdown.replace(/mailto:([^)\s"']+)/gi, ' $1 ').replace(/\s+/g, ' ');
  } catch {
    return null;
  }
}

export type AgentEmailLookup = {email: EmailEvidence | null; searchedUrl: string | null; note: string};

type Scored = {candidate: EmailCandidate; url: string; text: string; how: string; weight: number};

export async function findAgentEmail(
  agent: {name: string; brokerage: string},
  options: {apiKey: string; firecrawlKey?: string | undefined; fetch?: typeof fetch; log?: (message: string) => void; timeoutMs?: number},
): Promise<AgentEmailLookup> {
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const distinctive = agent.brokerage.split(/\s+/).find(part => !STOP_WORDS.test(part.toLowerCase()))
    ?? agent.brokerage.split(/\s+/)[0]
    ?? agent.brokerage;
  const query = `${agent.name} ${distinctive}`;
  const log = (message: string) => options.log?.(`tavily contact lookup ${query}: ${message}`);
  let body: {results?: TavilyResult[]};
  try {
    const response = await fetcher('https://api.tavily.com/search', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}`},
      body: JSON.stringify({query, max_results: 5, search_depth: 'basic', include_raw_content: true}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (!options.firecrawlKey) {
        return {email: null, searchedUrl: null, note: `Tavily search failed (HTTP ${response.status})`};
      }
      log(`Tavily HTTP ${response.status}; trying Firecrawl search`);
      const search = await fetcher('https://api.firecrawl.dev/v2/search', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${options.firecrawlKey}`},
        body: JSON.stringify({query, limit: 5}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!search.ok) {
        await search.body?.cancel();
        return {email: null, searchedUrl: null, note: `Tavily search failed (HTTP ${response.status})`};
      }
      const found = await search.json() as {data?: {web?: Array<{url?: string; title?: string; description?: string}>}};
      body = {results: (found.data?.web ?? []).flatMap(row => typeof row.url === 'string'
        ? [{url: row.url, title: row.title ?? '', content: row.description ?? ''}] : [])};
    } else {
      body = await response.json() as {results?: TavilyResult[]};
    }
  } catch (error) {
    return {email: null, searchedUrl: null, note: `Tavily search failed: ${error instanceof Error ? error.message.slice(0, 120) : 'unknown error'}`};
  }
  const results = (body.results ?? []).filter(r => typeof r.url === 'string' && /^https?:\/\//.test(r.url));
  if (results.length === 0) return {email: null, searchedUrl: null, note: `Tavily found nothing for ${query}`};

  const ranked = results.map(r => ({r, score: scoreResult(r, agent.name, agent.brokerage)})).sort((a, b) => b.score - a.score);
  log(`ranked ${ranked.map(({r, score}) => `${score}:${r.url}`).join(' | ')}`);
  const nameRe = new RegExp(tokens(agent.name).join('\\s+'), 'i');
  const scored: Scored[] = [];
  const consider = (r: TavilyResult, rank: number, pageScore: number, text: string, how: string) => {
    if (!CONTEXT_RE.test(text)) {log(`skip ${r.url}: no real-estate context`); return;}
    const candidates = emailCandidates(text, agent.name, agent.brokerage);
    for (const candidate of candidates) {
      // Attribution: the address carries the name; or it is at the brokerage's
      // own domain on a page naming the agent; or this is the closest link
      // naming the agent and it has exactly one personal-looking address.
      const attributable = candidate.nameMatch
        || (candidate.brokerageDomain && nameRe.test(text))
        || (rank === 0 && candidates.length === 1 && nameRe.test(text));
      if (!attributable) continue;
      scored.push({candidate, url: r.url, text, how, weight: (candidate.brokerageDomain ? 4 : 0) + (candidate.nameMatch ? 2 : 0) + Math.max(0, pageScore) / 10});
    }
  };

  // Pass 1: search text of every plausible result.
  for (const [rank, {r, score}] of ranked.entries()) {
    if (score < 1) break;
    consider(r, rank, score, `${r.content}\n${r.raw_content ?? ''}`, 'Tavily search text');
  }
  // Pass 2: only when nothing ties an address to both the name and the
  // brokerage, read the closest non-social pages directly for mailto links.
  // Brokerage sites often 403 a plain HTTP client; Firecrawl renders those.
  if (!scored.some(s => s.candidate.brokerageDomain)) {
    let fetched = 0;
    for (const [rank, {r, score}] of ranked.entries()) {
      if (score < 2 || fetched >= 3) break;
      if (SOCIAL_RE.test(r.url)) continue;
      fetched += 1;
      let text = await fetchPageText(r.url, fetcher, Math.min(timeoutMs, 15_000));
      let how = 'direct page read';
      if (!text && options.firecrawlKey) {
        text = await firecrawlPageText(r.url, options.firecrawlKey, fetcher, timeoutMs);
        how = 'Firecrawl page read';
      }
      log(`${how} ${r.url}: ${text ? `${text.length} chars` : 'failed'}`);
      if (text) consider(r, rank, score, text, how);
      if (scored.some(s => s.candidate.brokerageDomain)) break;
    }
  }
  scored.sort((a, b) => b.weight - a.weight);
  const best = scored[0];
  if (!best) return {email: null, searchedUrl: ranked[0]!.r.url, note: `No attributable email on the closest pages for ${query} (top: ${ranked[0]!.r.url})`};
  const {candidate, url, text, how} = best;
  return {
    email: {value: candidate.value, evidence: {
      url, sourceType: 'broker_profile',
      excerpt: text.slice(Math.max(0, candidate.index - 160), candidate.index + candidate.value.length + 80).replace(/\s+/g, ' ').trim(),
    }},
    searchedUrl: url,
    note: `Email read from ${url} (${how} for ${query})`,
  };
}
