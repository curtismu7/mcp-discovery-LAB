// Thin fetch wrapper. No body and no credentials: the server refuses them.
// X-Workspace-Id is a label, not a credential. On the hosted SE build it gives each browser tab its own in-memory workspace,
// so one visitor's Scan or Reset never touches another's. It lives in sessionStorage; without storage the tab uses "default".
// The local build ignores the header.
export function workspaceId() {
  try {
    let id = sessionStorage.getItem("mcpd-workspace");
    if (!id || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) {
      id = `w-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`.slice(0, 32);
      sessionStorage.setItem("mcpd-workspace", id);
    }
    return id;
  } catch { return "default"; }
}

async function call(path, method = "GET", payload) {
  const init = { method, headers: { Accept: "application/json", "X-Workspace-Id": workspaceId() } };
  if (payload !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(payload); }
  const res = await fetch(path, init);
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(body?.message || body?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export const getHealth = () => call("/api/health");
export const getInfo = () => call("/api/info");
export const setMode = (source) => call("/api/mode", "POST", { source });
export const getInventory = () => call("/api/inventory");
export const getRecord = (id) => call(`/api/inventory/${encodeURIComponent(id)}`);
export const postScan = () => call("/api/scan", "POST");
export const postReset = () => call("/api/reset", "POST");
