import type {ContactSnapshot} from '../db/schema/pursuits.ts';
import type {EnrichmentResult} from '../enrichment/service.ts';
import type {ListingAgent} from '../outreach/types.ts';

function mapRole(role: string | null): ListingAgent['role'] {
  if (role === 'primary' || role === 'secondary') {
    return role;
  }
  return 'unspecified';
}

export function contactSnapshotFromEnrichment(result: EnrichmentResult): ContactSnapshot | null {
  const withEmail = result.agents.filter(agent => agent.email);
  if (withEmail.length === 0) {
    // No individual mailbox, but enrichment may still have verified the firm's
    // own leasing or office route. That is a real way to reach whoever holds
    // the listing, and `tier` records that it is the brokerage, not the agent.
    const routes = result.contactRoutes.filter(route => route.email);
    if (routes.length === 0) {
      return null;
    }
    return {
      tier: routes[0]!.kind === 'leasing_team' ? 'building_leasing' : 'brokerage',
      sourceUrl: routes[0]!.sourceUrls[0] ?? result.brokerageUrl,
      contacts: routes.map(route => ({
        name: route.name,
        email: route.email,
        phone: route.phone,
        profileUrl: route.sourceUrls[0] ?? null,
        role: 'unspecified' as const,
      })),
    };
  }

  let tier: ContactSnapshot['tier'];
  switch (result.resolution) {
    case 'agents_verified':
      tier = 'listing_agents';
      break;
    case 'leasing_team_verified':
      tier = 'building_leasing';
      break;
    case 'brokerage_only':
      tier = 'brokerage';
      break;
    default:
      tier = result.agents.length > 0 ? 'listing_agents' : 'brokerage';
  }

  return {
    tier,
    sourceUrl: result.listingUrl ?? result.brokerageUrl,
    contacts: withEmail.map(agent => ({
      name: agent.name,
      email: agent.email,
      phone: agent.phone,
      profileUrl: agent.profileUrl,
      role: mapRole(agent.role),
    })),
  };
}

export function agentsForOutreach(snapshot: ContactSnapshot): ListingAgent[] {
  return snapshot.contacts.flatMap(contact => {
    if (!contact.email) {
      return [];
    }
    return [{
      name: contact.name ?? 'Agent',
      email: contact.email,
      role: contact.role === 'primary' || contact.role === 'secondary' ? contact.role : 'unspecified',
    }];
  });
}
