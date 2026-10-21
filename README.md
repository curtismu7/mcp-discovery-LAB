# MCP Discovery

A read-only MCP discovery demo. It finds MCP servers (processes, listeners, Compose services, client configs, remote URLs), probes each reachable one for its tool metadata, flags poisoned metadata, and shows what changed between two scans, including a possible rug-pull (the tool metadata changed after it was first seen).

The server, the API and a web UI exist.

Demo mode is the default: it scans fixtures and five in-process stub MCP servers on loopback, and never reads your machine. Scanning the real host is a separate, explicit opt-in (`MCP_DISCOVERY_LIVE=1`, below).

## Status

Built and tested:

- Discovery ported from the AI-DEMO2 `standalone/mcp-discovery-agent`: candidate sources, inventory records, probe, target policy, redaction, store.
- A self-contained tool-metadata checker (`server/src/toolcheck.js`) in place of the old import from the sibling `mcp-scanner` repo: a hash of the canonical metadata, plus findings for hidden characters, instruction-like text and overly broad schemas.
- Demo mode: stub servers on `127.0.0.1:5311-5315` (clean, poisoned, rug-pull, timeout, auth required) and fake process, listener, Compose and client-config fixtures.
- Scan diff (new, changed, gone, possible rug-pull).
- The API, `GET /api/health` (`demo-health/1`), the doctor, Docker files.
- The web UI (`web/`, React + Vite + React Flow): see [The web UI](#the-web-ui).

Not verified: live mode has not been run against a real host (the tests run the same parsers on fixtures). The Docker image was built and run on OrbStack only: `GET /api/health` and `POST /api/scan` answered on `127.0.0.1:5310`.

Not built: probing of remote servers, stdio servers (they are listed, never started), CI.

## Run it

```bash
npm install
npm run doctor      # node, bind, port range, mode, free ports
npm test
npm start           # http://127.0.0.1:5310/  (MCP_DISCOVERY_PORT to change; ports 5300-5999 only)
```

With the UI: `npm run build && npm start` serves `web/dist` and the API together on `http://127.0.0.1:5310/`. Without `web/dist`, `GET /` is a JSON 404 and the API still works.

```bash
curl -s http://127.0.0.1:5310/api/health
curl -s -X POST http://127.0.0.1:5310/api/scan        # first scan
curl -s -X POST http://127.0.0.1:5310/api/scan        # second scan: the rug-pull stub's metadata hash changes
curl -s http://127.0.0.1:5310/api/inventory
curl -s -X POST http://127.0.0.1:5310/api/reset       # clear the inventory, restart the rug-pull
```

## API

| Route | Does |
| --- | --- |
| `GET /api/health` | `demo-health/1`. `runtime` is `offline` in demo mode and `live` in live mode. |
| `POST /api/scan` | Runs a scan, returns `mode`, `records`, `diagnostics`, `diff`, `summary`. Takes no body fields. |
| `GET /api/inventory` | The latest scan: `records`, `diff`, `summary`. |
| `GET /api/inventory/:id` | One record, or 404. |
| `POST /api/reset` | Clears the inventory and the stubs' counters. |

A scan in demo mode returns ten records: clean (`healthy`), poisoned (`hostile`, with findings), rug-pull (`healthy`, then `hostile` with `possibleRugPull` in the diff on the second scan), timeout (`offline`), auth (`degraded`, `auth_required`), and five that are listed but not probed (a stdio process, a stdio client-config entry, a remote client-config entry, a remote URL, and a non-MCP listener). See [docs/architecture.md](docs/architecture.md).

## The web UI

`web/` is a React + Vite workspace (React Flow for the diagram, vitest + Testing Library for tests). Theme tokens, dark and light with a toggle, no purple.

- Header: a `DEMO MODE` badge, and in live mode a `LIVE` badge plus a loud banner, both from `GET /api/health`.
- Inventory: servers with source(s), status (`candidate`, `healthy`, `review`, `hostile`, `offline`, `degraded`), confidence, transport, tools and findings. A record opens in a detail drawer (`GET /api/inventory/:id`). **Scan** and **Reset** buttons; the scan result is announced in an `aria-live` region.
- Scan diff: new, changed and gone since the previous scan. A changed metadata hash is flagged `POSSIBLE RUG-PULL` with the hash before and after.
- Pipeline: a movable diagram (sources, candidates, probe, inventory, findings) with Simulate, Reset and speed. The step captions use the numbers from the last real scan. A story strip says what each step proves.
- Inert text: every string a server provides (tool names and descriptions, server info, instructions, command lines) is rendered as a React text node, never HTML. Hidden characters are shown as `[U+XXXX]` chips (the server does it too; the UI repeats it as defence in depth).

```bash
npm run dev          # Vite on http://127.0.0.1:5330 (VITE_PORT), proxies /api to the server on 5310; start the server with npm start
npm run build        # web/dist, which `npm start` serves
npm run e2e          # real headless Chromium run (Playwright), screenshots to .data/e2e-screenshots or E2E_SHOTS
```

The server serves `web/dist` itself (`express.static`) with `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; ...`; `/api` responses keep `default-src 'none'`. The Host guard and the Origin guard apply to static files too. The Docker image does not include `web/dist` (API only).

## Safety rules

- Demo mode never touches the real host and makes no non-loopback connection. A test replaces every child-process and file-read function with one that fails, blocks non-loopback sockets, DNS and `fetch`, and runs full scans.
- Binds `127.0.0.1` only; a non-loopback `Host` header gets 421.
- No credential is accepted (an `Authorization`, `Proxy-Authorization` or `X-API-Key` header gets 400, and a scan takes no body fields) and none is ever sent to a server. A server that wants one is reported as `auth_required`.
- Probes send `server/discover`, `initialize`, `notifications/initialized` and `tools/list` only. No tool is invoked.
- Secret-looking strings are redacted; server-provided text is treated as untrusted data and made inert.

Each rule and its test is listed in [docs/safety.md](docs/safety.md).

## Live mode (opt-in)

```bash
MCP_DISCOVERY_LIVE=1 npm start
```

Reads this machine with `ps`, `lsof` (listening TCP), `docker ps`, and the client config files you list in `MCP_DISCOVERY_CONFIG_PATHS`. Read-only, loopback and stdio only, still redacted. Only exactly `1` enables it; other values make the doctor fail. It refuses to bind a non-loopback address. A listener is probed only if a Compose label, a client-config entry or an MCP-looking process says it is an MCP server. Remote URLs (`MCP_DISCOVERY_REMOTE_URLS`) are listed and never contacted. The inventory is kept in memory unless `MCP_DISCOVERY_STORE_PATH` is set. See `.env.example`.

## Docker

```bash
docker compose up --build -d      # http://127.0.0.1:5310 ; HOST_PORT=5311 to change the published port
docker compose down
```

Demo mode only, Node 22, non-root, read-only filesystem, all capabilities dropped, no host mounts. The server binds `0.0.0.0` inside the container (the image sets `MCP_DISCOVERY_BIND`, the explicit opt-in) and compose publishes the port as `127.0.0.1:PORT:5310`; a test pins that. Do not widen it.

## Layout

```
server/src/      app, runtime, safety, probe, toolcheck, candidates/, demo/ (stubs, fixtures), live.js
server/test/     node:test suites (one netguard helper blocks non-loopback network)
web/             React UI (src/components, src/lib, src/test), vite.config.js
scripts/         doctor.mjs, e2e.mjs, compose.test.mjs, docs.test.mjs
docs/            safety.md, architecture.md
```

Licence: MIT, see `LICENSE`.
