import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const docs = ['README.md', 'docs/safety.md', 'docs/architecture.md', 'docs/k8s.md'];

test('relative links in README and docs resolve to files that exist', () => {
  for (const d of docs) {
    const text = fs.readFileSync(path.join(root, d), 'utf8');
    for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
      assert.ok(fs.existsSync(path.resolve(path.dirname(path.join(root, d)), m[1])), `${d} links to missing ${m[1]}`);
    }
  }
});

test('every npm script and source file the docs name exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const serverPkg = JSON.parse(fs.readFileSync(path.join(root, 'server/package.json'), 'utf8'));
  for (const d of docs) {
    const text = fs.readFileSync(path.join(root, d), 'utf8');
    for (const m of text.matchAll(/npm run ([\w-]+)(?! -w)/g)) assert.ok(pkg.scripts[m[1]] || serverPkg.scripts[m[1]], `${d}: npm run ${m[1]} does not exist`);
    for (const m of text.matchAll(/`((?:server|scripts)\/[\w./-]+\.(?:js|mjs))`/g)) assert.ok(fs.existsSync(path.join(root, m[1])), `${d} names missing file ${m[1]}`);
  }
});

test('the docs state the default mode and the live opt-in', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /MCP_DISCOVERY_LIVE=1/);
  assert.match(readme, /demo mode/i);
});

test('the docs say plainly what is not checked: cookies, hash-uncovered fields, the doctor stub-port range', () => {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  assert.match(read('docs/safety.md'), /Cookie headers are not checked and never read/);
  assert.match(read('README.md'), /Cookie headers are not checked and never read/);
  const safety = read('docs/safety.md');
  for (const field of ['title', 'annotations', 'outputSchema', '_meta', 'instructions', 'capabilities']) assert.ok(safety.includes(`\`${field}\``), `safety.md names the uncovered field ${field}`);
  assert.match(read('docs/architecture.md'), /5311-5315/);
  assert.match(read('docs/architecture.md'), /5316-5319 .*not checked/);
});

test('CLAUDE.md and the talk track exist and mention the port', () => {
  for (const f of ['CLAUDE.md', 'docs/talk-track.md']) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} exists`);
    assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /5310/, `${f} mentions port 5310`);
  }
});
