#!/usr/bin/env bash
set -euo pipefail

STAGED=/home/demac-deploy/stage/server-v2.mjs
DEPLOYED=/opt/demac-whatsapp-bridge/server-v2.mjs
EXPECTED_TARGET='https://us-central1-demac-corporation.cloudfunctions.net/wacliWebhook'

echo '=== DEMAC STANDARD WACLI BRIDGE DEPLOY ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

test -s "$STAGED"
node --check "$STAGED"

if grep -q 'X-Demac-Bridge-Signature\|bridgeSignatureFor\|BRIDGE_SIGNING_KEY\|wacliMediaUploadTicketV2' "$STAGED"; then
  echo 'ERROR: staged bridge still contains retired custom authentication/upload-ticket code.' >&2
  exit 1
fi
if ! grep -q "Authorization: `Bearer \${BRIDGE_TOKEN}`" "$STAGED"; then
  echo 'ERROR: staged bridge is missing standard Bearer forwarding.' >&2
  exit 1
fi
if ! grep -Fq "$EXPECTED_TARGET" "$STAGED"; then
  echo 'ERROR: staged bridge is missing the canonical Firebase target.' >&2
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
    target="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("erpWebhookUrl") or "")')"
    if [ "$ok" = 'true' ] && [ "$auth" = 'bearer-v1' ] && [ "$target" = "$EXPECTED_TARGET" ]; then
      echo "bridge_health_ready attempt=$attempt auth=$auth target=canonical"
      break
    fi
  fi
  if [ "$attempt" = '30' ]; then
    echo 'ERROR: standard bridge did not become healthy on the canonical Firebase target.' >&2
    exit 1
  fi
  sleep 2
done

echo '=== WAIT FOR OUTBOX DRAIN ==='
for attempt in $(seq 1 60); do
  health="$(curl -fsS http://127.0.0.1:8787/health)"
  pending="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("pendingWebhookEvents",-1))')"
  error="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("lastForwardError") or "")')"
  success="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("lastForwardSuccessAt") or "")')"
  printf 'attempt=%s pending=%s success=%s error_present=%s\n' "$attempt" "$pending" "${success:-none}" "$([ -n "$error" ] && echo yes || echo no)"
  if [ "$pending" = '0' ] && [ -z "$error" ] && [ -n "$success" ]; then
    echo 'STANDARD_BRIDGE_QUEUE_RECOVERED'
    exit 0
  fi
  sleep 5
done

echo 'ERROR: bridge is healthy but the webhook outbox did not drain.' >&2
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool
exit 1
