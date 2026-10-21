#!/usr/bin/env node
// Serves the built web UI (web/dist) and the unchanged API on one loopback port.
// server/src/app.js serves only /api (and sends CSP default-src 'none'), so this wrapper adds the static files
// in front of it without editing server/. Everything under /api is handled by createApp() exactly as in `npm start`.
//
//   npm run build && npm run start:ui     # http://127.0.0.1:5310/   (MCP_DISCOVERY_PORT to change; 5300-5999 only)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from '../server/src/app.js';
import { createHealth } from '../server/src/health.js';
import { createRuntime } from '../server/src/runtime.js';
import { allPassed, runChecks } from '../server/src/doctor.js';
import { assertBindAllowed, bindHost, hostGuard, portInRange, serverPort } from '../server/src/safety.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.WEB_DIST || path.join(root, 'web', 'dist');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* no .env */ }

if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('[mcp-discovery] web/dist is missing. Run `npm run build` first.'); process.exit(2); }
const checks = runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[mcp-discovery] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const port = serverPort();
if (!portInRange(port)) { console.error(`[mcp-discovery] port ${port} is outside 5300-5999`); process.exit(1); }
const host = assertBindAllowed(bindHost());

const runtime = await createRuntime({ env: process.env });
const health = createHealth();
const outer = express();
outer.disable('x-powered-by');
outer.use(hostGuard);
outer.use(express.static(dist, {
  index: 'index.html',
  setHeaders: (res) => res.set({
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  }),
}));
outer.use(createApp({ runtime, health }));
const srv = outer.listen(port, host, () => {
  console.log(`[mcp-discovery] ${runtime.mode.toUpperCase()} mode, UI and API at http://127.0.0.1:${srv.address().port}/`);
});
const stop = async () => { health.stop(); srv.closeAllConnections?.(); srv.close(); await runtime.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
