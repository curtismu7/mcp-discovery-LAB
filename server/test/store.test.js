import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInventoryStore } from '../src/store.js';

test('persists inventory atomically and keeps last successful record on failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-discovery-'));
  const store = createInventoryStore({ filePath: join(dir, 'inventory.json'), retentionMs: 60_000 });
  const record = { id: 'one', status: 'healthy', endpoint: 'http://127.0.0.1:8080/mcp', probe: { lastSuccessAt: 'now' } };
  await store.replaceScan({ scanId: 'scan-1', records: [record], diagnostics: [] });
  const snapshot = await store.snapshot();
  assert.equal(snapshot.records[0].id, 'one');
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'inventory.json'), 'utf8')).records, [record]);
});

test('recovers from missing or corrupt inventory files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-discovery-'));
  const filePath = join(dir, 'inventory.json');
  const store = createInventoryStore({ filePath, retentionMs: 60_000 });
  assert.deepEqual((await store.list()), []);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(filePath, '{bad'));
  assert.deepEqual(await store.list(), []);
});

test('memory mode keeps retained records marked gone, and reset empties it', async () => {
  const store = createInventoryStore({ retentionMs: 60_000 });
  const seen = { id: 'a', lastSeenAt: new Date().toISOString() };
  await store.replaceScan({ scanId: 's1', records: [seen] });
  await store.replaceScan({ scanId: 's2', records: [{ id: 'b', lastSeenAt: new Date().toISOString() }] });
  const list = await store.list();
  assert.deepEqual(list.map((r) => [r.id, r.gone ?? false]), [['b', false], ['a', true]]);
  await store.reset();
  assert.deepEqual(await store.list(), []);
});
