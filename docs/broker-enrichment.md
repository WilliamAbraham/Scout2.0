# Broker enrichment

The only enrichment entry point is [`enrichWithAgent()`](enrichment/openrouter-agent.md), mapped for the worker through `enrichForPipeline`. Paid OpenRouter discovery runs when `SCOUT_ENRICHMENT_BUDGET_USD` is above zero. Otherwise the same function uses StreetEasy + Tavily (`findListingAgents`) and reviewed direct adapters as fallbacks. The old `BrokerEnrichment` directory-crawl engine is gone. See the [12-listing evaluation](enrichment/active-12-agent-test-2026-09-12.md) for measured coverage and limitations.

`service.ts` still holds listing types, `parseEmailListing`, and the identity/contact helpers the agent and fallbacks share. Direct adapters live in `sources.ts`. Firecrawl listing-page extraction lives in `listingAgents.ts`.

The [updated research](broker-enrichment-research-v2.md) and [Word report](broker-enrichment-research-v2.docx) explain an earlier five-listing benchmark. The [earlier observed summary](enrichment/118-mulberry-r4.observed.json) records the DALLAL run. These remain historical, not proof of complete market coverage.

## Run

Use Node 24+ and install dependencies from the repository root with `npm ci`. From that directory:

```sh
npm run enrich -- backend/fixtures/enrichment/118-mulberry-r4.json
npm run enrich -- backend/fixtures/enrichment/118-mulberry-r4.json --refresh --budget-usd 0.05
npm run test:enrichment -w backend
npm run typecheck:enrichment -w backend
```

The root `.env` may define `OPENROUTER_API_KEY`, `TAVILY_API_KEY` and `FIRECRAWL_API_KEY`. Never commit keys. Paid discovery requires an explicit `--budget-usd` (CLI) or `SCOUT_ENRICHMENT_BUDGET_USD` (worker). Default budget is `$0`, which skips OpenRouter and uses the StreetEasy + Tavily fallback.

Required input values are validated before network requests. A trailing `#unit` is split from `address` if `unit` is absent. Unit character order is never changed. Enrichment neither sends messages nor changes database records. Gmail ingestion, database persistence and a review interface are separate integration work.

`brokerageOfficeAddress` may be omitted, null, or empty; supplied non-string values are rejected. `Owner` is an explicit classification requiring no provider call. It yields no invented agent or email.

## Direct sources and contact routes

`sources.ts` contains reviewed organization aliases and readers, not property-specific contact answers. Canvas discovers detail IDs from its public catalog and follows the scripts to the public feed; it verifies exact street, city, unit, price, room counts and brokerage attribution. Centennial follows catalog, listing, profile and vCard links, corroborating contact fields. Its #5-6 source remains a review candidate for email #6-5. Next Step verifies a general office route through its homepage and contact page.

`contactRoutes` is separate from `agents`. Its `kind` is `leasing_team` or `brokerage_office`; its `relationship` is `exact_listing`, `unit_conflict`, or `brokerage`. Each record carries source URLs, evidence and the original retrieval timestamp. `resolution` distinguishes `agents_verified`, `leasing_team_verified`, `brokerage_only`, `owner_listed`, and `unresolved`. A current exact team route may set `outreachReady`; an office route, owner classification, or unit conflict cannot. A mailbox in an agent feed's name field is not a person.

Alert enrichment events now retain these routes for dashboard display even when no outreach snapshot is saved. Centennial also preserves its explicitly named catalog-footer office phone/email when exact-unit discovery fails. The UI labels office routes and unit conflicts, shows their original retrieval times and source links, and keeps recovered contacts separate from automated email recipients. Historical events that omitted routes need a source-backed repair to expose those channels.

Direct reads allow only reviewed HTTPS origins, validate each redirect, limit response size to 4 MB, and make at most 16 requests. They use a 30-second default timeout and a one-hour cache. `direct: false` on the agent skips adapters. Unknown brokerages skip this path and use paid discovery or the StreetEasy fallback. Provider failures preserve recovered routes.

## Method and evidence

1. Classify owners and run the reviewed direct adapter when available (Canvas, Centennial, Next Step).
2. If `SCOUT_ENRICHMENT_BUDGET_USD` is above zero, run paid OpenRouter discovery (and one recovery stage) for named listing brokers, then a paid contact stage only when Tavily has not already resolved every supported email.
3. If the budget is `$0`, or paid discovery finds no supported broker, read the StreetEasy listing through Firecrawl (`findListingAgents`) and look up each named person with Tavily (`"name" brokerage`, then a market pass). Agents credited to another firm are refused.
4. Validate names, emails and phones against source text. Never infer an email pattern. Names remain available when email/phone are missing.

Sources are retained separately: `attributionSourceUrl` supports the listing relationship; `emailSourceUrl` and `phoneSourceUrl` support each contact field. `sourceUrl` identifies the latest contact page, so consumers should use the field-specific URLs when contacts came from more than one page. Source excerpts and the original selected listing extraction remain available for review.

| Result | Meaning |
| --- | --- |
| `source_matched` | A source supports an exact listing and its recovered agents or assigned leasing team; inspect `resolution` and both contact arrays |
| `partial` | A matching source exists, but contacts, attribution or candidate checks are incomplete |
| `needs_review` | Only index attribution is available, or multiple matching sources disagree |
| `not_found` | Discovery did not establish a usable listing or candidate; this is not proof of an empty roster |
| `error` | A provider or processing error prevented resolution |

`execution` independently reports `completed`, `partial`, `error` or `budget_exhausted`. `rosterCompleteness: source_only` means the extracted roster is supported by the selected source, not independently proven exhaustive. `unverified` is used for index candidates. Only a completed source match can set `outreachReady: true`; index candidates cannot. Structured extraction can still miss details, and an apparently active page is not proof of a current rental campaign. Review date uncertainty and stale-page conflicts before operational use.

Default bounds: three brokerage pages, three catalog links, four candidate listing pages, twelve directory agents, 32 API requests, 45 seconds per request, and one retry for network failures or HTTP 429/500/502/503/504. Retry-After values above two seconds defer rather than cause repeated immediate requests. Failed target-page responses are not cached. Quota failures preserve already recovered candidates. Cache writes use atomic rename. These are application limits, not a monetary spending cap: calls can consume multiple credits.

## Observed result and validation

The September 12, 2026 final run returned `needs_review`, `execution: completed`, `outreachReady: false`, an empty `agents` array and these candidates:

| Candidate | Official email | Official phone |
| --- | --- | --- |
| Michael Dallal | mike@dallalnewyork.com | 516-673-7155 |
| Javier Cruz | javier@dallalnewyork.com | (347) 654-8962 |

Both profiles were read from DALLAL's website. Exact #R4 search results associated the names with the listing. An earlier #4R result involving Samantha Krot was excluded. The algorithm did not prove the complete #R4 roster. The successful final run reused fresh responses from the preceding live attempt and performed the remaining searches/profile read; it was not a fully uncached benchmark.

The tests cover source verification, co-agent handling, profile recovery, directory candidates, conflicting pages, malformed input/output, bounded requests, retries and cache behavior. `npm test` and `npm run typecheck:enrichment -w backend` pass. Full `npm run typecheck` remains blocked by pre-existing incompatible OAuth client types in `backend/src/gmail/auth.ts` at lines 81 and 90; this change does not modify Gmail authentication.

The follow-up fresh direct run recovered three contact routes: Canvas's exact listing email, Centennial's contact with a unit conflict, and Next Step's office contact. It used 13 direct requests and no provider credits. DALLAL's earlier named candidates are a separate result; the direct run did not reproduce them. The 76 enrichment tests and isolated typecheck pass. See the updated research for sources and limitations.

For production evaluation, label 20–30 listings across multiple brokerages and measure exact-unit precision, co-agent recall, email precision, review rate, latency and cost. Track reported provider credits separately; do not sum Tavily and Firecrawl credit units as equivalent. Extend the reviewed registry, campaign-date verification and durable job persistence based on those results.

## Primary references

- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) and [credits](https://docs.tavily.com/documentation/api-credits)
- [Firecrawl Scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape), [Search API](https://docs.firecrawl.dev/api-reference/endpoint/search) and [keyless limits](https://docs.firecrawl.dev/rate-limits#keyless-no-api-key)
- [LangChain structured output](https://docs.langchain.com/oss/javascript/langchain/models#structured-output) and [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Michael Dallal profile](https://dallal.realtymx.com/?page=agents&id=1), [Javier Cruz profile](https://dallal.realtymx.com/?page=agents&id=29) and [R4 attribution candidate](https://streeteasy.com/building/118-mulberry-street-new_york/r4)
