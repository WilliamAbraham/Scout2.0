# Broker enrichment research findings

The finalized findings are in [the Word report](../../broker-enrichment-findings.docx), with the implemented contract and run instructions in [the service guide](../../broker-enrichment.md).

The recommended v1 uses Tavily for search and Firecrawl for rendering and structured extraction. LangChain is optional orchestration infrastructure; LangGraph is a later option for persisted workflows. Firecrawl keyless search and extraction were exercised live; Tavily was checked against its official documentation and covered with a simulated adapter test because no API key was configured.

The exact 118 Mulberry Street #R4 run recovered Michael Dallal and Javier Cruz as review candidates, with public contacts verified on official profiles. The listing relationship was only available in search-index evidence. An earlier #4R result was excluded. The result does not establish the complete current roster.

Other research cases:

- [REAL NY 448 West 19th Street #3CD](https://www.realnyproperties.com/chelsea/apartment-for-rent/448-west-19th-street-3cd/220689): rendering exposed contact information for Paul Morrissette and Luke Joyce that raw HTML left obfuscated.
- [REAL NY 245 Eldridge Street #1R](https://www.realnyproperties.com/lower-east-side/apartment-for-rent/245-eldridge-street-1r/220466): heading and description disagreed on unit. Extraction must preserve the contradiction and require review.
- [Canvas rental catalog](https://canvaspg.com/luxury-rentals/): rendering made the catalog accessible, but did not establish the target unit or an agent email.
- The Essex and Glenwood cases exposed phone/form contact routes without establishing a universal email fallback.

These are exploratory observations, not a representative benchmark. Before scaling, label a cross-brokerage sample and measure identity precision, full-roster recall, direct-email precision, review rate, latency and cost. No messages were sent during research.
