#!/usr/bin/env bash
set -euo pipefail

SYNC=demac-wacli-sync-v8-test.service

echo '=== DEMAC LIVE MEDIA FLOW VERIFICATION ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo '=== SERVICES / MEDIA PERMISSIONS ==='
sudo -n /usr/local/sbin/demac-maintenance status

echo
echo '=== RECENT LOCAL MESSAGES ==='
sudo -n /usr/local/sbin/demac-wacli-ro messages list --limit 15

echo
echo '=== RECENT MESSAGE JSON SUMMARY ==='
sudo -n /usr/local/sbin/demac-wacli-ro messages export --limit 15 2>/dev/null | python3 -c '
import json,sys
obj=json.load(sys.stdin)
data=obj.get("data",obj)
msgs=data.get("messages",[]) if isinstance(data,dict) else []
for m in msgs:
    ts=m.get("Timestamp","")
    chat=m.get("ChatJID","")
    mid=m.get("MsgID","")
    text=m.get("Text","") or m.get("DisplayText","")
    media=m.get("MediaType","")
    mime=m.get("MimeType","")
    local=m.get("LocalPath","")
    downloaded=m.get("DownloadedAt","")
    print(f"TS={ts} CHAT={chat} ID={mid} TEXT={text!r} MEDIA={media!r} MIME={mime!r} LOCAL={local!r} DOWNLOADED={downloaded!r}")
'

echo
echo '=== SYNC EVENTS LAST 15 MINUTES ==='
journalctl -u "$SYNC" --since '15 minutes ago' --no-pager \
 | grep -Ei 'media download|permission denied|webhook|error|fail|connected|disconnected|reconnect' \
 | tail -n 160 || true

echo
echo '=== BRIDGE HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo
echo '=== BRIDGE JOURNAL LAST 15 MINUTES ==='
journalctl -u demac-whatsapp-bridge-v8-test.service --since '15 minutes ago' --no-pager \
 | grep -Ei 'error|fail|storage|upload|media|webhook|avatar|firebase' \
 | tail -n 160 || true

echo
echo 'LIVE_MEDIA_FLOW_VERIFICATION_COMPLETE'
