#!/usr/bin/env bash
set -euo pipefail

SOURCE=/opt/demac-whatsapp-bridge/server-v2.mjs
STAGED=/home/demac-deploy/stage/server-v2.mjs

echo '=== INSTALL DEMAC ED25519 BRIDGE SIGNING ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - <<'PY'
from pathlib import Path
s=Path('/opt/demac-whatsapp-bridge/server-v2.mjs').read_text()

# Persistent private signing key lives only inside the bridge state directory.
anchor="const TEMP_DIR = path.join(STATE_DIR, 'media-temp');"
insert="""const TEMP_DIR = path.join(STATE_DIR, 'media-temp');
const BRIDGE_SIGNING_KEY_PATH = path.join(STATE_DIR, 'bridge-signing-ed25519-private.pem');"""
if 'BRIDGE_SIGNING_KEY_PATH' not in s:
    if anchor not in s: raise SystemExit('ERROR: TEMP_DIR anchor not found')
    s=s.replace(anchor,insert,1)

anchor="let forwarding = false;"
insert="""let forwarding = false;
let bridgeSigningPrivateKey = null;
let bridgeSigningPublicKeyDer = '';"""
if 'bridgeSigningPrivateKey' not in s:
    if anchor not in s: raise SystemExit('ERROR: forwarding anchor not found')
    s=s.replace(anchor,insert,1)

old="function bridgeSignatureFor(rawBody) { return `sha256=${crypto.createHmac('sha256', BRIDGE_TOKEN).update(rawBody).digest('hex')}`; }"
new="""function bridgeHmacSignatureFor(rawBody) { return `sha256=${crypto.createHmac('sha256', BRIDGE_TOKEN).update(rawBody).digest('hex')}`; }
function bridgeSignatureFor(rawBody) {
  if (!bridgeSigningPrivateKey) throw new Error('Bridge signing identity is not initialized.');
  return `ed25519=${crypto.sign(null, rawBody, bridgeSigningPrivateKey).toString('base64')}`;
}
async function ensureBridgeSigningIdentity() {
  await fs.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  let privatePem = '';
  try {
    privatePem = await fs.readFile(BRIDGE_SIGNING_KEY_PATH, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const pair = crypto.generateKeyPairSync('ed25519');
    privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const temporary = `${BRIDGE_SIGNING_KEY_PATH}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, privatePem, { mode: 0o600 });
    await fs.rename(temporary, BRIDGE_SIGNING_KEY_PATH);
  }
  bridgeSigningPrivateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(bridgeSigningPrivateKey);
  bridgeSigningPublicKeyDer = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}"""
if 'async function ensureBridgeSigningIdentity()' not in s:
    if old not in s: raise SystemExit('ERROR: bridge signature anchor not found')
    s=s.replace(old,new,1)

# Keep legacy HMAC header for compatibility while adding the authoritative Ed25519 header.
s=s.replace("'X-Wacli-Signature': bridgeSignatureFor(raw)", "'X-Wacli-Signature': bridgeHmacSignatureFor(raw)")
old_forward="headers: { 'Content-Type': 'application/json', 'X-Wacli-Signature': bridgeSignatureFor(rawBody) }"
new_forward="headers: { 'Content-Type': 'application/json', 'X-Wacli-Signature': bridgeHmacSignatureFor(rawBody), 'X-Demac-Bridge-Signature': bridgeSignatureFor(rawBody) }"
if old_forward in s:
    s=s.replace(old_forward,new_forward,1)
elif "'X-Demac-Bridge-Signature': bridgeSignatureFor(rawBody)" not in s:
    raise SystemExit('ERROR: forwardRecord header anchor not found')

# Surface only the PUBLIC key through localhost health. It is not secret.
old_health="lastForwardSuccessAt, lastForwardError, lastSendSuccessAt, lastSendError }); }"
new_health="lastForwardSuccessAt, lastForwardError, lastSendSuccessAt, lastSendError, bridgeSigningPublicKey: bridgeSigningPublicKeyDer }); }"
if 'bridgeSigningPublicKey:' not in s:
    if old_health not in s: raise SystemExit('ERROR: health anchor not found')
    s=s.replace(old_health,new_health,1)

old_start="requireConfiguration(); await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 }); await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });"
new_start="requireConfiguration(); await ensureBridgeSigningIdentity(); await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 }); await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });"
if 'await ensureBridgeSigningIdentity();' not in s:
    if old_start not in s: raise SystemExit('ERROR: startup anchor not found')
    s=s.replace(old_start,new_start,1)

Path('/home/demac-deploy/stage/server-v2.mjs').write_text(s)
PY

node --check "$STAGED"
sudo -n /usr/local/sbin/demac-deploy-bridge >/tmp/demac-ed25519-deploy.log

echo '=== VERIFY ED25519 IDENTITY WITHOUT PRIVATE KEY ==='
health="$(curl -fsS http://127.0.0.1:8787/health)"
printf '%s' "$health" | python3 - <<'PY'
import json,sys
x=json.load(sys.stdin)
pub=x.get('bridgeSigningPublicKey','')
print('ok=',x.get('ok'))
print('pending=',x.get('pendingWebhookEvents'))
print('public_key_present=',bool(pub))
print('public_key_bytes_b64=',len(pub))
if not pub: raise SystemExit(1)
PY

if grep -q '/__internal/wacli-secret' "$SOURCE"; then
  echo 'ERROR: temporary secret handoff route unexpectedly present' >&2
  exit 1
fi

echo 'ED25519_BRIDGE_SIGNING_READY'
