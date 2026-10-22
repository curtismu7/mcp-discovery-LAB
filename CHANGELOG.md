# Changelog

## Unreleased

- k8s: hosted mock build for the SE cluster (rule 18). `MODE=se-mock` (default `local`, unchanged) refuses every live setting in the doctor, health and startup, keeps one isolated in-memory workspace per `X-Workspace-Id` (strict charset, capped at 50, 30 minute idle eviction, per-workspace stub counters), accepts the configured `MCP_DISCOVERY_PUBLIC_HOST`, and adds `mode`/`hosted` to the health reply. The UI shows a HOSTED SIMULATION banner on every tab. Manifests, an owner-approved `k8s/deploy.sh` with `--dry-run`, `scripts/k8s.test.mjs`, `docs/k8s.md`. Not deployed.

## 0.1.0

- MD0/MD1: discovery ported from the AI-DEMO2 source demo (candidate sources, inventory, probe, target policy, redaction, store), self-contained tool-metadata checker, demo mode with five stub MCP servers and fixtures, scan diff with possible rug-pull, API, `GET /api/health` (`demo-health/1`), doctor.
- MD2: web UI (inventory, scan diff, pipeline diagram, detail drawer, inert text), review fixes (CSRF rule, broader sanitising and redaction, checker coverage, tests on free ports), Playwright e2e (`npm run e2e`, not CI).
- MD3: multi-stage Dockerfile that builds and ships `web/dist`, loopback-published compose with `/api/health` healthcheck, Learning Hub content pack (`content-pack.json`, generator, ajv validator, schema copy, glossary), shelf registry entry (`docs/shelf-entry.json`) validated by a copy of the shelf's rules, this changelog.
