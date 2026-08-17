#!/usr/bin/env bash
set -euo pipefail

OUTBOX=/var/lib/demac-whatsapp-bridge/webhook-outbox

echo '=== DEMAC QUEUED EVENT SHAPE SUMMARY ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - <<'PY'
import base64, glob, json, os
files=sorted(glob.glob('/var/lib/demac-whatsapp-bridge/webhook-outbox/*.json'))
print('pending_files=', len(files))
for i,p in enumerate(files,1):
    try:
        rec=json.load(open(p))
        body=json.loads(base64.b64decode(rec['bodyBase64']))
    except Exception as e:
        print(i, 'decode_error=', type(e).__name__)
        continue
    event=str(body.get('EventType') or 'message')
    keys=sorted(body.keys())
    media=body.get('Media')
    media_keys=sorted(media.keys()) if isinstance(media,dict) else []
    media_type=None
    if isinstance(media,dict): media_type=media.get('Type') or media.get('type') or media.get('kind')
    top_media=body.get('MediaType') or body.get('MimeType') or None
    has_profile=bool(body.get('ProfilePicture'))
    print(f'{i:02d} event={event} keys={keys} media_keys={media_keys} media_type={media_type!r} top_media={top_media!r} profile={has_profile}')
PY

echo
echo '=== RECENT WACLI MESSAGE MEDIA SUMMARY ==='
sudo -n /usr/local/sbin/demac-wacli-ro messages export --limit 10 | python3 - <<'PY'
import json,sys
obj=json.load(sys.stdin)
data=obj.get('data', obj)
msgs=data.get('messages',[]) if isinstance(data,dict) else []
for m in msgs:
    print('ts=',m.get('Timestamp'),'id=',m.get('MsgID'),'fromMe=',m.get('FromMe'),
          'media=',repr(m.get('MediaType')),'mime=',repr(m.get('MimeType')),
          'local=',bool(m.get('LocalPath')),'downloaded=',m.get('DownloadedAt'))
PY

echo
echo '=== HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo 'QUEUED_EVENT_SHAPE_SUMMARY_COMPLETE'
