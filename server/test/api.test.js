import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createRuntime } from '../src/runtime.js';
import { BASES, request } from './helpers.js';

async function boot(t, offset) {
  const rt = await createRuntime({ env: {}, stubBase: BASES.api + offset });
  const health = createHealth();
  const port = BASES.api + offset + 9;
  const server = createApp({ runtime: rt, health }).listen(port, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(async () => { health.stop(); server.closeAllConnections(); await new Promise((r) => server.close(r)); await rt.close(); });
  return { port, rt };
}

test('GET /api/health is demo-health/1, no-store, offline in demo mode', async (t) => {
  const { port } = await boot(t, 0);
  const res = await request(port, 'GET', '/api/health');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.json.schema, 'demo-health/1');
  assert.equal(res.json.state, 'ready');
  assert.equal(res.json.runtime, 'offline');
  assert.deepEqual(Object.keys(res.json).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
  assert.equal(res.json.demo.id, 'mcp-discovery');
  assert.ok(res.json.demo.id.length <= 64 && res.json.demo.name.length <= 80 && res.json.demo.version.length <= 32);
  assert.ok(!Number.isNaN(Date.parse(res.json.at)));
  assert.ok(res.raw.length < 4096);
  assert.equal((await request(port, 'POST', '/api/health')).status, 405);
});

test('scan, inventory, record, diff, reset round trip', async (t) => {
  const { port } = await boot(t, 20);
  assert.deepEqual((await request(port, 'GET', '/api/inventory')).json.records, []);
  const s1 = await request(port, 'POST', '/api/scan');
  assert.equal(s1.status, 200);
  assert.equal(s1.json.mode, 'demo');
  assert.equal(s1.json.summary.byStatus.hostile, 1);
  assert.equal(s1.json.summary.byStatus.healthy, 2);
  const s2 = await request(port, 'POST', '/api/scan', { body: {} });
  assert.equal(s2.json.diff.changed[0].possibleRugPull, true);
  const inv = await request(port, 'GET', '/api/inventory');
  assert.equal(inv.json.scanId, s2.json.scanId);
  assert.equal(inv.json.records.length, s2.json.records.length);
  assert.equal(inv.json.diff.changed.length, 1);
  const one = await request(port, 'GET', `/api/inventory/${s2.json.diff.changed[0].id}`);
  assert.equal(one.status, 200);
  assert.equal(one.json.record.status, 'hostile');
  assert.equal((await request(port, 'GET', '/api/inventory/nope')).status, 404);
  assert.equal((await request(port, 'POST', '/api/reset')).json.ok, true);
  assert.deepEqual((await request(port, 'GET', '/api/inventory')).json.records, []);
  assert.equal((await request(port, 'POST', '/api/scan')).json.diff.firstScan, true);
});

test('a non-loopback Host header is refused', async (t) => {
  const { port } = await boot(t, 40);
  for (const host of ['evil.example.com', 'evil.example.com:5310', '10.0.0.5:5310', '127.0.0.1.evil.example:5310']) {
    assert.equal((await request(port, 'GET', '/api/health', { host })).status, 421, host);
  }
  for (const host of ['localhost:5310', '127.0.0.1', '[::1]:5310']) assert.equal((await request(port, 'GET', '/api/health', { host })).status, 200, host);
});

test('credentials are refused: headers, and any body field on scan', async (t) => {
  const { port, rt } = await boot(t, 60);
  for (const headers of [{ authorization: 'Bearer x' }, { 'proxy-authorization': 'Basic x' }, { 'x-api-key': 'k' }]) {
    const res = await request(port, 'POST', '/api/scan', { headers });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'credentials_not_accepted');
  }
  for (const body of [{ token: 'x' }, { target: 'http://127.0.0.1:5311/mcp' }, { headers: { Authorization: 'x' } }]) {
    assert.equal((await request(port, 'POST', '/api/scan', { body })).status, 400);
  }
  assert.equal((await rt.store.snapshot()).scanId, null, 'no scan ran');
  assert.equal((await request(port, 'POST', '/api/scan', { body: '{bad' })).status, 400);
  assert.equal((await request(port, 'POST', '/api/scan', { body: { pad: 'x'.repeat(5000) } })).status, 413);
});

test('responses are JSON with nosniff and a locked-down CSP; unknown routes are 404 JSON', async (t) => {
  const { port } = await boot(t, 80);
  const res = await request(port, 'GET', '/api/nothing');
  assert.equal(res.status, 404);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['content-security-policy'], "default-src 'none'");
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal((await request(port, 'GET', '/')).status, 404);
});
