#!/usr/bin/env bash
set -euo pipefail

STAGED=/home/demac-deploy/stage/server-v2.mjs
DEPLOYED=/opt/demac-whatsapp-bridge/server-v2.mjs
EXPECTED_TARGET='https://us-central1-demac-corporation.cloudfunctions.net/wacliWebhook'

echo '=== DEMAC STANDARD WACLI BRIDGE DEPLOY ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo '=== PRE-DEPLOY LIVE SNAPSHOT ==='
if pre_health="$(curl -fsS http://127.0.0.1:8787/health 2>/dev/null)"; then
  printf '%s' "$pre_health" | python3 -m json.tool
else
  echo 'bridge_health_unavailable'
fi
printf 'bridge_service=%s\n' "$(systemctl is-active demac-whatsapp-bridge-v8-test.service 2>/dev/null || true)"
printf 'sync_service=%s\n' "$(systemctl is-active demac-wacli-sync-v8-test.service 2>/dev/null || true)"

echo '=== SAFE TEST MESSAGE PROBE ==='
python3 - <<'PY' || true
import json
import subprocess
from datetime import datetime, timezone

cmd = [
    '/usr/local/bin/wacli', '--store', '/var/lib/demac-wacli-test', '--json',
    'messages', 'list', '--limit', '50'
]
try:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
except Exception as exc:
    print(f'wacli_probe_unavailable={type(exc).__name__}')
    raise SystemExit(0)
if proc.returncode != 0:
    print('wacli_probe_unavailable=permission_or_store_lock')
    raise SystemExit(0)
try:
    payload = json.loads(proc.stdout)
except Exception:
    print('wacli_probe_unavailable=non_json_output')
    raise SystemExit(0)
rows = payload if isinstance(payload, list) else payload.get('messages') or payload.get('data') or []
needle = 'PRUEBA FINAL DEMAC'
match = None
for row in rows:
    text = str(row.get('Text') or row.get('DisplayText') or row.get('text') or '')
    if needle in text:
        match = row
        break
if not match:
    print('test_text_found=false')
    raise SystemExit(0)
chat = str(match.get('ChatJID') or match.get('Chat') or match.get('chat') or '')
raw_ts = str(match.get('Timestamp') or match.get('timestamp') or '')
try:
    anchor = datetime.fromisoformat(raw_ts.replace('Z', '+00:00'))
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
except Exception:
    anchor = None
print('test_text_found=true')
print(f'test_chat_present={bool(chat)}')
print(f'test_timestamp={raw_ts or "unknown"}')
nearby = []
for row in rows:
    row_chat = str(row.get('ChatJID') or row.get('Chat') or row.get('chat') or '')
    if chat and row_chat != chat:
        continue
    ts = str(row.get('Timestamp') or row.get('timestamp') or '')
    if anchor:
        try:
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if abs((dt - anchor).total_seconds()) > 300:
                continue
        except Exception:
            continue
    media = str(row.get('MediaType') or row.get('mediaType') or '').lower()
    text = str(row.get('Text') or row.get('DisplayText') or row.get('text') or '')
    if needle in text:
        kind = 'text-test'
    elif media in {'image', 'audio', 'voice', 'video', 'document', 'sticker'}:
        kind = media
    else:
        continue
    nearby.append((ts, kind, bool(row.get('FromMe') or row.get('fromMe'))))
for index, (ts, kind, from_me) in enumerate(sorted(nearby), 1):
    print(f'test_event_{index}=timestamp:{ts},kind:{kind},from_me:{str(from_me).lower()}')
PY

test -s "$STAGED"
node --check "$STAGED"

if grep -q 'X-Demac-Bridge-Signature\|bridgeSignatureFor\|BRIDGE_SIGNING_KEY\|wacliMediaUploadTicketV2' "$STAGED"; then
  echo 'ERROR: staged bridge still contains retired custom authentication/upload-ticket code.' >&2
  exit 1
fi
if ! grep -Fq 'Authorization: `Bearer ${BRIDGE_TOKEN}`' "$STAGED"; then
  echo 'ERROR: staged bridge is missing standard Bearer forwarding.' >&2
  exit 1
fi
if ! grep -Fq "$EXPECTED_TARGET" "$STAGED"; then
  echo 'ERROR: staged bridge is missing the canonical Firebase target.' >&2
  exit 1
fi

echo 'staged_bridge_sha256='"$(sha256sum "$STAGED" | awk '{print $1}')"

sudo -n /usr/local/sbin/demac-deploy-bridge

node --check "$DEPLOYED"
echo 'deployed_bridge_sha256='"$(sha256sum "$DEPLOYED" | awk '{print $1}')"

echo '=== SERVICE HEALTH AFTER DEPLOY ==='
for attempt in $(seq 1 30); do
  if health="$(curl -fsS http://127.0.0.1:8787/health 2>/dev/null)"; then
    ok="$(printf '%s' "$health" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("ok",False)).lower())')"
    auth="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("bridgeAuth") or "")')"
    target="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("erpWebhookUrl") or "")')"
    if [ "$ok" = 'true' ] && [ "$auth" = 'bearer-v1' ] && [ "$target" = "$EXPECTED_TARGET" ]; then
      echo "bridge_health_ready attempt=$attempt auth=$auth target=canonical"
      break
    fi
  fi
  if [ "$attempt" = '30' ]; then
    echo 'ERROR: standard bridge did not become healthy on the canonical Firebase target.' >&2
    exit 1
  fi
  sleep 2
done

echo '=== WAIT FOR OUTBOX DRAIN ==='
for attempt in $(seq 1 60); do
  health="$(curl -fsS http://127.0.0.1:8787/health)"
  pending="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("pendingWebhookEvents",-1))')"
  error="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("lastForwardError") or "")')"
  success="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("lastForwardSuccessAt") or "")')"
  printf 'attempt=%s pending=%s success=%s error_present=%s\n' "$attempt" "$pending" "${success:-none}" "$([ -n "$error" ] && echo yes || echo no)"
  if [ "$pending" = '0' ] && [ -z "$error" ]; then
    echo 'STANDARD_BRIDGE_QUEUE_HEALTHY'
    exit 0
  fi
  sleep 5
done

echo 'ERROR: bridge is healthy but the webhook outbox did not drain.' >&2
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool
exit 1
