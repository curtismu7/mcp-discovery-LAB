// One Express app: the API under /api. createApp() is what the tests use.
// Every server-provided string in a response was made inert at probe time (sanitize.js) and is served as JSON only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createHealth } from './health.js';
import { createRuntime, createSwitchableRuntime } from './runtime.js';
import { assertBindAllowed, bindHost, credentialGuard, makeHostGuard, makeOriginGuard, serverPort } from './safety.js';
import { DEFAULT_WORKSPACE, isWorkspaceId } from './workspaces.js';
import { allowedHostsFrom, assertSeMockClean, modeFrom, publicHostFrom } from './config.js';
import { shelfInfo } from './shelfLink.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, message, status = 400) => res.status(status).json({ error: status === 404 ? 'not_found' : 'bad_request', message });

const summary = (records) => {
  const by = {};
  for (const r of records) by[r.status] = (by[r.status] || 0) + 1;
  return { total: records.length, byStatus: by };
};

export const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const API_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
// The built UI: same-origin scripts, styles, images and fetches only. (style-src allows inline styles: React Flow sets them.)
export const UI_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// webDist: directory with the built UI (web/dist). null disables static serving; a missing directory serves JSON 404 at /.
// publicHost: se-mock only, the ingress host name (see config.js). A hosted runtime (runtime.isolated) serves one workspace
// per X-Workspace-Id; a local runtime ignores that header entirely.
export function createApp({ runtime, health = createHealth(), webDist = DEFAULT_WEB_DIST, publicHost = null, allowedHosts = new Set() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(makeHostGuard(publicHost, allowedHosts));
  app.use(makeOriginGuard(publicHost, allowedHosts));
  app.use((_req, res, next) => { res.set(API_HEADERS); next(); });
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, {
      index: 'index.html', dotfiles: 'ignore',
      setHeaders: (res) => res.set({ ...API_HEADERS, 'Content-Security-Policy': UI_CSP }),
    }));
  }

  const api = express.Router();
  api.use(credentialGuard);
  api.use('/health', health.router);
  // The workspace this request works in (hosted build only). The id is a label, not a credential; a malformed one is refused.
  api.use((req, res, next) => {
    if (!runtime.isolated) { req.rt = runtime; return next(); }
    const id = req.headers['x-workspace-id'];
    if (id !== undefined && !isWorkspaceId(id)) return bad(res, 'X-Workspace-Id must be 1-32 characters of a-z, 0-9 and hyphen, starting with a letter or digit');
    req.workspaceId = id ?? DEFAULT_WORKSPACE;
    req.rt = runtime.forWorkspace(req.workspaceId);
    return next();
  });
  api.use(express.json({ limit: '2kb' }));

  // Rule 19: the Mock/Real toggle's API. Mock is the demo; Real is the live scan of this machine, available only when the owner
  // started the server with MCP_DISCOVERY_LIVE=1 (the page can switch to it and back, never enable it). The hosted build is Mock only.
  const hosted = runtime.isolated === true;
  const sourceNow = () => (hosted ? 'mock' : typeof runtime.source === 'function' ? runtime.source() : runtime.mode === 'live' ? 'real' : 'mock');
  const infoBody = () => ({ mode: hosted ? 'se-mock' : 'local', hosted, source: sourceNow(), realAvailable: !hosted && runtime.realAvailable === true });
  api.get('/info', (_req, res) => res.json(infoBody()));
  api.post('/mode', (req, res) => {
    const b = req.body;
    if (b === null || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 1 || !['mock', 'real'].includes(b.source)) return bad(res, 'body must be exactly {source: "mock" or "real"}');
    if (hosted) return bad(res, 'The hosted build is Mock only and cannot be switched.', 403);
    if (b.source === 'real' && runtime.realAvailable !== true) return bad(res, 'Real needs the server started with MCP_DISCOVERY_LIVE=1: it then scans this machine (read-only, loopback, standard config paths). Restart it that way, then switch.', 409);
    if (typeof runtime.select === 'function') runtime.select(b.source);
    return res.json(infoBody());
  });

  api.post('/scan', wrap(async (req, res) => {
    // A scan takes no parameters. Any body field is refused, so a credential or a target can never be passed in.
    if (req.body && Object.keys(req.body).length) return bad(res, 'POST /api/scan takes no parameters; credentials and targets are never accepted');
    let result;
    try { result = await req.rt.scan(); } catch (e) {
      if (e?.code === 'scan_queue_full') return res.set('Retry-After', '2').status(429).json({ error: 'scan_queue_full', message: 'a scan is running and another is already queued; try again shortly' });
      throw e;
    }
    res.json({ mode: req.rt.mode, ...result, summary: summary(result.records) });
  }));
  api.get('/inventory', wrap(async (req, res) => {
    const snap = await req.rt.store.snapshot();
    res.json({ mode: req.rt.mode, ...snap, summary: summary(snap.records) });
  }));
  api.get('/inventory/:id', wrap(async (req, res) => {
    const record = await req.rt.store.get(req.params.id);
    if (!record) return bad(res, 'no such inventory record', 404);
    res.json({ mode: req.rt.mode, record });
  }));
  api.post('/reset', wrap(async (req, res) => {
    if (req.body && Object.keys(req.body).length) return bad(res, 'POST /api/reset takes no parameters');
    await req.rt.reset();
    res.json({ ok: true, mode: req.rt.mode });
  }));

  api.use((_req, res) => bad(res, 'no such endpoint', 404));
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'request body is too large' });
    if (err.type === 'entity.parse.failed') return bad(res, 'request body is not valid JSON');
    if (err instanceof URIError || err.status === 400) return bad(res, 'malformed request');
    console.error('[mcp-discovery] api error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  });
  app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
  app.use('/api', api);
  app.use((_req, res) => bad(res, 'no such endpoint', 404));
  app.use((err, _req, res, _next) => (err instanceof URIError || err.status === 400 ? bad(res, 'malformed request') : res.status(500).json({ error: 'server_error' })));
  return app;
}

// Boot on `port`. Refuses a non-loopback host unless MCP_DISCOVERY_BIND is set (and never with live mode).
export async function startHttpServer({ port = serverPort(), host = bindHost(), env = process.env, runtime } = {}) {
  const deployMode = modeFrom(env); // throws on an unknown MODE
  if (deployMode === 'se-mock') assertSeMockClean(env);
  assertBindAllowed(host, env);
  const publicHost = deployMode === 'se-mock' ? publicHostFrom(env) : null;
  const allowedHosts = allowedHostsFrom(env); // before the stubs start: a bad name must not leave servers running
  const rt = runtime || await (deployMode === 'se-mock' ? createRuntime({ env }) : createSwitchableRuntime({ env }));
  const health = createHealth({ env, liveNow: typeof rt.source === 'function' ? () => rt.source() === 'real' : null });
  return new Promise((resolve, reject) => {
    const httpServer = createApp({ runtime: rt, health, publicHost, allowedHosts }).listen(port, host);
    httpServer.once('error', async (e) => { health.stop(); await rt.close(); reject(e); });
    httpServer.once('listening', () => {
      const { port: bound } = httpServer.address();
      resolve({
        port: bound, runtime: rt,
        url: `http://127.0.0.1:${bound}/`,
        close: async () => { health.stop(); await new Promise((r) => { httpServer.closeAllConnections?.(); httpServer.close(r); }); await rt.close(); },
      });
    });
  });
}
