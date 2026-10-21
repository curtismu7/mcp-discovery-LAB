import { fileURLToPath } from 'node:url';
import { startHttpServer } from './app.js';
import { allPassed, runChecks } from './doctor.js';

// Local runs read the repo-root .env (real env vars win).
try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); } catch { /* no .env */ }

const checks = runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[mcp-discovery] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const { url, runtime } = await startHttpServer();
console.log(`[mcp-discovery] ${runtime.mode.toUpperCase()} mode at ${url} (loopback unless MCP_DISCOVERY_BIND is set)`);
console.log(`[mcp-discovery] API: GET ${url}api/health | POST ${url}api/scan | GET ${url}api/inventory`);
if (runtime.mode === 'demo') console.log(`[mcp-discovery] stub MCP servers on 127.0.0.1:${[...runtime.stubs.ports].join(', ')}`);
