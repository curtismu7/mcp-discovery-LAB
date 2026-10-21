// Test helpers. Every test file owns a distinct slice of 5400-5599 so files running in parallel never collide.
import http from 'node:http';
import net from 'node:net';

export const BASES = { probe: 5420, app: 5500, scanner: 5600, api: 5700, safety: 5800 };
const SLICE_END = { probe: 5499, app: 5599, scanner: 5699, api: 5799, safety: 5899 };

const isFree = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

// A run of `count` consecutive free loopback ports inside a file's own slice of 5400-5899, so a foreign process
// holding one of the usual ports moves the test along instead of failing it. The search resumes after the last run
// handed out (and wraps), so a port is not reused right after a test closed a server on it: pooled keep-alive
// connections to the dead server would otherwise be reused. Ports stay in 5300-5999.
const cursor = {};
export async function freeBase(slice, count = 10) {
  const first = BASES[slice]; const last = SLICE_END[slice];
  const starts = [];
  for (let s = cursor[slice] ?? first; s + count - 1 <= last; s += 1) starts.push(s);
  for (let s = first; s < (cursor[slice] ?? first) && s + count - 1 <= last; s += 1) starts.push(s);
  for (const start of starts) {
    let ok = true;
    for (let p = start; p < start + count && ok; p += 1) ok = await isFree(p);
    if (ok) { cursor[slice] = start + count; return start; }
  }
  throw new Error(`no ${count} free ports in ${first}-${last}`);
}

// Like fetch, but lets a test set the Host header. Resolves { status, headers, json }.
export function request(port, method, path, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...(host ? { host } : {}), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json, raw }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
