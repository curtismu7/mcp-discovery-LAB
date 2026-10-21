import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCandidates } from '../src/candidates/index.js';
import { discoverProcesses } from '../src/candidates/processes.js';
import { discoverListeners } from '../src/candidates/listeners.js';
import { discoverCompose } from '../src/candidates/compose.js';
import { discoverClientConfigs } from '../src/candidates/clientConfig.js';
import { discoverRemoteUrls } from '../src/candidates/remoteUrls.js';

const execFixture = async (file, args) => {
  if (file === 'ps') {
    assert.deepEqual(args, ['-axo', 'pid=,command=']);
    return '  42 node /tmp/mcp-server.mjs\n  43 node /tmp/unrelated.mjs\n';
  }
  if (file === 'lsof') {
    assert.deepEqual(args, ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpctn']);
    return 'p42\ncnode\nf123\nn127.0.0.1:8080\n';
  }
  if (file === 'docker') {
    assert.deepEqual(args, ['ps', '--format', '{{json .}}']);
    return '{"ID":"abc","Names":"ai-demo-mcp-server","Image":"demo","Labels":"com.docker.compose.service=mcp-server","Ports":"0.0.0.0:8080->8080/tcp"}\n';
  }
  throw new Error(`unexpected command ${file}`);
};

test('discovers likely MCP host processes without attaching to stdio', async () => {
  const candidates = await discoverProcesses(execFixture);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].transport, 'stdio');
  assert.equal(candidates[0].process.pid, 42);
  assert.equal(candidates[0].source, 'host-process');
});

test('discovers local listeners as HTTP candidates', async () => {
  const candidates = await discoverListeners(execFixture);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].endpoint, 'http://127.0.0.1:8080/mcp');
  assert.equal(candidates[0].source, 'listener');
});

test('parses Compose metadata without shell interpolation', async () => {
  const candidates = await discoverCompose(execFixture, { host: '127.0.0.1' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].container.service, 'mcp-server');
  assert.equal(candidates[0].endpoint, 'http://127.0.0.1:8080/mcp');
});

test('reads only configured MCP client config paths', async () => {
  const fsImpl = { readFile: async () => JSON.stringify({ mcpServers: {
    safe: { command: 'node', args: ['server.mjs'] },
    remote: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'secret' } },
  } }) };
  const candidates = await discoverClientConfigs(fsImpl, ['/tmp/config.json']);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].source, 'client-config');
  assert.equal(candidates[1].endpoint, 'https://mcp.example.com/mcp');
  assert.equal(candidates[1].headers, undefined);
});

test('accepts explicit public remote URLs and reports rejected targets', async () => {
  const result = await discoverRemoteUrls(['https://mcp.example.com/mcp', 'http://127.0.0.1:8080/mcp']);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].location, 'remote');
  assert.equal(result.diagnostics[0].reason, 'private_remote_target');
});

test('folds a stdio host-process into the listener that has the same pid', async () => {
  const result = await discoverCandidates({ execFile: execFixture, compose: { host: '127.0.0.1' } });
  assert.equal(result.candidates.filter((candidate) => candidate.source === 'host-process').length, 0);
  assert.match(result.candidates.find((candidate) => candidate.source === 'listener').process.command, /mcp-server/);
});

test('a listener on a non-loopback interface is not a candidate', async () => {
  const out = await discoverListeners(async () => 'p9\ncnode\nn192.168.1.5:8080\n');
  assert.deepEqual(out, []);
});

test('merges duplicate endpoint candidates while retaining source labels', async () => {
  const result = await discoverCandidates({
    execFile: execFixture,
    remoteUrls: ['http://127.0.0.1:8080/mcp'],
    clientConfigPaths: [],
    compose: { host: '127.0.0.1' },
  });
  const listener = result.candidates.find((candidate) => candidate.endpoint === 'http://127.0.0.1:8080/mcp');
  assert.ok(listener);
  assert.deepEqual(listener.sources.sort(), ['compose-service', 'host-process', 'listener']);
});
