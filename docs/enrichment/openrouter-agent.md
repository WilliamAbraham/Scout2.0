# Cost-controlled OpenRouter enrichment

The `enrich:agent` command now defaults to GPT-4.1 Mini through the official OpenAI JavaScript SDK and OpenRouter. It requires an explicit dollar budget before making paid requests. A subsequently approved [four-listing live test](mini-cost-benchmark-2026-09-12.md) cost $0.020800404 total, but found no named brokers and only three generic brokerage contact channels. Lower cost is measured; adequate enrichment quality is not established. The earlier $4.21 benchmark used a different email and configuration.

## Verified current result

The address-only test now independently identifies **Fatma Kara at FIND Real Estate for 620 East 6th Street #9A**. A fresh live run cost **$0.003407284 (0.34¢)** and took 7.882 seconds. The original input contained no URL, expected name or screenshot. An offline audit rejects an email associated with a conflicting brokerage while retaining the correctly discovered broker. [Full result and limitations](fatma-live-result-2026-09-12.md).

## Retrieval upgrade (2026-09-12)

The agent now accepts an optional `listingUrl`. The Gmail-to-enrichment adapter preserves it instead of dropping it. The input parser accepts canonical HTTPS StreetEasy rental or exact-unit building URLs and removes query parameters and fragments. The live alert/outreach runner still uses `BrokerEnrichment`, not this optional OpenRouter agent; this change does not switch providers or enable outreach.

Before paid discovery, a supplied URL is read over HTTP. When no URL is supplied, the agent tries one conventional StreetEasy URL generated from the New York address and unit. It validates the returned heading and any available asking rent before using the page as evidence; generated URLs alone do not establish attribution. The reader checks every redirect against the StreetEasy listing allowlist, bounds the entire read to ten seconds and 2 MB, removes executable markup, and retains the page heading plus up to 5,200 characters around “Listed by.” This targets broker names even after a long description. The read uses no model/search credits. HTTP errors, challenge pages and missing content are recorded before search fallback; there is no CAPTCHA bypass or browser rendering. JavaScript-only or inaccessible pages remain a limitation.

Discovery receives that source text when available and omits search tools during page extraction. Without page/image evidence, search requests use `tool_choice: required` and include New York in address searches. If no supported broker is found, code enforces **one alternate discovery request** before looking up generic office contacts. This request uses the same dollar ledger, model and two-search maximum as the other stages. There are now up to three paid stages: discovery, discovery recovery, contacts. Recovery does not repeat indefinitely, and budget refusal keeps execution partial. Explicit Owner listings can skip recovery. Citation text is required and must contain the broker name, matching address and unit; a wrong-city citation cannot establish attribution. Candidates remain available for review, and a later supported match upgrades the same candidate without duplicating it.

For JSON callers, add `"listingUrl": "https://streeteasy.com/rental/<actual-rental-id>"` using the URL from the email. Do not seed expected broker names. `discovery_retry` transcripts are saved separately. Cache policy was bumped so older search-only results are not reused.

The preceding single-listing test of **620 East 6th Street #9A** cost **$0.006410748** and missed Fatma Kara, who is visible in the user's subsequent screenshot. New offline fixtures cover this layout and recovery behavior, but deliberately supplied fixture responses are **not proof of independent live discovery**. The subsequent approved rerun of the upgraded agent cost **$0.008392432 (0.84¢)** and still missed Fatma Kara; see the live regression result below. The old 0.52¢ average must not be presented as the upgraded pipeline's measured rate.

## Live regression result (2026-09-12)

One user-requested rerun used the original 620 East 6th Street #9A input, GPT-4.1 Mini / Parallel fast, `--refresh`, and a shared $0.05 request budget. No expected name or screenshot was supplied. The original input has no listing URL, so this run tested search recovery, **not the new direct-page reader**. Artifacts are in ignored `data/enrichment/east-6th-9a-test/upgraded-run-1/`.

| Stage | API-reported cost | Reported searches |
| --- | ---: | ---: |
| Discovery | $0.000603900 | None reported |
| Discovery recovery | $0.003508760 | 2 |
| Contacts | $0.004279772 | 2 |
| Total | **$0.008392432** | **4** |

The API stages completed, but listing status remained `unresolved` and no broker attribution was supported. Discovery returned Judith Mei with an uncited listing URL; recovery proposed Jules Borbely from a company listing without the target address/unit in its excerpt. Both were retained as `needs_review`, not accepted listing brokers. The contact-stage source subsequently identified Jules's property as **210 East 36th Street #6-C**, a different listing. Neither candidate is a result for 620 East 6th Street #9A.

The only supported channel was FIND's general office email/phone, hello@findrealestate.com and +1 212 994 9965. The model also duplicated those office values under Jules's personal contact fields despite explicitly noting that they were generic. At that time contact validation checked cited values, not personal-versus-office ownership. The current version excludes unsupported candidates, office duplicates, and contacts lacking broker/brokerage identity evidence. The factual association gate prevented accepted broker attribution, but did not fix retrieval or prevent wasted contact research on unsupported candidates. No further paid attempts were made in that test. This historical search-recovery failure was followed by the [successful address-derived direct-page run](fatma-live-result-2026-09-12.md).

## Usage

```sh
# Default budget is zero: cached results and direct brokerage reads only.
npm run enrich:agent -- backend/fixtures/enrichment/423-west-1c.json

# Example of a separately authorized future run, with one budget shared across the batch:
npm run enrich:agent -- listings.json --budget-usd 0.10 --output data/enrichment/agent-tests/budgeted-run
```

Set `OPENROUTER_API_KEY` in the root `.env` or environment for paid research. No OpenAI API key is needed. A missing key does not prevent cached or direct-source results. The only permitted model is `openai/gpt-4.1-mini`; an old premium `OPENROUTER_MODEL` override produces an error instead of silently incurring that model's charges. Only Parallel search is allowed in this cost-controlled path. `--refresh` bypasses cached results and direct page caches but does not bypass the budget.

## What changed

| Control | Earlier research version | Current version |
| --- | --- | --- |
| Default model | GPT-5.5 | GPT-4.1 Mini |
| Requested hosted tool steps per stage | 12 | 2 maximum |
| Search results per stage | Up to 40 | Up to 6 |
| Text per search result | 5,000 characters | 1,500 characters |
| Hosted full-page fetches | Up to 6 per stage | None |
| Completion limit per stage | 6,500 tokens | 2,500 tokens |
| Search mode | Parallel basic | Parallel fast |
| SDK retries | 0 | 0 |
| HTTP timeout | 240 seconds | 60 seconds |
| Contact prompt | Full roster evidence and discovery notes | Supported broker IDs, names, brokerages, attribution URLs only |
| Paid admission | API key was enough | Explicit shared USD budget required |
| Provider price filter | None | At most $0.40/M input, $1.60/M output; provider fallbacks disabled |
| Result reuse | None | Full-input cache and concurrent duplicate suppression |

Exact address/unit discovery and, when needed, one recovery stage run before personal contact lookup. A generic office contact cannot terminate broker-name discovery. Missing email/phone, provider failure, or insufficient budget retains the discovered names.

Existing direct brokerage adapters run first when a cache directory is configured (the CLI configures one). Their verified contacts are returned separately in `directContacts`, including exact-listing, unit-conflict, or brokerage-only relationships. If discovery and recovery find no named people and a direct contact is available, the paid generic contact stage is skipped. This recovers sources such as Canvas's public listing feed without asking the model to rediscover that feed. Direct HTTP reads use no model or search credits; they can still fail or require review.

## Name + brokerage email lookup

When `TAVILY_API_KEY` is set (the CLI and `npm run alert` pass it through), every supported broker discovered without an email goes through `src/enrichment/agentContacts.ts` before the paid contact stage: one Tavily search for `"<name>" "<brokerage>"`, results ranked by name/brokerage/profile-URL signals, every plausible address on those pages collected, and the one attributable to the agent kept. Attribution means the address carries the name, or sits at the brokerage's own domain on a page naming the agent, or is the single personal address on the closest page. Generic inboxes (`info@`, `leasing@`, …) are never chosen. Tavily's page text drops `mailto:` links, so when nothing attributable appears the closest non-social pages are fetched directly, and through Firecrawl (`FIRECRAWL_API_KEY`) when the site blocks a plain HTTP client. Evidence is recorded as `sourceType: broker_profile` with the URL and excerpt. If every supported broker resolves this way the OpenRouter contact stage is skipped; otherwise it runs and never overwrites a lookup result. Cost is one Tavily credit per agent plus at most three Firecrawl scrapes, outside the USD budget. The cache policy version is `listing-evidence-v4`, keyed on whether the lookup was enabled.

Measured on 2026-09-12 against the five brokers named for the "3 Results for Manhattan - 9/11/26" alert: 5 of 5 resolved in isolation (Paul Morrissette, Luke Joyce, Ben Refael, Michael Dallal, Perry Roth). The lookup depends on discovery producing names first; when StreetEasy's PerimeterX block (HTTP 403) denies the listing-page read, discovery falls back to search and names fewer brokers.

## Budget semantics

`EnrichmentBudget` is shared across all listings in a CLI batch. Every paid request must reserve a $0.02 planning allowance from the remaining budget before dispatch. Afterward, the allowance is replaced with the provider's reported charge. If insufficient budget remains, the next request is not sent. If the provider reports no valid cost, a request times out, or an individual request exceeds its allowance, subsequent paid requests are stopped. Failed or malformed model responses are still accounted for.

**This is a local admission gate, not a guaranteed hard cap on an in-flight provider charge.** OpenRouter's server-tool API is beta, and prior live responses exceeded requested step counts. The price filter constrains provider token rates, not all search charges. The smaller model, reduced search limits, disabled page-fetch tool, and budget checks reduce exposure; only provider-enforced account/key limits can independently constrain billing. This implementation does not alter the account's key or billing settings.

The CLI writes `budget.json` alongside results. Each result records `cost.reportedUsd`, `cost.cacheHit`, and `cost.budgetLimitUsd`; null means the charge was unavailable, not zero. The $0.02 reservation is an operating allowance, not a measured per-request cost or a savings guarantee.

## Cache and evidence

Results with discovered people or contact routes are cached for one hour; completed unresolved results for five minutes. The key includes the full listing input, model, engine, tool limit, direct-source setting, screenshot content, and policy version. Different units, rents, or brokerages cannot share an attribution result. Cache hits keep the original `checkedAt`, preserve evidence, and report zero newly incurred cost. Concurrent identical requests in this process share one enrichment operation. Separate processes do not share an in-flight lock or budget; use one batch runner for a shared budget.

Direct source pages retain their existing one-hour cache. Failed/partial result objects are not stored in the complete-result cache. Changes to cache semantics or verification rules must bump the policy version.

Model contacts require valid format, a supporting excerpt, and a matching provider citation. Personal contacts additionally require source text naming the broker and their listing brokerage, or naming them on the same already-supported listing URL. Unsupported candidates are excluded from contact research and cannot receive contacts. Multiple excerpts for a URL are accumulated; a later masked page cannot erase earlier email evidence. A masked model email excerpt can be replaced only by actual cited provider text containing that email. No email patterns are guessed. Values duplicated in office contacts, or explicitly described as generic office channels, are removed from personal contact fields. These checks address the defects observed in the earlier regression below; live broker-name discovery is verified, while personal contact discovery remains incomplete.

`source_cited` requires matching model-reported address/unit, a citation URL, and the name/address/unit in actual citation text. URL-only citations cannot validate an agent. Directly fetched listing text is retained as source evidence too. This is not independent proof that the roster is complete or current; excerpt-only or historical sources need review. Unit conflicts remain review candidates. The previous search-only version missed Jake Vitale for 423 West #1C; live recovery of that co-agent remains unverified.

## Optional screenshot

`--screenshot /absolute/path/listing.png` is supported for one listing at a time. PNG/JPEG/WebP files up to 20 MB are accepted. The image is sent to OpenRouter during discovery only; this requires authorization for the image payload. Its live test remains unapproved and was not run. Results use `inputMode: listing_facts_and_image` and `attributionStatus: provided_image` for names read from it. Screenshot-assisted results must not be presented as independent web discovery. Image bytes are not stored in raw response files.

## Verification

The retrieval upgrade passes 154 tests in the full `yarn test` suite (with Node 22 type stripping enabled) and the isolated enrichment TypeScript check; root `yarn lint` remains unavailable because no script exists. Tests use mocked HTTP with the real OpenAI SDK and cover zero-budget rejection, shared batch spending, unknown charges, overruns, model/price/search restrictions, cache hits, expiry, changed units, concurrent duplicates, direct contact reuse, and roster preservation. The approved live test measured cost but exposed insufficient broker discovery. New retrieval tests additionally cover URL propagation and sanitization, blocked/oversized/redirected pages, broker sections after long descriptions, irrelevant source rejection, bounded discovery recovery, candidate upgrades, and budget refusal. Further paid experiments need an agreed budget.

- [OpenRouter GPT-4.1 Mini pricing](https://openrouter.ai/openai/gpt-4.1-mini): $0.40/M input and $1.60/M output when checked September 12, 2026.
- [Provider price filters](https://openrouter.ai/docs/guides/routing/provider-selection#max-price)
- [Search settings and Parallel fast pricing](https://openrouter.ai/docs/guides/features/server-tools/web-search)
- [Historical live benchmark](openrouter-live-results-2026-09-12.md)
