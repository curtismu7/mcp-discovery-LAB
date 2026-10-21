import dns from 'node:dns/promises';
import net from 'node:net';
import { isLoopbackHost } from './safety.js';

const PRIVATE_IPV4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[0-1])\./, /^192\.168\./];

function isPrivateIp(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(h)) return PRIVATE_IPV4.some((pattern) => pattern.test(h));
  if (net.isIPv6(h)) return h === '::' || h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('::ffff:');
  return false;
}

// scope 'loopback' is the only scope a probe uses: http(s) to a loopback host, no credentials in the URL.
// scope 'remote' is for remote-url candidates, which are listed and never contacted; it rejects private targets.
export function evaluateTarget(target, { scope = 'remote', allowRemotePrivate = false } = {}) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return { allowed: false, reason: 'invalid_url', normalizedUrl: null };
  }
  if (!['http:', 'https:'].includes(url.protocol)) return { allowed: false, reason: 'unsupported_scheme', normalizedUrl: null };
  if (url.username || url.password) return { allowed: false, reason: 'credentials_not_allowed', normalizedUrl: null };
  if (scope === 'loopback' && !isLoopbackHost(url.hostname)) return { allowed: false, reason: 'not_loopback', normalizedUrl: null };
  if (scope === 'remote' && !allowRemotePrivate && (isPrivateIp(url.hostname) || url.hostname === 'localhost')) {
    return { allowed: false, reason: 'private_remote_target', normalizedUrl: null };
  }
  url.hash = '';
  return { allowed: true, reason: null, normalizedUrl: url.toString() };
}

export async function resolveAndEvaluateTarget(target, options = {}) {
  const initial = evaluateTarget(target, options);
  if (!initial.allowed || options.scope !== 'remote') return initial;
  const hostname = new URL(initial.normalizedUrl).hostname;
  if (net.isIP(hostname.replace(/^\[|\]$/g, ''))) return initial;
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!options.allowRemotePrivate && addresses.some(({ address }) => isPrivateIp(address))) {
      return { allowed: false, reason: 'private_remote_resolution', normalizedUrl: null };
    }
  } catch {
    return { allowed: false, reason: 'dns_resolution_failed', normalizedUrl: null };
  }
  return initial;
}
