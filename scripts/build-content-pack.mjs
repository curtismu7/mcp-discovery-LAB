#!/usr/bin/env node
/**
 * Generates content-pack.json (repo root). Format: docs/content-pack.schema.json (a copy of the Learning Hub / ID-JAG kit schema).
 * Glossary from content/terms.json, stories from content/stories.json (same text as web/src/components/Story.jsx; a test checks that),
 * cards for the two UI views. Deterministic: lists sorted by id, 2-space JSON, no timestamps. The git commit is recorded only when
 * passed (--commit=<sha>), so a plain run is reproducible.
 *
 * Sources: none. No public documentation URL is cited in this repo that was verified, so the pack lists none.
 *
 *   node scripts/build-content-pack.mjs [--commit=<sha>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_PATH = path.join(ROOT, 'content-pack.json');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The UI has two views and no deep links, so both cards open the app root.
const CARDS = [
  { id: 'inventory', label: 'Inventory and scan diff', description: 'Scan the demo fixtures and stubs, open a record, and see the second scan flag the rug-pull stub.', group: 'try-it', href: '/', terms: ['mcp-discovery', 'rug-pull', 'tool-metadata-hash', 'tool-poisoning', 'redaction', 'inert-text'], story: 'S05' },
  { id: 'pipeline', label: 'Discovery pipeline', description: 'Sources, candidates, probe, inventory and findings as a movable diagram with Simulate.', group: 'concept', href: '/', terms: ['demo-mode', 'read-only-probe'], story: 'S01' },
];

export function buildPack({ commit } = {}) {
  const pkg = readJson('package.json');
  const stories = readJson('content/stories.json').sort(byId);
  const ids = new Set(stories.map((s) => s.id));
  const pack = {
    schema: 'demo-content-pack/1',
    id: 'mcp-discovery',
    title: 'MCP Discovery',
    version: pkg.version,
    ...(commit ? { source: { repo: 'mcp-discovery', commit } } : {}),
    demo: { id: 'mcp-discovery', name: 'MCP Discovery', catalog: 'D5', baseUrl: 'http://localhost:5310', doctor: '/api/health', tags: ['mcp', 'discovery', 'rug-pull', 'read-only'] },
    glossary: readJson('content/terms.json').sort(byId),
    sources: [],
    cards: CARDS.map(({ href, ...c }) => ({ ...c, action: { type: 'route', href } })).sort(byId),
    diagrams: [{ id: 'pipeline', label: 'Discovery pipeline', href: '/' }],
    stories,
  };
  for (const c of pack.cards) if (c.story && !ids.has(c.story)) throw new Error(`card ${c.id} names unknown story ${c.story}`);
  return pack;
}

export const serialize = (pack) => `${JSON.stringify(pack, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commit = process.argv.find((a) => a.startsWith('--commit='))?.slice(9);
  fs.writeFileSync(PACK_PATH, serialize(buildPack({ commit })));
  console.log(`wrote ${path.relative(process.cwd(), PACK_PATH) || PACK_PATH}`);
}
