// Builds what the API serves from: the mode (demo unless MCP_DISCOVERY_LIVE=1), the host to scan, the store.
// Demo: in-process stubs on 127.0.0.1:5311-5319 + fixtures, memory store, probes limited to the stub ports.
// Live: the real host through live.js, loopback probes only, file store only if MCP_DISCOVERY_STORE_PATH is set.
import { createInventoryStore } from './store.js';
import { liveEnabled, STUB_BASE_PORT } from './safety.js';
import { runScan } from './scanner.js';

export async function createRuntime({ env = process.env, stubBase = STUB_BASE_PORT, timeoutMs } = {}) {
  const live = liveEnabled(env);
  let scanning = Promise.resolve();
  let pending = 0;
  if (live) {
    const { liveHost } = await import('./live.js');
    const host = liveHost(env);
    const store = createInventoryStore({ filePath: env.MCP_DISCOVERY_STORE_PATH || null });
    return build('live', host, store, { timeoutMs: timeoutMs ?? 3000 }, async () => {});
  }
  const { startStubs } = await import('./demo/stubs.js');
  const { demoHost } = await import('./demo/fixtures.js');
  const stubs = await startStubs({ basePort: stubBase });
  const store = createInventoryStore();
  return build('demo', demoHost(stubs), store, { timeoutMs: timeoutMs ?? 800, allowedPorts: stubs.ports }, () => stubs.close(), stubs);

  function build(mode, host, store, probeOptions, close, stubsHandle = null) {
    return {
      mode, store, stubs: stubsHandle,
      // Scans run one at a time; a request that arrives during a scan waits for it. At most one waits: a third
      // request while one runs and one is queued is refused (scan_queue_full -> 429), so requests cannot pile up.
      scan: () => {
        if (pending >= 2) return Promise.reject(Object.assign(new Error('a scan is running and another is already queued'), { code: 'scan_queue_full' }));
        pending += 1;
        const run = scanning.then(() => runScan({ host, store, probeOptions }));
        scanning = run.catch(() => {}).then(() => { pending -= 1; });
        return run;
      },
      async reset() { await store.reset(); stubsHandle?.reset(); },
      close,
    };
  }
}
