#!/usr/bin/env bash
set -euo pipefail

FILE=/opt/demac-whatsapp-bridge/server-v2.mjs

echo '=== DEMAC BRIDGE SIGNATURE DIAGNOSTIC ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo '=== CONFIG VARIABLE NAMES USED BY BRIDGE (VALUES REDACTED) ==='
grep -nE 'process\.env\.|WEBHOOK|SIGNATURE|SECRET|ERP_' "$FILE" \
  | sed -E 's/(process\.env\.[A-Za-z0-9_]+).*/\1 [value-redacted]/' \
  | head -n 120 || true

echo
echo '=== SIGNATURE / FORWARDING CODE ==='
grep -n -B 8 -A 16 -E 'function signatureFor|const signatureFor|ERP_WEBHOOK_URL|forwardRecord|persistWebhookEvent|X-Wacli-Signature|x-wacli-signature' "$FILE" \
  | head -n 240 || true

echo
echo '=== ENV KEY NAMES ONLY ==='
sudo -n /usr/local/sbin/demac-maintenance status >/dev/null
if [ -r /etc/demac-whatsapp-bridge.env ]; then
  sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1=[redacted]/p' /etc/demac-whatsapp-bridge.env | sort
else
  echo 'env-file-not-readable-as-deploy-user'
fi

echo
echo '=== HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo
echo 'BRIDGE_SIGNATURE_DIAGNOSTIC_COMPLETE'
