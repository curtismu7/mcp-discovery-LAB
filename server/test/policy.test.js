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

test('private ranges: 172.16.0.0/12 and IPv4-mapped IPv6 are private remote targets; 172.15 and 172.32 are not', () => {
  const reason = (host) => evaluateTarget(`http://${host}/mcp`, { scope: 'remote' }).reason;
  for (const h of ['172.16.0.1', '172.20.5.5', '172.31.255.255', '[::ffff:10.0.0.1]', '[::ffff:127.0.0.1]', '[::ffff:8.8.8.8]', '[fe80::1]', '[fc00::1]', '[fd12::1]', '[::]', '10.1.2.3', '192.168.0.1', '169.254.169.254', '0.0.0.0']) {
    assert.equal(reason(h), 'private_remote_target', h);
  }
  for (const h of ['172.15.0.1', '172.32.0.1', '8.8.8.8']) assert.equal(reason(h), null, h);
});

test('redaction: field names, headers at any depth and case, and more secret shapes', () => {
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dBjftJeZ4CVPmB92K27uhbUJU1p1r'].join('.'); // assembled so no secret scanner flags the test
  const akia = `${'AKIA'}${'IOSFODNN7EXAMPLE'}`;
  const pem = ['-----BEGIN PRIVATE', 'KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE', 'KEY-----'].join(' ');
  const r = redactRecord({
    serverInfo: { name: 'ok', apiToken: 'abc123', nested: { Authorization: 'Bearer zzz', client_secret: { value: 'v' }, Headers: { a: 'b' } }, Headers: { 'X-Key': 'k' } },
    capabilities: { password: 'hunter2', experimental: { sessionCookie: 'sid=1' }, maxTokens: 5 },
    HEADERS: { a: 'b' }, Environment: { A: 'b' }, ENV: { A: 'b' },
    instructions: `password: hunter2\nx-api-key: abc\nCookie: sid=abc; theme=dark\nSet-Cookie: sid=abc; HttpOnly\nmy_token=abc\nauth ${jwt}\nkey ${akia}\n${pem}\ndone`,
    endpoint: 'https://app.example.com/cb?x=1#access_token=SECRETVAL&state=ok',
    tools: [{ name: 'get_token', description: 'Returns the token: see docs', inputSchema: { type: 'object', properties: { token: { type: 'string' }, env: { type: 'string' } } } }],
    toolHashes: { get_token: 'sha256:aaa', password_reset: 'sha256:bbb' },
  });
  assert.equal(r.serverInfo.name, 'ok');
  assert.equal(r.serverInfo.apiToken, '[REDACTED]');
  assert.equal(r.serverInfo.nested.Authorization, '[REDACTED]');
  assert.equal(r.serverInfo.nested.client_secret, '[REDACTED]');
  assert.equal('Headers' in r.serverInfo.nested || 'Headers' in r.serverInfo, false);
  assert.equal(r.capabilities.password, '[REDACTED]');
  assert.equal(r.capabilities.experimental.sessionCookie, '[REDACTED]');
  assert.equal(r.capabilities.maxTokens, 5, 'a number is not a secret');
  for (const k of ['HEADERS', 'Environment', 'ENV']) assert.equal(k in r, false, k);
  for (const bad of ['hunter2', 'abc\n', 'sid=abc', 'my_token=abc', jwt, akia, 'MIIEvQ', 'SECRETVAL']) assert.ok(!JSON.stringify(r).includes(bad.trim()), bad);
  assert.match(r.instructions, /Cookie: \[REDACTED\]/);
  assert.match(r.instructions, /my_token=\[REDACTED\]/);
  assert.match(r.endpoint, /state=ok/);
  // data, not field names: tool names and schema properties survive
  assert.deepEqual(r.toolHashes, { get_token: 'sha256:aaa', password_reset: 'sha256:bbb' });
  assert.deepEqual(Object.keys(r.tools[0].inputSchema.properties), ['token', 'env']);
  assert.equal(JSON.stringify(redactRecord(r)), JSON.stringify(r), 'idempotent');
});
