import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const EMPTY = () => ({ scanId: null, scannedAt: null, records: [], diagnostics: [], diff: null });

// filePath null = memory only (demo mode). With a path, the file is the source of truth (live mode).
export function createInventoryStore({ filePath = null, retentionMs = 24 * 60 * 60 * 1000 } = {}) {
  let cache = EMPTY();

  async function load() {
    if (!filePath) return cache;
    try { cache = JSON.parse(await readFile(filePath, 'utf8')); } catch { cache = EMPTY(); }
    return cache;
  }

  async function persist() {
    if (!filePath) return;
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}`;
    await writeFile(tempPath, JSON.stringify(cache, null, 2));
    await rename(tempPath, filePath);
  }

  return {
    async list() { return (await load()).records; },
    async get(id) { return (await load()).records.find((record) => record.id === id) || null; },
    async snapshot() { return await load(); },
    // Records seen in an earlier scan within the retention window and absent now are kept, marked gone: true.
    async replaceScan({ scanId, records, diagnostics, diff = null }) {
      const previous = await load();
      const now = Date.now();
      const currentIds = new Set(records.map((record) => record.id));
      const retained = previous.records
        .filter((record) => !currentIds.has(record.id) && now - Date.parse(record.lastSeenAt || 0) < retentionMs)
        .map((record) => ({ ...record, gone: true }));
      cache = { scanId, scannedAt: new Date().toISOString(), records: [...records, ...retained], diagnostics: diagnostics || [], diff };
      await persist();
      return cache;
    },
    async reset() { cache = EMPTY(); await persist(); },
  };
}
