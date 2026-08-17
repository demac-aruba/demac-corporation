#!/usr/bin/env bash
set -euo pipefail

DEPLOY_USER="demac-deploy"
DEPLOY_HOME="/home/${DEPLOY_USER}"
SSH_DIR="${DEPLOY_HOME}/.ssh"
KEY_PATH="/root/demac-github-actions-ed25519"
BRIDGE_SERVICE="demac-whatsapp-bridge-v8-test.service"
SYNC_SERVICE="demac-wacli-sync-v8-test.service"
BRIDGE_FILE="/opt/demac-whatsapp-bridge/server-v2.mjs"
STAGE_DIR="${DEPLOY_HOME}/stage"
RUN_DIR="${DEPLOY_HOME}/run"
WACLI_STORE="/var/lib/demac-wacli-test"

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: run this bootstrap as root." >&2
  exit 1
fi

for required in useradd usermod install visudo systemctl node curl runuser ssh-keygen; do
  command -v "$required" >/dev/null 2>&1 || { echo "ERROR: missing required command: $required" >&2; exit 1; }
done

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi

usermod -a -G systemd-journal "$DEPLOY_USER" 2>/dev/null || true
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0700 "$SSH_DIR" "$STAGE_DIR" "$RUN_DIR"

cat >/usr/local/sbin/demac-service-control <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
BRIDGE_SERVICE="demac-whatsapp-bridge-v8-test.service"
SYNC_SERVICE="demac-wacli-sync-v8-test.service"
action="${1:-}"
target="${2:-}"
case "$action" in
  status)
    case "$target" in
      bridge) systemctl --no-pager --full status "$BRIDGE_SERVICE" ;;
      sync) systemctl --no-pager --full status "$SYNC_SERVICE" ;;
      both)
        systemctl --no-pager --full status "$BRIDGE_SERVICE" || true
        systemctl --no-pager --full status "$SYNC_SERVICE" || true
        ;;
      *) echo "Usage: demac-service-control status {bridge|sync|both}" >&2; exit 2 ;;
    esac
    ;;
  restart)
    case "$target" in
      bridge) systemctl restart "$BRIDGE_SERVICE" ;;
      sync) systemctl restart "$SYNC_SERVICE" ;;
      both)
        systemctl restart "$BRIDGE_SERVICE"
        systemctl restart "$SYNC_SERVICE"
        ;;
      *) echo "Usage: demac-service-control restart {bridge|sync|both}" >&2; exit 2 ;;
    esac
    ;;
  *) echo "Usage: demac-service-control {status|restart} {bridge|sync|both}" >&2; exit 2 ;;
esac
SCRIPT
chmod 0755 /usr/local/sbin/demac-service-control

cat >/usr/local/sbin/demac-wacli-ro <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
WACLI="/usr/local/bin/wacli"
STORE="/var/lib/demac-wacli-test"
first="${1:-}"
second="${2:-}"
case "${first}:${second}" in
  messages:list|messages:show|messages:search|messages:export|messages:context|messages:starred|media:download)
    exec runuser -u demac-wacli -- "$WACLI" --store "$STORE" --read-only "$@"
    ;;
  *)
    echo "Denied. Allowed read-only commands: messages {list,show,search,export,context,starred}; media download." >&2
    exit 64
    ;;
esac
SCRIPT
chmod 0755 /usr/local/sbin/demac-wacli-ro

cat >/usr/local/sbin/demac-deploy-bridge <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
STAGED="/home/demac-deploy/stage/server-v2.mjs"
TARGET="/opt/demac-whatsapp-bridge/server-v2.mjs"
BACKUP_DIR="/opt/demac-whatsapp-bridge/backups"
SERVICE="demac-whatsapp-bridge-v8-test.service"
HEALTH="http://127.0.0.1:8787/health"

[[ -f "$STAGED" ]] || { echo "ERROR: staged bridge file not found: $STAGED" >&2; exit 2; }
node --check "$STAGED"
install -d -o root -g root -m 0750 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="${BACKUP_DIR}/server-v2.mjs.${stamp}.bak"
cp -a "$TARGET" "$backup"
rollback() {
  echo "Bridge validation failed; restoring $backup" >&2
  cp -a "$backup" "$TARGET"
  systemctl restart "$SERVICE" || true
}
trap rollback ERR
install -o root -g root -m 0644 "$STAGED" "$TARGET"
node --check "$TARGET"
systemctl restart "$SERVICE"
for _ in {1..15}; do
  if curl -fsS "$HEALTH" >/tmp/demac-bridge-health.json 2>/dev/null; then
    cat /tmp/demac-bridge-health.json
    trap - ERR
    echo
    echo "Bridge deploy successful. Backup: $backup"
    exit 0
  fi
  sleep 1
done
echo "ERROR: bridge health check did not recover." >&2
exit 1
SCRIPT
chmod 0755 /usr/local/sbin/demac-deploy-bridge

cat >/etc/sudoers.d/demac-github-ops <<'SUDOERS'
Defaults:demac-deploy !requiretty
Cmnd_Alias DEMAC_SERVICE_CTL = /usr/local/sbin/demac-service-control *
Cmnd_Alias DEMAC_WACLI_RO = /usr/local/sbin/demac-wacli-ro *
Cmnd_Alias DEMAC_BRIDGE_DEPLOY = /usr/local/sbin/demac-deploy-bridge
demac-deploy ALL=(root) NOPASSWD: DEMAC_SERVICE_CTL, DEMAC_WACLI_RO, DEMAC_BRIDGE_DEPLOY
SUDOERS
chmod 0440 /etc/sudoers.d/demac-github-ops
visudo -cf /etc/sudoers.d/demac-github-ops >/dev/null

if [[ ! -f "$KEY_PATH" ]]; then
  ssh-keygen -q -t ed25519 -N '' -C 'demac-github-actions' -f "$KEY_PATH"
fi

PUBKEY="$(cat "${KEY_PATH}.pub")"
touch "${SSH_DIR}/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "${SSH_DIR}/authorized_keys"
chmod 0600 "${SSH_DIR}/authorized_keys"
grep -qxF "$PUBKEY" "${SSH_DIR}/authorized_keys" || echo "$PUBKEY" >>"${SSH_DIR}/authorized_keys"

systemctl is-active --quiet "$BRIDGE_SERVICE" || echo "WARNING: $BRIDGE_SERVICE is not active."
systemctl is-active --quiet "$SYNC_SERVICE" || echo "WARNING: $SYNC_SERVICE is not active."
node --check "$BRIDGE_FILE" >/dev/null

cat <<EOF

============================================================
DEMAC DIGITALOCEAN REMOTE OPS BOOTSTRAP COMPLETE
============================================================
Deployment user: ${DEPLOY_USER}
Bridge service:  ${BRIDGE_SERVICE}
Sync service:    ${SYNC_SERVICE}

NEXT STEP (ONE TIME ONLY):
1. In GitHub repository demac-aruba/demac-corporation open:
   Settings -> Secrets and variables -> Actions -> New repository secret
2. Secret name: DO_SSH_KEY
3. Secret value: copy the ENTIRE private key printed below, including BEGIN/END lines.
4. Do NOT paste the private key into ChatGPT or any message.

----- BEGIN COPY TO GITHUB SECRET DO_SSH_KEY -----
EOF
cat "$KEY_PATH"
cat <<'EOF'
----- END COPY TO GITHUB SECRET DO_SSH_KEY -----

After the GitHub secret is saved, return here and tell ChatGPT: "DO_SSH_KEY listo".
ChatGPT will run the remote connection test through GitHub Actions.

For cleanup after the first successful GitHub connection, this local private-key copy may be deleted with:
  rm -f /root/demac-github-actions-ed25519
(The public key and GitHub secret remain sufficient.)
============================================================
EOF
