#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

APP_DIR=/opt/demac-whatsapp-bridge
STATE_DIR=/var/lib/demac-whatsapp-bridge
STORE_DIR=/var/lib/demac-wacli-test
ENV_FILE=/etc/demac-whatsapp-bridge.env
SERVICE_USER=demac-wacli
SERVICE_GROUP=demac-wacli
OLD_BRIDGE=demac-whatsapp-bridge-test.service
OLD_SYNC=demac-wacli-sync-test.service
V8_BRIDGE=demac-whatsapp-bridge-v8-test.service
V8_SYNC=demac-wacli-sync-v8-test.service
V8_BACKFILL=demac-wacli-backfill-v8-test.service
V2_WEBHOOK_URL=https://us-central1-demac-corporation.cloudfunctions.net/wacliWebhookV2
ASSET_REF=47c84bab43c05810963a16ada3fdf06030ccd6ec
RAW_BASE="https://raw.githubusercontent.com/demac-aruba/demac-corporation/${ASSET_REF}/services/whatsapp-bridge"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="/var/backups/demac-whatsapp-bridge-v8/${STAMP}"
CUTOVER_STARTED=0

log() { printf '\n==> %s\n' "$*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }
unit_exists() { systemctl cat "$1" >/dev/null 2>&1; }

rollback() {
  local exit_code=$?
  if [[ $CUTOVER_STARTED -eq 0 ]]; then
    exit "$exit_code"
  fi
  echo >&2
  echo "V8 activation did not complete. Rolling back the personal test bridge..." >&2
  systemctl disable --now "$V8_SYNC" >/dev/null 2>&1 || true
  systemctl disable --now "$V8_BRIDGE" >/dev/null 2>&1 || true
  if [[ -f "$BACKUP_DIR/demac-whatsapp-bridge.env" ]]; then
    install -o root -g root -m 600 "$BACKUP_DIR/demac-whatsapp-bridge.env" "$ENV_FILE"
  fi
  systemctl daemon-reload || true
  if unit_exists "$OLD_BRIDGE"; then systemctl enable --now "$OLD_BRIDGE" >/dev/null 2>&1 || true; fi
  if unit_exists "$OLD_SYNC"; then systemctl enable --now "$OLD_SYNC" >/dev/null 2>&1 || true; fi
  echo "Rollback attempted. Check: systemctl status $OLD_BRIDGE $OLD_SYNC --no-pager" >&2
  exit "$exit_code"
}
trap rollback ERR

log "Preflight"
command -v curl >/dev/null || fail "curl is required."
command -v python3 >/dev/null || fail "python3 is required."
command -v node >/dev/null || fail "node is required."
[[ -x /usr/local/bin/wacli ]] || fail "/usr/local/bin/wacli was not found."
id "$SERVICE_USER" >/dev/null 2>&1 || fail "Service user $SERVICE_USER does not exist."
[[ -d "$STORE_DIR" ]] || fail "Personal WhatsApp test store $STORE_DIR does not exist."
[[ -f "$ENV_FILE" ]] || fail "$ENV_FILE does not exist."
grep -q '^WACLI_WEBHOOK_SECRET=' "$ENV_FILE" || fail "WACLI_WEBHOOK_SECRET is missing from the bridge env file."
grep -q '^BRIDGE_TOKEN=' "$ENV_FILE" || fail "BRIDGE_TOKEN is missing from the bridge env file."

# Do not switch endpoints while the durable V1 outbox still contains work.
if curl -fsS --max-time 3 http://127.0.0.1:8787/health >/tmp/demac-v8-old-health.json 2>/dev/null; then
  PENDING=$(python3 - <<'PY'
import json
try:
    data=json.load(open('/tmp/demac-v8-old-health.json'))
    print(int(data.get('pendingWebhookEvents', 0)))
except Exception:
    print(0)
PY
)
  if [[ "$PENDING" -gt 0 ]]; then
    log "Waiting for ${PENDING} durable webhook event(s) to flush before cutover"
    for _ in {1..12}; do
      sleep 3
      curl -fsS --max-time 3 http://127.0.0.1:8787/health >/tmp/demac-v8-old-health.json 2>/dev/null || true
      PENDING=$(python3 - <<'PY'
import json
try:
    data=json.load(open('/tmp/demac-v8-old-health.json'))
    print(int(data.get('pendingWebhookEvents', 0)))
except Exception:
    print(0)
PY
)
      [[ "$PENDING" -eq 0 ]] && break
    done
    [[ "$PENDING" -eq 0 ]] || fail "The existing bridge still has ${PENDING} pending webhook event(s). No cutover was made."
  fi
fi
rm -f /tmp/demac-v8-old-health.json

log "Creating rollback backup at $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -a "$ENV_FILE" "$BACKUP_DIR/demac-whatsapp-bridge.env"
for unit in "$OLD_BRIDGE" "$OLD_SYNC"; do
  if unit_exists "$unit"; then
    systemctl cat "$unit" >"$BACKUP_DIR/${unit}.txt" || true
    systemctl is-enabled "$unit" >"$BACKUP_DIR/${unit}.enabled" 2>/dev/null || true
    systemctl is-active "$unit" >"$BACKUP_DIR/${unit}.active" 2>/dev/null || true
  fi
done

if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  log "Installing ffmpeg/ffprobe for WhatsApp voice-note conversion"
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg
fi

log "Installing validated V8 bridge assets"
mkdir -p "$APP_DIR" "$STATE_DIR"
chmod 700 "$STATE_DIR"
curl -fL --retry 3 --connect-timeout 10 "$RAW_BASE/server-v2.mjs" -o "$APP_DIR/server-v2.mjs.new"
curl -fL --retry 3 --connect-timeout 10 "$RAW_BASE/backfill-recent.mjs" -o "$APP_DIR/backfill-recent.mjs.new"
node --check "$APP_DIR/server-v2.mjs.new"
node --check "$APP_DIR/backfill-recent.mjs.new"
install -o root -g root -m 644 "$APP_DIR/server-v2.mjs.new" "$APP_DIR/server-v2.mjs"
install -o root -g root -m 644 "$APP_DIR/backfill-recent.mjs.new" "$APP_DIR/backfill-recent.mjs"
rm -f "$APP_DIR/server-v2.mjs.new" "$APP_DIR/backfill-recent.mjs.new"

# Every bridge-spawned wacli command is forced into the already-paired personal test store.
cat >"$APP_DIR/wacli-test-wrapper" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${WACLI_ALLOW_LIVE_PROFILE_FETCH:-0}" != "1" ]]; then
  joined=" $* "
  if [[ "$joined" == *" profile picture-info "* ]]; then
    printf '%s\n' '{"success":false,"error":{"message":"profile picture lookup deferred to maintenance backfill"}}'
    exit 0
  fi
fi
exec /usr/local/bin/wacli --store /var/lib/demac-wacli-test "$@"
WRAPPER
chown root:root "$APP_DIR/wacli-test-wrapper"
chmod 755 "$APP_DIR/wacli-test-wrapper"

log "Pointing only the personal-test bridge to Firebase V8"
python3 - "$ENV_FILE" "$V2_WEBHOOK_URL" <<'PY'
import os, sys, tempfile
path, url = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    lines=f.read().splitlines()
lines=[line for line in lines if not line.startswith('ERP_WEBHOOK_URL=')]
lines.append('ERP_WEBHOOK_URL=' + url)
fd,tmp=tempfile.mkstemp(prefix='.demac-env-', dir=os.path.dirname(path), text=True)
try:
    with os.fdopen(fd,'w',encoding='utf-8') as f:
        f.write('\n'.join(lines)+'\n')
    os.chmod(tmp,0o600)
    os.replace(tmp,path)
finally:
    if os.path.exists(tmp): os.unlink(tmp)
PY
chown root:root "$ENV_FILE"
chmod 600 "$ENV_FILE"

log "Installing isolated V8 systemd units"
cat >/etc/systemd/system/$V8_BRIDGE <<'UNIT'
[Unit]
Description=DEMAC WhatsApp wacli Bridge V8 - personal test
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=demac-wacli
Group=demac-wacli
WorkingDirectory=/opt/demac-whatsapp-bridge
EnvironmentFile=/etc/demac-whatsapp-bridge.env
Environment=WACLI_BINARY=/opt/demac-whatsapp-bridge/wacli-test-wrapper
ExecStart=/usr/bin/node /opt/demac-whatsapp-bridge/server-v2.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/demac-whatsapp-bridge /var/lib/demac-wacli-test
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/$V8_SYNC <<'UNIT'
[Unit]
Description=DEMAC WhatsApp wacli Sync V8 - personal test with media
After=network-online.target demac-whatsapp-bridge-v8-test.service
Wants=network-online.target
Requires=demac-whatsapp-bridge-v8-test.service

[Service]
Type=simple
User=demac-wacli
Group=demac-wacli
EnvironmentFile=/etc/demac-whatsapp-bridge.env
ExecStart=/usr/local/bin/wacli --store /var/lib/demac-wacli-test sync --follow --max-reconnect 0 --stale-threshold 2m --presence-mode quiet --send-spacing 2s-5s --max-db-size 2GB --download-media --refresh-contacts --webhook http://127.0.0.1:8787/v1/events --webhook-allow-private --webhook-secret ${WACLI_WEBHOOK_SECRET} --webhook-events message,receipt
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/demac-wacli-test
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/$V8_BACKFILL <<'UNIT'
[Unit]
Description=DEMAC WhatsApp V8 recent media identity and avatar backfill - personal test
After=network-online.target
Wants=network-online.target
Conflicts=demac-wacli-sync-v8-test.service demac-wacli-sync-test.service

[Service]
Type=oneshot
User=demac-wacli
Group=demac-wacli
WorkingDirectory=/opt/demac-whatsapp-bridge
EnvironmentFile=/etc/demac-whatsapp-bridge.env
Environment=WACLI_BINARY=/opt/demac-whatsapp-bridge/wacli-test-wrapper
Environment=WACLI_ALLOW_LIVE_PROFILE_FETCH=1
Environment=WACLI_BACKFILL_LIMIT=500
ExecStart=/usr/bin/node /opt/demac-whatsapp-bridge/backfill-recent.mjs
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/demac-whatsapp-bridge /var/lib/demac-wacli-test
UMask=0077
UNIT

cat >"$APP_DIR/rollback-v8-test.sh" <<ROLLBACK
#!/usr/bin/env bash
set -euo pipefail
[[ \${EUID:-\$(id -u)} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
systemctl disable --now $V8_SYNC >/dev/null 2>&1 || true
systemctl disable --now $V8_BRIDGE >/dev/null 2>&1 || true
install -o root -g root -m 600 "$BACKUP_DIR/demac-whatsapp-bridge.env" "$ENV_FILE"
systemctl daemon-reload
if systemctl cat $OLD_BRIDGE >/dev/null 2>&1; then systemctl enable --now $OLD_BRIDGE; fi
if systemctl cat $OLD_SYNC >/dev/null 2>&1; then systemctl enable --now $OLD_SYNC; fi
echo "Personal test bridge rolled back to the previous services."
ROLLBACK
chmod 700 "$APP_DIR/rollback-v8-test.sh"

cat >"$APP_DIR/run-v8-backfill-test.sh" <<'BACKFILL'
#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
SYNC=demac-wacli-sync-v8-test.service
systemctl stop "$SYNC"
trap 'systemctl start "$SYNC" >/dev/null 2>&1 || true' EXIT
systemctl start demac-wacli-backfill-v8-test.service
systemctl --no-pager --full status demac-wacli-backfill-v8-test.service || true
BACKFILL
chmod 700 "$APP_DIR/run-v8-backfill-test.sh"

systemctl daemon-reload
CUTOVER_STARTED=1

log "Stopping the proven V1 personal-test services only for this controlled cutover"
if unit_exists "$OLD_SYNC"; then systemctl disable --now "$OLD_SYNC" >/dev/null 2>&1 || true; fi
if unit_exists "$OLD_BRIDGE"; then systemctl disable --now "$OLD_BRIDGE" >/dev/null 2>&1 || true; fi

log "Starting V8 bridge"
systemctl enable --now "$V8_BRIDGE"
for _ in {1..15}; do
  if curl -fsS --max-time 2 http://127.0.0.1:8787/health >/tmp/demac-v8-health.json 2>/dev/null; then break; fi
  sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:8787/health >/tmp/demac-v8-health.json
python3 - <<'PY'
import json
data=json.load(open('/tmp/demac-v8-health.json'))
assert data.get('ok') is True, data
assert data.get('service') == 'demac-whatsapp-wacli-bridge-v2', data
print('Bridge health: OK')
print('Pending durable events:', data.get('pendingWebhookEvents', 0))
PY
rm -f /tmp/demac-v8-health.json

log "Starting V8 continuous WhatsApp sync with media capture"
systemctl enable --now "$V8_SYNC"
sleep 5
systemctl is-active --quiet "$V8_BRIDGE"
systemctl is-active --quiet "$V8_SYNC"

# If we reach this point the automatic ERR rollback is no longer needed.
CUTOVER_STARTED=0
trap - ERR

log "V8 personal-test bridge is active"
printf 'Bridge: %s\n' "$(systemctl is-active "$V8_BRIDGE")"
printf 'Sync:   %s\n' "$(systemctl is-active "$V8_SYNC")"
printf 'wacli:  %s\n' "$(/usr/local/bin/wacli --version 2>/dev/null | head -n1 || true)"
echo "Rollback command: $APP_DIR/rollback-v8-test.sh"
echo "Historical media/avatar backfill (run only after live smoke tests): $APP_DIR/run-v8-backfill-test.sh"
