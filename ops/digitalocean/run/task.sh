#!/usr/bin/env bash
set -euo pipefail

echo '=== DEMAC REMOTE OPS CONNECTION TEST ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'user=%s\n' "$(id -un)"
printf 'host=%s\n' "$(hostname)"

echo
echo '=== ACTIVE V8 SERVICES ==='
systemctl is-active demac-whatsapp-bridge-v8-test.service || true
systemctl is-active demac-wacli-sync-v8-test.service || true

echo
echo '=== BRIDGE HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo
echo '=== RECENT WACLI MESSAGES ==='
sudo -n /usr/local/sbin/demac-wacli-ro messages list --limit 12

echo
echo '=== RECENT SYNC LOGS ==='
journalctl -u demac-wacli-sync-v8-test.service --since '30 minutes ago' --no-pager | tail -n 80 || true

echo
echo '=== RECENT BRIDGE LOGS ==='
journalctl -u demac-whatsapp-bridge-v8-test.service --since '30 minutes ago' --no-pager | tail -n 80 || true

echo
echo 'REMOTE_OPS_TEST_COMPLETE'
