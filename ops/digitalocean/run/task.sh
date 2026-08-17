#!/usr/bin/env bash
set -euo pipefail

FILE=/opt/demac-whatsapp-bridge/server-v2.mjs
OUTBOX=/var/lib/demac-whatsapp-bridge/webhook-outbox

echo '=== DEMAC MEDIA PAYLOAD SHAPE DIAGNOSTIC ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo '=== BRIDGE MEDIA EXTRACTION / UPLOAD CODE ==='
nl -ba "$FILE" | sed -n '100,146p'

echo
echo '=== ROUTES ==='
nl -ba "$FILE" | sed -n '250,285p'

echo
echo '=== ONE PENDING MEDIA EVENT SHAPE (CONTENT REDACTED) ==='
python3 - <<'PY'
import base64, json, os, glob
files=sorted(glob.glob('/var/lib/demac-whatsapp-bridge/webhook-outbox/*.json'))
found=False
for p in files:
    try:
        rec=json.load(open(p))
        body=json.loads(base64.b64decode(rec['bodyBase64']))
    except Exception:
        continue
    media=body.get('Media')
    if isinstance(media,dict):
        safe={}
        for k,v in media.items():
            kl=str(k).lower()
            if 'url' in kl or 'path' in kl:
                safe[k]='[present]' if v else None
            elif 'error' in kl:
                safe[k]=str(v)[:180]
            elif k in {'Type','type','kind','MimeType','mimeType','Filename','fileName','size','FileLength'}:
                safe[k]=v
            else:
                safe[k]=f'[{type(v).__name__}]'
        print('payload_keys=', sorted(body.keys()))
        print('media_keys=', sorted(media.keys()))
        print('media_safe=', json.dumps(safe, ensure_ascii=False))
        found=True
        break
print('media_event_found=', found)
PY

echo
echo '=== HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo 'MEDIA_PAYLOAD_SHAPE_DIAGNOSTIC_COMPLETE'
