import { discoverCandidates } from './candidates/index.js';
import { createInventoryRecord, normalizeCandidate } from './inventory.js';
import { probeCandidate } from './probe.js';
import { redactRecord } from './redaction.js';
import { diffScans } from './diff.js';

// A candidate is probed only when the user (compose label, client config) or the process list (a listener whose pid
// is an MCP-looking process) says it is an MCP server. A random local listener is never sent a request.
export function probeEligible(candidate, mcpPids) {
  if (!candidate.endpoint) return false;
  if (candidate.sources.some((s) => s === 'compose-service' || s === 'client-config')) return true;
  return candidate.sources.includes('listener') && candidate.process?.pid != null && mcpPids.has(candidate.process.pid);
}

// host: { execFile, fsImpl, clientConfigPaths, remoteUrls, compose }.  Returns the scan result (already redacted).
export async function runScan({ host, store, probeOptions = {} } = {}) {
  const scanId = `scan-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const discovered = await discoverCandidates({
    execFile: host.execFile, fsImpl: host.fsImpl, remoteUrls: host.remoteUrls,
    clientConfigPaths: host.clientConfigPaths, compose: host.compose,
  });
  const mcpPids = new Set(discovered.candidates.filter((c) => c.source === 'host-process' || c.sources.includes('host-process')).map((c) => c.process?.pid).filter((p) => p != null));
  const records = [];
  for (const raw of discovered.candidates) {
    // Redact before probing: secret query parameters are stripped from the URL we contact and from the id.
    const candidate = normalizeCandidate(redactRecord(raw));
    let record;
    if (candidate.transport !== 'stdio' && !probeEligible(raw, mcpPids)) {
      record = createInventoryRecord(candidate);
      record.probe.errorCode = candidate.location === 'remote' ? 'remote_not_contacted' : 'probe_skipped_unconfirmed';
    } else {
      record = await probeCandidate(candidate, probeOptions);
    }
    records.push(redactRecord(record));
  }
  const previous = store ? await store.snapshot() : { records: [] };
  // Carry the last non-null hash forward so a timeout or a 401 between two answers does not erase the baseline.
  const before = new Map(previous.records.filter((r) => !r.gone).map((r) => [r.id, r]));
  for (const record of records) {
    const prev = before.get(record.id);
    if (record.toolMetadataHash) { record.lastGoodToolMetadataHash = record.toolMetadataHash; record.lastGoodToolHashes = record.toolHashes; }
    else if (prev) {
      const hash = prev.lastGoodToolMetadataHash || prev.toolMetadataHash;
      if (hash) { record.lastGoodToolMetadataHash = hash; record.lastGoodToolHashes = prev.lastGoodToolMetadataHash ? prev.lastGoodToolHashes : prev.toolHashes; }
    }
  }
  const diff = diffScans(previous.records, records);
  const result = { scanId, startedAt, completedAt: new Date().toISOString(), records, diagnostics: discovered.diagnostics, diff };
  if (store) await store.replaceScan(result);
  return result;
}
