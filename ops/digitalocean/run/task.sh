#!/usr/bin/env bash
set -euo pipefail

echo '=== DEMAC LIVE TEST MEDIA MATERIALIZATION ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
sudo -n /usr/local/sbin/demac-wacli-ro messages export --limit 12 >"$tmp"
python3 - "$tmp" <<'PY'
import json,sys
obj=json.load(open(sys.argv[1]))
data=obj.get('data',obj)
msgs=data.get('messages',[]) if isinstance(data,dict) else []
for m in msgs:
    print('ts=',m.get('Timestamp'),'id=',m.get('MsgID'),'fromMe=',m.get('FromMe'),
          'text=',repr((m.get('Text') or m.get('DisplayText') or '')[:40]),
          'media=',repr(m.get('MediaType')),'mime=',repr(m.get('MimeType')),
          'local=',bool(m.get('LocalPath')),'downloaded=',m.get('DownloadedAt'))
PY

echo
echo '=== SYNC MEDIA ERRORS SINCE PERMISSION REPAIR ==='
journalctl -u demac-wacli-sync-v8-test.service --since '2026-08-16 20:46:25' --no-pager \
 | grep -Ei 'media download failed|permission denied|downloaded|error|fail' | tail -n 100 || true

echo
echo '=== BRIDGE HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo 'LIVE_TEST_MEDIA_MATERIALIZATION_COMPLETE'
