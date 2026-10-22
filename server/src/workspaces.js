// Workspace registry (rule 13, rule 18): one in-memory runtime per workspace id, so one visitor's scan, baseline or Reset
// never touches another's. The id comes from the X-Workspace-Id header (default 'default'). It is a label, not a
// credential: it grants nothing, and everything in a workspace is synthetic.
// Capped two ways: past `max` the least recently used non-default workspace is evicted, and a workspace idle for
// `ttlMs` is dropped. The default workspace is never evicted. `onEvict(id)` lets shared parts (the stubs) forget it.
export const DEFAULT_WORKSPACE = 'default';
export const MAX_WORKSPACES = 50;
export const WORKSPACE_TTL_MS = 30 * 60 * 1000;
export const WORKSPACE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const isWorkspaceId = (id) => typeof id === 'string' && WORKSPACE_RE.test(id);

export function createWorkspaces({ create, max = MAX_WORKSPACES, ttlMs = WORKSPACE_TTL_MS, now = Date.now, onEvict = () => {} }) {
  const map = new Map(); // id -> { rt, last }; insertion order = least recently used first
  const drop = (id) => { const e = map.get(id); map.delete(id); if (e) { try { e.rt.dispose?.(); } finally { onEvict(id); } } };
  const sweep = () => {
    const t = now();
    for (const [id, e] of [...map]) if (id !== DEFAULT_WORKSPACE && t - e.last >= ttlMs) drop(id);
  };
  return {
    get(id = DEFAULT_WORKSPACE) {
      if (!isWorkspaceId(id)) throw new Error('invalid workspace id');
      sweep();
      const hit = map.get(id);
      if (hit) { hit.last = now(); map.delete(id); map.set(id, hit); return hit.rt; }
      while (map.size >= max) {
        const victim = [...map.keys()].find((k) => k !== DEFAULT_WORKSPACE);
        if (victim === undefined) break;
        drop(victim);
      }
      const rt = create(id);
      map.set(id, { rt, last: now() });
      return rt;
    },
    sweep,
    get size() { return map.size; },
    ids: () => [...map.keys()],
  };
}
