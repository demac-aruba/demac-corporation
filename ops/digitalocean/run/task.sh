#!/usr/bin/env bash
set -euo pipefail

SERVICE=demac-whatsapp-bridge-v8-test.service

echo '=== DEMAC BRIDGE STATE / SERVICE BOUNDARY INSPECTION ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo '=== SYSTEMD PROPERTIES (NO SECRET VALUES) ==='
systemctl show "$SERVICE" \
  -p User -p Group -p WorkingDirectory -p ExecStart \
  -p EnvironmentFiles -p StateDirectory -p StateDirectoryMode \
  -p ReadWritePaths -p ReadOnlyPaths -p ProtectSystem -p ProtectHome --no-pager

echo
echo '=== ENVIRONMENT VARIABLE NAMES ONLY ==='
systemctl show "$SERVICE" -p Environment --value 2>/dev/null \
  | tr ' ' '\n' | sed -n 's/=.*$//p' | sort -u

echo
echo '=== EXPECTED STATE METADATA ==='
for dir in /var/lib/demac-whatsapp-bridge /var/lib/demac-wacli-test; do
  if [ -e "$dir" ]; then
    stat -c 'path=%n type=%F mode=%a owner=%U group=%G' "$dir"
  else
    echo "path=$dir absent"
  fi
done
for file in /var/lib/demac-whatsapp-bridge/bridge-signing-ed25519-private.pem /var/lib/demac-wacli-test/bridge-signing-ed25519-private.pem; do
  if [ -e "$file" ]; then
    stat -c 'private_key_path=%n mode=%a owner=%U group=%G bytes=%s' "$file"
  else
    echo "private_key_path=$file absent"
  fi
done

echo
echo '=== HEALTH IDENTITY ==='
curl -fsS http://127.0.0.1:8787/health | python3 -c 'import json,sys,hashlib,base64; x=json.load(sys.stdin); pub=x.get("bridgeSigningPublicKey",""); print("pending=",x.get("pendingWebhookEvents")); print("lastForwardError=",x.get("lastForwardError")); print("public_key_present=",bool(pub)); print("public_key_sha256=",hashlib.sha256(base64.b64decode(pub)).hexdigest() if pub else "")'

echo 'BRIDGE_STATE_BOUNDARY_INSPECTION_COMPLETE'
