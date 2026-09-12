# Broker enrichment technology and validation

Scout should use a layered enrichment pipeline: resolve the listing’s brokerage, read its published listing data, verify the apartment identity, and then recover the contact assigned to that apartment. Tavily remains the preferred search provider. Direct brokerage adapters should precede expensive extraction where the source structure is known. Firecrawl and Playwright are useful readers for the remaining sites. LangGraph becomes valuable when these steps need durable retries and human review.

The five-listing evaluation shows why a single “find the broker” prompt is insufficient. The sample contains two listings with named-agent candidates, two represented by leasing organizations, and one explicitly advertised by its owner. The output must distinguish a person, a listing-specific team mailbox, a general brokerage office, and an unresolved owner inquiry. Those categories have different evidence requirements and should not share one success counter.

The revised direct-source implementation recovered contact information for three listings in fresh requests: Canvas, Centennial, and Next Step. Only Canvas passed exact-listing verification. Centennial has a unit-number conflict, and Next Step yielded an office contact. Earlier DALLAL research recovered two named candidates, while additional research identified two Next Step candidates. Combining these findings provides useful contact leads for four of five properties, but it does not establish four verified listing rosters. The owner-listed property still has no supported public email or phone.

## Evaluation design and results

The benchmark reuses the five cards extracted from the September 11, 2026 Manhattan alert. Reusing the same email holds the input constant while the retrieval methods change. Its fields are address, unit, rent, bed and bath counts, brokerage, city, and office address when supplied. The fresh direct benchmark does not receive agent names, contact details, or property-specific URLs as input. It uses a reviewed registry of three brokerage websites and discovers property identifiers from their catalogs.

| Listing | Fresh direct code result | Additional research evidence |
| --- | --- | --- |
| 118 Mulberry Street R4 | No direct adapter; generic provider workflow remains available | Michael Dallal and Javier Cruz are index-supported candidates with official-profile contacts |
| 57 Grand Street 4 | Classified owner-listed; no contact invented | Indexed advertisement also says Owner |
| 248 Mott Street 6-5 | Centennial leasing email and phone; unit conflict requires review | Brokerage publishes the candidate as 5-6 |
| 503 West 22nd Street 5W | Exact listing matched; assigned team email recovered | Browser rendering independently confirms the feed and inquiry email |
| 423 West Street 1C | Next Step office email and phone verified | Indexed listing names Marilyn Deamorim and Jake Vitale |

The final direct run made 13 fresh HTTP requests across the three supported brokerages. Centennial required four requests and about 1.77 seconds; Canvas required six and about 1.23 seconds; Next Step required three, including a redirect, and about 0.76 seconds. These are individual local measurements, not representative latency guarantees. The requests incurred no Tavily, Firecrawl, or model credits; normal network and compute costs still apply.

The original email test skipped three cards because they lacked a brokerage office address. Of the remaining two, it recovered DALLAL candidates and failed to verify Next Step’s website. The new parser accepts missing office addresses, the direct adapters recover the three routes above, and owner listings are explicitly classified. The improvement is meaningful, but a fresh direct run alone returns no verified named-person roster. DALLAL’s earlier candidates and Next Step’s research candidates are reported separately to avoid presenting researched answers as autonomous pipeline output.

## Listing evidence and contact findings

### Canvas at 503 West 22nd Street 5W

Canvas’s public rental catalog loads listings through a JavaScript-linked JSON endpoint. Its HTML shell alone is misleading: the raw detail page contains placeholder text about a different building and apartment. A reader that extracts that shell before the dynamic data arrives can confidently return the wrong property. The catalog script, detail script, and feed must be treated as an evidence chain.[^1]

The implementation follows the catalog’s listing link, reads its property identifier, checks the detail script’s public feed reference, and requests the corresponding record. The record identifies 503 West 22nd Street, apartment 5W, New York, three bedrooms, two bathrooms, and $8,800. It assigns info@canvaspg.com in its Agents array and explicitly identifies Canvas Property Group as the landlord’s exclusive broker. This supports a listing-specific team route, despite the mailbox’s generic-looking name.[^2]

The same record contains the invalid phone value 123456789. The adapter rejects it rather than treating every nonempty phone field as usable. A separate Playwright check observed the rendered address and apartment and read the inquiry link containing info@canvaspg.com; its phone parameter was undefined. The browser experiment corroborates the team email and the decision to leave the phone empty. No inquiry was submitted.

The feed’s current catalog membership and matching details support the observed match. They do not guarantee continuing availability or prove that every representative across other channels has been identified. The result therefore marks roster completeness as source-only. An operational system should recheck the record before acting on it and retain the retrieval timestamp.

### Centennial at 248 Mott Street 6-5

Centennial’s server-rendered catalog contains a $9,495, three-bedroom, two-bathroom rental at 248 Mott Street. Its listing page labels the apartment 5-6 and also uses 5/6 in the description. The email labels it 6-5. The matching street, price, room counts, and brokerage make it a strong candidate, but these facts do not establish that the identifiers are interchangeable.[^3]

The listing names Centennial Properties as its listing agent and publishes 212-228-9300. Its linked agent profile supplies a downloadable vCard with apts@centpropny.com. The code corroborates the vCard’s team identity and phone against the listing and checks its email against the listing’s published contact-form field. That establishes the candidate listing’s contact without inventing a person.[^4]

The output retains apts@centpropny.com and 212-228-9300 with a unit-conflict relationship and leaves outreach readiness false. It does not apply a global reversal rule. Such a rule could silently turn distinct apartments into one identity, as the earlier R4 versus 4R investigation demonstrated. A verified external listing identifier, an explicit alias from the brokerage, or a reviewed confirmation is needed to settle this case.

The vCard also carries an older office address than the current website footer. That discrepancy illustrates why contact enrichment should store evidence per field. A useful email and corroborated phone do not make every field in the same document current. The revised output warns about the card’s address and does not adopt it as current office evidence.

### Next Step at 423 West Street 1C

The exact indexed listing associates Marilyn Deamorim and Jake Vitale with 423 West Street 1C and Next Step Realty New York LLC. This is evidence for candidate attribution, not a directly verified primary-source roster. The brokerage’s public site did not expose a matching rental detail page during this evaluation.[^5]

Next Step’s official contact page verifies clients@nextstepny.com, 646-568-1311, and the office at 4 East 8th Street. Its legal company name appears on the website. The adapter uses these related primary pages to establish the organization, rather than requiring both legal name and office address to appear on the homepage. The result is explicitly an office route and does not assign that mailbox to either person.[^6]

Marilyn’s RentHop profile publishes marilyn@nextstepny.com and 917-848-1001 under Next Step Realty NY. This is a separate, secondary-platform contact source, with an inactivity signal that warrants a freshness check. It can support a reviewed candidate contact, but it is not equivalent to a current official brokerage profile. Jake’s official biography confirms his identity and says he is licensed as Jacob Vitale; the visible contact block is the general company contact. No individual email for Jake was established.[^7][^8]

This case separates three independent assertions: an index associates the names with the apartment; official brokerage pages establish the organization and Jake’s identity; a secondary agent profile publishes Marilyn’s contact details. Merging those assertions without their provenance would make a candidate look verified. The production schema should preserve the distinction even when the interface presents a convenient combined contact card.

### DALLAL at 118 Mulberry Street R4

The earlier exact-unit investigation identified Michael Dallal and Javier Cruz as candidates. Their official profiles publish mike@dallalnewyork.com, 516-673-7155, and javier@dallalnewyork.com, 347-654-8962, respectively. Their association with R4 came from indexed listing evidence; a matching current listing on the brokerage website was not established. These remain the existing candidate results rather than new direct-adapter successes.[^9][^10][^26]

The fresh direct benchmark intentionally reports no DALLAL adapter. Its purpose is to measure the new deterministic paths without importing prior answers. The generic search-and-extraction workflow remains available for this brokerage. An authenticated provider run is still needed to evaluate whether improved discovery can reproduce the candidates and find a stronger listing-attribution source.

### Owner listing at 57 Grand Street 4

Both the email card and the indexed advertisement identify the advertiser as Owner. The appropriate result is an owner-listed classification with no invented broker. No supported public email or phone was established for this advertisement.[^11]

Corporate ownership records, historic sales representatives, and businesses occupying the building answer different questions. They do not prove who is handling the current apartment inquiry. A product can retain the original advertisement’s inquiry route for user action, while reporting the absence of a supported email or phone. This unresolved contact should not be counted as successful broker enrichment merely because the system recognized an owner listing.

## Technology assessment

### Tavily for discovery

Tavily is a sensible default for the project’s search incentive. Its Search API supports targeted queries and domain filters, making it suitable for brokerage discovery, exact-unit searches, and independent candidate corroboration. Search should return source records and excerpts, not a generated answer treated as evidence. The application must still establish the property and contact relationships.[^12]

Tavily Extract is also worth testing before committing every page read to Firecrawl. It accepts known URLs and supports deeper extraction for harder pages. Whether its output preserves the relevant agent block, hidden contact links, and dynamic listing data on these brokerages is an empirical question. Its documentation establishes capabilities, not measured accuracy on this sample.[^13]

No Tavily key was configured for the live evaluation, so the current preference is architectural and incentive-driven. Existing mocked tests verify request construction and provider selection; they do not establish search recall. A fair next comparison would send the same frozen listing inputs to Tavily and the alternative search provider, score discovered correct listing URLs, and separately score contact attribution after reading those pages.

### Firecrawl for rendered extraction and recovery

Firecrawl remains useful for turning known pages into readable content and schema-shaped output. Its current documentation distinguishes single-page JSON scraping from autonomous Agent discovery and recommends Agent over the older Extract approach for that broader workflow. A single known page is a different task from finding the right page across a brokerage site.[^14]

The earlier live pilot demonstrated useful structured extraction and official-profile recovery. The follow-up investigation also encountered the keyless daily credit cap. Firecrawl’s documentation confirms that keyless access has daily request and credit limits, and that endpoints such as Map and Crawl require a key. Retrying the same exhausted quota cannot reveal additional data; the job should record capacity exhaustion and preserve existing findings.[^15]

The recommended role is a bounded fallback after direct readers or as the primary reader for an unfamiliar site. Keep raw text or HTML alongside extracted fields, and validate the quoted evidence. Firecrawl can parse an incorrect page perfectly, or return a syntactically valid person unrelated to the target listing. Schema conformance and page-reading success should never be the sole completion conditions.

### Direct HTTP and Cheerio

Direct HTTP plus Cheerio performed the most productive new work in this sample. Cheerio provides structured selection over retrieved HTML; it does not supply a search index or a browser’s executed application state. It is appropriate for static RealtyMX catalogs, explicit profile links, and contact cards. Dynamic sites require reading their linked public data feed or using a browser.[^16]

The strongest direct-adapter pattern is discovery through the site itself. For Canvas, the code does not hardcode propertyid 6. It discovers the listing URL in the catalog and follows the script’s feed contract. The automated test substitutes a different identifier to ensure the implementation does not accidentally depend on the investigated listing’s identifier. Only reviewed organization domains and the specific Canvas public feed path are allowed.

This approach has maintenance costs. Catalog markup, feed schemas, and links can change. The adapter should fail into a review or fallback state when expected structures disappear, instead of broadening selectors until unrelated content passes. Prioritize adapters by recurring brokerage volume and observed failure rate. Building a bespoke scraper for every one-off brokerage is unlikely to be the best first investment.

### Playwright and Stagehand

Playwright can observe network responses and inspect rendered page state. In the live Canvas experiment it verified the exact apartment and inquiry email in about 2.33 seconds. It is a useful investigation and fallback tool for a JavaScript shell whose raw HTML contains stale placeholders. Reading the rendered target elements is more informative than waiting an arbitrary number of seconds and scraping the whole page.[^17]

Stagehand adds AI-assisted browser actions and extraction. It could reduce the work needed to navigate unfamiliar brokerage layouts, particularly where fixed selectors are brittle. It was reviewed through current documentation but not installed or tested in this benchmark. Introducing it adds another model-dependent component; require measured improvement over the existing Playwright path before adding that operational dependency.[^18]

Browser automation should preserve the same evidence boundaries as direct reading. A contact obtained from a suggested-agent panel is not a listing agent just because it is visible in the browser. Rendering solves access to application state; it does not solve relationship attribution.

### LangChain and LangGraph

LangChain can help standardize model calls, tool interfaces, and structured extraction. LangGraph provides a lower-level orchestration model with durable execution and human-in-the-loop capabilities. These tools are compatible with a Tavily-centered design, but neither creates listing coverage on its own.[^19]

The useful graph for Scout would persist states such as parsed input, verified brokerage, listing candidates, verified identity, recovered contacts, and review required. A quota failure should resume from the last saved state rather than rerunning Gmail extraction and all prior searches. LangGraph’s persistence and checkpointing model is relevant to this requirement.[^20]

The current TypeScript service remains small enough to operate without a framework migration. Keep deterministic validation as ordinary functions and provider calls behind clear interfaces. Add LangGraph when there is a concrete need for resumable batches, a review queue, or parallel recovery branches. A framework-only rewrite would leave the demonstrated failures—missing offices, dynamic feeds, team contacts, and unit conflicts—unresolved.

### Alternative indexes and contact vendors

Exa is a credible alternate discovery provider to evaluate when Tavily fails to locate an exact listing or official profile. Its search API combines search and content retrieval controls. Its value should be measured as incremental coverage on listings that the preferred provider misses, with independent source validation afterward. No Exa key was configured, so no live accuracy or latency comparison is claimed.[^21]

Apollo can enrich a known person using identity and company information. Hunter offers domain search and email verification. These services address the person-to-contact step after attribution, not the property-to-agent step. A valid email for a real employee can still be the wrong recipient for a listing. Neither was used to fill unsupported contacts in the five-property result.[^22][^23]

If later enabled, keep vendor-supplied contacts distinct from source-published contacts, retain the matched company and identity evidence, and record verification dates. Email syntax, source publication, and deliverability are separate checks. This implementation validates syntax and published evidence; it does not claim mailbox deliverability or telephone reachability.

### Licensed listing data

For broader coverage, investigate a licensed REBNY RLS provider or brokerage data agreement. REBNY describes multiple technical distribution arrangements and prelicensed providers. Eligibility, permitted fields, retention, display, and usage rights must be established with the provider; publicly documented standards are not credentials or a data license.[^24]

RESO defines listing-related identifiers such as ListAgentKey, which is the kind of stable join a property-to-agent enrichment system benefits from. A licensed feed with listing and member identifiers could reduce reliance on ambiguous names and stale web pages. Actual provider field completeness, co-agent representation, team handling, and rental coverage need verification against a sample export.[^25]

This is the strongest long-term route to investigate for authoritative attribution, but it is not guaranteed to include every advertisement. Owner-listed inventory and listings absent from a contracted feed still need separate handling. A vendor trial should demonstrate coverage on the unresolved cases before the system assumes that a data agreement closes them.

## Implementation changes and operating contract

The revised service accepts a missing brokerage office address while rejecting malformed supplied values. It adds direct adapters for Canvas, Centennial, and Next Step, preserves the existing generic Tavily and Firecrawl workflow, and adds an explicit direct-only mode for reproducible tests without provider credits. It does not send messages or write enriched contacts into the application database.

The result now includes contactRoutes and resolution alongside agents and candidateAgents. Each route records its kind, relationship, source URLs, evidence, and retrieval time. A team with an exact listing relationship can be marked ready for reviewable outreach preparation; a brokerage office or unit-conflict contact cannot. The readiness flag remains a quality indicator, not an instruction or authorization to contact anyone.

Direct reading enforces reviewed HTTPS origins, checks redirects before following them, limits response size, caps requests, and caches successful responses. Source failures retain any already recovered route and mark execution incomplete. Direct requests count toward the service’s overall outbound request budget. Cached evidence retains its original timestamp so a cache hit cannot masquerade as a fresh source observation.

The enrichment test suite now contains 76 passing tests. New cases cover optional offices, dynamic Canvas identifiers, placeholder phones, mismatched property identity, missing feed fields, vCard parsing, owner classification, contact-evidence chains, cache reuse, and blocked redirects. The isolated enrichment TypeScript check passes. These tests establish behavior for the supported contracts; they are not evidence of representative market coverage.

## Production evaluation and next decisions

A single headline “success rate” would hide the largest risks. Track exact listing attribution, complete named-agent recall, team-route recovery, brokerage-office fallback, unresolved owner contacts, and unsupported-attribution rate separately. Track provider failures and source absence separately too: a quota-exhausted lookup is not evidence that no contact exists.

Expand the evaluation to a labeled sample spanning recurring brokerages, owner listings, leasing teams, multiple co-agents, reordered unit strings, stale campaigns, and contradictory page content. Hold out listings from adapter development so the test includes genuinely unseen apartments. Report first-pass and reviewed outcomes, source age, request counts, latency distributions, and cost per verified result. The five cases here are a diagnostic sample, not a statistically representative benchmark.

The next live provider comparison requires configured credentials. Tavily should be tested first because of the project incentive; Firecrawl should be tested with authenticated capacity to separate quota effects from extraction quality. Compare those results with the direct adapters using the same input cards and the same attribution rules. Exa or a browser agent should be introduced only where that controlled comparison exposes a meaningful discovery or rendering gap.

There are three bounded unresolved questions in the current findings: whether Centennial’s 6-5 and 5-6 refer to the same advertised apartment, whether a primary current source can establish DALLAL’s and Next Step’s complete named-agent rosters, and whether the owner advertisement exposes a supported email or phone through an authorized source. More tools can improve retrieval, but unsupported answers should remain unresolved until better evidence appears.

## Sources

Sources accessed September 12, 2026. Undated documentation is identified as such. Live benchmark records are retained locally under data/enrichment/research-v2; the evaluation measurements are original observations, not provider performance claims.

[^1]: Canvas Property Group. Rental catalog and its linked public catalog script. Undated. https://canvaspg.com/luxury-rentals/ and https://canvaspg.com/js/canvas/alllisting.js
[^2]: Canvas Property Group. Listing page, linked detail script, and public listing feed. Undated; observed September 12, 2026. https://canvaspg.com/luxury-rentals-listing-page/?propertyid=6 and https://canvaspg.com/js/canvas/singlelisting.js and https://mc.wlep1.com/api/ajax/canvas/single?propertyid=6
[^3]: Centennial Properties NY. 248 Mott Street 5-6 listing. Undated. https://centpropny.com/soho-nolita/apartment-for-rent/248-mott-st-5-6/5044
[^4]: Centennial Properties NY. Centennial Properties agent profile and downloadable contact card. Undated. https://centpropny.com/?page=agents&id=1 and https://www.centpropny.com/images//agents/1.vcf
[^5]: StreetEasy. 423 West Street 1C. September 2026 campaign; search-index evidence. https://streeteasy.com/building/four23-423-west-street-new_york/1c?similarHDP2=1
[^6]: Next Step Realty. Contact page. Undated. https://www.thenextsteprealty.com/contact
[^7]: RentHop. Marilyn Deamorim agent profile. Undated. https://www.renthop.com/managers/marilyndeamorim
[^8]: Next Step Realty. Jake Vitale biography. Undated. https://www.thenextsteprealty.com/agents/jake-vitale/
[^9]: DALLAL. Michael Dallal agent profile. Undated. https://dallal.realtymx.com/?page=agents&id=1
[^10]: DALLAL. Javier Cruz agent profile. Undated. https://dallal.realtymx.com/?page=agents&id=29
[^11]: StreetEasy. 57 Grand Street 4. September 2026 campaign; search-index evidence. https://streeteasy.com/building/57-grand-street-new_york/4
[^12]: Tavily. Search API reference. Undated. https://docs.tavily.com/documentation/api-reference/endpoint/search
[^13]: Tavily. Extract API reference. Undated. https://docs.tavily.com/documentation/api-reference/endpoint/extract
[^14]: Firecrawl. Choosing the Data Extractor. Undated. https://docs.firecrawl.dev/developer-guides/usage-guides/choosing-the-data-extractor
[^15]: Firecrawl. Rate Limits, Keyless access section. Undated. https://docs.firecrawl.dev/rate-limits
[^16]: Cheerio. Loading Documents. Undated. https://cheerio.js.org/docs/basics/loading/
[^17]: Microsoft Playwright. Network documentation. Undated. https://playwright.dev/docs/network
[^18]: Stagehand. Introducing Stagehand version 4. Undated. https://docs.stagehand.dev/v4/first-steps/introduction
[^19]: LangChain. LangGraph JavaScript overview. Undated. https://docs.langchain.com/oss/javascript/langgraph/overview
[^20]: LangChain. LangGraph JavaScript persistence. Undated. https://docs.langchain.com/oss/javascript/langgraph/persistence
[^21]: Exa. Search API reference. Undated. https://exa.ai/docs/reference/search
[^22]: Apollo. People Enrichment API reference. Undated. https://docs.apollo.io/reference/people-enrichment
[^23]: Hunter. API reference. Undated. https://hunter.io/api-documentation
[^24]: REBNY. RLS Technical Solutions. Undated. https://www.rebny.com/rls-technical-solutions/
[^25]: RESO. Data Dictionary 2.1 ListAgentKey field. Undated. https://dd.reso.org/DD2.1/Property/ListAgentKey/
[^26]: StreetEasy. 118 Mulberry Street R4. September 2026 campaign; previously retrieved search-index evidence. https://streeteasy.com/building/118-mulberry-street-new_york/r4
