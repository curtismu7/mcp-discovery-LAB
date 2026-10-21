// Thin fetch wrapper. No body, no headers, no credentials: the server refuses all of them.
async function call(path, method = "GET") {
  const res = await fetch(path, { method, headers: { Accept: "application/json" } });
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
export const getInventory = () => call("/api/inventory");
export const getRecord = (id) => call(`/api/inventory/${encodeURIComponent(id)}`);
export const postScan = () => call("/api/scan", "POST");
export const postReset = () => call("/api/reset", "POST");
