#!/usr/bin/env bash
set -euo pipefail

echo '=== READ DEMAC ED25519 PUBLIC IDENTITY ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

health="$(curl -fsS http://127.0.0.1:8787/health)"
printf '%s' "$health" | python3 -c 'import json,sys; x=json.load(sys.stdin); pub=x.get("bridgeSigningPublicKey",""); print("ok=",x.get("ok")); print("pending=",x.get("pendingWebhookEvents")); print("lastForwardError=",x.get("lastForwardError")); print("bridgeSigningPublicKey=",pub); assert pub'

echo
echo '=== DEPLOYED PRIVATE KEY FILE CHECK (METADATA ONLY) ==='
python3 -c 'import os; p="/var/lib/demac-whatsapp-bridge/bridge-signing-ed25519-private.pem"; print("private_key_path_exists=",os.path.exists(p))' || true

echo 'ED25519_PUBLIC_IDENTITY_READ_COMPLETE'
