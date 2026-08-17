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
printf 'wacli_version='; /usr/local/bin/wacli --version 2>/dev/null || true

echo '=== SAFE TEST MESSAGE PROBE ==='
python3 - <<'PY' || true
import json
import subprocess

base = ['sudo','-n','/usr/local/sbin/demac-wacli-ro']
cmd = base + ['messages','search','PRUEBA FINAL DEMAC','--limit','5','--json']
try:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
except Exception as exc:
    print(f'wacli_probe_unavailable={type(exc).__name__}')
    raise SystemExit(0)
print(f'search_rc={proc.returncode}')
if proc.returncode != 0:
    print('wacli_probe_unavailable=wrapper_error')
    raise SystemExit(0)
try:
    payload = json.loads(proc.stdout)
except Exception:
    print('wacli_probe_unavailable=non_json_output')
    raise SystemExit(0)
rows = payload.get('data') if isinstance(payload, dict) else payload
if isinstance(rows, dict):
    rows = rows.get('messages') or rows.get('items') or []
if not isinstance(rows, list):
    rows = []
needle = 'PRUEBA FINAL DEMAC'
match = next((r for r in rows if needle in str(r.get('Text') or r.get('DisplayText') or r.get('text') or r.get('display_text') or '')), None)
print(f'test_text_found={str(bool(match)).lower()}')
if not match:
    raise SystemExit(0)
chat = str(match.get('ChatJID') or match.get('Chat') or match.get('chat_jid') or match.get('chat') or '')
print(f'test_chat_present={str(bool(chat)).lower()}')
if not chat:
    raise SystemExit(0)
list_cmd = base + ['messages','list','--chat',chat,'--limit','12','--json']
listed = subprocess.run(list_cmd, capture_output=True, text=True, timeout=20)
print(f'list_rc={listed.returncode}')
if listed.returncode != 0:
    print('wacli_probe_unavailable=list_error')
    raise SystemExit(0)
try:
    lp = json.loads(listed.stdout)
except Exception:
    print('wacli_probe_unavailable=list_non_json')
    raise SystemExit(0)
items = lp.get('data') if isinstance(lp, dict) else lp
if isinstance(items, dict):
    items = items.get('messages') or items.get('items') or []
if not isinstance(items, list):
    items = []
for index, row in enumerate(items, 1):
    media = str(row.get('MediaType') or row.get('mediaType') or row.get('media_type') or '').lower()
    text = str(row.get('Text') or row.get('DisplayText') or row.get('text') or row.get('display_text') or '')
    if needle in text:
        kind = 'text-test'
    elif media in {'image','audio','voice','video','document','sticker'}:
        kind = media
    else:
        continue
    mid = str(row.get('ID') or row.get('MessageID') or row.get('msg_id') or row.get('id') or '')
    ts = str(row.get('Timestamp') or row.get('timestamp') or row.get('ts') or '')
    local_path = row.get('LocalPath') or row.get('localPath') or row.get('local_path')
    downloaded = row.get('DownloadedAt') or row.get('downloadedAt') or row.get('downloaded_at')
    print(f'test_event_{index}=kind:{kind},id_present:{str(bool(mid)).lower()},ts:{ts or "unknown"},local_path_present:{str(bool(local_path)).lower()},downloaded_present:{str(bool(downloaded)).lower()}')
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
