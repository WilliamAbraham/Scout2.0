# Broker enrichment fixture

`118-mulberry-r4.json` contains only the listing facts visible in the supplied email screenshot. No agent name, email, phone, brokerage website or listing URL is prefilled.

From the repository root:

```sh
npm run enrich -- backend/fixtures/enrichment/118-mulberry-r4.json
npm run test:enrichment -w backend
npm run typecheck:enrichment -w backend
```

See [the service guide](../../../docs/broker-enrichment.md) for configuration, result semantics and the dated observed result. Live responses can change; this fixture is input, not a frozen assertion about today's roster.
