#!/usr/bin/env bash
# Deploy the MOCK-ONLY build to the SE cluster. The first deploy of each app is OWNER-APPROVED: this script refuses to
# run unless OWNER_APPROVED=1 is set by the owner. It never builds or pushes an image; it applies manifests for an image
# that already exists in the registry. Agents and CI never run it without --dry-run.
#
#   OWNER_APPROVED=1 NAMESPACE=<ns> [CONTEXT=<kubectl context>] IMAGE=<registry>/<repo>/mcp-discovery:<sha> SE_HOST=<host> k8s/deploy.sh [--dry-run]
#
# NAMESPACE is required and every kubectl call carries it (and --context when CONTEXT is set), so an apply can never land
# in whatever namespace or cluster happens to be current.
#
# After the deploy (not done by this script): verify by CONTENT, not 200 (GET /api/health must say mode:se-mock and the page
# must show the HOSTED SIMULATION banner), check the registry manifest and the pod's imageID match IMAGE, and hand over
# the full https:// URL after browser proof.
set -euo pipefail
cd "$(dirname "$0")"

[ "${OWNER_APPROVED:-}" = "1" ] || { echo "refusing: the first SE deploy of each app is owner-approved (set OWNER_APPROVED=1)" >&2; exit 2; }
[ -n "${NAMESPACE:-}" ] || { echo "refusing: set NAMESPACE explicitly (no default; the SE namespace is an owner decision)" >&2; exit 2; }
: "${IMAGE:?set IMAGE to the registry image with an explicit tag}" "${SE_HOST:?set SE_HOST to the SE cluster host}"
case "$IMAGE" in
  *:latest|*:HEAD|*:|*[!A-Za-z0-9._:/@-]*|"") echo "refusing: IMAGE must carry an explicit immutable tag or digest, not latest/HEAD" >&2; exit 2;;
  *:*) ;;
  *) echo "refusing: IMAGE has no tag" >&2; exit 2;;
esac
case "$SE_HOST" in *[!a-z0-9.-]*|""|.*|-*|*.|*-) echo "refusing: SE_HOST must be a plain lower-case host name" >&2; exit 2;; esac
[[ "$NAMESPACE" =~ ^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$ ]] || { echo "refusing: NAMESPACE must be a DNS label" >&2; exit 2; }
case "${CONTEXT:-x}" in *[!A-Za-z0-9._:/@-]*) echo "refusing: CONTEXT has unexpected characters" >&2; exit 2;; esac
KUBE=(kubectl --namespace "$NAMESPACE"); [ -z "${CONTEXT:-}" ] || KUBE+=(--context "$CONTEXT")
# The manifests carry only the literal tokens __IMAGE__ and __SE_HOST__ (no namespace field). Values are validated above,
# rendered with sed (the allowed sets contain no '|', '&', backslash or newline), and the render fails if any __TOKEN__ is left.
FILES="deployment.yaml service.yaml ingress.yaml"
render() { sed -e "s|__IMAGE__|$IMAGE|g" -e "s|__SE_HOST__|$SE_HOST|g" "$1"; echo '---'; }
rendered="$(for f in $FILES; do render "$f"; done)"
if left="$(printf '%s\n' "$rendered" | grep -nE '__[A-Z0-9_]+__')"; then
  echo "refusing: unreplaced placeholder token(s) in the rendered manifests:" >&2; printf '%s\n' "$left" >&2; exit 3
fi
if [ "${1:-}" = "--dry-run" ]; then printf '%s\n' "$rendered"; exit 0; fi
for f in $FILES; do render "$f" | "${KUBE[@]}" apply -f -; done
"${KUBE[@]}" rollout status deployment/mcp-discovery --timeout=120s
