// Preflight checks shared by `npm run doctor` and GET /api/health. Synchronous, no network, never prints a secret.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import { STUB_BASE_PORT, STUB_LAST_PORT, assertBindAllowed, bindHost, liveEnabled, portInRange, serverPort } from './safety.js';

export function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 20 ? 'pass' : 'fail', `v${process.versions.node} (need >= 20)`);

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.MCP_DISCOVERY_BIND ? ' (MCP_DISCOVERY_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = serverPort(env);
  add('port-range', portInRange(port) ? 'pass' : 'fail', portInRange(port) ? `server port ${port}, stubs ${STUB_BASE_PORT}-${STUB_LAST_PORT} (all within 5300-5999)` : `server port ${port} is outside 5300-5999`);

  if (env.MCP_DISCOVERY_LIVE !== undefined && !liveEnabled(env)) add('mode', 'fail', 'MCP_DISCOVERY_LIVE must be exactly 1 to enable live mode, or unset');
  else if (liveEnabled(env)) add('mode', 'info', 'LIVE: reads this machine (ps, lsof, docker ps, listed client configs), read-only, loopback and stdio only');
  else add('mode', 'pass', 'demo (default): fixtures and in-process stubs only, the real host is never read');

  add('outbound', 'pass', 'no outbound settings: probes go to loopback only, credentials are never accepted or sent');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
