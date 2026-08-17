#!/usr/bin/env bash
set -euo pipefail

SOURCE=/opt/demac-whatsapp-bridge/server-v2.mjs
STAGED=/home/demac-deploy/stage/server-v2.mjs

echo '=== REPAIR TEMPORARY LOOPBACK SECRET HANDOFF ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - <<'PY'
from pathlib import Path
source = Path('/opt/demac-whatsapp-bridge/server-v2.mjs').read_text()
old = "response.end(String(WACLI_WEBHOOK_SECRET || ''));"
new = "response.end(String(WEBHOOK_SECRET || ''));"
if old in source:
    source = source.replace(old, new, 1)
elif new not in source:
    raise SystemExit('ERROR: temporary handoff response line not found')
Path('/home/demac-deploy/stage/server-v2.mjs').write_text(source)
PY

node --check "$STAGED"
sudo -n /usr/local/sbin/demac-deploy-bridge >/tmp/demac-temp-secret-deploy.log

echo '=== VERIFY LOOPBACK-ONLY ENDPOINT WITHOUT PRINTING SECRET ==='
code="$(curl -sS -o /tmp/demac-secret-probe -w '%{http_code}' http://127.0.0.1:8787/__internal/wacli-secret)"
bytes="$(wc -c </tmp/demac-secret-probe | tr -d ' ')"
rm -f /tmp/demac-secret-probe
printf 'http_status=%s secret_bytes=%s\n' "$code" "$bytes"
if [ "$code" != '200' ] || [ "$bytes" -lt 32 ]; then
  echo 'ERROR: temporary loopback secret handoff verification failed' >&2
  exit 1
fi

curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo 'TEMP_SECRET_HANDOFF_READY'
