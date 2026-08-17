#!/usr/bin/env bash
set -euo pipefail

echo '=== DEMAC POST-ED25519 QUEUE VERIFICATION ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

sleep 8

echo
echo '=== BRIDGE HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -c 'import json,sys; x=json.load(sys.stdin); print("ok=",x.get("ok")); print("pendingWebhookEvents=",x.get("pendingWebhookEvents")); print("lastForwardSuccessAt=",x.get("lastForwardSuccessAt")); print("lastForwardError=",x.get("lastForwardError")); print("identityCache=",x.get("identityCache")); print("avatarCache=",x.get("avatarCache"))'

echo
echo '=== RECENT WACLI MESSAGES ==='
sudo -n /usr/local/sbin/demac-wacli-ro messages list --limit 10

echo
echo '=== RECENT BRIDGE ERRORS ==='
journalctl -u demac-whatsapp-bridge-v8-test.service --since '15 minutes ago' --no-pager | grep -Ei 'error|fail|401|signature|media|avatar' | tail -n 120 || true

echo 'POST_ED25519_QUEUE_VERIFICATION_COMPLETE'
