// Scan diff: new / changed / gone servers between two scans. A changed tool-metadata hash on a server that
// answered both times is reported as a possible rug-pull (the tools changed after they were first seen).
const brief = (r) => ({ id: r.id, displayName: r.displayName, endpoint: r.endpoint, status: r.status });

function toolChanges(a = {}, b = {}) {
  return {
    added: Object.keys(b).filter((n) => !(n in a)),
    removed: Object.keys(a).filter((n) => !(n in b)),
    changed: Object.keys(b).filter((n) => n in a && a[n] !== b[n]),
  };
}

// The baseline for rug-pull detection is the last hash a server answered with, not the previous scan's hash: a
// timeout or a 401 in between makes the hash null and must not make the next change invisible.
const baselineOf = (r) => (r.lastGoodToolMetadataHash
  ? { hash: r.lastGoodToolMetadataHash, tools: r.lastGoodToolHashes }
  : { hash: r.toolMetadataHash, tools: r.toolHashes });

export function diffScans(previousRecords, nextRecords) {
  const prev = (previousRecords || []).filter((r) => !r.gone);
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const nextById = new Map(nextRecords.map((r) => [r.id, r]));
  const out = { firstScan: prev.length === 0, new: [], gone: [], changed: [], unchanged: 0 };
  for (const record of nextRecords) {
    const before = prevById.get(record.id);
    if (!before) { out.new.push(brief(record)); continue; }
    const changes = [];
    if (before.status !== record.status) changes.push({ field: 'status', from: before.status, to: record.status });
    if (before.toolMetadataHash !== record.toolMetadataHash) changes.push({ field: 'toolMetadataHash', from: before.toolMetadataHash, to: record.toolMetadataHash });
    if (before.probe?.errorCode !== record.probe?.errorCode) changes.push({ field: 'errorCode', from: before.probe?.errorCode ?? null, to: record.probe?.errorCode ?? null });
    if (!changes.length) { out.unchanged += 1; continue; }
    const base = baselineOf(before);
    const rugPull = Boolean(base.hash && record.toolMetadataHash && base.hash !== record.toolMetadataHash);
    if (rugPull) for (const c of changes) if (c.field === 'toolMetadataHash') c.from = base.hash; // show the last answered hash, not null
    out.changed.push({
      ...brief(record), changes, possibleRugPull: rugPull,
      ...(rugPull ? { toolChanges: toolChanges(base.tools, record.toolHashes), note: 'possible rug-pull: the tool metadata changed since the last scan that got an answer' } : {}),
    });
  }
  for (const record of prev) if (!nextById.has(record.id)) out.gone.push(brief(record));
  return out;
}
