#!/usr/bin/env bash
set -euo pipefail

STAGED=/home/demac-deploy/stage/server-v2.mjs
DEPLOYED=/opt/demac-whatsapp-bridge/server-v2.mjs
EXPECTED_PUBLIC_KEY='MCowBQYDK2VwAyEAe01shOc9JLdWeX8OwYyzA3Mw9ckn5fg1llLtu4QtJX0='

echo '=== DEMAC CANONICAL WACLI BRIDGE DEPLOY ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

test -s "$STAGED"
node --check "$STAGED"

if grep -q 'wacliMediaUploadTicketV2\|bridgeHmacSignatureFor\|X-Wacli-Signature.*bridge' "$STAGED"; then
  echo 'ERROR: staged bridge still contains legacy bridge-to-Firebase authentication or upload-ticket code.' >&2
  exit 1
fi
if ! grep -q "'X-Demac-Bridge-Signature': bridgeSignatureFor(rawBody)" "$STAGED"; then
  echo 'ERROR: staged bridge is missing canonical Ed25519 forwarding.' >&2
  exit 1
fi

echo 'staged_bridge_sha256='"$(sha256sum "$STAGED" | awk '{print $1}')"

sudo -n /usr/local/sbin/demac-deploy-bridge

node --check "$DEPLOYED"
echo 'deployed_bridge_sha256='"$(sha256sum "$DEPLOYED" | awk '{print $1}')"

echo '=== SERVICE HEALTH AFTER DEPLOY ==='
for attempt in $(seq 1 30); do
  if health="$(curl -fsS http://127.0.0.1:8787/health 2>/dev/null)"; then
    ok="$(printf '%s' "$health" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("ok",False)).lower())')"
    auth="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("bridgeAuth") or "")')"
    pub="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("bridgeSigningPublicKey") or "")')"
    if [ "$ok" = 'true' ] && [ "$auth" = 'ed25519-v1' ] && [ "$pub" = "$EXPECTED_PUBLIC_KEY" ]; then
      echo "bridge_health_ready attempt=$attempt auth=$auth"
      break
    fi
  fi
  if [ "$attempt" = '30' ]; then
    echo 'ERROR: canonical bridge did not become healthy with the expected signing identity.' >&2
    exit 1
  fi
  sleep 2
done

echo '=== WAIT FOR FIREBASE CUTOVER / OUTBOX DRAIN ==='
for attempt in $(seq 1 60); do
  health="$(curl -fsS http://127.0.0.1:8787/health)"
  pending="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("pendingWebhookEvents",-1))')"
  error="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("lastForwardError") or "")')"
  success="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("lastForwardSuccessAt") or "")')"
  printf 'attempt=%s pending=%s success=%s error_present=%s\n' "$attempt" "$pending" "${success:-none}" "$([ -n "$error" ] && echo yes || echo no)"
  if [ "$pending" = '0' ] && [ -z "$error" ] && [ -n "$success" ]; then
    echo 'CANONICAL_BRIDGE_QUEUE_RECOVERED'
    exit 0
  fi
  sleep 5
done

echo 'ERROR: bridge is healthy but the webhook outbox did not drain during the coordinated cutover.' >&2
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool
exit 1
