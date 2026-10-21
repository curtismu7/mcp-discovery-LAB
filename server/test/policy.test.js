import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTarget } from '../src/policy.js';
import { redactRecord } from '../src/redaction.js';

test('allows explicit public HTTPS remote URL', () => {
  const result = evaluateTarget('https://mcp.example.com/mcp', { scope: 'remote' });
  assert.equal(result.allowed, true);
  assert.equal(result.normalizedUrl, 'https://mcp.example.com/mcp');
});

test('rejects private remote URL but permits local adapter loopback', () => {
  assert.equal(evaluateTarget('http://127.0.0.1:8080/mcp', { scope: 'remote' }).allowed, false);
  assert.equal(evaluateTarget('http://127.0.0.1:8080/mcp', { scope: 'local-adapter' }).allowed, true);
});

test('rejects cloud metadata and credentials in remote URL', () => {
  assert.equal(evaluateTarget('http://169.254.169.254/latest/meta-data', { scope: 'remote' }).allowed, false);
  assert.equal(evaluateTarget('https://user:password@mcp.example.com/mcp', { scope: 'remote' }).allowed, false);
});

test('redacts secrets from inventory records', () => {
  const redacted = redactRecord({
    endpoint: 'https://mcp.example.com/mcp?token=secret&safe=yes',
    process: { pid: 12, command: 'node server --api-key=secret --safe=yes' },
    headers: { Authorization: 'Bearer secret', Cookie: 'sid=secret' },
    environment: { API_KEY: 'secret' },
  });

  assert.equal(redacted.endpoint, 'https://mcp.example.com/mcp?safe=yes');
  assert.equal(redacted.process.command, 'node server --api-key=[REDACTED] --safe=yes');
  assert.deepEqual(redacted.headers, undefined);
  assert.deepEqual(redacted.environment, undefined);
});

test('rejects 0.0.0.0 and bracketed IPv6 loopback as remote targets', () => {
  assert.equal(evaluateTarget('http://0.0.0.0:8080/mcp', { scope: 'remote' }).reason, 'private_remote_target');
  assert.equal(evaluateTarget('http://[::1]:8080/mcp', { scope: 'remote' }).reason, 'private_remote_target');
});

test('the loopback scope allows only loopback hosts', () => {
  assert.equal(evaluateTarget('http://127.0.0.1:5311/mcp', { scope: 'loopback' }).allowed, true);
  assert.equal(evaluateTarget('http://localhost:5311/mcp', { scope: 'loopback' }).allowed, true);
  assert.equal(evaluateTarget('http://[::1]:5311/mcp', { scope: 'loopback' }).allowed, true);
  assert.equal(evaluateTarget('http://2130706433:5311/mcp', { scope: 'loopback' }).allowed, true); // URL parser normalises to 127.0.0.1
  for (const bad of ['https://mcp.example.com/mcp', 'http://192.168.1.5:5311/mcp', 'http://0.0.0.0:5311/mcp', 'ftp://127.0.0.1/x']) {
    assert.equal(evaluateTarget(bad, { scope: 'loopback' }).allowed, false, bad);
  }
});

test('redaction removes bearer tokens, env-style secrets, token-shaped strings and nested URLs', () => {
  const r = redactRecord({
    displayName: 'x',
    process: { pid: 1, command: 'API_TOKEN=abc123 node s.js --password hunter2 --safe=yes Authorization: Bearer abcdef123456 sk-abcdefghijklmnopqrstuv', env: { A: 'b' } },
    instructions: 'see https://u:p@host.example.invalid/x?api_key=k&ok=1',
    env: { A: 'b' },
  });
  assert.equal(r.process.command, 'API_TOKEN=[REDACTED] node s.js --password [REDACTED] --safe=yes Authorization: Bearer [REDACTED] [REDACTED]');
  assert.equal(r.instructions, 'see https://host.example.invalid/x?ok=1');
  assert.equal(r.env, undefined);
  assert.equal(r.process.env, undefined);
  assert.equal(JSON.stringify(redactRecord(r)), JSON.stringify(r), 'redaction is idempotent');
});
