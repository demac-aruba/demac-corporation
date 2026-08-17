#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=/etc/demac-whatsapp-bridge.env
SERVICE=demac-whatsapp-bridge-v8-test.service

echo '=== DEMAC BRIDGE STATE PATH RESOLUTION ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo '=== ENVIRONMENT FILE METADATA ==='
stat -c 'path=%n mode=%a owner=%U group=%G bytes=%s' "$ENV_FILE" 2>/dev/null || echo 'environment_file_metadata_unavailable'

if [ -r "$ENV_FILE" ]; then
  echo
echo '=== ENVIRONMENT VARIABLE NAMES ONLY ==='
  sed -E '/^[[:space:]]*(#|$)/d; s/^export[[:space:]]+//; s/=.*$//' "$ENV_FILE" | sort -u
  echo
echo '=== NON-SENSITIVE PATH / URL SETTINGS ==='
  sed -n -E 's/^export[[:space:]]+//; /^BRIDGE_STATE_DIR=|^ERP_WEBHOOK_URL=|^PORT=|^HOST=|^WACLI_BINARY=|^FFMPEG_BINARY=/p' "$ENV_FILE"
else
  echo 'environment_file_readable=no'
fi

echo
echo '=== PROCESS CWD / WRITABLE ROOTS ==='
systemctl show "$SERVICE" -p WorkingDirectory -p ReadWritePaths --no-pager

echo
echo '=== HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -c 'import json,sys; x=json.load(sys.stdin); print("pending=",x.get("pendingWebhookEvents")); print("lastForwardError=",x.get("lastForwardError")); print("bridgeSigningPublicKey=",x.get("bridgeSigningPublicKey"))'

echo 'BRIDGE_STATE_PATH_RESOLUTION_COMPLETE'
