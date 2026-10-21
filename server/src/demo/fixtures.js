// Fake host data for demo mode. It is fed to the real discovery code through the same execFile / readFile seams the
// live mode uses, so the demo exercises the real parsers. Nothing here reads the machine.
// The "secrets" are obviously fake and exist so redaction has something to remove.
export const FAKE_SECRET_ARG = 'demo-fake-key-0000';
export const FAKE_SECRET_QUERY = 'demo-fake-token-1111';
export const FAKE_SECRET_ENV = 'demo-fake-env-2222';

const PIDS = { clean: 4201, poisoned: 4202, rugpull: 4203, timeout: 4204, auth: 4205 };
const DECOY = { pid: 4300, port: 5319 };

export function demoHost(stubs) {
  const ep = (key) => stubs.byKey[key];
  const execFile = async (file, args) => {
    if (file === 'ps') {
      return [
        `  ${PIDS.clean} node /opt/demo/mcp-clean-notes.js`,
        `  ${PIDS.poisoned} node /opt/demo/mcp-poisoned-notes.js --api-key=${FAKE_SECRET_ARG}`,
        `  ${PIDS.timeout} node /opt/demo/mcp-slow-server.js`,
        `  4310 npx mcp-fs-helper --root /opt/demo/files MY_SERVICE_TOKEN=${FAKE_SECRET_ENV}`,
        `  ${DECOY.pid} postgres: demo writer process`,
        '',
      ].join('\n');
    }
    if (file === 'lsof') {
      return [
        `p${PIDS.clean}`, 'cnode', `n127.0.0.1:${ep('clean').port}`,
        `p${PIDS.poisoned}`, 'cnode', `n127.0.0.1:${ep('poisoned').port}`,
        `p${PIDS.timeout}`, 'cnode', `n*:${ep('timeout').port}`,
        `p${DECOY.pid}`, 'cpostgres', `n127.0.0.1:${DECOY.port}`,
        '',
      ].join('\n');
    }
    if (file === 'docker') {
      return `${JSON.stringify({ ID: 'demo0001', Names: 'demo-mcp-rugpull', Image: 'demo/forecast', Labels: 'com.docker.compose.project=demo,com.docker.compose.service=mcp-forecast', Ports: `127.0.0.1:${ep('rugpull').port}->8080/tcp` })}\n`;
    }
    throw new Error(`demo host: unexpected command ${file} ${args.join(' ')}`);
  };
  const fsImpl = {
    readFile: async (path) => {
      if (path !== 'demo://client-config.json') throw new Error('demo host: unexpected file');
      return JSON.stringify({ mcpServers: {
        'private-server': { url: ep('auth').endpoint },
        'hosted-search': { url: `https://mcp.example.invalid/mcp?token=${FAKE_SECRET_QUERY}&region=eu`, headers: { Authorization: 'Bearer demo-fake-bearer-3333' } },
        'local-files': { command: 'npx', args: ['mcp-fs-helper', '--root', '/opt/demo/files', `--token=${FAKE_SECRET_ARG}`] },
      } });
    },
  };
  return {
    execFile, fsImpl,
    clientConfigPaths: ['demo://client-config.json'],
    remoteUrls: ['https://mcp.example.invalid/registry'],
    compose: { host: '127.0.0.1' },
    mcpPids: undefined,
  };
}
