import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHealth } from '../src/health.js';
import { freeBase, request } from './helpers.js';

async function serve(t, health) {
  const app = express();
  app.use('/api/health', health.router);
  const port = await freeBase('app', 1);
  const s = app.listen(port, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  t.after(() => { health.stop(); s.closeAllConnections(); s.close(); });
  return port;
}
const get = async (t, opts) => (await request(await serve(t, createHealth(opts)), 'GET', '/api/health')).json;

test('state follows the checks: failing is broken, throwing is unknown, passing is ready', async (t) => {
  assert.equal((await get(t, { runChecks: () => [{ id: 'x', level: 'fail', detail: 'no' }] })).state, 'broken');
  assert.equal((await get(t, { runChecks: () => { throw new Error('boom'); } })).state, 'unknown');
  assert.equal((await get(t, { runChecks: () => [{ id: 'x', level: 'info', detail: 'ok' }] })).state, 'ready');
});

test('runtime is live only with MCP_DISCOVERY_LIVE=1', async (t) => {
  assert.equal((await get(t, { env: {}, runChecks: () => [] })).runtime, 'offline');
  assert.equal((await get(t, { env: { MCP_DISCOVERY_LIVE: '1' }, runChecks: () => [] })).runtime, 'live');
});

test('a request does not run the checks', async (t) => {
  let runs = 0;
  const port = await serve(t, createHealth({ runChecks: () => { runs += 1; return []; } }));
  const before = runs;
  await request(port, 'GET', '/api/health');
  await request(port, 'GET', '/api/health');
  assert.equal(runs, before);
});
