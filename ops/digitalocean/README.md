# DEMAC DigitalOcean Remote Ops

This directory provides a controlled GitHub Actions -> SSH path to the DEMAC WhatsApp V8 test Droplet.

## Security model

- Dedicated non-root SSH user: `demac-deploy`.
- One repository secret only: `DO_SSH_KEY`.
- The GitHub runner cannot use unrestricted `sudo`.
- Root actions are limited to three validated helper commands installed by `bootstrap.sh`:
  - `demac-service-control` for status/restart of the V8 bridge and sync units only.
  - `demac-wacli-ro` for read-only wacli inspection/media-download commands against `/var/lib/demac-wacli-test`.
  - `demac-deploy-bridge` for validated/backup/rollback deployment of `/opt/demac-whatsapp-bridge/server-v2.mjs` only.
- The bridge deploy helper runs `node --check`, makes a timestamped backup, restarts only the V8 bridge, checks `/health`, and rolls back on failure.
- GitHub Actions logs become the audit trail for remote operations.

## One-time bootstrap

Run `bootstrap.sh` as root on the Droplet. It creates `demac-deploy`, the limited sudo helpers, and a dedicated Ed25519 SSH keypair. Copy the printed private key directly into GitHub repository secret `DO_SSH_KEY`. Never paste it into chat or commit it to the repository.

After the first successful GitHub Actions connection, delete `/root/demac-github-actions-ed25519` from the Droplet. The public key in `demac-deploy` and the GitHub secret remain in place.

## Normal operating flow

`ops/digitalocean/run/task.sh` is the audited remote task. Changes merged to `main` trigger `.github/workflows/digitalocean-remote-ops.yml`, which uploads and executes the task as `demac-deploy`. A candidate `ops/digitalocean/deploy/server-v2.mjs` may be staged and deployed by invoking `sudo /usr/local/sbin/demac-deploy-bridge` from the task.

This intentionally does not provide arbitrary root shell access.
