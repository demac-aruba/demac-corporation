#!/usr/bin/env bash
set -euo pipefail

FILE=/opt/demac-whatsapp-bridge/server-v2.mjs
SERVICE=demac-whatsapp-bridge-v8-test.service

echo '=== DEMAC DEPLOYED BRIDGE SOURCE INSPECTION ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo '=== SERVICE NON-SECRET CONFIGURATION ==='
systemctl show "$SERVICE" -p User -p Group -p WorkingDirectory -p ExecStart --no-pager
raw="$(systemctl show "$SERVICE" -p Environment --value 2>/dev/null || true)"
printf '%s\n' "$raw" | tr ' ' '\n' | grep -E '^(PORT|HOST|WACLI_BINARY|FFMPEG_BINARY|BRIDGE_STATE_DIR|ERP_WEBHOOK_URL|WACLI_SEND_TIMEOUT_MS|ERP_FORWARD_TIMEOUT_MS|WEBHOOK_RETRY_INTERVAL_MS)=' || true

echo
echo '=== SOURCE METADATA ==='
printf 'bytes='; wc -c < "$FILE"
printf 'lines='; wc -l < "$FILE"
printf 'sha256='; sha256sum "$FILE" | awk '{print $1}'

echo
echo '=== SOURCE BEGIN ==='
cat "$FILE"
echo '=== SOURCE END ==='

echo
echo '=== HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo 'DEPLOYED_BRIDGE_SOURCE_INSPECTION_COMPLETE'
