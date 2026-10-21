# Changelog

## 0.1.0

- MD0/MD1: discovery ported from the AI-DEMO2 source demo (candidate sources, inventory, probe, target policy, redaction, store), self-contained tool-metadata checker, demo mode with five stub MCP servers and fixtures, scan diff with possible rug-pull, API, `GET /api/health` (`demo-health/1`), doctor.
- MD2: web UI (inventory, scan diff, pipeline diagram, detail drawer, inert text), review fixes (CSRF rule, broader sanitising and redaction, checker coverage, tests on free ports), Playwright e2e (`npm run e2e`, not CI).
- MD3: multi-stage Dockerfile that builds and ships `web/dist`, loopback-published compose with `/api/health` healthcheck, Learning Hub content pack (`content-pack.json`, generator, ajv validator, schema copy, glossary), shelf registry entry (`docs/shelf-entry.json`) validated by a copy of the shelf's rules, this changelog.
