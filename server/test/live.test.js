import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { liveHost } from '../src/live.js';

test('the live command allow-list is exactly ps, lsof, docker', () => {
  const src = fs.readFileSync(new URL('../src/live.js', import.meta.url), 'utf8');
  const m = src.match(/const ALLOWED = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'ALLOWED is a literal Set');
  assert.deepEqual(m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).sort(), ['docker', 'lsof', 'ps']);
  assert.doesNotMatch(src, /shell:\s*true|\bexec\(|execSync|spawn\(/, 'no shell, no exec');
});

test('anything else is rejected before it can run', async () => {
  const host = liveHost({});
  for (const file of ['sh', 'bash', '/bin/sh', 'curl', 'rm', 'node', 'ps ', 'PS', 'docker-compose', 'env']) {
    await assert.rejects(() => host.execFile(file, ['-c', 'true']), /command not allowed/, file);
  }
});
