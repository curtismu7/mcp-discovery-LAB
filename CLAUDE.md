# CLAUDE.md

MCP Discovery (tier: Tester, port 5310). A read-only demo that finds MCP servers, probes their tool metadata (`tools/list` only, no tool is ever called), flags poisoned metadata and shows what changed between two scans (possible rug-pull). Demo mode is the default: fixtures plus five in-process stub servers on loopback. See [README.md](README.md) for the full description, API and UI.

## Commands

```bash
npm install
npm test            # server, web and scripts/*.test.mjs (compose, docs, content-pack, shelf-entry, k8s)
npm run build       # web/dist
npm run doctor      # node, bind, port range, mode, free ports
npm run e2e         # real headless Chromium run (Playwright)
npm run content-pack  # regenerate and validate content-pack.json
npm start           # http://127.0.0.1:5310/ (build first to get the UI)
```

Ports: server 5310 (`MCP_DISCOVERY_PORT`, 5300-5999 only), demo stubs 5311-5315, Vite dev 5330. Docker: `docker compose up --build -d`, published on `127.0.0.1` only.

## Rules that bite here

- Loopback only: bind `127.0.0.1`, non-loopback `Host` gets 421, cross-site `Origin` gets 403. Do not widen compose ports.
- No real network, hosts or tenants. Demo mode must make zero non-loopback connections and never read the host. Live mode (`MCP_DISCOVERY_LIVE=1`) is owner-run only.
- Server-provided text is inert: render as React text, never HTML; no `eval`/`Function`.
- `MODE=se-mock` is the hosted build (rule 18): any live setting must stay refused, state must stay per workspace (a new piece of server state needs a per-workspace home and a line in the table in [docs/k8s.md](docs/k8s.md)), and `k8s/deploy.sh` is never run by an agent without `--dry-run` (the first SE deploy is owner-approved).
- Test scripts use globs (`node --test test/*.test.js`), never a directory (fails on Node 22).
- Never use `crypto.generateKeyPairSync` or async `generateKeyPair` (aborts on Node 20 in CI).
- Never parse `node:test` stdout; use the exit code.
- Forbidden-strings history scan must print 0: `git log -p --all | grep -cF -f ~/.config/demo-kit/forbidden-strings.txt`. Never print the list.
- gitleaks runs in `.githooks/pre-commit`; keep it installed.
- Docker is OrbStack only, never Docker Desktop.
- This app issues and accepts no tokens (credential headers are refused with 400). Any mock token added later must be labelled as mock.
- Product claims are UNVERIFIED unless a source is cited. The README lists what was not verified.

## Where the safety claims are pinned

Table in [docs/safety.md](docs/safety.md). Main files: `server/test/safety.test.js` (demo mode, bind, no process/file/network), `server/test/api.test.js` (Host, CSRF, credentials, 429), `server/test/scanner.test.js` and `probe.test.js` (methods sent, no redirects), `server/test/policy.test.js` and `sanitize.test.js` (redaction, inert text), `scripts/compose.test.mjs` (loopback publish), `server/test/hosted.test.js` and `scripts/k8s.test.mjs` (hosted build: refused live settings, workspace isolation, manifests).

## Shelf and content pack

- Shelf: edit [docs/shelf-entry.json](docs/shelf-entry.json) (catalog id D5). `scripts/shelf-entry.test.mjs` checks it against a copy of the shelf rules. Do not edit the shelf repo from here.
- Content pack: edit `content/terms.json` or `content/stories.json`, run `npm run content-pack`, commit `content-pack.json`. `npm test` fails if it is stale.
- Keep the UI story strip (`web/src/components/Story.jsx`) and `content/stories.json` in step.
- Talk track: [docs/talk-track.md](docs/talk-track.md).
