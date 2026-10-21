import { discoverProcesses } from './processes.js';
import { discoverListeners } from './listeners.js';
import { discoverCompose } from './compose.js';
import { discoverClientConfigs } from './clientConfig.js';
import { discoverRemoteUrls } from './remoteUrls.js';
import { normalizeCandidate } from '../inventory.js';

function mergeCandidates(candidates) {
  const byKey = new Map();
  for (const candidate of candidates) {
    const key = candidate.endpoint || `${candidate.source}:${candidate.process?.pid || candidate.process?.command || candidate.container?.name || candidate.id}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...candidate, sources: [candidate.source] });
      continue;
    }
    current.sources = [...new Set([...current.sources, candidate.source])];
    if (candidate.confidence === 'observed') current.confidence = 'observed';
    current.container ||= candidate.container;
    current.process ||= candidate.process;
  }
  // A stdio host-process candidate whose pid also owns a listener is the same server: fold it into the listener.
  const withEndpoint = [...byKey.values()].filter((c) => c.endpoint && c.process?.pid != null);
  for (const [key, candidate] of byKey) {
    if (candidate.endpoint || candidate.source !== 'host-process') continue;
    const owner = withEndpoint.find((c) => c.process.pid === candidate.process.pid);
    if (!owner) continue;
    owner.sources = [...new Set([...owner.sources, ...candidate.sources])];
    owner.process = { pid: owner.process.pid, command: candidate.process.command };
    byKey.delete(key);
  }
  return [...byKey.values()].map((candidate) => normalizeCandidate(candidate));
}

export async function discoverCandidates({ execFile, fsImpl, clientConfigPaths = [], remoteUrls = [], compose = {} } = {}) {
  const diagnostics = [];
  const sources = [];
  for (const [name, fn] of [
    ['processes', () => discoverProcesses(execFile)],
    ['listeners', () => discoverListeners(execFile)],
    ['compose', () => discoverCompose(execFile, compose)],
    ['client-config', () => discoverClientConfigs(fsImpl, clientConfigPaths)],
  ]) {
    try { sources.push(...await fn()); } catch (error) { diagnostics.push({ source: name, reason: 'source_failed', message: error.message }); }
  }
  const remote = await discoverRemoteUrls(remoteUrls);
  diagnostics.push(...remote.diagnostics);
  sources.push(...remote.candidates);
  return { candidates: mergeCandidates(sources), diagnostics };
}
