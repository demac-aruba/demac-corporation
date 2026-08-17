#!/usr/bin/env bash
set -euo pipefail

FILE=/opt/demac-whatsapp-bridge/server-v2.mjs
SERVICE=demac-whatsapp-bridge-v8-test.service

echo '=== DEMAC BRIDGE FORWARD TARGET / SIGNATURE CHECK ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo '=== ERP WEBHOOK TARGET (URL ONLY) ==='
raw="$(systemctl show -p Environment --value "$SERVICE" 2>/dev/null || true)"
printf '%s\n' "$raw" | tr ' ' '\n' | sed -n 's/^ERP_WEBHOOK_URL=//p'

echo
echo '=== DEPLOYED SIGNATURE FUNCTIONS ==='
grep -n -E 'function (wacliSignatureFor|bridgeSignatureFor)|X-Wacli-Signature|forwardRecord|handleWacliEvent' "$FILE" | head -n 100

echo
echo '=== TEMP SECRET ROUTE MUST BE ABSENT ==='
if grep -q '/__internal/wacli-secret' "$FILE"; then
  echo 'temporary_secret_route=present_ERROR'
  exit 1
else
  echo 'temporary_secret_route=absent_OK'
fi

echo
echo '=== CURRENT HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo 'FORWARD_TARGET_SIGNATURE_CHECK_COMPLETE'
