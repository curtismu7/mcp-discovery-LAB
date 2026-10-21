# Architecture

One Node process (Express, ESM). No database: the inventory is in memory in demo mode.

```
 POST /api/scan
      |
   runtime.js -- demo: demo/stubs.js (5 in-process MCP stubs, 127.0.0.1:5311-5315) + demo/fixtures.js (fake ps/lsof/docker/config)
      |       `- live (MCP_DISCOVERY_LIVE=1): live.js (the only file that touches the host)
      v
   scanner.js
      |-- candidates/*        processes, listeners, compose, client configs, remote URLs  -> merged candidates
      |-- redaction.js        secrets removed from each candidate BEFORE it is probed
      |-- probe.js            policy.js (loopback only) -> JSON-RPC over HTTP -> toolcheck.js -> sanitize.js
      |-- diff.js             previous scan vs this one: new / changed / gone, possible rug-pull
      `-- store.js            latest scan (memory, or a file in live mode with MCP_DISCOVERY_STORE_PATH)
```

The discovery code is ported from the AI-DEMO2 `standalone/mcp-discovery-agent`. The scanner import from the sibling `mcp-scanner` repo was replaced by `server/src/toolcheck.js`.

## The pieces

| Piece | File | Job |
| --- | --- | --- |
| API | `server/src/app.js` | `/api/health`, `/api/scan`, `/api/inventory`, `/api/inventory/:id`, `/api/reset`. Host, Origin (CSRF) and credential guards; JSON only. |
| Static UI | `server/src/app.js` | Serves `web/dist` when it exists (`express.static`, same-origin CSP). `/api` keeps `default-src 'none'`. Host and Origin guards cover both. |
| Runtime | `server/src/runtime.js` | Picks demo or live, builds the host, store and probe limits, serialises scans. |
| Safety | `server/src/safety.js` | Loopback rule, port range, live switch, Host and credential guards. See [safety.md](safety.md). |
| Candidates | `server/src/candidates/` | Turns `ps`, `lsof`, `docker ps`, client configs and remote URLs into candidates. A stdio process whose pid owns a listener is folded into the listener. |
| Probe | `server/src/probe.js` | `server/discover`, falling back to `initialize`, then `tools/list`. Redirects refused, bodies capped at 1 MB, a timeout per probe, fixed headers. Maps failures to `offline` (timeout), `degraded` (`auth_required`, redirect, too large, method not found). |
| Tool check | `server/src/toolcheck.js` | Hash of canonical tool metadata, plus findings. |
| Sanitize | `server/src/sanitize.js` | Makes server-provided text inert. |
| Redaction | `server/src/redaction.js` | Removes secret-looking strings. |
| Diff | `server/src/diff.js` | Scan-to-scan comparison. |
| Health | `server/src/health.js`, `doctor.js` | `GET /api/health` (`demo-health/1`), state cached 60 s from the doctor checks. `npm run doctor` also checks that the server port and the five stub ports 5311-5315 are free; 5316-5319 are inside the reserved range but are not checked, because nothing binds them. |

## Statuses

`healthy` (probed, no findings), `review` (only medium findings, i.e. a broad schema), `hostile` (any high finding: hidden characters or instruction-like text), `degraded` (answered but unusable: `auth_required`, redirect, too large, method not found), `offline` (timeout or connection failure), `candidate` (found but not probed: stdio, remote, skipped, or not allowed).

## Tool metadata check

The hash is `sha256` of the canonical JSON of every tool's `name`, `description` and `inputSchema`, tools sorted by name and object keys sorted at every depth, so ordering never changes it. Findings, each with the tool, the field and a short evidence string (hidden characters shown as `[U+XXXX]`):

- `invisible-characters` (high): zero-width, bidi, tag, Braille-blank and similar characters in a name, description or schema description.
- `hidden-instruction` (high): a few instruction-like patterns, checked after removing hidden characters so splitting a phrase with one does not hide it.
- `broad-schema` (medium): no input schema, `additionalProperties: true`, or an object schema with neither `properties` nor `additionalProperties: false`.

## Scan diff

Records are matched by id (a hash of source, location, endpoint, pid, container, name). A record with no match before is `new`; one in the previous scan and absent now is `gone`; one whose status, metadata hash or error code differs is `changed`. A changed metadata hash where both scans got a hash is flagged `possibleRugPull: true` with the tool names added, removed or changed.

## The demo servers

| Port | Stub | What a scan shows |
| --- | --- | --- |
| 5311 | clean | `healthy`, two tight tools |
| 5312 | poisoned | `hostile`: instruction-like description, a hidden character, a broad schema |
| 5313 | rug-pull | `healthy` on the first scan; from the second `tools/list` on, its description carries an added instruction: hash change, `possibleRugPull`, `hostile` |
| 5314 | timeout | `offline`, `timeout` (never answers) |
| 5315 | auth | `degraded`, `auth_required` (always 401) |

`POST /api/reset` clears the inventory and restarts the rug-pull stub's count.
