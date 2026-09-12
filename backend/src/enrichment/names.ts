/**
 * Agent-name enrichment pipeline — implementation plan.
 *
 * Goal: find every agent explicitly attached to the current rental listing.
 * Email and phone enrichment are a separate, later pipeline.
 * This file is a plan only; it does not fetch pages or change the database.
 *
 * 1. Load listings and group by brokerage
 *    - Input: id, rentalId, brokerage, address, price, bedrooms, bathrooms,
 *      listingUrl, firstSeenAt, lastSeenAt from the listings table.
 *    - Keep the original brokerage string as evidence. Normalize whitespace
 *      and separate any trailing office address to resolve a brokerage key.
 *    - Maintain an explicit brokerage registry: aliases, verified website,
 *      rental search/catalog URL, and extraction adapter.
 *    - Keep REAL New York and R New York distinct; do not fuzzy-merge names.
 *    - Missing or unknown brokerages go to review until a website is verified.
 *
 * 2. Find candidate pages on that brokerage's website
 *    - Search the exact street address AND unit, restricted to its domain.
 *    - Also search the brokerage's own rental catalog: our pilot found Scout
 *      listings there that general web search missed.
 *    - Fetch/cache catalog pages once per brokerage batch, not per apartment.
 *    - Normalize street abbreviations and unit prefixes for matching, while
 *      preserving meaningful unit distinctions (3 vs 3R, 5A vs 5B).
 *    - Do not assume unusual unit aliases (THREE, 3/3, R56) are equivalent
 *      without evidence on the source page.
 *    - Search results discover URLs; a snippet alone is not a verified match.
 *    - Start with REAL NY. Add other brokerage adapters after inspecting
 *      representative pages. Select a search API before automating search.
 *
 * 3. Verify the current listing before extracting names
 *    - Require the same street address, unit, and listing brokerage.
 *    - Check rental status, dates, price, and beds/baths against Scout.
 *    - Price changes are possible: record differences rather than rejecting
 *      on price alone. Distinguish base rent from net-effective rent.
 *    - An exact address alone cannot distinguish an old rental campaign.
 *    - Reject clearly historical or wrong-unit pages. Conflicting unit text,
 *      uncertain recency, or multiple plausible matches require review.
 *    - A brokerage site can carry another firm's syndicated listings: verify
 *      the listing attribution rather than treating its domain as proof.
 *
 * 4. Extract all explicitly listed agents
 *    - Read the matched page's Listing Agents / Listed By section.
 *    - Prefer HTML parsing; use browser rendering only if the site needs it.
 *    - Capture every name and its linked profile URL, preserving page order.
 *    - Deduplicate repeated cards/links using profile URL, then normalized
 *      full name within the listing. Keep the original display name.
 *    - Record primary/secondary only when the source explicitly labels it;
 *      otherwise role = unspecified. First on the page does not mean primary.
 *    - Exclude navigation, suggested agents, unrelated team members, and
 *      generic inquiry contacts without explicit listing attribution.
 *    - Preserve team/company labels separately; do not invent personal names.
 *
 * 5. Return evidence and an honest completion status
 *    - Proposed result:
 *      { listingId, rentalId, brokerage, sourceUrl, checkedAt,
 *        status: matched | needs_review | not_found | blocked | error,
 *        agents: [{ name, profileUrl, role, sourceOrder }],
 *        evidence: { sourceAddress, sourceUnit, sourcePrice, sourceStatus,
 *                    sourceDate, attributionText, agentSectionText },
 *        issues: string[], rosterCompleteness: source_only | verified }
 *    - Source-only means all agents displayed by this source were captured;
 *      it does not prove the StreetEasy roster is identical or complete.
 *    - Use verified only after comparison with an authoritative full roster
 *      or a recorded manual check. Finding one agent is not completion proof.
 *    - Not-found, blocked, and errors remain distinct from a verified empty
 *      roster. Store attempted URLs and reasons so review is actionable.
 *
 * 6. Run in resumable batches
 *    - First write reviewable results to data/enrichment/names.json; design
 *      database persistence after the pilot establishes the output shape.
 *    - Key results by listing ID and retain evidence from previous attempts.
 *    - Cache successful page fetches, limit concurrency per brokerage, and
 *      use bounded retries/backoff for transient errors.
 *    - Mark access blocks for review instead of endlessly retrying them.
 *    - Do not overwrite a successful roster with a failed/empty attempt.
 *    - Recheck when brokerage changes, a new rental campaign appears, or the
 *      result expires; retain timestamps because agent assignments can change.
 *
 * 7. Validate before scaling
 *    - Pilot 20–30 Scout listings across the most common brokerages, including
 *      listings with multiple agents. Manually establish expected rosters.
 *    - Measure exact-listing matches, full-roster coverage, incorrect agents,
 *      review rate, requests per listing, and elapsed time.
 *    - Save representative HTML fixtures for meaningful adapter checks:
 *      multiple agents, duplicate links, wrong unit, old campaign, conflicting
 *      listing details, syndicated attribution, and blocked/empty responses.
 *
 * Pilot examples already observed:
 * - 448 West 19th Street #3CD: REAL NY lists Paul Morrissette and Luke Joyce;
 *   address, $8,500, 3 beds, and 2 baths matched the saved Scout email.
 *   https://www.realnyproperties.com/chelsea/apartment-for-rent/448-west-19th-street-3cd/220689
 * - 245 Eldridge Street #1R: REAL NY names the same two agents, but its heading
 *   and description disagree on the unit. This must require review.
 *   https://www.realnyproperties.com/lower-east-side/apartment-for-rent/245-eldridge-street-1r/220466
 * - 152 Ludlow Street #TH1: matching REAL NY catalog entry found, but detail
 *   fetch failed. This remains unresolved, not a listing with zero agents.
 *
 * Implementation order:
 * brokerage registry -> REAL NY discovery -> candidate verification -> name
 * extraction -> evidence/results writer -> pilot review -> more adapters.
 */
