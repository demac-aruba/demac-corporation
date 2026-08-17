#!/usr/bin/env bash
set -euo pipefail

SOURCE=/opt/demac-whatsapp-bridge/server-v2.mjs
STAGED=/home/demac-deploy/stage/server-v2.mjs
MARKER='DEMAC_TEMP_SECRET_HANDOFF_V1'

echo '=== INSTALL TEMPORARY LOOPBACK SECRET HANDOFF ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - <<'PY'
from pathlib import Path
source = Path('/opt/demac-whatsapp-bridge/server-v2.mjs').read_text()
marker = 'DEMAC_TEMP_SECRET_HANDOFF_V1'
if marker in source:
    patched = source
else:
    needle = "if (request.method === 'GET' && url.pathname === '/health') return await handleHealth(response);"
    if needle not in source:
        raise SystemExit('ERROR: expected /health route anchor not found')
    block = """/* DEMAC_TEMP_SECRET_HANDOFF_V1 */
    if (request.method === 'GET' && url.pathname === '/__internal/wacli-secret') {
      const peer = String(request.socket?.remoteAddress || '');
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) {
        return json(response, 403, { error: 'Forbidden' });
      }
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(String(WACLI_WEBHOOK_SECRET || ''));
      return;
    }
    /* DEMAC_TEMP_SECRET_HANDOFF_V1_END */
    """
    patched = source.replace(needle, block + needle, 1)
Path('/home/demac-deploy/stage/server-v2.mjs').write_text(patched)
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
