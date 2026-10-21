// LIVE mode: the ONLY file that touches the real host (ps, lsof, docker ps, the client config files you list).
// Opt-in with MCP_DISCOVERY_LIVE=1. Fixed argv, no shell, short timeout, output read only. Never writes, never
// invokes a tool, never accepts a credential. A source scan in test/safety.test.js pins that nothing else imports these.
import cp from 'node:child_process';
import fs from 'node:fs/promises';

const ALLOWED = new Set(['ps', 'lsof', 'docker']);

export function liveHost(env = process.env) {
  const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  return {
    execFile: (file, args) => new Promise((resolve, reject) => {
      if (!ALLOWED.has(file)) return reject(new Error(`live host: command not allowed: ${file}`));
      return cp.execFile(file, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024, shell: false }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    }),
    fsImpl: { readFile: (path) => fs.readFile(path, 'utf8') },
    clientConfigPaths: list(env.MCP_DISCOVERY_CONFIG_PATHS),
    remoteUrls: list(env.MCP_DISCOVERY_REMOTE_URLS),
    compose: { host: '127.0.0.1' },
  };
}
