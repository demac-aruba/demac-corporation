#!/usr/bin/env bash
set -euo pipefail

DEPLOY_USER="demac-deploy"
STORE="/var/lib/demac-wacli-test"
ENV_FILE="/etc/demac-whatsapp-bridge.env"
BRIDGE_SERVICE="demac-whatsapp-bridge-v8-test.service"
SYNC_SERVICE="demac-wacli-sync-v8-test.service"
HELPER="/usr/local/sbin/demac-maintenance"
SUDOERS="/etc/sudoers.d/demac-github-maintenance"

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: run as root." >&2
  exit 1
fi

for required in systemctl install awk openssl visudo curl; do
  command -v "$required" >/dev/null 2>&1 || { echo "ERROR: missing command: $required" >&2; exit 1; }
done

id demac-wacli >/dev/null 2>&1 || { echo "ERROR: demac-wacli user not found." >&2; exit 1; }
id "$DEPLOY_USER" >/dev/null 2>&1 || { echo "ERROR: demac-deploy user not found." >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "ERROR: $ENV_FILE not found." >&2; exit 1; }

echo "=== 1. Fixing wacli media directory permissions ==="
install -d -o demac-wacli -g demac-wacli -m 0700 "$STORE/media"
chown -R demac-wacli:demac-wacli "$STORE/media"
chmod 0700 "$STORE/media"

echo "=== 2. Installing restricted maintenance helper ==="
cat >"$HELPER" <<'HELPER'
#!/usr/bin/env bash
set -euo pipefail
STORE="/var/lib/demac-wacli-test"
ENV_FILE="/etc/demac-whatsapp-bridge.env"
BRIDGE_SERVICE="demac-whatsapp-bridge-v8-test.service"
SYNC_SERVICE="demac-wacli-sync-v8-test.service"

fix_media() {
  install -d -o demac-wacli -g demac-wacli -m 0700 "$STORE/media"
  chown -R demac-wacli:demac-wacli "$STORE/media"
  chmod 0700 "$STORE/media"
  stat -c 'media=%A %U:%G %n' "$STORE/media"
}

rotate_webhook() {
  [[ -f "$ENV_FILE" ]] || { echo "ERROR: missing $ENV_FILE" >&2; exit 2; }
  local secret tmp backup stamp
  secret="$(openssl rand -hex 32)"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="${ENV_FILE}.bak-${stamp}"
  cp -a "$ENV_FILE" "$backup"
  tmp="$(mktemp)"
  awk -v s="$secret" '
    BEGIN { done=0 }
    /^WACLI_WEBHOOK_SECRET=/ { print "WACLI_WEBHOOK_SECRET=" s; done=1; next }
    { print }
    END { if (!done) print "WACLI_WEBHOOK_SECRET=" s }
  ' "$ENV_FILE" >"$tmp"
  chown --reference="$ENV_FILE" "$tmp"
  chmod --reference="$ENV_FILE" "$tmp"
  mv "$tmp" "$ENV_FILE"
  systemctl restart "$BRIDGE_SERVICE"
  systemctl restart "$SYNC_SERVICE"
  systemctl is-active --quiet "$BRIDGE_SERVICE"
  systemctl is-active --quiet "$SYNC_SERVICE"
  echo "Webhook secret rotated; backup=$backup"
}

case "${1:-}" in
  fix-media)
    fix_media
    ;;
  rotate-webhook-secret)
    rotate_webhook
    ;;
  restart-bridge)
    systemctl restart "$BRIDGE_SERVICE"
    systemctl is-active "$BRIDGE_SERVICE"
    ;;
  restart-sync)
    systemctl restart "$SYNC_SERVICE"
    systemctl is-active "$SYNC_SERVICE"
    ;;
  restart-both)
    systemctl restart "$BRIDGE_SERVICE"
    systemctl restart "$SYNC_SERVICE"
    systemctl is-active "$BRIDGE_SERVICE"
    systemctl is-active "$SYNC_SERVICE"
    ;;
  status)
    systemctl is-active "$BRIDGE_SERVICE" || true
    systemctl is-active "$SYNC_SERVICE" || true
    stat -c 'media=%A %U:%G %n' "$STORE/media" 2>/dev/null || true
    ;;
  *)
    echo "Usage: demac-maintenance {fix-media|rotate-webhook-secret|restart-bridge|restart-sync|restart-both|status}" >&2
    exit 64
    ;;
esac
HELPER
chmod 0755 "$HELPER"

cat >"$SUDOERS" <<'SUDOERS'
Defaults:demac-deploy !requiretty
Cmnd_Alias DEMAC_MAINTENANCE = /usr/local/sbin/demac-maintenance *
demac-deploy ALL=(root) NOPASSWD: DEMAC_MAINTENANCE
SUDOERS
chmod 0440 "$SUDOERS"
visudo -cf "$SUDOERS" >/dev/null

echo "=== 3. Rotating exposed webhook secret ==="
"$HELPER" rotate-webhook-secret

echo "=== 4. Verifying services and bridge health ==="
"$HELPER" status
for _ in {1..15}; do
  if curl -fsS http://127.0.0.1:8787/health >/tmp/demac-health-after-maint.json 2>/dev/null; then
    python3 -m json.tool </tmp/demac-health-after-maint.json || cat /tmp/demac-health-after-maint.json
    break
  fi
  sleep 1
done

echo "=== 5. Removing local GitHub private-key copy ==="
rm -f /root/demac-github-actions-ed25519 /root/demac-github-actions-ed25519.pub

echo
echo "DEMAC_MAINTENANCE_V2_COMPLETE"
echo "GitHub remote operations remain authorized through /home/demac-deploy/.ssh/authorized_keys."
echo "No private GitHub SSH key remains on the Droplet."
