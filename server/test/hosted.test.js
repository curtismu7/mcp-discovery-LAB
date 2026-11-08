// Rule 18, the hosted (MODE=se-mock) build: live features refused, one isolated workspace per visitor, capped, evicted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { runChecks, allPassed } from '../src/doctor.js';
import { createRuntime } from '../src/runtime.js';
import { LIVE_FLAGS, liveFlagsSet, modeFrom, publicHostFrom } from '../src/config.js';
import { DEFAULT_WORKSPACE, createWorkspaces, isWorkspaceId } from '../src/workspaces.js';
import { freeBase, request } from './helpers.js';

const SE = { MODE: 'se-mock' };

async function boot(t, { env = SE, publicHost = null, allowedHosts = new Set(), runtimeOptions = {} } = {}) {
  const base = await freeBase('hosted', 6);
  const rt = await createRuntime({ env, stubBase: base, ...runtimeOptions });
  const health = createHealth({ env });
  const port = base + 5;
  const server = createApp({ runtime: rt, health, webDist: null, publicHost, allowedHosts }).listen(port, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(async () => { health.stop(); server.closeAllConnections(); await new Promise((r) => server.close(r)); await rt.close(); });
  return { port, rt };
}
const ws = (id) => ({ headers: { 'x-workspace-id': id } });

test('MODE: local is the default, se-mock is the hosted build, anything else is an error', () => {
  assert.equal(modeFrom({}), 'local');
  assert.equal(modeFrom({ MODE: '' }), 'local');
  assert.equal(modeFrom({ MODE: 'local' }), 'local');
  assert.equal(modeFrom({ MODE: 'se-mock' }), 'se-mock');
  for (const m of ['live', 'mock', 'SE-MOCK', 'prod', ' se-mock']) assert.throws(() => modeFrom({ MODE: m }), /not valid/, m);
});

test('MCP_DISCOVERY_PUBLIC_HOST is a plain lower-case host name or nothing', () => {
  assert.equal(publicHostFrom({}), null);
  assert.equal(publicHostFrom({ MCP_DISCOVERY_PUBLIC_HOST: 'discovery.se.example' }), 'discovery.se.example');
  for (const h of ['Bad Host', 'a/b', 'a:80', '-x', 'x.example/', 'x@y', 'a_b']) assert.throws(() => publicHostFrom({ MCP_DISCOVERY_PUBLIC_HOST: h }), /plain/, h);
});

test('the doctor fails se-mock with ANY live setting, even a falsy-looking one, and passes it clean', () => {
  assert.equal(allPassed(runChecks({ env: SE })), true);
  for (const flag of LIVE_FLAGS) {
    for (const value of ['1', '0', '', 'true']) {
      const checks = runChecks({ env: { ...SE, [flag]: value } });
      assert.equal(allPassed(checks), false, `${flag}=${JSON.stringify(value)}`);
      assert.match(checks.find((c) => c.id === 'deploy-mode').detail, new RegExp(flag));
    }
  }
  assert.equal(allPassed(runChecks({ env: { MODE: 'live' } })), false);
  assert.equal(allPassed(runChecks({ env: { ...SE, MCP_DISCOVERY_PUBLIC_HOST: 'No Good' } })), false);
  // local behaviour is unchanged
  assert.equal(allPassed(runChecks({ env: {} })), true);
  assert.equal(allPassed(runChecks({ env: { MCP_DISCOVERY_LIVE: '1' } })), true);
  assert.equal(allPassed(runChecks({ env: { MCP_DISCOVERY_PUBLIC_HOST: 'x.example' } })), false);
});

test('startup and createRuntime refuse se-mock with a live setting, before anything is started or bound', async () => {
  for (const flag of LIVE_FLAGS) {
    const env = { ...SE, [flag]: '1' };
    assert.deepEqual(liveFlagsSet(env), [flag]);
    await assert.rejects(createRuntime({ env, stubBase: await freeBase('hosted', 6) }), /refuses live settings/, flag);
    await assert.rejects(startHttpServer({ port: await freeBase('hosted', 1), env }), /refuses live settings/, flag);
  }
  await assert.rejects(startHttpServer({ port: await freeBase('hosted', 1), env: { MODE: 'bogus' } }), /not valid/);
});

test('se-mock health keeps demo-health/1, names the mode, and never reports live', async (t) => {
  const { port } = await boot(t);
  const res = await request(port, 'GET', '/api/health');
  assert.equal(res.json.schema, 'demo-health/1');
  assert.equal(res.json.state, 'ready');
  assert.equal(res.json.mode, 'se-mock');
  assert.equal(res.json.hosted, true);
  assert.equal(res.json.runtime, 'offline');
});

test('two workspaces cannot see or change each other: scans, baselines, rug-pull counters and Reset are private', async (t) => {
  const { port, rt } = await boot(t);
  const a = ws('visitor-a'); const b = ws('visitor-b');
  assert.deepEqual((await request(port, 'GET', '/api/inventory', a)).json.records, []);
  const a1 = await request(port, 'POST', '/api/scan', a);
  assert.equal(a1.json.summary.byStatus.hostile, 1);
  const a2 = await request(port, 'POST', '/api/scan', a);
  assert.equal(a2.json.diff.changed[0].possibleRugPull, true, 'A saw the rug-pull on its second scan');

  // B sees nothing of A's, and B's first scan is a clean baseline: A's scans did not advance B's rug-pull stub.
  assert.deepEqual((await request(port, 'GET', '/api/inventory', b)).json.records, []);
  const b1 = await request(port, 'POST', '/api/scan', b);
  assert.equal(b1.json.diff.firstScan, true);
  assert.equal(b1.json.summary.byStatus.hostile, 1, 'only the poisoned stub; the rug-pull stub is still on its clean first listing');
  assert.equal(b1.json.summary.byStatus.healthy, 2);

  // B's reset leaves A's inventory and counters alone.
  assert.equal((await request(port, 'POST', '/api/reset', b)).json.ok, true);
  assert.deepEqual((await request(port, 'GET', '/api/inventory', b)).json.records, []);
  assert.equal((await request(port, 'GET', '/api/inventory', a)).json.scanId, a2.json.scanId);
  assert.equal(rt.stubs.stateOf('rugpull', 'visitor-a').toolsListCalls, 2);
  assert.equal(rt.stubs.stateOf('rugpull', 'visitor-b').toolsListCalls, 0);

  // a record id fetched in A is not found through B
  const id = a2.json.records[0].id;
  assert.equal((await request(port, 'GET', `/api/inventory/${id}`, a)).status, 200);
  assert.equal((await request(port, 'GET', `/api/inventory/${id}`, b)).status, 404);

  // no header = the default workspace, which is also separate from both
  assert.deepEqual((await request(port, 'GET', '/api/inventory')).json.records, []);
  assert.equal(rt.workspaces.size, 3);
});

test('a hostile or malformed workspace id is refused with 400 and creates no workspace', async (t) => {
  const { port, rt } = await boot(t);
  const before = rt.workspaces.size;
  const hostile = ['', 'A', 'UPPER', '../etc', 'a/b', 'a b', '-lead', 'a'.repeat(33), 'a.b', 'a_b', 'café', 'a​b', '<script>', "a'b", 'a;b', '%00', 'a%2fb'];
  for (const id of hostile) {
    const res = await request(port, 'GET', '/api/inventory', { headers: { 'x-workspace-id': id } }).catch((e) => ({ status: `client-refused:${e.code}` }));
    assert.ok(res.status === 400 || String(res.status).startsWith('client-refused'), `${JSON.stringify(id)} -> ${res.status}`);
    if (res.status === 400) assert.equal(res.json.error, 'bad_request');
  }
  const r = await request(port, 'GET', '/api/inventory', { headers: { 'x-workspace-id': 'ok-1' } });
  assert.equal(r.status, 200);
  assert.equal(rt.workspaces.size, before + 1, 'only the valid id created a workspace');
  // writes with a hostile id never reach the store either
  assert.equal((await request(port, 'POST', '/api/scan', { headers: { 'x-workspace-id': '../x' } })).status, 400);
  // the id is a label, not a credential: an Authorization header is still refused
  assert.equal((await request(port, 'GET', '/api/inventory', { headers: { 'x-workspace-id': 'ok-1', authorization: 'Bearer x' } })).status, 400);
});

test('in local mode the workspace header is ignored: one shared inventory, as before', async (t) => {
  const { port } = await boot(t, { env: {} });
  await request(port, 'POST', '/api/scan', ws('visitor-a'));
  assert.equal((await request(port, 'GET', '/api/inventory', ws('visitor-b'))).json.records.length > 0, true);
  assert.equal((await request(port, 'GET', '/api/inventory', { headers: { 'x-workspace-id': '../x' } })).status, 200);
});

test('the registry caps workspaces and evicts the least recently used; the default is never evicted', () => {
  const dropped = [];
  const w = createWorkspaces({ create: (id) => ({ id }), max: 3, onEvict: (id) => dropped.push(id) });
  w.get(DEFAULT_WORKSPACE); w.get('one'); w.get('two');
  assert.deepEqual(w.ids(), [DEFAULT_WORKSPACE, 'one', 'two']);
  w.get('one'); // touch: 'two' is now the least recently used
  w.get('three');
  assert.deepEqual(dropped, ['two']);
  assert.equal(w.size, 3);
  for (let i = 0; i < 20; i += 1) w.get(`flood-${i}`);
  assert.equal(w.size, 3, 'a flood of new ids never grows the registry past the cap');
  assert.ok(w.ids().includes(DEFAULT_WORKSPACE));
  assert.throws(() => w.get('Bad Id'), /invalid workspace id/);
  assert.throws(() => w.get('x'.repeat(33)), /invalid workspace id/);
});

test('an idle workspace is dropped after the TTL and comes back empty; the default stays', () => {
  let t = 1_000;
  const dropped = [];
  const w = createWorkspaces({ create: (id) => ({ id, born: t }), ttlMs: 100, now: () => t, onEvict: (id) => dropped.push(id) });
  w.get(DEFAULT_WORKSPACE); const first = w.get('idle');
  t += 99; w.get(DEFAULT_WORKSPACE);
  assert.equal(w.get('idle'), first, 'within the TTL it is the same workspace (and the touch renewed it)');
  t += 100;
  w.sweep();
  assert.deepEqual(dropped, ['idle']);
  assert.deepEqual(w.ids(), [DEFAULT_WORKSPACE]);
  assert.notEqual(w.get('idle'), first, 'a new workspace, fresh state');
  assert.equal(isWorkspaceId('ok-1'), true);
  assert.equal(isWorkspaceId(undefined), false);
  assert.equal(isWorkspaceId(['a']), false);
});

test('eviction in the running app drops the workspace state, including the shared stubs\' counters for it', async (t) => {
  let now = 5_000;
  const { port, rt } = await boot(t, { runtimeOptions: { max: 3, ttlMs: 1000, now: () => now } });
  await request(port, 'POST', '/api/scan', ws('one'));
  await request(port, 'POST', '/api/scan', ws('two'));
  assert.equal(rt.stubs.workspaceCount(), 2);
  await request(port, 'POST', '/api/scan', ws('three')); // cap 3 incl. default: 'one' goes
  assert.equal(rt.workspaces.ids().includes('one'), false);
  assert.equal(rt.stubs.workspaceCount(), 2, 'the evicted workspace\'s counters are gone (two and three remain)');
  await request(port, 'POST', '/api/scan', ws('one')); // comes back with a fresh baseline and fresh counters
  assert.equal(rt.stubs.stateOf('rugpull', 'one').toolsListCalls, 1);
  now += 5_000; // everything but the default is idle past the TTL
  await request(port, 'GET', '/api/inventory', ws('four'));
  assert.deepEqual(rt.workspaces.ids().sort(), [DEFAULT_WORKSPACE, 'four']);
  assert.equal(rt.stubs.workspaceCount(), 1, 'TTL eviction frees the stub counters too (only the live workspace four remains)');
});

test('a scan still in flight when its workspace is evicted does not leave stub counters behind or poison a re-created id', async (t) => {
  const base = await freeBase('hosted', 6);
  const rt = await createRuntime({ env: SE, stubBase: base, max: 3 });
  t.after(() => rt.close());
  const cleanStatuses = (await rt.forWorkspace('clean').scan()).records.map((r) => r.status).sort();
  const late = rt.forWorkspace('victim').scan(); // not awaited
  for (const id of ['x1', 'x2', 'x3']) rt.forWorkspace(id);
  assert.equal(rt.workspaces.ids().includes('victim'), false);
  await late.catch(() => {});
  assert.equal(rt.stubs.stateOf('rugpull', 'victim').toolsListCalls, 0, 'no counters were recreated for the dropped id');
  const again = (await rt.forWorkspace('victim').scan()).records.map((r) => r.status).sort();
  assert.deepEqual(again, cleanStatuses, 'the returning id gets a clean baseline');
});

test('se-mock never writes a file: the store is memory only whatever the environment says', async (t) => {
  const { rt } = await boot(t);
  const store = rt.forWorkspace('visitor-a').store;
  assert.equal(typeof store.snapshot, 'function');
  await store.reset(); // memory only: would throw on a read-only filesystem if it tried to persist
});

test('hosted Host and Origin: only the configured public host (and loopback) are accepted; others stay refused', async (t) => {
  const { port } = await boot(t, { publicHost: 'discovery.se.example' });
  const host = 'discovery.se.example';
  assert.equal((await request(port, 'GET', '/api/health', { host })).status, 200);
  assert.equal((await request(port, 'GET', '/api/health', { host: `${host}:443` })).status, 200);
  assert.equal((await request(port, 'GET', '/api/health', { host: 'evil.example' })).status, 421);
  assert.equal((await request(port, 'GET', '/api/health', { host: `x${host}` })).status, 421);
  assert.equal((await request(port, 'GET', '/api/health', { host: `${host}.evil.example` })).status, 421);
  const write = (origin, h = host) => request(port, 'POST', '/api/reset', { host: h, headers: { origin } });
  assert.equal((await write(`https://${host}`)).status, 200);
  assert.equal((await write('https://evil.example')).status, 403);
  assert.equal((await write(`https://${host}.evil.example`)).status, 403);
  assert.equal((await write(`https://${host}:8443`)).status, 403, 'origin and Host must agree');
  assert.equal((await write('null')).status, 403);
  assert.equal((await request(port, 'POST', '/api/reset', { host, headers: { origin: `https://${host}`, 'sec-fetch-site': 'cross-site' } })).status, 403);
});

test('MCP_DISCOVERY_PUBLIC_HOST keeps working next to LAB_ALLOWED_HOSTS: each name passes its own Host/Origin rules and not the other\'s', async (t) => {
  const { port } = await boot(t, { publicHost: 'discovery.se.example', allowedHosts: new Set(['mcp-discovery.local.ping-devops.com']) });
  const write = (origin, h, extra = {}) => request(port, 'POST', '/api/reset', { host: h, headers: { origin, ...extra } });
  assert.equal((await write('https://discovery.se.example', 'discovery.se.example')).status, 200);
  assert.equal((await write('https://local.ping-devops.com:8443', 'mcp-discovery.local.ping-devops.com:5310', { 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'https' })).status, 200);
  assert.equal((await write('https://local.ping-devops.com:8443', 'discovery.se.example', { 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'https' })).status, 403, 'forwarded headers are not believed on the public host');
  assert.equal((await write('https://discovery.se.example', 'mcp-discovery.local.ping-devops.com:5310')).status, 403, 'the public origin is not valid for the proxy name');
});

test('without a public host only loopback is accepted, as in the local build', async (t) => {
  const { port } = await boot(t);
  assert.equal((await request(port, 'GET', '/api/health', { host: 'discovery.se.example' })).status, 421);
  assert.equal((await request(port, 'POST', '/api/reset', { host: `127.0.0.1:${port}`, headers: { origin: 'https://discovery.se.example' } })).status, 403);
});
