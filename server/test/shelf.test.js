import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createRuntime } from '../src/runtime.js';
import { freeBase, request } from './helpers.js';

// Regression: GET /api/shelf must be reachable with no web build (webDist null) and return SHELF_URL.
test('GET /api/shelf returns SHELF_URL (slash trimmed) with no web build; POST is not 200', async (t) => {
  const prev = process.env.SHELF_URL;
  process.env.SHELF_URL = 'https://shelf.example:8443/';
  t.after(() => { if (prev === undefined) delete process.env.SHELF_URL; else process.env.SHELF_URL = prev; });
  const base = await freeBase('api', 6);
  const rt = await createRuntime({ env: {}, stubBase: base });
  const health = createHealth();
  const port = base + 5;
  const server = createApp({ runtime: rt, health, webDist: null }).listen(port, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(async () => { health.stop(); server.closeAllConnections(); await new Promise((r) => server.close(r)); await rt.close(); });

  const res = await request(port, 'GET', '/api/shelf');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { shelfUrl: 'https://shelf.example:8443' });
  const post = await request(port, 'POST', '/api/shelf', { body: {} });
  assert.notEqual(post.status, 200);
});
