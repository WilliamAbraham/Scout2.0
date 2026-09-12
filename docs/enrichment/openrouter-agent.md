# Cost-controlled OpenRouter enrichment

The `enrich:agent` command now defaults to GPT-4.1 Mini through the official OpenAI JavaScript SDK and OpenRouter. It requires an explicit dollar budget before making paid requests. No paid requests were made while implementing this optimization; the earlier $4.21 benchmark is historical and does not measure this version's accuracy or cost.

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
| Contact prompt | Full roster evidence and discovery notes | IDs, names, brokerages, attribution URLs only |
| Paid admission | API key was enough | Explicit shared USD budget required |
| Provider price filter | None | At most $0.40/M input, $1.60/M output; provider fallbacks disabled |
| Result reuse | None | Full-input cache and concurrent duplicate suppression |

Exact address/unit discovery still runs before personal contact lookup. A generic office contact cannot terminate broker-name discovery. Missing email/phone, provider failure, or insufficient budget retains the discovered names.

Existing direct brokerage adapters run first when a cache directory is configured (the CLI configures one). Their verified contacts are returned separately in `directContacts`, including exact-listing, unit-conflict, or brokerage-only relationships. If discovery finds no named people and a direct contact is available, the paid generic contact stage is skipped. This recovers sources such as Canvas's public listing feed without asking the model to rediscover that feed. Direct HTTP reads use no model or search credits; they can still fail or require review.

## Budget semantics

`EnrichmentBudget` is shared across all listings in a CLI batch. Every paid request must reserve a $0.02 planning allowance from the remaining budget before dispatch. Afterward, the allowance is replaced with the provider's reported charge. If insufficient budget remains, the next request is not sent. If the provider reports no valid cost, a request times out, or an individual request exceeds its allowance, subsequent paid requests are stopped. Failed or malformed model responses are still accounted for.

**This is a local admission gate, not a guaranteed hard cap on an in-flight provider charge.** OpenRouter's server-tool API is beta, and prior live responses exceeded requested step counts. The price filter constrains provider token rates, not all search charges. The smaller model, reduced search limits, disabled page-fetch tool, and budget checks reduce exposure; only provider-enforced account/key limits can independently constrain billing. This implementation does not alter the account's key or billing settings.

The CLI writes `budget.json` alongside results. Each result records `cost.reportedUsd`, `cost.cacheHit`, and `cost.budgetLimitUsd`; null means the charge was unavailable, not zero. The $0.02 reservation is an operating allowance, not a measured per-request cost or a savings guarantee.

## Cache and evidence

Results with discovered people or contact routes are cached for one hour; completed unresolved results for five minutes. The key includes the full listing input, model, engine, tool limit, direct-source setting, screenshot content, and policy version. Different units, rents, or brokerages cannot share an attribution result. Cache hits keep the original `checkedAt`, preserve evidence, and report zero newly incurred cost. Concurrent identical requests in this process share one enrichment operation. Separate processes do not share an in-flight lock or budget; use one batch runner for a shared budget.

Direct source pages retain their existing one-hour cache. Failed/partial result objects are not stored in the complete-result cache. Changes to cache semantics or verification rules must bump the policy version.

Model contacts require valid format, a supporting excerpt, and a matching provider citation. Multiple excerpts for a URL are accumulated; a later masked page cannot erase earlier email evidence. A masked model email excerpt can be replaced only by actual cited provider text containing that email. No email patterns are guessed. Generic office channels remain separate from individual broker contacts.

`source_cited` means matching model-reported address/unit plus a citation URL, not independent proof that the roster is complete or current. Unit conflicts remain review candidates. The previous search-only version missed Jake Vitale for 423 West #1C; this optimization does not claim to have fixed that retrieval gap.

## Optional screenshot

`--screenshot /absolute/path/listing.png` is supported for one listing at a time. PNG/JPEG/WebP files up to 20 MB are accepted. The image is sent to OpenRouter during discovery only; this requires authorization for the image payload. Its live test remains unapproved and was not run. Results use `inputMode: listing_facts_and_image` and `attributionStatus: provided_image` for names read from it. Screenshot-assisted results must not be presented as independent web discovery. Image bytes are not stored in raw response files.

## Verification

98 enrichment tests and the isolated TypeScript check passed during optimization. Tests use mocked HTTP with the real OpenAI SDK and cover zero-budget rejection, shared batch spending, unknown charges, overruns, model/price/search restrictions, cache hits, expiry, changed units, concurrent duplicates, direct contact reuse, and roster preservation. These verify control flow, not the cheaper model's real-world extraction quality. A live quality/cost comparison needs a separately agreed budget.

- [OpenRouter GPT-4.1 Mini pricing](https://openrouter.ai/openai/gpt-4.1-mini): $0.40/M input and $1.60/M output when checked September 12, 2026.
- [Provider price filters](https://openrouter.ai/docs/guides/routing/provider-selection#max-price)
- [Search settings and Parallel fast pricing](https://openrouter.ai/docs/guides/features/server-tools/web-search)
- [Historical live benchmark](openrouter-live-results-2026-09-12.md)
