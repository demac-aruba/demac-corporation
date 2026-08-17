#!/usr/bin/env bash
set -euo pipefail

BRIDGE=demac-whatsapp-bridge-v8-test.service
SYNC=demac-wacli-sync-v8-test.service
STORE=/var/lib/demac-wacli-test

echo '=== DEMAC WACLI MEDIA PERMISSION DIAGNOSTIC ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo '=== SERVICE STATE ==='
for svc in "$BRIDGE" "$SYNC"; do
  printf '%s: ' "$svc"
  systemctl is-active "$svc" || true
 done

echo
echo '=== STORE OWNERSHIP ==='
namei -l "$STORE/media" || true
printf '\nTop-level store entries:\n'
ls -ldn "$STORE" "$STORE/media" 2>/dev/null || true
find "$STORE" -maxdepth 2 -type d -printf '%M %u:%g %p\n' 2>/dev/null | sort | head -n 120 || true

echo
echo '=== RECENT MEDIA DOWNLOAD FAILURES ==='
journalctl -u "$SYNC" --since '24 hours ago' --no-pager \
  | grep -Ei 'media download failed|permission denied|download-media|connected|disconnected|reconnect|stale' \
  | tail -n 120 || true

echo
echo '=== BRIDGE HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo
echo '=== RECENT LOCAL MESSAGES ==='
sudo -n /usr/local/sbin/demac-wacli-ro messages list --limit 12

echo
echo 'MEDIA_PERMISSION_DIAGNOSTIC_COMPLETE'
