# Verified broker discovery: 620 East 6th Street #9A

On September 12, 2026, a fresh run of the enrichment agent correctly returned **Fatma Kara, FIND Real Estate**, with attribution to the [exact StreetEasy listing](https://streeteasy.com/building/620-east-6-street-new_york/9a). It read the live page's “Listed by” section, which links to her [StreetEasy profile](https://streeteasy.com/profile/942807).

## Independent input and retrieval

The input was unchanged from the earlier failed tests: 620 East 6th Street, unit 9A, $6,995, three bedrooms, two bathrooms, FIND Real Estate, and its supplied office address. It contained **no listing URL, broker name, broker profile, or screenshot**. The expected name was used only to evaluate the result afterward.

The pipeline generated one conventional StreetEasy URL from the address and unit, fetched it with ordinary Node HTTP, then checked its heading and available asking rent against the input. It did not need a search-index result, browser session, CAPTCHA solution, manually injected page text, or brokerage-name seed beyond the original email fields. GPT-4.1 Mini extracted the broker from that live page. Search tools were omitted during extraction because the page evidence was already present. The separate contact stage used one hosted search.

A generated URL is a candidate, not evidence. This convention is restricted to New York city inputs and conservative address/unit characters. A missing, blocked, mismatched, or price-conflicting page falls back to budgeted search; there is no permutation sweep. Buildings with different StreetEasy slugs may still need a supplied email URL or search recovery.

## Measured cost and result

| Item | Measured result |
| --- | --- |
| Model | `openai/gpt-4.1-mini` through OpenRouter / OpenAI SDK |
| Shared test request budget | $0.10 |
| Discovery/extraction charge | $0.000725076 |
| Contact research charge | $0.002682208 |
| **Total new API charge** | **$0.003407284 — 0.34 cents** |
| Elapsed time | 7.882 seconds |
| API requests / reported web searches | 2 / 1 |
| Broker | Fatma Kara, FIND Real Estate |
| Attribution | `source_cited`, exact listing page |
| Final verified personal email / phone | None |

The initial contact output included an email from a third-party profile associated with a different brokerage. It is not a verified contact for this listing. A subsequent **offline replay of the exact saved live HTTP response and both provider responses** validated the stricter contact-identity gate: Fatma Kara remains attributed to the listing, while that email is rejected. This audit made zero new API calls. Personal contact sources now need evidence identifying the agent at the listing brokerage, or the same already-supported listing source; office duplicates and explicitly generic channels are excluded from personal fields.

The live run independently proves broker-name discovery for this unit. It does not prove general recall for all listings, guarantee roster completeness, or verify Fatma's contact details. The $0.0034 charge is one observation, not a batch-cost guarantee. The worker's existing enrichment-provider wiring has not changed.

## Verification and artifacts

- 154 offline tests pass, including a reduced HTML fixture captured from the live response, URL generation, unit/rent conflicts, co-broker retention, uncited-name rejection, office duplication, and conflicting-brokerage contacts.
- Isolated enrichment TypeScript check and `git diff --check` pass.
- `yarn lint` was attempted; the repository still has no root lint script.
- Raw HTTP, input, requests, provider responses, usage, and the audit are retained in ignored `data/enrichment/fatma-retrieval-research/live-2026-09-12T22-19-57.105Z/`.
- The shared experimental ledger in `data/enrichment/fatma-retrieval-research/v3-budget.json` records $0.003407284 spent, zero reserved, and no halt.

The earlier search-only and recovery-only failures remain documented in [the agent guide](openrouter-agent.md#live-regression-result-2026-09-12). No second paid run was needed after the direct-page change succeeded.
