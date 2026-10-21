import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { FAKE_SECRET_ARG, FAKE_SECRET_ENV, FAKE_SECRET_QUERY } from '../src/demo/fixtures.js';
import { BASES } from './helpers.js';

const byName = (records, name) => records.find((r) => r.displayName === name);

test('demo scan finds the stub servers with the expected status for each', async (t) => {
  const rt = await createRuntime({ env: {}, stubBase: BASES.scanner });
  t.after(() => rt.close());
  const { records, diagnostics, diff } = await rt.scan();
  assert.deepEqual(diagnostics, []);
  assert.equal(diff.firstScan, true);
  const at = (port) => records.find((r) => r.endpoint === `http://127.0.0.1:${port}/mcp`);
  assert.equal(at(BASES.scanner).status, 'healthy', 'clean');
  assert.equal(at(BASES.scanner).tools.length, 2);
  assert.equal(at(BASES.scanner + 1).status, 'hostile', 'poisoned');
  assert.deepEqual([...new Set(at(BASES.scanner + 1).securityFindings.map((f) => f.kind))].sort(), ['broad-schema', 'hidden-instruction', 'invisible-characters']);
  assert.equal(at(BASES.scanner + 2).status, 'healthy', 'rug-pull stub looks clean the first time');
  assert.equal(at(BASES.scanner + 3).status, 'offline');
  assert.equal(at(BASES.scanner + 3).probe.errorCode, 'timeout');
  assert.equal(at(BASES.scanner + 4).status, 'degraded');
  assert.equal(at(BASES.scanner + 4).probe.errorCode, 'auth_required');
});

test('the rug-pull stub shows a metadata hash change on the second scan, and reset starts over', async (t) => {
  const rt = await createRuntime({ env: {}, stubBase: BASES.scanner + 10 });
  t.after(() => rt.close());
  const first = await rt.scan();
  const second = await rt.scan();
  const before = first.records.find((r) => r.endpoint?.endsWith(`:${BASES.scanner + 12}/mcp`));
  const after = second.records.find((r) => r.id === before.id);
  assert.notEqual(before.toolMetadataHash, after.toolMetadataHash);
  assert.equal(after.status, 'hostile');
  assert.equal(second.diff.firstScan, false);
  assert.deepEqual(second.diff.new, []);
  assert.equal(second.diff.changed.length, 1);
  assert.equal(second.diff.changed[0].id, before.id);
  assert.equal(second.diff.changed[0].possibleRugPull, true);
  const third = await rt.scan();
  assert.equal(third.diff.changed.length, 0, 'later scans serve the same changed list, so no further change');
  await rt.reset();
  assert.equal((await rt.store.snapshot()).records.length, 0);
  const again = await rt.scan();
  assert.equal(again.diff.firstScan, true);
  assert.equal(again.records.find((r) => r.id === before.id).toolMetadataHash, before.toolMetadataHash, 'reset restores the clean first list');
});

test('the auth stub gets no credentials, stdio and remote candidates are never contacted, an unconfirmed listener is skipped', async (t) => {
  const rt = await createRuntime({ env: {}, stubBase: BASES.scanner + 20 });
  t.after(() => rt.close());
  const { records } = await rt.scan();
  assert.equal(rt.stubs.byKey.auth.state.hits > 0, true);
  assert.equal(rt.stubs.byKey.auth.state.credentialHeaderSeen, false);
  assert.equal(byName(records, 'local-files').probe.errorCode, 'stdio_unprobed');
  assert.equal(byName(records, 'hosted-search').probe.errorCode, 'not_loopback_unprobed');
  assert.equal(byName(records, 'mcp.example.invalid').probe.errorCode, 'remote_not_contacted');
  assert.equal(byName(records, 'postgres 5319').probe.errorCode, 'probe_skipped_unconfirmed');
  assert.equal(byName(records, 'postgres 5319').probe.lastAttemptAt, null);
});

test('only the listed tool methods are sent: no tool is ever invoked', async (t) => {
  const seen = [];
  const rt = await createRuntime({ env: {}, stubBase: BASES.scanner + 30 });
  t.after(() => rt.close());
  const { default: http } = await import('node:http');
  // wrap the clean stub's request handler to record the JSON-RPC methods it receives
  const listeners = rt.stubs.stubs.length; // sanity: 5 stubs
  assert.equal(listeners, 5);
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { try { seen.push(JSON.parse(init.body).method); } catch { /* ignore */ } return orig(url, init); };
  t.after(() => { globalThis.fetch = orig; });
  await rt.scan();
  assert.ok(seen.length > 0);
  assert.deepEqual([...new Set(seen)].sort(), ['initialize', 'notifications/initialized', 'server/discover', 'tools/list']);
  assert.ok(http);
});

test('secret-looking strings in the fixtures never reach the scan output', async (t) => {
  const rt = await createRuntime({ env: {}, stubBase: BASES.scanner + 40 });
  t.after(() => rt.close());
  const out = JSON.stringify(await rt.scan()) + JSON.stringify(await rt.store.snapshot());
  for (const secret of [FAKE_SECRET_ARG, FAKE_SECRET_QUERY, FAKE_SECRET_ENV, 'demo-fake-bearer-3333']) assert.ok(!out.includes(secret), secret);
  assert.ok(out.includes('[REDACTED]'));
  assert.ok(out.includes('region=eu'), 'the non-secret query parameter survives');
});

test('server-provided text is inert in records: hidden characters are shown, not stored raw', async (t) => {
  const rt = await createRuntime({ env: {}, stubBase: BASES.scanner + 50 });
  t.after(() => rt.close());
  const { records } = await rt.scan();
  const poisoned = records.find((r) => r.endpoint?.endsWith(`:${BASES.scanner + 51}/mcp`));
  assert.ok(!/[​‮]/.test(JSON.stringify(poisoned)));
  assert.match(poisoned.tools[0].description, /no\[U\+200B\]tes/);
});
