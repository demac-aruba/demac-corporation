#!/usr/bin/env bash
set -euo pipefail

echo '=== WACLI MEDIA PROBE ==='
printf 'version='; /usr/local/bin/wacli --version || true

python3 - <<'PY'
import json
import subprocess

base = ['sudo','-n','/usr/local/sbin/demac-wacli-ro']
cmd = base + ['messages','search','PRUEBA FINAL DEMAC','--limit','5','--json']
proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
print(f'search_rc={proc.returncode}')
if proc.returncode != 0:
    print('search_error_present=true')
    raise SystemExit(0)
try:
    payload = json.loads(proc.stdout)
except Exception:
    print('search_json=false')
    raise SystemExit(0)
rows = payload.get('data') if isinstance(payload, dict) else payload
if isinstance(rows, dict):
    rows = rows.get('messages') or rows.get('items') or []
if not isinstance(rows, list):
    rows=[]
match = next((r for r in rows if 'PRUEBA FINAL DEMAC' in str(r.get('Text') or r.get('DisplayText') or r.get('text') or r.get('display_text') or '')), None)
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
    print('list_error_present=true')
    raise SystemExit(0)
try:
    lp = json.loads(listed.stdout)
except Exception:
    print('list_json=false')
    raise SystemExit(0)
items = lp.get('data') if isinstance(lp, dict) else lp
if isinstance(items, dict):
    items = items.get('messages') or items.get('items') or []
if not isinstance(items, list):
    items=[]
for i,row in enumerate(items,1):
    media = str(row.get('MediaType') or row.get('mediaType') or row.get('media_type') or '').lower()
    text = str(row.get('Text') or row.get('DisplayText') or row.get('text') or row.get('display_text') or '')
    if 'PRUEBA FINAL DEMAC' in text:
        kind='text-test'
    elif media in {'image','audio','voice','video','document','sticker'}:
        kind=media
    else:
        continue
    mid = str(row.get('ID') or row.get('MessageID') or row.get('msg_id') or row.get('id') or '')
    ts = str(row.get('Timestamp') or row.get('timestamp') or row.get('ts') or '')
    local_path = row.get('LocalPath') or row.get('localPath') or row.get('local_path')
    downloaded = row.get('DownloadedAt') or row.get('downloadedAt') or row.get('downloaded_at')
    print(f'event_{i}=kind:{kind},id_present:{str(bool(mid)).lower()},ts:{ts or "unknown"},local_path_present:{str(bool(local_path)).lower()},downloaded_present:{str(bool(downloaded)).lower()}')
PY
