// One Express app: the API under /api. createApp() is what the tests use.
// Every server-provided string in a response was made inert at probe time (sanitize.js) and is served as JSON only.
import express from 'express';
import { createHealth } from './health.js';
import { createRuntime } from './runtime.js';
import { assertBindAllowed, bindHost, credentialGuard, hostGuard, serverPort } from './safety.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, message, status = 400) => res.status(status).json({ error: status === 404 ? 'not_found' : 'bad_request', message });

const summary = (records) => {
  const by = {};
  for (const r of records) by[r.status] = (by[r.status] || 0) + 1;
  return { total: records.length, byStatus: by };
};

export function createApp({ runtime, health = createHealth() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostGuard);
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  });

  const api = express.Router();
  api.use(credentialGuard);
  api.use('/health', health.router);
  api.use(express.json({ limit: '2kb' }));

  api.post('/scan', wrap(async (req, res) => {
    // A scan takes no parameters. Any body field is refused, so a credential or a target can never be passed in.
    if (req.body && Object.keys(req.body).length) return bad(res, 'POST /api/scan takes no parameters; credentials and targets are never accepted');
    const result = await runtime.scan();
    res.json({ mode: runtime.mode, ...result, summary: summary(result.records) });
  }));
  api.get('/inventory', wrap(async (_req, res) => {
    const snap = await runtime.store.snapshot();
    res.json({ mode: runtime.mode, ...snap, summary: summary(snap.records) });
  }));
  api.get('/inventory/:id', wrap(async (req, res) => {
    const record = await runtime.store.get(req.params.id);
    if (!record) return bad(res, 'no such inventory record', 404);
    res.json({ mode: runtime.mode, record });
  }));
  api.post('/reset', wrap(async (req, res) => {
    if (req.body && Object.keys(req.body).length) return bad(res, 'POST /api/reset takes no parameters');
    await runtime.reset();
    res.json({ ok: true, mode: runtime.mode });
  }));

  api.use((_req, res) => bad(res, 'no such endpoint', 404));
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'request body is too large' });
    if (err.type === 'entity.parse.failed') return bad(res, 'request body is not valid JSON');
    console.error('[mcp-discovery] api error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  });
  app.use('/api', api);
  app.use((_req, res) => bad(res, 'no such endpoint', 404));
  return app;
}

// Boot on `port`. Refuses a non-loopback host unless MCP_DISCOVERY_BIND is set (and never with live mode).
export async function startHttpServer({ port = serverPort(), host = bindHost(), env = process.env, runtime } = {}) {
  assertBindAllowed(host, env);
  const rt = runtime || await createRuntime({ env });
  const health = createHealth({ env });
  return new Promise((resolve, reject) => {
    const httpServer = createApp({ runtime: rt, health }).listen(port, host);
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
