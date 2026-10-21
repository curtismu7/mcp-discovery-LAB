import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createRuntime } from '../src/runtime.js';
import net from 'node:net';
import { BASES, request } from './helpers.js';

async function boot(t, offset, appOptions = {}, runtime) {
  const rt = runtime || await createRuntime({ env: {}, stubBase: BASES.api + offset });
  const health = createHealth();
  const port = BASES.api + offset + 9;
  const server = createApp({ runtime: rt, health, webDist: null, ...appOptions }).listen(port, '127.0.0.1');
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

test('CSRF: a cross-origin or cross-site POST is refused and changes nothing', async (t) => {
  const { port, rt } = await boot(t, 100);
  const evil = [
    { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' },
    { origin: 'http://evil.example' },
    { origin: 'null' },
    { origin: 'http://127.0.0.1:1' },                       // loopback, wrong port
    { origin: `http://localhost:${port}` },                // loopback, other name than Host
    { origin: `https://127.0.0.1:${port}` },               // wrong scheme
    { 'sec-fetch-site': 'cross-site' },                    // no Origin, but the browser says cross-site
  ];
  for (const path of ['/api/scan', '/api/reset']) {
    for (const headers of evil) {
      const res = await request(port, 'POST', path, { headers, body: headers['content-type'] ? 'x' : undefined });
      assert.equal(res.status, 403, `${path} ${JSON.stringify(headers)}`);
    }
  }
  assert.equal((await rt.store.snapshot()).scanId, null, 'no scan ran');
  // same-origin, same-site, none and a missing Origin are fine
  for (const headers of [{ origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }, { 'sec-fetch-site': 'same-site' }, {}]) {
    assert.equal((await request(port, 'POST', '/api/reset', { headers })).status, 200, JSON.stringify(headers));
  }
  // a proxy (Vite dev) forwards Host and Origin unchanged: same origin as far as the server can tell
  assert.equal((await request(port, 'POST', '/api/reset', { host: '127.0.0.1:5330', headers: { origin: 'http://127.0.0.1:5330' } })).status, 200);
  assert.equal((await request(port, 'POST', '/api/reset', { host: '127.0.0.1:5330', headers: { origin: 'http://127.0.0.1:5310' } })).status, 403);
});

test('a request body must be application/json', async (t) => {
  const { port } = await boot(t, 120);
  const res = await request(port, 'POST', '/api/scan', { headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
  assert.equal((await request(port, 'POST', '/api/scan', { headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{}' })).status, 200);
});

test('POST /api/reset with a body is refused', async (t) => {
  const { port } = await boot(t, 140);
  assert.equal((await request(port, 'POST', '/api/reset', { body: { all: true } })).status, 400);
  assert.equal((await request(port, 'POST', '/api/reset', { body: '[1]' })).status, 400);
});

test('a missing Host header (HTTP/1.0) and malformed loopback Hosts are refused', async (t) => {
  const { port } = await boot(t, 160);
  const raw = await new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write('GET /api/health HTTP/1.0\r\n\r\n'));
    let out = ''; s.on('data', (c) => { out += c; }); s.on('close', () => resolve(out));
  });
  assert.match(raw, /^HTTP\/1\.[01] 421/);
  for (const host of ['127.999.999.999', '127.0.0.256:5310', '[::1]junk', '[::1]:5310x', 'localhost:99999', '127.0.0.1:', 'localhost.evil.com', '127.0.0.1@evil.com']) {
    assert.equal((await request(port, 'GET', '/api/health', { host })).status, 421, host);
  }
});

test('GET /api/inventory/%ZZ is a 400, not a 500', async (t) => {
  const { port } = await boot(t, 180);
  const res = await request(port, 'GET', '/api/inventory/%ZZ');
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'bad_request');
});

test('a 500 never leaks err.message or a stack', async (t) => {
  const boom = { mode: 'demo', store: { snapshot: async () => { throw new Error('SECRET-INTERNAL /Users/x/file.js:12'); } }, scan: async () => { throw new Error('SECRET-INTERNAL'); }, reset: async () => {}, close: async () => {} };
  const { port } = await boot(t, 200, {}, boom);
  const realError = console.error; console.error = () => {};
  t.after(() => { console.error = realError; });
  for (const [m, p] of [['GET', '/api/inventory'], ['POST', '/api/scan']]) {
    const res = await request(port, m, p);
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { error: 'server_error' });
    assert.doesNotMatch(res.raw, /SECRET-INTERNAL|\.js:|at /);
  }
});

test('the credential guard runs before /api/health', async (t) => {
  const { port } = await boot(t, 220);
  const res = await request(port, 'GET', '/api/health', { headers: { authorization: 'Bearer x' } });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'credentials_not_accepted');
});
