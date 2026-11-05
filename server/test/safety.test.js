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
