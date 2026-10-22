# Hosted mock build for the SE cluster (rule 18)

MCP Discovery ships in two forms from one image and one Dockerfile. The local standalone (`MODE` unset, or `local`) is what the README describes. The hosted mock build (`MODE=se-mock`) is the same server with every live feature refused, one isolated workspace per visitor, and a "hosted and simulated" banner. This page is the manifest-and-risk side of that build. **Nothing here has been deployed.** The first deploy to the SE cluster needs the owner's approval, and `k8s/deploy.sh` refuses to run without it.

## What the build is

- Image: the existing `Dockerfile`, unchanged. `MODE` is not baked in; the Deployment sets `MODE=se-mock`.
- Manifests in `k8s/`: `deployment.yaml`, `service.yaml` (ClusterIP), `ingress.yaml`, and `deploy.sh`. `scripts/k8s.test.mjs` pins their safety properties (text checks, no cluster, `kubectl` never run).
- Deployment: replicas 1 (state is in memory and per workspace, so more replicas would split a visitor across pods), non-root (uid 1000), read-only root filesystem with a 16 MiB `/tmp` emptyDir, `drop: ["ALL"]`, `allowPrivilegeEscalation: false` (no-new-privileges), `seccompProfile: RuntimeDefault`, no service account token, CPU and memory requests and limits, no volumes with data, no secrets, no host paths or host network.
- Probes: readiness and liveness both `GET /api/health` (`demo-health/1`). The app answers loopback `Host` headers and the configured public host only, and kubelet sends the pod IP, so the probes set `Host: 127.0.0.1:5310`.
- Ports: the app on 5310. The five demo stub MCP servers (5311-5315) listen on loopback inside the pod and the Service does not expose them.

## What is refused or compiled out

In `MODE=se-mock` the server is demo-only. There is no code path to the real host:

| Live feature | In se-mock |
| --- | --- |
| `MCP_DISCOVERY_LIVE` (reading `ps`, `lsof`, `docker ps`) | Refused. Set to any value, including `0`, it fails the doctor, `GET /api/health` (state `broken`), `createRuntime` and server startup. `live.js` is never imported by the se-mock runtime. |
| `MCP_DISCOVERY_CONFIG_PATHS` (client config files) | Refused the same way. |
| `MCP_DISCOVERY_REMOTE_URLS` | Refused the same way. |
| `MCP_DISCOVERY_STORE_PATH` (file store) | Refused. The store is memory only and nothing is written to disk. |
| Non-`local`, non-`se-mock` `MODE` values | Fail the doctor and startup. |

Everything else about safety is unchanged: loopback probes only to the stub ports, no credential accepted or sent, redaction and inert rendering of server text, same-origin writes. The health reply keeps `schema: demo-health/1`, stays `runtime: offline`, and adds `mode: "se-mock"` and `hosted: true`.

## Per-visitor isolation

The browser sends `X-Workspace-Id` (a random id kept in `sessionStorage`, so one per tab). The server keeps one runtime per id: its own inventory store, its own scan queue, and its own counters in each demo stub. The probe tells the stubs which workspace it is scanning for with an `X-Demo-Workspace` header, which only a hosted workspace sends. The id is a label, not a credential; everything in a workspace is synthetic.

- Charset and length: `^[a-z0-9][a-z0-9-]{0,31}$`. Anything else is refused with 400 and creates nothing. No header means the `default` workspace.
- Cap: 50 workspaces. A new id past the cap evicts the least recently used non-default workspace.
- TTL: a workspace idle for 30 minutes is dropped. The default workspace is never evicted.
- Eviction also drops that workspace's counters in the stubs.
- Availability trade-off: there is no per-IP limit, so a visitor who creates more than 50 ids evicts others' workspaces (they restart from an empty inventory). State is never readable across workspaces; this is only a loss of someone else's demo progress.
- `server/test/hosted.test.js` proves that two workspaces cannot see or change each other (scans, baselines, the rug-pull counter, Reset, record lookup), that hostile ids are refused, and that the cap and TTL hold.

### All state, and where it lives

Every mutable thing in the server, found by reading each module, and what the hosted build does with it:

| State | Where | Hosted build |
| --- | --- | --- |
| Inventory records, last scan, diff | `store.js` (`cache`) | Per workspace, memory only |
| Scan queue (`scanning`, `pending`, the 429 limit) | `runtime.js` | Per workspace |
| Stub counters: `toolsListCalls` (drives the rug-pull), `hits`, `credentialHeaderSeen` | `demo/stubs.js` | Per workspace, keyed by `X-Demo-Workspace` |
| Open stub sockets | `demo/stubs.js` | Shared infrastructure, holds no visitor data |
| Health state `last` | `health.js` | Shared; it is the process's doctor result, not visitor data |
| Fixtures, patterns, regex tables | module-level constants | Read-only |

In the browser: the theme in `localStorage` (cosmetic) and the workspace id in `sessionStorage`.

## How the owner deploys, after approving

1. Build and push the image to a registry the SE cluster can pull from, with an immutable tag (a commit SHA). This repo does not do that for you.
2. Choose the SE host name. The docs use placeholders like `discovery.se.example`; the real name is yours to fill in.
3. Check the rendered manifests without touching the cluster:
   ```bash
   OWNER_APPROVED=1 NAMESPACE=<ns> IMAGE=registry.example/team/mcp-discovery:<sha> SE_HOST=discovery.se.example k8s/deploy.sh --dry-run
   ```
4. Deploy (needs `kubectl` pointed at the SE cluster and `envsubst`): the same command without `--dry-run`.
5. Verify by content, not by a 200: `GET /api/health` must say `"mode":"se-mock"`, the page must show the HOSTED SIMULATION banner, a Scan must return the demo findings, and a second browser tab must start with an empty inventory. Check the registry manifest and the pod's `imageID` against `IMAGE`.

`deploy.sh` refuses unless `OWNER_APPROVED=1`, a `NAMESPACE` (every kubectl call is namespaced; set `CONTEXT` to pin the cluster context too), an explicit non-`latest`/`HEAD` tag or digest, and a plain lower-case host name. It never builds or pushes.

The Ingress does not rewrite `Host`. The Deployment sets `MCP_DISCOVERY_PUBLIC_HOST` to `SE_HOST`; the app accepts exactly that name (and loopback), and a browser write must carry `Origin` equal to `https://<SE_HOST>` with a matching `Host`. Any other host gets 421 and any other origin 403. Without the variable only loopback is accepted, which suits `kubectl port-forward`.

## Residual risks

- **The workspace id is a label.** Anyone who knows or guesses another visitor's id can read that workspace. Ids are random and the data is synthetic, but there is no authentication.
- **No rate limiting beyond the scan queue.** A visitor can create workspaces up to the cap and make the five stubs do small work. The cap bounds memory; the 256 MiB limit and the one-replica pod bound the rest. Put rate limiting at the ingress if the URL is shared widely.
- **The `timeout` stub holds a connection until the probe's 800 ms timeout.** Concurrent scans from many workspaces share one event loop.
- **A restart empties every workspace.** Expected for an in-memory demo.
- **Single replica.** No high availability by design.
- **Text served from the stubs is still untrusted data.** It is made inert at probe time, as in the local build.
- **Product claims are UNVERIFIED** unless a source is cited, as in the README. This build was exercised on OrbStack with `MODE=se-mock`; it has not run on a Kubernetes cluster.
