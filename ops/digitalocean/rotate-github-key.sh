#!/usr/bin/env bash
set -euo pipefail

DEPLOY_USER="demac-deploy"
DEPLOY_HOME="/home/${DEPLOY_USER}"
SSH_DIR="${DEPLOY_HOME}/.ssh"
AUTHORIZED_KEYS="${SSH_DIR}/authorized_keys"
KEY_PATH="/root/demac-github-actions-ed25519"

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: run this script as root." >&2
  exit 1
fi

id "$DEPLOY_USER" >/dev/null 2>&1 || { echo "ERROR: demac-deploy does not exist; run bootstrap first." >&2; exit 1; }
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0700 "$SSH_DIR"
touch "$AUTHORIZED_KEYS"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTHORIZED_KEYS"
chmod 0600 "$AUTHORIZED_KEYS"

old_pub=""
if [[ -f "${KEY_PATH}.pub" ]]; then
  old_pub="$(cat "${KEY_PATH}.pub")"
fi

if [[ -n "$old_pub" ]]; then
  tmp="$(mktemp)"
  grep -vxF "$old_pub" "$AUTHORIZED_KEYS" >"$tmp" || true
  install -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0600 "$tmp" "$AUTHORIZED_KEYS"
  rm -f "$tmp"
fi

rm -f "$KEY_PATH" "${KEY_PATH}.pub"
ssh-keygen -q -t ed25519 -N '' -C 'demac-github-actions' -f "$KEY_PATH"
new_pub="$(cat "${KEY_PATH}.pub")"
grep -qxF "$new_pub" "$AUTHORIZED_KEYS" || echo "$new_pub" >>"$AUTHORIZED_KEYS"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTHORIZED_KEYS"
chmod 0600 "$AUTHORIZED_KEYS"

printf '\nDEMAC GitHub SSH key rotated successfully.\n'
printf 'Fingerprint: '
ssh-keygen -lf "${KEY_PATH}.pub"
printf '\nThe NEW private key remains only at: %s\n' "$KEY_PATH"
printf 'Do NOT send or screenshot the private key.\n'
printf 'Next: open GitHub -> Settings -> Secrets and variables -> Actions -> New repository secret.\n'
printf 'Secret name: DO_SSH_KEY_B64\n'
printf 'Only when the GitHub secret form is open, run this command and copy its single-line output directly into the secret value:\n\n'
printf 'base64 -w0 %s; echo\n\n' "$KEY_PATH"
printf 'After saving the GitHub secret, clear the terminal and tell ChatGPT only: DO_SSH_KEY_B64 listo\n'
