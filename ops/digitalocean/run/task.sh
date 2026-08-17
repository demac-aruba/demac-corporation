#!/usr/bin/env bash
set -euo pipefail

SOURCE=/opt/demac-whatsapp-bridge/server-v2.mjs
STAGED=/home/demac-deploy/stage/server-v2.mjs

echo '=== DEMAC BRIDGE AUTH + MEDIA PATCH ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - <<'PY'
from pathlib import Path
p=Path('/opt/demac-whatsapp-bridge/server-v2.mjs')
s=p.read_text()

# 1) Split the two trust directions. Existing queued records will be re-signed
# at delivery time with BRIDGE_TOKEN, so no persisted event is lost.
old="function signatureFor(rawBody) { return `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`; }"
new="""function wacliSignatureFor(rawBody) { return `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`; }
function bridgeSignatureFor(rawBody) { return `sha256=${crypto.createHmac('sha256', BRIDGE_TOKEN).update(rawBody).digest('hex')}`; }"""
if old in s:
    s=s.replace(old,new,1)
elif 'function wacliSignatureFor' not in s or 'function bridgeSignatureFor' not in s:
    raise SystemExit('ERROR: signatureFor anchor not found')

# 2) Re-sign every forward attempt with the bridge token rather than trusting
# the signature stored with an older queued record.
s=s.replace("'X-Wacli-Signature': record.signature", "'X-Wacli-Signature': bridgeSignatureFor(rawBody)")

# 3) Keep local wacli validation on the rotated webhook secret.
s=s.replace("safeEqual(provided, signatureFor(rawBody))", "safeEqual(provided, wacliSignatureFor(rawBody))")
s=s.replace("const signature = signatureFor(enrichedRaw);", "const signature = bridgeSignatureFor(enrichedRaw);")

# 4) Any legacy ticket request is bridge-originated, so use bridge auth too.
s=s.replace("'X-Wacli-Signature': signatureFor(raw)", "'X-Wacli-Signature': bridgeSignatureFor(raw)")

# 5) Add an authenticated binary media endpoint matching Firebase's existing
# fetchAndStoreWacliMedia client. It downloads by chat/message id via wacli.
if 'async function handleMedia(request, response)' not in s:
    anchor='async function handleSend(request, response) {'
    if anchor not in s:
        raise SystemExit('ERROR: handleSend anchor not found')
    handler=r'''async function handleMedia(request, response) {
  if (!authorized(request)) { json(response, 401, { error: 'Unauthorized' }); return; }
  let output = '';
  try {
    const input = JSON.parse((await readBody(request)).toString('utf8'));
    const chat = String(input.chat || '').trim();
    const messageId = String(input.messageId || input.id || '').trim();
    if (!chat || chat.length > 200 || !messageId || messageId.length > 220) throw new Error('chat and messageId are required.');
    if (!/^[A-Za-z0-9_@.:-]+$/.test(chat) || !/^[A-Za-z0-9_.:-]+$/.test(messageId)) throw new Error('Invalid media identifier.');
    await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });
    output = path.join(TEMP_DIR, `pull-${safeName(messageId, crypto.randomUUID())}`);
    await execFileAsync(WACLI_BINARY, ['--read-only', 'media', 'download', '--chat', chat, '--id', messageId, '--output', output], { timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: process.env, windowsHide: true });
    const buffer = await fs.readFile(output);
    if (!buffer.length) throw new Error('Downloaded media is empty.');
    if (buffer.length > MAX_MEDIA_BYTES) throw new Error('WhatsApp media exceeds bridge download limit.');
    const contentType = String(input.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': String(buffer.length), 'Cache-Control': 'no-store' });
    response.end(buffer);
  } catch (error) {
    if (!response.headersSent) json(response, error?.statusCode || 502, { error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (output) await fs.unlink(output).catch(() => undefined);
  }
}

'''
    s=s.replace(anchor,handler+anchor,1)

# 6) Route /v1/media and remove the temporary loopback secret handoff.
start='/* DEMAC_TEMP_SECRET_HANDOFF_V1 */'
end='/* DEMAC_TEMP_SECRET_HANDOFF_V1_END */'
if start in s and end in s:
    a=s.index(start); b=s.index(end,a)+len(end)
    s=s[:a]+s[b:]

route_old="if (request.method === 'GET' && url.pathname === '/health') return await handleHealth(response); if (request.method === 'POST' && url.pathname === '/v1/send') return await handleSend(request, response); if (request.method === 'POST' && url.pathname === '/v1/events') return await handleWacliEvent(request, response);"
route_new="if (request.method === 'GET' && url.pathname === '/health') return await handleHealth(response); if (request.method === 'POST' && url.pathname === '/v1/send') return await handleSend(request, response); if (request.method === 'POST' && url.pathname === '/v1/media') return await handleMedia(request, response); if (request.method === 'POST' && url.pathname === '/v1/events') return await handleWacliEvent(request, response);"
if route_old in s:
    s=s.replace(route_old,route_new,1)
elif "url.pathname === '/v1/media'" not in s:
    raise SystemExit('ERROR: route anchor not found')

# No generic signatureFor or temporary secret endpoint may remain.
if 'signatureFor(' in s and 'wacliSignatureFor(' not in s:
    raise SystemExit('ERROR: unexpected signature function state')
if '/__internal/wacli-secret' in s:
    raise SystemExit('ERROR: temporary secret endpoint still present')

Path('/home/demac-deploy/stage/server-v2.mjs').write_text(s)
PY

node --check "$STAGED"
sudo -n /usr/local/sbin/demac-deploy-bridge

echo
echo '=== POST-DEPLOY HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo
echo '=== MEDIA ROUTE MUST REQUIRE AUTH ==='
code="$(curl -sS -o /tmp/media-unauth -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' http://127.0.0.1:8787/v1/media)"
rm -f /tmp/media-unauth
printf 'unauthenticated_media_http=%s\n' "$code"
test "$code" = '401'

echo 'BRIDGE_AUTH_MEDIA_PATCH_COMPLETE'
