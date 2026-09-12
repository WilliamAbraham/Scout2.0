# OpenRouter enrichment live test — September 12, 2026

The OpenAI SDK successfully ran against OpenRouter using the existing key. The strongest tested configuration, GPT-5.5 with Parallel search, produced a public contact route for each of five listings. It did **not** recover every broker: the search-only result for 423 West Street omitted Jake Vitale, whose name is visible in the supplied listing screenshot.

Inputs were the five frozen email listing records: address, exact unit, rent, bed/bath counts, brokerage, city, and available office address. No broker names, contact details, screenshot text, or manually researched URLs were seeded into these live search-only requests.

| Listing | Agent or contact channel returned | Email | Listed phone |
| --- | --- | --- | --- |
| 118 Mulberry Street #R4 | Javier Cruz, DALLAL | javier@dallalnewyork.com | (347) 654-8962 |
| 118 Mulberry Street #R4 | Michael Dallal, DALLAL | mike@dallalnewyork.com | (516) 673-7155 |
| 57 Grand Street #4 | Owner/property-manager channel | Not found | (212) 472-9789 |
| 248 Mott Street #6-5 | Centennial Properties NY team | apts@centpropny.com | (212) 228-9300 |
| 503 West 22nd Street #5W | Canvas Property Group listing contact | Not found | (646) 661-4569 |
| 423 West Street #1C | Marilyn Deamorim, Next Step Realty | marilyn@nextstepny.com | (917) 848-1001 |

These are source-cited research results, not confirmed working contact details. Portal phone numbers can be routing numbers. Source-index excerpts may be stale. Office/team channels are not individual brokers.

## Evidence and caveats

- **118 Mulberry:** the [exact-unit StreetEasy source](https://streeteasy.com/building/118-mulberry-street-new_york/r4) names Javier and Michael. Public business contacts were supported by their [Javier profile](https://www.dallalnyproperties.com/?page=agents&id=29) and [Michael profile](https://www.dallalnyproperties.com/?page=agents&id=1), including search excerpts exposing email addresses masked in some fetched versions.
- **57 Grand:** the [exact-unit listing](https://streeteasy.com/building/57-grand-street-new_york/4) identifies the current listing as owner-listed. Historical Compass agents were excluded. The owner/manager phone came from an indexed [HotPads building page](https://hotpads.com/57-grand-st-new-york-ny-10013-241d2ax/building); no named individual owner was identified.
- **248 Mott:** the [StreetEasy #6-5 listing](https://streeteasy.com/building/248-mott-street-new_york/65) lists Centennial as a team. Contact information comes from the [official contact page](https://www.centpropny.com/index.cfm?page=contact). The brokerage's property page calls the unit #5-6/#5/6, so the unit conflict remains flagged rather than silently normalized.
- **503 West 22nd:** exact-unit sources identify Canvas as the listing brokerage/team. The phone came from the indexed [HotPads #5W page](https://hotpads.com/503-w-22nd-st-new-york-ny-10011-2430sne/5w/pad). The agent did not retrieve the email previously found by the deterministic Canvas adapter; that earlier result is not counted as an AI-agent discovery.
- **423 West:** an indexed [Zillow #1C listing](https://www.zillow.com/homedetails/423-West-St-1C-New-York-NY-10014/465090703_zpid/) names Marilyn. Her business email and phone were supported by an indexed [CityRealty profile](https://www.cityrealty.com/nyc/agents/marilyn-deamorim/30661). Other portal phone numbers conflicted. Jake is visible in the user-provided screenshot but absent from the accepted search-only roster. No claim of a complete roster is made.

## Experiments and API-reported cost

| Experiment | Outcome | Cost, USD |
| --- | --- | ---: |
| GPT-5.5 / Exa, 423 West | No broker names; output failed schema validation | 0.4554 |
| GPT-5.5 / Parallel, 423 West | Marilyn plus personal contact details; Jake missing | 0.7257 |
| GPT-5.5 / Perplexity, 423 West | Brokerage contact only | 0.3340 |
| GPT-5.5 / native search, 423 West | Brokerage contact only; roster unresolved | 0.3940 |
| Claude Sonnet 4.6 / Parallel, 423 West | Non-JSON prose plus JSON; rejected. Also claimed #1L equaled #1C, which is unsupported | 0.4123 |
| GPT-5.5 / Parallel, remaining four | Two DALLAL brokers, one owner channel, two team channels | 1.8926 |
| **All search-only trials** | **16 stage requests** | **4.2141** |

The five-listing Parallel baseline cost approximately $2.62; the larger total includes alternative-engine/model experiments. Costs are provider-reported, not a billing reconciliation or estimate of future per-listing cost.

## Fixes validated with these runs

1. The schema is included explicitly in the prompt as well as the API's response-format field. GPT-5.5 subsequently returned valid structured output. Some beta tool/model combinations still did not honor it, and invalid output is rejected.
2. Multiple citations for the same URL are accumulated. Previously, a later masked page could overwrite an earlier excerpt containing a valid email.
3. If a model supplies a masked email excerpt but the provider's cited text contains the actual email, the evidence excerpt is reconstructed from that provider text. No email pattern is inferred.
4. The discovered roster is saved before contact research, with unknown IDs rejected and missing contacts preserving names.
5. Search defaults to Parallel based on this benchmark. Exact address/unit seed queries and follow-up query guidance were added. The revised query guidance has not yet been benchmarked across all five listings.

The two evidence-validation fixes were replayed against saved live provider responses without further API requests. Original responses and original result files remain intact. Revalidated results are saved under each run's `revalidated/` directory.

## Artifacts and validation

Run artifacts are under `data/enrichment/agent-tests/openrouter-*`, including raw provider responses, citation excerpts, usage, original results, and offline revalidation results. These directories are ignored by Git. `backend/src/enrichment/agent.test.ts` exercises the actual SDK with mocked HTTP responses; all 89 enrichment tests and the isolated TypeScript check pass.

An optional screenshot input is implemented and locally tested. Its live run was blocked by automatic approval review because the prior approval covered listing fields, not the image payload. Screenshot-assisted results must be measured separately and must not be described as independent search-only discovery.
