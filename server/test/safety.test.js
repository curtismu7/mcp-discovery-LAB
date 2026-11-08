import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHttpServer } from '../src/app.js';
import { createRuntime } from '../src/runtime.js';
import { allPassed, runChecks } from '../src/doctor.js';
import { assertBindAllowed, bindHost, hostnameOf, isLoopbackHost, liveEnabled, portInRange } from '../src/safety.js';
import { guardNetwork } from './netguard.js';
import { freeBase, request } from './helpers.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

test('loopback helpers', () => {
  for (const h of ['127.0.0.1', 'localhost', '::1', '[::1]', '127.1.2.3']) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['0.0.0.0', '192.168.1.1', 'example.com', '127.0.0.1.evil.com']) assert.equal(isLoopbackHost(h), false, h);
  assert.equal(hostnameOf('[::1]:5310'), '::1');
  assert.equal(hostnameOf('localhost:5310'), 'localhost');
  assert.equal(portInRange(5310) && portInRange(5300) && portInRange(5999), true);
  assert.equal(portInRange(5299) || portInRange(6000) || portInRange(80) || portInRange(NaN), false);
});

test('binds loopback by default; any other address needs MCP_DISCOVERY_BIND, and never with live mode', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('0.0.0.0', { MCP_DISCOVERY_BIND: '0.0.0.0' }), '0.0.0.0');
  assert.throws(() => assertBindAllowed('0.0.0.0', { MCP_DISCOVERY_BIND: '0.0.0.0', MCP_DISCOVERY_LIVE: '1' }), /MCP_DISCOVERY_LIVE/);
  assert.equal(assertBindAllowed('127.0.0.1', { MCP_DISCOVERY_LIVE: '1' }), '127.0.0.1');
});

test('live mode needs exactly MCP_DISCOVERY_LIVE=1; other values fail the doctor, not enable it', () => {
  assert.equal(liveEnabled({}), false);
  for (const v of ['true', 'yes', '0', '', '2']) {
    assert.equal(liveEnabled({ MCP_DISCOVERY_LIVE: v }), false, v);
    assert.equal(allPassed(runChecks({ env: { MCP_DISCOVERY_LIVE: v } })), false, v);
  }
  assert.equal(liveEnabled({ MCP_DISCOVERY_LIVE: '1' }), true);
  assert.equal(allPassed(runChecks({ env: { MCP_DISCOVERY_LIVE: '1' } })), true);
  assert.equal(allPassed(runChecks({ env: { MCP_DISCOVERY_PORT: '8080' } })), false);
});

test('a started server is actually listening on loopback only', async (t) => {
  const base = await freeBase('safety', 6);
  const port = base + 5;
  const srv = await startHttpServer({ port, host: '127.0.0.1', env: {}, runtime: await createRuntime({ env: {}, stubBase: base }) });
  t.after(() => srv.close());
  assert.equal(srv.port, port);
  assert.equal((await request(port, 'GET', '/api/health')).status, 200);
  const external = Object.values((await import('node:os')).networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4');
  if (external) {
    const refused = await new Promise((resolve) => { const s = net.connect({ host: external.address, port }); s.once('connect', () => { s.destroy(); resolve(false); }); s.once('error', () => resolve(true)); });
    assert.equal(refused, true, 'not reachable on the LAN address');
  }
});

const PROXY_HOST = 'mcp-discovery.local.ping-devops.com';
const tcpServers = () => process.getActiveResourcesInfo().filter((r) => r === 'TCPServerWrap').length;

test('LAB_ALLOWED_HOSTS: the lab-proxy name is served on any port, other names stay 421, a bad name refuses to start and leaves nothing running', async (t) => {
  const base = await freeBase('safety', 6);
  const port = base + 5;
  const env = { LAB_ALLOWED_HOSTS: `${PROXY_HOST}, Other.Example` };
  const srv = await startHttpServer({ port, host: '127.0.0.1', env, runtime: await createRuntime({ env: {}, stubBase: base }) });
  t.after(() => srv.close());
  for (const host of [`${PROXY_HOST}:5310`, PROXY_HOST, 'MCP-Discovery.Local.Ping-Devops.com:8443', 'other.example', 'OTHER.example:8443', `127.0.0.1:${port}`]) {
    assert.equal((await request(port, 'GET', '/api/health', { host })).status, 200, host);
  }
  for (const host of ['evil.example.com', `${PROXY_HOST}.evil.com`, 'xmcp-discovery.local.ping-devops.example', 'local.ping-devops.com:8443', 'ping-devops.com']) {
    assert.equal((await request(port, 'GET', '/api/health', { host })).status, 421, host);
  }
  // a bad name throws before the runtime (and its stub servers) is created, in local and in se-mock mode
  const before = tcpServers();
  await assert.rejects(startHttpServer({ port: base + 4, host: '127.0.0.1', env: { LAB_ALLOWED_HOSTS: 'not a host name' } }), /LAB_ALLOWED_HOSTS: not a host name: not a host name/);
  await assert.rejects(startHttpServer({ port: base + 4, host: '127.0.0.1', env: { MODE: 'se-mock', LAB_ALLOWED_HOSTS: 'a.example,-bad-' } }), /LAB_ALLOWED_HOSTS: not a host name: -bad-/);
  assert.equal(tcpServers(), before, 'no server left running');
  // unset: the default stays loopback only
  const b2 = await freeBase('safety', 6);
  const plain = await startHttpServer({ port: b2 + 5, host: '127.0.0.1', env: {}, runtime: await createRuntime({ env: {}, stubBase: b2 }) });
  t.after(() => plain.close());
  assert.equal((await request(b2 + 5, 'GET', '/api/health', { host: `${PROXY_HOST}:5310` })).status, 421);
  assert.equal((await request(b2 + 5, 'GET', '/api/health', { host: `127.0.0.1:${b2 + 5}` })).status, 200);
});

test('behind the lab-proxy: a write is accepted only with the proxy\'s forwarded origin AND an allowed Host', async (t) => {
  const base = await freeBase('safety', 6);
  const port = base + 5;
  const srv = await startHttpServer({ port, host: '127.0.0.1', env: { LAB_ALLOWED_HOSTS: PROXY_HOST }, runtime: await createRuntime({ env: {}, stubBase: base }) });
  t.after(() => srv.close());
  const proxyHost = `${PROXY_HOST}:5310`;
  const fwd = { 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'https' };
  const via = (headers, host = proxyHost) => request(port, 'POST', '/api/reset', { host, headers });
  // what the browser and the proxy really send for a same-origin POST
  assert.equal((await via({ ...fwd, origin: 'https://local.ping-devops.com:8443', 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.equal((await via({ ...fwd, origin: 'https://local.ping-devops.com:8443' })).status, 200);
  assert.equal((await via({ 'x-forwarded-host': 'local.ping-devops.com:8443', origin: 'https://local.ping-devops.com:8443' })).status, 200, 'proto defaults to https');
  assert.equal((await via({ ...fwd, origin: 'https://local.ping-devops.com:8443' }, PROXY_HOST.toUpperCase())).status, 200, 'Host without a port, any case');
  // refused: a foreign origin, a mismatched forwarded host, a wrong scheme, a cross-site fetch, no forwarded host at all
  for (const headers of [
    { ...fwd, origin: 'https://evil.example.com' },
    { ...fwd, origin: 'https://local.ping-devops.com:9999' },
    { ...fwd, origin: 'http://local.ping-devops.com:8443' },
    { ...fwd, origin: 'https://local.ping-devops.com:8443', 'sec-fetch-site': 'cross-site' },
    { origin: 'https://local.ping-devops.com:8443' },
    { 'x-forwarded-host': 'evil.example.com', 'x-forwarded-proto': 'https', origin: 'https://local.ping-devops.com:8443' },
    { 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'ftp', origin: 'ftp://local.ping-devops.com:8443' },
  ]) assert.equal((await via(headers)).status, 403, JSON.stringify(headers));
  // the forwarded headers are not believed on a loopback Host: a page that did not come through the proxy cannot use them
  assert.equal((await via({ ...fwd, origin: 'https://local.ping-devops.com:8443' }, `127.0.0.1:${port}`)).status, 403);
  assert.equal((await via({ origin: `http://127.0.0.1:${port}` }, `127.0.0.1:${port}`)).status, 200, 'loopback origin still works');
  // and without LAB_ALLOWED_HOSTS the same request is refused at the Host check
  const b2 = await freeBase('safety', 6);
  const plain = await startHttpServer({ port: b2 + 5, host: '127.0.0.1', env: {}, runtime: await createRuntime({ env: {}, stubBase: b2 }) });
  t.after(() => plain.close());
  assert.equal((await request(b2 + 5, 'POST', '/api/reset', { host: proxyHost, headers: { ...fwd, origin: 'https://local.ping-devops.com:8443' } })).status, 421);
});

test('the guard itself works', async () => {
  const g = guardNetwork();
  try {
    await assert.rejects(() => fetch('http://203.0.113.9/'), /network blocked/);
    await assert.rejects(() => fetch('https://mcp.example.com/'), /network blocked/);
  } finally { g.restore(); }
  assert.deepEqual(g.attempts, ['fetch:203.0.113.9', 'fetch:mcp.example.com']);
  const g2 = guardNetwork();
  try { assert.throws(() => net.connect({ host: '203.0.113.9', port: 5859 }), /network blocked/); } finally { g2.restore(); }
  assert.deepEqual(g2.attempts, ['socket:203.0.113.9']);
});

test('default mode: a full scan makes zero non-loopback connections, only ever touches stub ports, and never reads the real host', async (t) => {
  const rt = await createRuntime({ env: {}, stubBase: await freeBase('safety', 6) });
  const g = guardNetwork();
  const touched = [];
  const patched = [];
  const spy = (obj, name) => {
    const real = obj[name];
    obj[name] = function spied(...args) { touched.push(`${name}:${String(args[0]).slice(0, 60)}`); throw new Error(`real host access blocked: ${name}`); };
    patched.push(() => { obj[name] = real; });
  };
  for (const n of ['exec', 'execFile', 'execSync', 'execFileSync', 'spawn', 'spawnSync', 'fork']) spy(cp, n);
  for (const n of ['readFile', 'readdir', 'readFileSync', 'readdirSync', 'createReadStream', 'opendir', 'openSync', 'statSync', 'readlinkSync']) spy(fs, n);
  for (const n of ['readFile', 'readdir', 'opendir', 'open']) spy(fsp, n);
  const realConnect = net.Socket.prototype.connect;
  const ports = new Set();
  net.Socket.prototype.connect = function recording(...args) { const a = Array.isArray(args[0]) ? args[0][0] : args[0]; ports.add(typeof a === 'object' ? a.port : a); return realConnect.apply(this, args); };
  try {
    const scan1 = await rt.scan();
    const scan2 = await rt.scan();
    assert.equal(scan1.mode ?? 'demo', 'demo');
    assert.ok(scan2.records.length >= 9);
  } finally {
    net.Socket.prototype.connect = realConnect;
    patched.forEach((undo) => undo());
    g.restore();
    await rt.close();
  }
  assert.deepEqual(g.attempts, [], 'no non-loopback socket, DNS lookup or fetch');
  assert.deepEqual(touched, [], 'no child process, no file read');
  assert.ok(ports.size > 0);
  for (const p of ports) assert.ok(rt.stubs.ports.has(Number(p)), `connected only to stub ports, saw ${p}`);
});

test('the same holds through the HTTP API: POST /api/scan under the guard', async (t) => {
  const g = guardNetwork();
  const base = await freeBase('safety', 6);
  const port = base + 5;
  let srv;
  try {
    srv = await startHttpServer({ port, host: '127.0.0.1', env: {}, runtime: await createRuntime({ env: {}, stubBase: base }) });
    assert.equal((await request(port, 'POST', '/api/scan')).status, 200);
  } finally { await srv?.close(); g.restore(); }
  assert.deepEqual(g.attempts, []);
});

test('source scan: only live.js starts processes or reads files for the host, and only runtime.js imports it', () => {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))); })(SRC);
  const rel = (f) => path.relative(SRC, f);
  const withText = files.map((f) => [rel(f), fs.readFileSync(f, 'utf8')]);
  const uses = (re) => withText.filter(([, t]) => re.test(t)).map(([f]) => f).sort();
  assert.deepEqual(uses(/node:child_process/), ['live.js']);
  assert.deepEqual(uses(/\bfetch\(|\bfetchImpl\b/), ['probe.js']);
  assert.deepEqual(uses(/from 'node:fs(\/promises)?'/), ['app.js', 'candidates/clientConfig.js', 'health.js', 'live.js', 'shelfLink.js', 'store.js']);
  assert.deepEqual(uses(/import\(['"]\.\/live\.js['"]\)|from '\.\/live\.js'/), ['runtime.js']);
  assert.deepEqual(uses(/node:(net|dgram|tls|https|http2)\b/), ['policy.js'], 'policy.js uses net.isIP only');
  assert.deepEqual(uses(/node:http'/), ['demo/stubs.js']);
});
