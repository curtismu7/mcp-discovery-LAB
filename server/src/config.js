// Deployment mode (rule 18). MODE=local (default) is the standalone app, unchanged. MODE=se-mock is the hosted,
// simulated build for the SE cluster: demo stubs only, per-visitor workspaces, every live feature refused.
// Pure functions, no I/O.
export const MODES = ['local', 'se-mock'];
// Every setting that only means something in live mode. Any of them present in se-mock is an error, not ignored.
export const LIVE_FLAGS = ['MCP_DISCOVERY_LIVE', 'MCP_DISCOVERY_CONFIG_PATHS', 'MCP_DISCOVERY_REMOTE_URLS', 'MCP_DISCOVERY_STORE_PATH'];

export function modeFrom(env = process.env) {
  const m = env.MODE === undefined || env.MODE === '' ? 'local' : env.MODE;
  if (!MODES.includes(m)) throw new Error(`MODE=${String(m).slice(0, 20)} is not valid: use local (default) or se-mock`);
  return m;
}
export const isSeMock = (env = process.env) => modeFrom(env) === 'se-mock';

// Names of the live settings that are set (the values are never read out).
export const liveFlagsSet = (env = process.env) => LIVE_FLAGS.filter((k) => env[k] !== undefined);

// Throws when se-mock is combined with any live setting.
export function assertSeMockClean(env = process.env) {
  const set = liveFlagsSet(env);
  if (set.length) throw new Error(`MODE=se-mock refuses live settings: ${set.join(', ')} (unset them; the hosted build is simulated only)`);
}

// The public host name the ingress serves (se-mock only). Optional: unset means only loopback Host headers are accepted
// (kubectl port-forward). A plain DNS name, nothing else.
const HOST_NAME_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
export function publicHostFrom(env = process.env) {
  const h = env.MCP_DISCOVERY_PUBLIC_HOST;
  if (h === undefined || h === '') return null;
  if (!HOST_NAME_RE.test(h)) throw new Error('MCP_DISCOVERY_PUBLIC_HOST must be a plain lower-case host name');
  return h;
}

// Extra Host names this app answers to (family standard): LAB_ALLOWED_HOSTS, comma separated host names that point at this Mac,
// such as the lab-proxy's mcp-discovery.local.ping-devops.com. Loopback always works; unset = loopback only. Works in every mode,
// independent of MCP_DISCOVERY_PUBLIC_HOST (the single hosted name, se-mock only), which is unchanged.
const LAB_HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
export function allowedHostsFrom(env = process.env) {
  const names = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  for (const h of names) if (!LAB_HOSTNAME.test(h)) throw new Error(`LAB_ALLOWED_HOSTS: not a host name: ${h}`);
  return new Set(names);
}
