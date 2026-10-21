// Safety rules. Pure functions, no I/O.
//  1. Bind loopback only, unless MCP_DISCOVERY_BIND opts in (the container does), and never together with live mode.
//  2. Every port this app uses is in 5300-5999.
//  3. Demo mode is the default. Scanning the real host needs MCP_DISCOVERY_LIVE=1 exactly.
//  4. Only loopback hosts are Host-header-accepted; no credential header is accepted.

export const SERVER_PORT = 5310;
export const STUB_BASE_PORT = 5311;
export const STUB_LAST_PORT = 5319;

const OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
const LOOPBACK_V4 = new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || LOOPBACK_V4.test(h);
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

// Strict Host parsing: "localhost", "127.x.y.z" (each octet 0-255) or "[::1]", optionally ":port". Anything else -> null.
const HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::(\d{1,5}))?$/i;
export function parseHost(hostHeader) {
  const m = HOST_RE.exec(String(hostHeader ?? '').trim());
  if (!m || !isLoopbackHost(m[1])) return null;
  if (m[2] !== undefined && Number(m[2]) > 65535) return null;
  return { hostname: m[1].toLowerCase().replace(/^\[|\]$/g, ''), port: m[2] === undefined ? null : Number(m[2]), host: `${m[1]}${m[2] === undefined ? '' : `:${m[2]}`}`.toLowerCase() };
}
// "127.0.0.1:5310" | "[::1]:5310" | "localhost" -> hostname ('' if malformed)
export const hostnameOf = (hostHeader) => parseHost(hostHeader)?.hostname ?? '';

// Rejects a missing, malformed or non-loopback Host header (DNS rebinding): 421 Misdirected Request.
export function hostGuard(req, res, next) {
  if (!req.headers.host || !parseHost(req.headers.host)) {
    return res.status(421).json({ error: 'bad_host', message: 'this server answers loopback Host headers only' });
  }
  return next();
}

// CSRF defence for anything that is not a plain read. A browser page on another site can send a "simple" POST to
// 127.0.0.1 without CORS permission, so the server must refuse it itself:
//  - Sec-Fetch-Site: cross-site is refused (same-origin, same-site, none are fine);
//  - an Origin header must be an http loopback origin identical to the Host the request was sent to (this also
//    covers a published container port and the Vite dev proxy, which forwards Host and Origin unchanged);
//  - a request with a body must be application/json.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export function originGuard(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  const refuse = (status, error, message) => res.status(status).json({ error, message });
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return refuse(403, 'cross_site_refused', 'cross-site requests are refused');
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let u = null;
    try { u = new URL(origin); } catch { /* refused below */ }
    const host = parseHost(req.headers.host);
    const same = u && u.protocol === 'http:' && u.origin !== 'null' && isLoopbackHost(u.hostname) && host
      && u.host.toLowerCase() === host.host && !u.username && !u.password && u.pathname === '/' && origin === u.origin;
    if (!same) return refuse(403, 'bad_origin', 'this server accepts same-origin loopback requests only');
  }
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (hasBody && !/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) return refuse(415, 'unsupported_media_type', 'a request body must be application/json');
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
