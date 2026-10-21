import test from 'node:test';
import assert from 'node:assert/strict';
import { diffScans } from '../src/diff.js';

const rec = (id, o = {}) => ({ id, displayName: id, endpoint: `http://127.0.0.1/${id}`, status: 'healthy', toolMetadataHash: 'h1', toolHashes: { t: 'a' }, probe: { errorCode: null }, ...o });

test('first scan: everything is new', () => {
  const d = diffScans([], [rec('a')]);
  assert.equal(d.firstScan, true);
  assert.deepEqual(d.new.map((x) => x.id), ['a']);
});

test('new, gone, unchanged and a possible rug-pull on a hash change', () => {
  const d = diffScans([rec('a'), rec('b'), rec('c')], [rec('a'), rec('c', { toolMetadataHash: 'h2', toolHashes: { t: 'b', u: 'x' }, status: 'hostile' }), rec('d')]);
  assert.deepEqual(d.new.map((x) => x.id), ['d']);
  assert.deepEqual(d.gone.map((x) => x.id), ['b']);
  assert.equal(d.unchanged, 1);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].possibleRugPull, true);
  assert.deepEqual(d.changed[0].toolChanges, { added: ['u'], removed: [], changed: ['t'] });
  assert.match(d.changed[0].note, /possible rug-pull/);
});

test('a status change without a hash change is a change but not a rug-pull; retained gone records are ignored', () => {
  const d = diffScans([rec('a'), rec('z', { gone: true })], [rec('a', { status: 'offline', toolMetadataHash: null, probe: { errorCode: 'timeout' } })]);
  assert.equal(d.changed[0].possibleRugPull, false);
  assert.deepEqual(d.gone, []);
});
