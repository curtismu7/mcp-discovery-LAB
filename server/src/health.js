// GET /api/health, contract demo-health/1 (the demo shelf's docs/health-contract.md).
// Public, GET only, no counts or detail. The state comes from the doctor checks, refreshed in the background every
// 60 s; a request never runs them.
import fs from 'node:fs';
import express from 'express';
import { allPassed, runChecks as defaultChecks } from './doctor.js';
import { liveEnabled } from './safety.js';
import { modeFrom } from './config.js';

const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const DEMO = { id: 'mcp-discovery', name: 'MCP Discovery', version };

export function createHealth({ runChecks = defaultChecks, now = () => new Date(), intervalMs = 60_000, env = process.env } = {}) {
  let last = { state: 'unknown', at: null };
  function refresh() {
    try { last = { state: allPassed(runChecks({ env })) ? 'ready' : 'broken', at: now().toISOString() }; }
    catch { last = { state: 'unknown', at: now().toISOString() }; }
  }
  refresh();
  const timer = setInterval(refresh, intervalMs);
  timer.unref();

  const router = express.Router();
  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    // The hosted build also names its mode so the UI can show the "hosted and simulated" banner.
    let seMock = false;
    try { seMock = modeFrom(env) === 'se-mock'; } catch { /* the doctor reports it; health stays local-shaped */ }
    res.json({ schema: 'demo-health/1', at: last.at || now().toISOString(), state: last.state, runtime: !seMock && liveEnabled(env) ? 'live' : 'offline', ...(seMock ? { mode: 'se-mock', hosted: true } : {}), demo: DEMO });
  });
  router.all('/', (_req, res) => res.set('Allow', 'GET').status(405).json({ error: 'method_not_allowed' }));
  return { router, refresh, stop: () => clearInterval(timer) };
}
