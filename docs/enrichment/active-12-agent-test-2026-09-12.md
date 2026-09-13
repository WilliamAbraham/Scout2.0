# Active-listing test of enrichWithAgent

The user selected `enrichWithAgent()` as the default and explicitly approved a live test on the 12 active pursuits, a shared $0.25 OpenRouter budget, and configured Tavily/Firecrawl contact services. The test ran September 12, 2026 (New York time). It made no database writes, sent no email, and did not run the continuous worker.

## Result

**Full broker-identification coverage is not established.** The fresh batch retained supported individual agents for **2 of 12 listings (3 people)**. It identified a brokerage-only listing for 115 Mulberry #F4, recovered an exact-listing Canvas leasing route for 503 West 22nd #5W with an unresolved individual roster, and classified 57 Grand #4 as owner-listed from the original input. The other seven rosters remained unresolved, even where office contacts were found.

All 12 were attempted. Ten raw executions completed and two were partial due to malformed structured responses. Completion means the API stages finished, not that the listing's brokers were identified. OpenRouter reported **$0.087395756 (8.74¢)** against the approved $0.25 allowance, with zero outstanding reservations. Tavily/Firecrawl credits are separate and were not metered by this ledger.

| Listing | Accepted named agents | Other result / limitation |
| --- | --- | --- |
| 115 Mulberry Street #F4 | None | Exact page listed Centennial Properties NY, with no individual names. Office email/phone recovered. |
| 118 Mulberry Street #R4 | Javier Cruz; Michael Dallal | Exact listing source supports both names. Michael's email and phone recovered; Javier's contacts missing. |
| 227 Waverly Place #5B | Unresolved | StreetEasy HTTP 403; search did not establish a roster. PREX brokerage name alone is not proof of a brokerage-only listing. |
| 245 Eldridge Street #1B | Unresolved | StreetEasy HTTP 403; search failed to establish a roster. Claimed office phone failed evidence validation. |
| 248 Mott Street #3 | Unresolved | Office phone recovered. Model returned the generic label “Listing Agent”; it is excluded as a person. The user's earlier screenshot shows Centennial, but the automated batch did not establish a named roster. |
| 248 Mott Street #6-5 | Unresolved | Centennial contact came from source unit #5-6 and retains a unit-conflict label. |
| 252 Mott Street #R3 | Ben Refael | Exact-unit search citation supports Ben; DALLAL email lookup succeeded. |
| 423 West Street #1C | Unresolved | Next Step office email/phone recovered. Recovery returned a null agent name and failed schema validation. |
| 444 East 13th Street #9 | Unresolved | Tesla office email/phone recovered; no supported individual roster. |
| 503 West 22nd Street #5W | Unresolved | Canvas exact-listing leasing email recovered. Emilio Mora was excluded from accepted agents: the cited page belongs to Kleier Residential and quotes a different rent. He remains a review candidate, without an outreach email. |
| 57 Grand Street #4 | Owner-listed input | No broker invented. Contact-stage output failed schema validation; no owner contact recovered. |
| 620 East 6th Street #9A | Unresolved in this batch | StreetEasy HTTP 403; search missed Fatma Kara. FIND office email/phone recovered. The earlier independently verified Fatma attribution remains valid as a separate observation. |

The batch therefore does **not** prove that the second implementation always outperforms the first. Direct listing access is the main observed gap: ten listing reads returned HTTP 403. “We only found an office” must not be presented as “the listing only names a brokerage.”

## Default path and acceptance rules

The continuous worker, one-email runner and default `npm run enrich` command now use `enrichWithAgent()`. Shared `agentResultForPipeline()` mapping preserves names, company routes, evidence, cost and partial status. Generic labels and the input brokerage's company name cannot become people. A different-brokerage person remains a candidate, with contact fields excluded. Only a complete supported email roster, or an eligible exact-listing team route without unresolved candidates, can produce an outreach-ready snapshot. Generic office routes and unit conflicts cannot.

These mapping checks were replayed offline against the exact saved live outputs; no second paid batch was needed. Raw responses are retained separately from the accepted pipeline results. Only 252 Mott #R3 was outreach-ready after these checks; this was a test result, not a send or state change.

The worker's `SCOUT_ENRICHMENT_BUDGET_USD` is an explicit shared **per-process** OpenRouter allowance, defaulting to zero. It does not reset per listing or polling cycle, is not a durable daily spending cap, and does not include Tavily/Firecrawl credits. A deployment must configure its own allowance. The legacy implementation remains available through `npm run enrich:legacy`.

## Evidence and reproduction

Input fields came from the 12 existing pursuit records: listing URL, address/unit, rent, room counts and brokerage. No expected agent names, screenshots, account identity or pursuit history were supplied to the model. The scope is the 12 listings with pursuits, not the 203 imported listings (all of which currently carry a match flag).

Ignored artifacts:

- `data/enrichment/active-12-agent-test/input.json`: exact 12 inputs.
- `data/enrichment/active-12-agent-test/run/results.json`: raw agent results.
- `data/enrichment/active-12-agent-test/run/pipeline-results.json`: accepted pipeline mapping.
- `data/enrichment/active-12-agent-test/run/*-discovery*.raw.json` and `*-contacts.raw.json`: provider responses and citations.
- `data/enrichment/active-12-agent-test/run/budget.json`: shared budget settlement.
- `data/enrichment/active-12-agent-test/summary.json`: compact comparison.

Relevant returned sources include [118 Mulberry #R4](https://streeteasy.com/building/118-mulberry-street-new_york/r4), [252 Mott #R3](https://streeteasy.com/building/252-mott-street-new_york/r3), and the [conflicting Kleier listing](https://www.kleiers.com/listing/290925?origin=rp). The previous [Fatma verification](fatma-live-result-2026-09-12.md) documents the successful independent source read separately from this batch failure.

The approved command was:

```sh
node backend/scripts/enrichAgent.ts data/enrichment/active-12-agent-test/input.json \
  --model openai/gpt-4.1-mini --budget-usd 0.25 --refresh \
  --output data/enrichment/active-12-agent-test/run
```

Do not overwrite these artifacts when reproducing a future run; choose another output directory and an explicitly authorized budget.
