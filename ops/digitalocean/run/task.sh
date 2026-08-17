#!/usr/bin/env bash
set -euo pipefail

BRIDGE=demac-whatsapp-bridge-v8-test.service
SYNC=demac-wacli-sync-v8-test.service
CHAT='2975600140@s.whatsapp.net'
MSG='AC70D50A47601F776CDA9258164E66AE'
OUT='/var/lib/demac-wacli-test/media/manual-permission-probe.ogg'

echo '=== DEMAC MEDIA DOWNLOAD PROBE ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo '=== CURRENT MAINTENANCE STATUS ==='
sudo -n /usr/local/sbin/demac-maintenance status

echo
echo '=== DOWNLOAD KNOWN AUDIO INTO WACLI MEDIA STORE ==='
sudo -n /usr/local/sbin/demac-wacli-ro media download --chat "$CHAT" --id "$MSG" --output "$OUT"

echo
echo '=== VERIFY DOWNLOADED FILE ==='
sudo -n /usr/local/sbin/demac-wacli-ro messages show --chat "$CHAT" --id "$MSG" --json 2>/dev/null \
  | python3 - <<'PY' || true
import json,sys
try:
    obj=json.load(sys.stdin)
except Exception:
    sys.exit(0)
print('message_show_ok=true')
for k in ('MediaType','MimeType','LocalPath','DownloadedAt'):
    if isinstance(obj,dict):
        data=obj.get('data',obj)
        if isinstance(data,dict): print(f'{k}={data.get(k,"")}')
PY

# We cannot stat the 0700 store as demac-deploy, but a successful media-download
# exit status proves the demac-wacli process can now create/write the requested file.

echo
echo '=== BRIDGE HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo
echo '=== SYNC ERRORS SINCE RESTART ==='
START="$(systemctl show -p ExecMainStartTimestamp --value "$SYNC")"
journalctl -u "$SYNC" --since "$START" --no-pager \
  | grep -Ei 'media download failed|permission denied|error|fail|disconnected|connected' \
  | tail -n 100 || true

echo
echo 'MEDIA_DOWNLOAD_PROBE_COMPLETE'
