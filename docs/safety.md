# Safety

This app inspects tool metadata that servers supply, and that metadata is untrusted. It is built so that running it, in its default mode, cannot reach anything real. Each rule below names the test that enforces it. Run them all with `npm test`.

| Rule | Enforced by |
| --- | --- |
| Demo mode is the default. It scans fixtures and in-process stub servers only; the real host is never read. Live mode needs `MCP_DISCOVERY_LIVE=1` exactly (`true`, `yes`, `0` and the empty string are refused by the doctor, not treated as on). | `server/test/safety.test.js`: "live mode needs exactly MCP_DISCOVERY_LIVE=1" and "default mode: a full scan makes zero non-loopback connections, only ever touches stub ports, and never reads the real host" (every child-process and file-read function is replaced by one that records and throws, for the whole scan). |
| Only `server/src/live.js` starts a process (`ps`, `lsof`, `docker ps`, fixed argv, no shell), and only `runtime.js` can import it, and only in live mode. | `safety.test.js`: "source scan: only live.js starts processes or reads files for the host". |
| Default mode makes no non-loopback connection of any kind: no socket, no DNS lookup, no `fetch`. | `safety.test.js` (the guard in `server/test/netguard.js` blocks and records them; also run through `POST /api/scan`), "the guard itself works". |
| A probe contacts a loopback host only, and in demo mode only the stub ports. A remote URL is listed and never contacted. | `server/test/policy.test.js` ("the loopback scope allows only loopback hosts"), `scanner.test.js` ("stdio and remote candidates are never contacted"), `probe.test.js`. |
| A listener is probed only when something says it is an MCP server (a Compose service, a client-config entry, or a pid that is an MCP-looking process). A random local service is never sent a request. | `scanner.test.js`: the `postgres 5319` decoy is `probe_skipped_unconfirmed` with no attempt. |
| A probe sends `server/discover`, `initialize`, `notifications/initialized` and `tools/list` and nothing else. No tool is ever invoked. | `scanner.test.js`: "only the listed tool methods are sent". |
| No credential is accepted or sent. A request with `Authorization`, `Proxy-Authorization` or `X-API-Key` is refused (400). `POST /api/scan` and `POST /api/reset` take no body fields. A server that answers 401/403 is reported as `auth_required` and is not retried with anything. | `server/test/api.test.js`: "credentials are refused"; `scanner.test.js`: the auth stub records that no credential header ever arrived. |
| The server binds `127.0.0.1` only, refuses another address unless `MCP_DISCOVERY_BIND` is set, and refuses any non-loopback bind together with live mode. A non-loopback `Host` header gets 421. | `safety.test.js`: "binds loopback by default", "a started server is actually listening on loopback only"; `api.test.js`: "a non-loopback Host header is refused". |
| Every port is in 5300-5999. | `safety.test.js` and the doctor's `port-range` check; `scripts/compose.test.mjs` for the published port. |
| Secret-looking strings (secret query parameters, `--api-key=...`, `TOKEN=...`, bearer tokens, URL userinfo, token-shaped strings) are redacted before a record is stored or returned, and `headers` / `environment` fields are dropped. | `policy.test.js` (redaction), `scanner.test.js`: "secret-looking strings in the fixtures never reach the scan output". |
| Server-provided strings (names, descriptions, schemas, instructions) are untrusted data: hidden and control characters are shown as `[U+XXXX]`, sizes and depth are bounded, they are served only as JSON with `nosniff` and `Content-Security-Policy: default-src 'none'`, and nothing is evaluated or followed. | `sanitize.test.js`, `scanner.test.js`: "server-provided text is inert in records", `api.test.js`: "responses are JSON with nosniff". |
| The container publishes its port on loopback only, with no host mounts, no docker socket and no `MCP_DISCOVERY_LIVE`. | `scripts/compose.test.mjs`. |
| No real credentials in the repo. | `.githooks/pre-commit` runs gitleaks on staged changes when it is installed. The only secret-shaped strings are the obviously fake ones in `server/src/demo/fixtures.js`. |

## Live mode

`MCP_DISCOVERY_LIVE=1 npm start` reads this machine: `ps`, `lsof` (listening TCP), `docker ps`, and the client config files named in `MCP_DISCOVERY_CONFIG_PATHS`. It is read-only, loopback and stdio only, and the output is redacted the same way. It is not covered by the automated tests against a real host (they use the same parsers on fixtures); see the README for what was and was not run.

What live mode still does: it sends the four JSON-RPC methods above, as POST requests, to loopback ports it has reason to think are MCP servers. A POST is not guaranteed to be free of side effects on a server that is not what it says it is. That is why unconfirmed listeners are skipped.

## What is not covered

- Stdio servers are listed from the process table and client configs and are never started or attached to, so their tools are not inspected.
- The metadata checker is small on purpose (hidden characters, a few instruction patterns, broad schemas). A clean result means none of those matched, not that a server is safe.
- The metadata hash covers `name`, `description` and `inputSchema` only. A change to anything else (annotations, `title`, `_meta`) is not noticed.
- Remote servers are not probed at all in this version.
