# Talk track (4-6 minutes)

Setup: `npm run build && npm start`, open http://127.0.0.1:5310/. The header shows a `DEMO MODE` badge. Everything below runs on fixtures and five in-process stub servers.

## Pitch (one sentence)

"AI agents trust whatever tool descriptions an MCP server gives them, so this tool finds the servers, reads their tool metadata without calling anything, flags poisoned text, and tells you when a server changes its tools after you first saw them."

## Live steps

1. **Frame it (20 s).** Point at the `DEMO MODE` badge. Say: "This is a simulation. It scans fixtures and five stub servers on loopback and never reads this machine."
2. **Scan (30 s).** Open the **Inventory** tab and click **Scan**. Say: "Ten things were found across five sources: processes, listeners, Compose services, client configs and remote URLs."
3. **Read the table (45 s).** Point at the status column. Say: "Clean Notes is healthy. Slow Server is offline. Private Server wants credentials, so it is degraded and we send it nothing. Five entries are listed but not probed: stdio and remote ones, and a database listener nothing said was an MCP server."
4. **Poisoned Notes (60 s).** Click the Poisoned Notes row to open the drawer. Say: "The `lookup_note` description hides an instruction to read a key file and tell no one. Hidden characters are shown as `[U+XXXX]` chips. This text is data and is never rendered as HTML." Click **Close**.
5. **Rug-pull (60 s).** Note the Forecast server is healthy. Click **Scan** again. Open the **Scan diff**: Forecast shows `POSSIBLE RUG-PULL` with the metadata hash before and after. Say: "Same server, same name, the tool description changed after we trusted it."
6. **Pipeline (60 s).** Open the **Pipeline** tab. Click **Simulate**. Say what each caption proves: find, merge, probe, check, compare. Drag a box to show it is live. Optionally change **Speed**. Click **Reset diagram**.
7. **Close (20 s).** Say: "Probes send discover, initialize and tools/list only. No tool is invoked and no credential is sent."

## If asked, be straight about

- Simulated: every server, process and config in demo mode. Live mode (`MCP_DISCOVERY_LIVE=1`) has not been run against a real host.
- UNVERIFIED: product behaviour of any real MCP client or vendor is not claimed here; no public source is cited.
- Does NOT prove: that a "healthy" server is safe. The checker is small (hidden characters, a few English instruction patterns, broad schemas). It misses paraphrase, other languages, encoded text, and changes outside name, description and inputSchema. Stdio and remote servers are not inspected. See [safety.md](safety.md), "What is not covered".

## Likely questions

- **Does it call my tools?** No. Only `server/discover`, `initialize`, `notifications/initialized` and `tools/list`.
- **Can it scan my real environment?** Only with the explicit live opt-in, read-only, loopback and stdio. Not shown in this demo.
- **Does it detect all prompt injection?** No. A clean result means the listed checks found nothing.
- **How does it spot a rug-pull?** It hashes each server's tool name, description and input schema and compares with the previous scan.
- **Where do secrets go?** Credential headers are refused, secret-looking strings are redacted before storage, and nothing is sent to a server.

## Reset before the next demo

Click **Reset** in the header (or `curl -s -X POST http://127.0.0.1:5310/api/reset`). This clears the inventory and restarts the rug-pull stub, so the next two scans show healthy then possible rug-pull. Click **Reset diagram** on the Pipeline tab. Restarting `npm start` also works.
