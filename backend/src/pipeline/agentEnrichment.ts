import {enrichWithAgent} from '../enrichment/agent.ts';
import type {AgentEnrichmentResult, AgentOptions, ResearchedAgent} from '../enrichment/agent.ts';
import type {Contact, EmailListing, EnrichmentResult} from '../enrichment/service.ts';
import type {ContactRoute} from '../enrichment/sources.ts';

/** Adapt agent research to the worker contract without promoting review candidates. */
export function agentResultForPipeline(result: AgentEnrichmentResult): EnrichmentResult {
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(?:ny|llc|inc|ltd|corp|corporation)\b/g, '').replace(/\s+/g, ' ').trim();
  const placeholder = (name: string) => /^(?:(?:listing|listed|primary|contact|leasing) )?(?:agent|broker|team)(?: name)?$|^(?:unknown|not provided|not available|n\/a)$/i.test(name.trim());
  const organization = (agent: ResearchedAgent) => normalize(agent.name) === normalize(result.input.brokerage);
  const people = result.agents.filter(agent => !placeholder(agent.name) && !organization(agent));
  const matchesBrokerage = (agent: ResearchedAgent) => normalize(agent.brokerage) === normalize(result.input.brokerage);
  const supported = people.filter(agent => agent.attributionStatus === 'source_cited' && matchesBrokerage(agent));
  const candidates = people.filter(agent => agent.attributionStatus !== 'source_cited' || !matchesBrokerage(agent));
  const listedOrganization = result.agents.some(agent => organization(agent) && agent.attributionStatus === 'source_cited');
  const listingStatus = supported.length ? 'named_brokers' : listedOrganization ? 'team_only'
    : result.listingStatus === 'named_brokers' ? 'unresolved' : result.listingStatus;
  const mapAgent = (agent: ResearchedAgent, verified: boolean): Contact => ({
    name: agent.name, role: null,
    profileUrl: agent.attribution.sourceType === 'broker_profile' ? agent.attribution.url : null,
    email: verified ? agent.email?.value ?? null : null,
    phone: verified ? agent.phone?.value ?? null : null,
    attributionEvidence: agent.attribution.excerpt,
    contactEvidence: verified ? [agent.email?.evidence.excerpt, agent.phone?.evidence.excerpt].filter(Boolean).join('\n') : '',
    sourceUrl: agent.attribution.url, attributionSourceUrl: agent.attribution.url,
    emailSourceUrl: verified ? agent.email?.evidence.url ?? null : null,
    phoneSourceUrl: verified ? agent.phone?.evidence.url ?? null : null,
  });
  const contactRoutes: ContactRoute[] = [...result.directContacts];
  for (const office of result.officeContacts) {
    const email = office.email?.value ?? null, phone = office.phone?.value ?? null;
    if ((!email && !phone) || contactRoutes.some(route => route.name === office.name && route.email === email && route.phone === phone)) continue;
    contactRoutes.push({kind: 'brokerage_office', name: office.name, email, phone, relationship: 'brokerage',
      sourceUrls: [...new Set([office.email?.evidence.url, office.phone?.evidence.url].filter((url): url is string => !!url))],
      evidence: [office.email?.evidence.excerpt, office.phone?.evidence.excerpt].filter(Boolean).join('\n'), fetchedAt: result.checkedAt});
  }
  const owner = result.listingStatus === 'owner_listed' && /^owner$/i.test(result.input.brokerage.trim());
  const exactTeam = contactRoutes.some(route => route.relationship === 'exact_listing' && route.email);
  const execution = result.notes.some(note => /Budget stopped request/.test(note)) ? 'budget_exhausted' : result.execution;
  const outreachReady = !owner && execution === 'completed' && candidates.length === 0 &&
    (supported.length > 0 ? supported.every(agent => agent.email) : exactTeam);
  return {
    input: result.input, checkedAt: result.checkedAt, execution, outreachReady,
    status: outreachReady ? 'source_matched' : supported.length ? 'partial'
      : candidates.length || contactRoutes.length ? 'needs_review' : execution === 'error' ? 'error' : 'not_found',
    resolution: owner ? 'owner_listed' : supported.length ? 'agents_verified'
      : exactTeam ? 'leasing_team_verified' : contactRoutes.length ? 'brokerage_only' : 'unresolved',
    agents: supported.map(agent => mapAgent(agent, true)), candidateAgents: candidates.map(agent => mapAgent(agent, false)),
    contactRoutes, listingUrl: result.listingUrl, brokerageUrl: null, sourceListing: null,
    rosterCompleteness: supported.length && !candidates.length ? 'source_only' : 'unverified',
    issues: [...result.notes,
      ...result.agents.filter(agent => !people.includes(agent)).map(agent => `Excluded non-person label from listing agents: ${agent.name}`),
      ...people.filter(agent => !matchesBrokerage(agent)).map(agent => `Brokerage conflict; candidate only: ${agent.name} at ${agent.brokerage}`)],
    warnings: [result.evidencePolicy],
    attempts: result.stages.map(stage => ({provider: 'openrouter', stage: stage.stage, responseId: stage.responseId, usage: stage.usage})),
    research: {engine: 'enrichWithAgent', model: result.model, listingStatus,
      reportedUsd: result.cost.reportedUsd, cacheHit: result.cost.cacheHit},
  };
}

export async function enrichForPipeline(input: EmailListing, options: AgentOptions): Promise<EnrichmentResult> {
  return agentResultForPipeline(await enrichWithAgent(input, options));
}
