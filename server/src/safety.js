// Safety rules. Pure functions, no I/O.
//  1. Bind loopback only, unless MCP_DISCOVERY_BIND opts in (the container does), and never together with live mode.
//  2. Every port this app uses is in 5300-5999.
//  3. Demo mode is the default. Scanning the real host needs MCP_DISCOVERY_LIVE=1 exactly.
//  4. Only loopback hosts are Host-header-accepted; no credential header is accepted.

export const SERVER_PORT = 5310;
export const STUB_BASE_PORT = 5311;
export const STUB_LAST_PORT = 5319;

export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

export const portInRange = (p) => Number.isInteger(p) && p >= 5300 && p <= 5999;
export const liveEnabled = (env = process.env) => env.MCP_DISCOVERY_LIVE === '1';
export const bindHost = (env = process.env) => env.MCP_DISCOVERY_BIND || '127.0.0.1';
export const serverPort = (env = process.env) => (env.MCP_DISCOVERY_PORT === undefined ? SERVER_PORT : Number(env.MCP_DISCOVERY_PORT));

export function assertBindAllowed(host, env = process.env) {
  if (liveEnabled(env) && !isLoopbackHost(host)) {
    throw new Error(`refusing to bind ${host} with MCP_DISCOVERY_LIVE=1: a live inventory of this machine is served on loopback only.`);
  }
  if (isLoopbackHost(host) || env.MCP_DISCOVERY_BIND) return host;
  throw new Error(`refusing to bind ${host}: loopback only. Set MCP_DISCOVERY_BIND to opt in (demo mode only).`);
}

// "127.0.0.1:5310" | "[::1]:5310" | "localhost" -> hostname
export function hostnameOf(hostHeader) {
  const h = String(hostHeader || '').trim();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') === -1 ? undefined : h.indexOf(']'));
  return h.replace(/:\d+$/, '');
}

// Rejects a non-loopback Host header (DNS rebinding): 421 Misdirected Request.
export function hostGuard(req, res, next) {
  if (!req.headers.host || !isLoopbackHost(hostnameOf(req.headers.host))) {
    return res.status(421).json({ error: 'bad_host', message: 'this server answers loopback Host headers only' });
  }
  return next();
}

// No credential is ever accepted or used. A request that carries one is refused, not ignored.
// (Cookies are not checked: they are scoped by host not port, so other local apps' cookies would arrive here. They are never read.)
const CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'x-api-key'];
export function credentialGuard(req, res, next) {
  if (CREDENTIAL_HEADERS.some((h) => req.headers[h] !== undefined)) {
    return res.status(400).json({ error: 'credentials_not_accepted', message: 'this server accepts and uses no credentials' });
  }
  return next();
}
