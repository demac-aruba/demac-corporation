#!/usr/bin/env bash
set -euo pipefail

BRIDGE=demac-whatsapp-bridge-v8-test.service
SYNC=demac-wacli-sync-v8-test.service

echo '=== DEMAC POST-MAINTENANCE VERIFICATION ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo '=== RESTRICTED MAINTENANCE STATUS ==='
sudo -n /usr/local/sbin/demac-maintenance status

echo
echo '=== SYSTEMD RESTART STATE ==='
for svc in "$BRIDGE" "$SYNC"; do
  echo "--- $svc ---"
  systemctl show "$svc" -p ActiveState -p SubState -p MainPID -p NRestarts -p Result -p ExecMainStartTimestamp --no-pager
 done

echo
echo '=== BRIDGE HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo
echo '=== RECENT SYNC EVENTS AFTER MAINTENANCE ==='
journalctl -u "$SYNC" --since '15 minutes ago' --no-pager \
  | grep -Ei 'started|connected|disconnected|reconnect|media download failed|permission denied|webhook|error|fail' \
  | tail -n 120 || true

echo
echo '=== RECENT LOCAL MESSAGES ==='
sudo -n /usr/local/sbin/demac-wacli-ro messages list --limit 12

echo
echo 'POST_MAINTENANCE_VERIFICATION_COMPLETE'
