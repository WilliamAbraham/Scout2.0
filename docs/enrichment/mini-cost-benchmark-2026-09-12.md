# GPT-4.1 Mini cost test on a different email

On September 12, 2026, the user approved a $0.10 OpenRouter test budget and enrichment of every listing in another StreetEasy email. The selected message, “4 Homes You May Have Missed,” received September 11, contained four listings different from the earlier five-listing benchmark.

**Measured cost: $0.020800404 total (2.08¢), averaging $0.005200101 (0.52¢) per listing.** All four completed their two research stages. No budget overrun or missing cost report occurred. Completion does not mean successful broker enrichment: the run found **zero named brokers**, three generic brokerage contact channels, and one listing with no contact details.

| Listing | API-reported cost | Result |
| --- | ---: | --- |
| 629 East 5th Street #10 | $0.006067020 | Canvas identified; no email or phone |
| 15 East 11th Street #8G | $0.005212352 | 346 Realty general email and phone; no listing agent |
| 93 Avenue B #2F | $0.004899116 | Metropolitan Property Group office phone; no listing agent |
| 36 Saint Marks Place #18 | $0.004621916 | Compass corporate footer phone; no listing agent |

## Contact evidence and limitations

- **346 Realty:** `info@346Realty.com`, `(646) 485-0910`, from the [company homepage](https://www.346realty.com/). The office address matched the email's brokerage office, but no exact-unit agent attribution was established.
- **Metropolitan Property Group:** `212-353-2003`, from the Fifth Avenue office block on an [official property page](https://www.metropolitanpropertygroup.com/index.cfm?id=878546&page=details). This is a different office from the Lexington Avenue office in the email; it is not a verified contact for the specific unit.
- **Compass:** `212-913-9058`, from a corporate footer on an [agent profile](https://www.compass.com/agents/beth-marks). The model did not attribute that profile's agent to the listing. This is only a corporate phone channel, not a verified listing contact.
- **Canvas:** the direct adapter inspected nonmatching units before exhausting its eight-request limit. Model searches identified the company but returned no usable email or phone.

Do not describe these outcomes as four successfully enriched listings or treat generic company contacts as the listing's broker roster. The experiment verifies lower spend on this input, not acceptable enrichment accuracy. It is not a controlled model comparison because the earlier expensive run used a different email and different limits.

## Run configuration

- Model: `openai/gpt-4.1-mini` through OpenRouter using the OpenAI SDK.
- Search: Parallel `fast`; requested at most two searches per stage, three results per search, six results per stage, and 1,500 characters per result.
- No hosted full-page fetch tool; maximum 2,500 output tokens per stage; no SDK retries or provider fallback.
- Fresh local result and direct-source cache. No cached enrichment answers, broker names, or contact details were seeded. Provider-side prompt caching was reported and is included in the cost.
- Eight stage requests, nine reported web searches, 29,985 aggregate tokens, approximately 45.15 seconds end to end.
- Only listing facts went to OpenRouter: address, unit, rent, bed/bath counts, brokerage, city, and available brokerage office address. No email body, tracking identifiers, screenshot, or mailbox credentials were sent.
- The temporary extractor handled the recommendation email's table/anchor layout; the regular alert parser's `.ListingCard` selector does not match this template. Production parser support was not changed by this test.

The budget ledger ended at $0.020800404 reported, $0 reserved, with no halt reason. The local admission gate is not a guarantee about a provider's in-flight charges. No further paid experiments were run in this task.

## Reproduction and verification

The ignored local directory `data/enrichment/cost-new-email/2026-09-12T21-10-53.136Z/` contains the per-stage raw responses, per-listing results, fresh cache, and `report.json` with costs and elapsed times. The parent directory contains the temporary email extractor, sanitized listing input, and runner. Private email content and raw run artifacts are not committed.

The discovery prompt was shortened to match the available search tool and two-search allowance. Required checks: `yarn test` passed all 123 tests; `npm run typecheck:enrichment -w backend` passed. `yarn lint` was attempted and failed because the root project defines no lint script. This existing check gap remains unresolved.
