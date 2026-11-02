// Rule 19: the Mock/Real toggle's API. Mock is the demo, Real is the live scan of this machine (only when the owner started the server
// with MCP_DISCOVERY_LIVE=1), and the hosted build is Mock only. The tests never run a live scan: they read info, health and the inventory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createRuntime, createSwitchableRuntime } from '../src/runtime.js';
import { freeBase, request } from './helpers.js';

async function boot(t, { env = {}, hosted = false } = {}) {
  const base = await freeBase('api', 6);
  const rt = hosted ? await createRuntime({ env: { MODE: 'se-mock' }, stubBase: base }) : await createSwitchableRuntime({ env, stubBase: base });
  const health = createHealth({ env: hosted ? { MODE: 'se-mock' } : env, liveNow: typeof rt.source === 'function' ? () => rt.source() === 'real' : null });
  const port = base + 5;
  const server = createApp({ runtime: rt, health, webDist: null }).listen(port, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(async () => { health.stop(); server.closeAllConnections(); await new Promise((r) => server.close(r)); await rt.close(); });
  return { port, rt };
}
const mode = (port, body) => request(port, 'POST', '/api/mode', { body });

test('no live setting: Mock only, Real is refused with how to enable it (409), bad bodies are 400', async (t) => {
  const { port } = await boot(t);
  const info = (await request(port, 'GET', '/api/info')).json;
  assert.equal(info.source, 'mock'); assert.equal(info.realAvailable, false); assert.equal(info.hosted, false); assert.equal(info.mode, 'local');
  const real = await mode(port, { source: 'real' });
  assert.equal(real.status, 409); assert.match(real.json.message, /MCP_DISCOVERY_LIVE=1/);
  assert.equal((await mode(port, { source: 'mock' })).status, 200);
  for (const body of [{}, { source: 'live' }, { source: 'mock', extra: 1 }, []]) assert.equal((await mode(port, body)).status, 400, JSON.stringify(body));
});

test('with MCP_DISCOVERY_LIVE=1: Real is the default and the toggle really switches the runtime, the inventory and the health', async (t) => {
  const { port, rt } = await boot(t, { env: { MCP_DISCOVERY_LIVE: '1' } });
  const info = (await request(port, 'GET', '/api/info')).json;
  assert.equal(info.source, 'real'); assert.equal(info.realAvailable, true); assert.equal(rt.mode, 'live');
  assert.equal((await request(port, 'GET', '/api/health')).json.runtime, 'live');
  assert.equal((await request(port, 'GET', '/api/inventory')).json.mode, 'live');
  const toMock = await mode(port, { source: 'mock' });
  assert.equal(toMock.status, 200); assert.equal(toMock.json.source, 'mock');
  assert.equal(rt.mode, 'demo');
  assert.equal((await request(port, 'GET', '/api/health')).json.runtime, 'offline', 'health follows the active source');
  const scan = await request(port, 'POST', '/api/scan');
  assert.equal(scan.status, 200); assert.equal(scan.json.mode, 'demo');
  const back = await mode(port, { source: 'real' });
  assert.equal(back.json.source, 'real'); assert.equal(rt.mode, 'live');
  assert.equal((await request(port, 'GET', '/api/health')).json.runtime, 'live');
});

test('hosted (se-mock): reports Mock only and refuses every switch (403)', async (t) => {
  const { port } = await boot(t, { hosted: true });
  const info = (await request(port, 'GET', '/api/info')).json;
  assert.equal(info.hosted, true); assert.equal(info.source, 'mock'); assert.equal(info.realAvailable, false); assert.equal(info.mode, 'se-mock');
  assert.equal((await mode(port, { source: 'real' })).status, 403);
  assert.equal((await mode(port, { source: 'mock' })).status, 403);
});
