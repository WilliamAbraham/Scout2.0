# Broker enrichment

The standalone TypeScript service takes the fields extracted from a listing email and returns every supported listing agent, public business contacts, source evidence and a review status. Tavily is the preferred search provider when configured. Firecrawl renders pages and performs structured extraction, and supplies search when no Tavily key is present. No LangChain or OpenAI dependency is required.

The [Word report](broker-enrichment-findings.docx) contains the findings and technology assessment. The [dated observed summary](enrichment/118-mulberry-r4.observed.json) records the real DALLAL run. The original architecture plan in `backend/src/enrichment/names.ts` remains useful context; this service is the implemented, bounded v1.

## Run

Use Node 24+ and install dependencies from the repository root with `npm ci`. From that directory:

```sh
npm run enrich -- backend/fixtures/enrichment/118-mulberry-r4.json
npm run enrich -- backend/fixtures/enrichment/118-mulberry-r4.json --refresh --max-calls 32
npm run test:enrichment -w backend
npm run typecheck:enrichment -w backend
```

The root `.env` may define `TAVILY_API_KEY` and `FIRECRAWL_API_KEY`. Never commit keys. The small live test used Firecrawl keyless access, which has per-IP request and credit limits. Use authenticated capacity for sustained use. The Tavily adapter is covered by a simulated API test; no live Tavily request was made without a key.

Options:

| CLI option | Behavior |
| --- | --- |
| `--refresh` | Bypass the local one-hour cache; Firecrawl requests also set `maxAge: 0` |
| `--max-calls N` | Cap outbound provider requests, including retries; default 32 |
| `--no-index-fallback` | Stop after first-party listing discovery |
| `--output path` | Write JSON to a chosen path instead of the default results directory |

Default output is `data/enrichment/results/<input-name>.result.json`; raw responses are in `data/enrichment/cache/`. Both are gitignored. Preserve dated outputs with `--output` when comparing runs. The default filename is replaced on rerun. CLI exit code is 1 for invalid input, provider errors or incomplete execution, and 0 for completed searches, including `needs_review` and `not_found`. Exit code 0 alone does not authorize outreach: inspect `outreachReady`.

## Service interface

```ts
import {BrokerEnrichment} from './backend/src/enrichment/service.ts';

const service = new BrokerEnrichment({
  cacheDir: './data/enrichment/cache',
  // tavilyKey and firecrawlKey may be supplied here from environment variables.
});
const result = await service.run({
  address: '118 Mulberry Street', unit: 'R4', price: 7495,
  bedrooms: 3, bathrooms: 1, brokerage: 'DALLAL',
  brokerageOfficeAddress: '260 Madison Avenue, New York, NY 10016',
  city: 'New York',
});
```

Required input values are validated before network requests. A trailing `#unit` is split from `address` if `unit` is absent. Unit character order is never changed. A separate instance is required for concurrent runs; a reused instance resets its budget and attempt log between runs. The service neither sends messages nor changes database records. Gmail ingestion, database persistence and a review interface are separate integration work.

## Method and evidence

1. Search for the brokerage and verify its name and office street address on a fetched website.
2. Search that domain for the exact address and unit, supplementing results with relevant catalog links.
3. Read candidate detail pages and extract all explicitly attached agents. Validate source evidence, exact unit, street, brokerage, beds/baths, rental status and reported contradictions. A price change is a warning. Conflicting matching-page rosters require review.
4. Validate agent names, email syntax, contact excerpts and phone presence. Follow explicitly linked profiles to recover missing contacts. On a profile with a matching name heading, reconstruct a contiguous source excerpt when the model rearranges its quotation. Never infer an email pattern.
5. If no verified detail page exists, read the official team directory and test a bounded set of names against exact-address/unit search results. These contacts always remain `candidateAgents`. Portal URLs are never scraped by this workflow.

Sources are retained separately: `attributionSourceUrl` supports the listing relationship; `emailSourceUrl` and `phoneSourceUrl` support each contact field. `sourceUrl` identifies the latest contact page, so consumers should use the field-specific URLs when contacts came from more than one page. Source excerpts and the original selected listing extraction remain available for review.

| Result | Meaning |
| --- | --- |
| `source_matched` | A source page supports the listing and its recovered roster; each recovered person has a supported email |
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

For production evaluation, label 20–30 listings across multiple brokerages and measure exact-unit precision, co-agent recall, email precision, review rate, latency and cost. Track reported provider credits separately; do not sum Tavily and Firecrawl credit units as equivalent. Add a brokerage registry, campaign-date verification and durable job persistence based on those results.

## Primary references

- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) and [credits](https://docs.tavily.com/documentation/api-credits)
- [Firecrawl Scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape), [Search API](https://docs.firecrawl.dev/api-reference/endpoint/search) and [keyless limits](https://docs.firecrawl.dev/rate-limits#keyless-no-api-key)
- [LangChain structured output](https://docs.langchain.com/oss/javascript/langchain/models#structured-output) and [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Michael Dallal profile](https://dallal.realtymx.com/?page=agents&id=1), [Javier Cruz profile](https://dallal.realtymx.com/?page=agents&id=29) and [R4 attribution candidate](https://streeteasy.com/building/118-mulberry-street-new_york/r4)
