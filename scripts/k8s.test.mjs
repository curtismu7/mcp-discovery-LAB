// Rule 18 (mock-only SE build): the manifests keep their safety properties. Text checks, no cluster, no yaml dependency,
// and kubectl is never run (a fake kubectl that fails is put first on PATH to prove the dry run does not call it).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const dep = read('k8s/deployment.yaml');
const noEnvsubst = false;

const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'k8s-test-'));
fs.writeFileSync(path.join(fakeBin, 'kubectl'), '#!/bin/sh\necho "kubectl must not run in tests" >&2\nexit 99\n', { mode: 0o755 });
const run = (env, args = ['--dry-run']) => spawnSync('bash', ['k8s/deploy.sh', ...args], { cwd: root, env: { PATH: `${fakeBin}:${process.env.PATH}`, ...env }, encoding: 'utf8' });

test('the deployment is mock-only, non-root, read-only, limited and probed on /api/health', () => {
  for (const re of [/name: MODE, value: se-mock/, /runAsNonRoot: true/, /readOnlyRootFilesystem: true/, /allowPrivilegeEscalation: false/, /drop: \["ALL"\]/,
    /limits: \{ cpu: 500m, memory: 256Mi \}/, /requests: \{ cpu:/, /automountServiceAccountToken: false/, /seccompProfile/, /containerPort: 5310/]) assert.match(dep, re);
  assert.equal((dep.match(/path: \/api\/health/g) || []).length, 2, 'readiness and liveness');
  assert.match(dep, /readinessProbe:/);
  assert.match(dep, /livenessProbe:/);
  assert.equal((dep.match(/name: Host, value: "127\.0\.0\.1:5310"/g) || []).length, 2, 'probes send a loopback Host');
  assert.match(dep, /replicas: 1/);
  assert.match(dep, /image: __IMAGE__/, 'the image is a placeholder filled by the owner');
  assert.doesNotMatch(dep, /image: \S*:(latest|HEAD)\b/);
});

test('nothing in the manifests can reach the host or the live feature', () => {
  for (const f of ['k8s/deployment.yaml', 'k8s/service.yaml', 'k8s/ingress.yaml']) {
    const t = read(f);
    assert.doesNotMatch(t, /hostPath|hostNetwork|hostPID|hostIPC|privileged: true|docker\.sock|runAsUser: 0\b|NodePort|LoadBalancer/, f);
    assert.doesNotMatch(t, /MCP_DISCOVERY_LIVE|MCP_DISCOVERY_CONFIG_PATHS|MCP_DISCOVERY_REMOTE_URLS|MCP_DISCOVERY_STORE_PATH/, `${f} sets no live setting`);
  }
  assert.doesNotMatch(dep, /MODE, value: (local|live|mock|prod)\b/);
  assert.doesNotMatch(dep, /persistentVolumeClaim|configMap|secret:/);
});

test('no secret, tenant id, credential or real host sits in the manifests or the script', () => {
  for (const f of ['k8s/deployment.yaml', 'k8s/service.yaml', 'k8s/ingress.yaml', 'k8s/deploy.sh']) {
    const t = read(f);
    assert.doesNotMatch(t, /secretKeyRef|kind: Secret|password|(^|\s)token:|apiKey|ping-devops|ghcr\.io\/[a-z]/i, f);
  }
  assert.match(read('k8s/ingress.yaml'), /host: __SE_HOST__/, 'the host is supplied, never defaulted');
  assert.match(dep, /MCP_DISCOVERY_PUBLIC_HOST, value: __SE_HOST__/);
});

test('the Dockerfile is one image for both forms: MODE is not baked in, no fork', () => {
  const d = read('Dockerfile');
  assert.doesNotMatch(d, /MODE=se-mock/, 'local stays the default; the manifest selects se-mock');
  assert.equal((d.match(/^FROM /gm) || []).length, 2, 'the same two stages as standalone');
  assert.match(d, /USER node/);
  assert.equal(fs.existsSync(path.join(root, 'Dockerfile.k8s')), false);
});

test('deploy.sh refuses without owner approval, without an immutable tag, and with a bad host', { skip: noEnvsubst }, () => {
  const ok = { OWNER_APPROVED: '1', NAMESPACE: 'demo-ns', IMAGE: 'registry.example/team/mcp-discovery:abc1234', SE_HOST: 'discovery.demo.example' };
  assert.equal(run({}).status, 2, 'no approval');
  assert.match(run({}).stderr, /owner-approved/);
  assert.equal(run({ ...ok, OWNER_APPROVED: '0' }).status, 2);
  assert.equal(run({ ...ok, OWNER_APPROVED: 'yes' }).status, 2);
  for (const IMAGE of ['registry.example/x:latest', 'registry.example/x:HEAD', 'registry.example/x', 'registry.example/x:', 'reg;rm/x:1', 'a b:1', '$(id):1']) assert.equal(run({ ...ok, IMAGE }).status, 2, IMAGE);
  for (const SE_HOST of ['Bad Host', 'a/b', 'a;b', '.x', 'x.', '-x', 'a:80', '$(id)']) assert.equal(run({ ...ok, SE_HOST }).status, 2, SE_HOST);
  const { NAMESPACE: _omit, ...noNs } = ok;
  assert.equal(run(noNs).status, 2, 'no namespace');
  for (const NAMESPACE of ['Bad', '-x', 'x-', 'a;b', 'a b', '$(id)']) assert.equal(run({ ...ok, NAMESPACE }).status, 2, NAMESPACE);
  assert.equal(run({ ...ok, CONTEXT: 'a;b' }).status, 2, 'bad context');
  const r = run(ok);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /image: registry\.example\/team\/mcp-discovery:abc1234/);
  assert.match(r.stdout, /host: discovery\.demo\.example/);
  assert.match(r.stdout, /MCP_DISCOVERY_PUBLIC_HOST, value: discovery\.demo\.example/);
  assert.match(r.stdout, /name: MODE, value: se-mock/);
  assert.doesNotMatch(r.stdout, /__(IMAGE|SE_HOST)__/);
  assert.deepEqual([...r.stdout.matchAll(/^kind: (\w+)/gm)].map((m) => m[1]).sort(), ['Deployment', 'Ingress', 'Service']);
});

test('without --dry-run the script would call kubectl, and only then (the fake kubectl proves the path is reached)', { skip: noEnvsubst }, () => {
  const r = run({ OWNER_APPROVED: '1', NAMESPACE: 'demo-ns', IMAGE: 'registry.example/team/mcp-discovery:abc1234', SE_HOST: 'discovery.demo.example' }, []);
  assert.notEqual(r.status, 0, 'the fake kubectl fails the apply; nothing was deployed');
  assert.match(r.stderr, /kubectl must not run in tests/);
  assert.match(read('k8s/deploy.sh'), /"\$\{KUBE\[@\]\}" apply/);
  assert.match(read('k8s/deploy.sh'), /kubectl --namespace "\$NAMESPACE"/, 'every kubectl call is namespaced');
});

test('deploy.sh --dry-run fails when a rendered manifest keeps a stray __TOKEN__ (temp copy, tracked files untouched)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'k8s-stray-'));
  for (const f of ['deploy.sh', 'deployment.yaml', 'service.yaml', 'ingress.yaml']) fs.copyFileSync(path.join(root, 'k8s', f), path.join(tmp, f));
  fs.appendFileSync(path.join(tmp, 'service.yaml'), '# stray __EXTRA_TOKEN__\n');
  const r = spawnSync('bash', ['deploy.sh', '--dry-run'], { cwd: tmp, env: { PATH: `${fakeBin}:${process.env.PATH}`, OWNER_APPROVED: '1', NAMESPACE: 'demo-ns', IMAGE: 'registry.example/team/mcp-discovery:abc1234', SE_HOST: 'discovery.demo.example' }, encoding: 'utf8' });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /unreplaced placeholder token/);
  assert.match(r.stderr, /__EXTRA_TOKEN__/);
});
