// Builds what the API serves from: the mode (demo unless MCP_DISCOVERY_LIVE=1), the host to scan, the store.
// Demo: in-process stubs on 127.0.0.1:5311-5319 + fixtures, memory store, probes limited to the stub ports.
// Live: the real host through live.js, loopback probes only, file store only if MCP_DISCOVERY_STORE_PATH is set.
// MODE=se-mock (the hosted build): demo only, one runtime per workspace over ONE shared set of stubs; live is refused.
import { createInventoryStore } from './store.js';
import { liveEnabled, STUB_BASE_PORT } from './safety.js';
import { runScan } from './scanner.js';
import { assertSeMockClean, isSeMock } from './config.js';
import { DEFAULT_WORKSPACE, MAX_WORKSPACES, WORKSPACE_TTL_MS, createWorkspaces } from './workspaces.js';

// Scans run one at a time; a request that arrives during a scan waits for it. At most one waits: a third
// request while one runs and one is queued is refused (scan_queue_full -> 429), so requests cannot pile up.
function buildRuntime({ mode, host, store, probeOptions, close, stubs = null, reset }) {
  let scanning = Promise.resolve();
  let pending = 0;
  const rt = {
    mode, store, stubs, isolated: false,
    scan: () => {
      if (pending >= 2) return Promise.reject(Object.assign(new Error('a scan is running and another is already queued'), { code: 'scan_queue_full' }));
      pending += 1;
      const run = scanning.then(() => runScan({ host, store, probeOptions }));
      scanning = run.catch(() => {}).then(() => { pending -= 1; });
      return run;
    },
    reset,
    close,
  };
  rt.forWorkspace = () => rt; // local: one workspace, the header is ignored
  return rt;
}

export async function createRuntime({ env = process.env, stubBase = STUB_BASE_PORT, timeoutMs, ...hosted } = {}) {
  if (isSeMock(env)) return createSeMockRuntime({ env, stubBase, timeoutMs, ...hosted }); // hosted: max, ttlMs, now (tests)
  const live = liveEnabled(env);
  if (live) {
    const { liveHost } = await import('./live.js');
    const host = liveHost(env);
    const store = createInventoryStore({ filePath: env.MCP_DISCOVERY_STORE_PATH || null });
    return buildRuntime({ mode: 'live', host, store, probeOptions: { timeoutMs: timeoutMs ?? 3000 }, close: async () => {}, reset: async () => { await store.reset(); } });
  }
  const { startStubs } = await import('./demo/stubs.js');
  const { demoHost } = await import('./demo/fixtures.js');
  const stubs = await startStubs({ basePort: stubBase });
  const store = createInventoryStore();
  return buildRuntime({
    mode: 'demo', host: demoHost(stubs), store, probeOptions: { timeoutMs: timeoutMs ?? 800, allowedPorts: stubs.ports },
    close: () => stubs.close(), stubs, reset: async () => { await store.reset(); stubs.reset(); },
  });
}

// The local build with both sides. Mock is the demo runtime (stubs + fixtures). Real is the live runtime, built ONLY when the owner started
// the server with MCP_DISCOVERY_LIVE=1: the page can switch between the two, it can never turn live on. Real is the default when it exists,
// as before.
export async function createSwitchableRuntime({ env = process.env, stubBase = STUB_BASE_PORT, timeoutMs } = {}) {
  const demoEnv = { ...env }; delete demoEnv.MCP_DISCOVERY_LIVE;
  const demo = await createRuntime({ env: demoEnv, stubBase, timeoutMs });
  let live = null;
  if (liveEnabled(env)) { try { live = await createRuntime({ env, stubBase, timeoutMs }); } catch (e) { await demo.close(); throw e; } }
  let source = live ? 'real' : 'mock';
  const cur = () => (source === 'real' ? live : demo);
  const rt = {
    isolated: false, realAvailable: !!live,
    get mode() { return cur().mode; }, get store() { return cur().store; }, get stubs() { return cur().stubs; },
    scan: () => cur().scan(), reset: () => cur().reset(),
    source: () => source,
    select(next) { if (next === 'real' && !live) return false; source = next; return true; },
    close: async () => { await demo.close(); if (live) await live.close(); },
  };
  rt.forWorkspace = () => rt;
  return rt;
}

// The hosted build. live.js is never imported here, so there is no code path to the real host. State that exists per
// visitor (the "all state" list in docs/k8s.md): the inventory store, the scan queue, and each stub's counters.
export async function createSeMockRuntime({ env = process.env, stubBase = STUB_BASE_PORT, timeoutMs, max = MAX_WORKSPACES, ttlMs = WORKSPACE_TTL_MS, now = Date.now } = {}) {
  assertSeMockClean(env);
  const { startStubs } = await import('./demo/stubs.js');
  const { demoHost } = await import('./demo/fixtures.js');
  const stubs = await startStubs({ basePort: stubBase });
  const host = demoHost(stubs);
  const make = (id) => {
    stubs.addWorkspace(id);
    const store = createInventoryStore(); // memory only, never a file
    const workspaceId = id === DEFAULT_WORKSPACE ? undefined : id;
    const rt = buildRuntime({
      mode: 'demo', host, store, stubs,
      probeOptions: { timeoutMs: timeoutMs ?? 800, allowedPorts: stubs.ports, workspaceId },
      close: async () => {}, reset: async () => { await store.reset(); stubs.reset(id); },
    });
    rt.isolated = true; rt.workspaceId = id;
    return rt;
  };
  const workspaces = createWorkspaces({ create: make, max, ttlMs, now, onEvict: (id) => stubs.dropWorkspace(id) });
  workspaces.get(DEFAULT_WORKSPACE); // the default workspace always exists
  return {
    mode: 'demo', seMock: true, isolated: true, stubs, workspaces,
    forWorkspace: (id) => workspaces.get(id),
    close: () => stubs.close(),
  };
}
