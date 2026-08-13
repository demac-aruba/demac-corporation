# DEMAC WhatsApp wacli Bridge

This service is the replaceable transport layer between DEMAC ERP/Firebase and the currently linked WhatsApp Business account.

It is deliberately separate from ERP business logic. Today the provider can be `wacli`; later the ERP can switch to Meta Cloud API without rebuilding the Communication Center, CRM, scheduling or operator workflow.

## Runtime topology

```text
DEMAC ERP (Vercel)
        |
        | Firestore whatsappOutboundQueue
        v
Firebase Functions
        |
        | HTTPS + Bearer token
        v
Public HTTPS reverse proxy
        |
        v
127.0.0.1:8787  demac-whatsapp-bridge
        |
        | wacli --json send text
        v
wacli sync --follow  <---->  WhatsApp linked device
        |
        | signed local webhook
        v
demac-whatsapp-bridge durable webhook outbox
        |
        | retrying HTTPS delivery + original HMAC signature
        v
Firebase wacliWebhook
        |
        v
Firestore Communication Center
```

## Why the local durable outbox exists

`wacli sync --webhook` is intentionally best-effort. The bridge therefore receives the webhook on localhost, verifies the wacli HMAC, writes the exact signed payload to disk, immediately acknowledges wacli, and retries delivery to Firebase until Firebase accepts it.

This protects daily operations from a temporary Firebase/internet failure without writing directly into either of wacli's SQLite databases.

## Host requirements

- Always-on Linux host/VPS.
- Node.js 22+ for this bridge.
- Current official `wacli` Linux binary.
- Public HTTPS hostname for the `/v1/send` endpoint. Put Caddy, nginx, Cloudflare Tunnel, or an equivalent trusted TLS reverse proxy in front of `127.0.0.1:8787`.
- Outbound HTTPS access to Firebase/Google and WhatsApp.
- The host must not be ephemeral; `/var/lib/demac-wacli` contains the linked-device session and `/var/lib/demac-whatsapp-bridge` contains any pending webhook events.

## 1. Create the service account and directories

```bash
sudo useradd --system --home /var/lib/demac-wacli --create-home --shell /usr/sbin/nologin demac-wacli
sudo install -d -o demac-wacli -g demac-wacli -m 700 /var/lib/demac-wacli
sudo install -d -o demac-wacli -g demac-wacli -m 700 /var/lib/demac-whatsapp-bridge
sudo install -d -o root -g root -m 755 /opt/demac-whatsapp-bridge
```

Copy `server.mjs` and `package.json` from this folder into `/opt/demac-whatsapp-bridge`.

Install the current official wacli binary as `/usr/local/bin/wacli` and verify:

```bash
/usr/local/bin/wacli version
```

## 2. Create secrets

Copy `demac-whatsapp-bridge.env.example` to `/etc/demac-whatsapp-bridge.env` and replace all placeholders.

Generate two independent secrets, for example:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Use one as `BRIDGE_TOKEN` and the other as `WACLI_WEBHOOK_SECRET`.

Protect the file:

```bash
sudo chown root:root /etc/demac-whatsapp-bridge.env
sudo chmod 600 /etc/demac-whatsapp-bridge.env
```

The same values must later be configured in Firebase Secrets:

- `WACLI_BRIDGE_TOKEN` = `BRIDGE_TOKEN`
- `WACLI_WEBHOOK_SECRET` = the same local HMAC secret
- `WACLI_BRIDGE_URL` = the public HTTPS origin of this bridge, without `/v1/send`

## 3. Pair the DEMAC WhatsApp Business account

This is the one required interactive step.

Temporarily give the service user a shell or run the command as that user from an interactive root shell:

```bash
sudo -u demac-wacli env WACLI_STORE_DIR=/var/lib/demac-wacli /usr/local/bin/wacli auth
```

On the DEMAC WhatsApp Business primary phone:

1. Open **Linked devices**.
2. Choose **Link a device**.
3. Scan the QR code shown by `wacli auth`.
4. Let the initial synchronization finish.

Then verify:

```bash
sudo -u demac-wacli env WACLI_STORE_DIR=/var/lib/demac-wacli /usr/local/bin/wacli auth status
sudo -u demac-wacli env WACLI_STORE_DIR=/var/lib/demac-wacli /usr/local/bin/wacli doctor --connect
```

Do not copy `session.db` or expose the wacli state directory. It contains linked-device identity/keys.

## 4. Install the services

```bash
sudo cp systemd/demac-whatsapp-bridge.service /etc/systemd/system/
sudo cp systemd/demac-wacli-sync.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now demac-whatsapp-bridge.service
sudo systemctl enable --now demac-wacli-sync.service
```

Check them:

```bash
sudo systemctl status demac-whatsapp-bridge.service
sudo systemctl status demac-wacli-sync.service
curl -s http://127.0.0.1:8787/health
```

`demac-wacli-sync.service` intentionally uses:

- `--max-reconnect 0` to keep reconnecting.
- `--stale-threshold 2m` for stuck connection recovery.
- `--presence-mode quiet` so the linked device does not continuously advertise available presence.
- `--send-spacing 2s-5s` to pace delegated sends.
- `--max-db-size 2GB` as a local storage guardrail.
- signed webhooks for `message,receipt`.
- `--webhook-allow-private` because the trusted webhook target is the loopback bridge.

Typing events are not enabled by default because wacli requires normal presence mode for `chat_presence`. DEMAC can enable them later if that tradeoff is desired.

## 5. Publish `/v1/send` over HTTPS

The Node service listens only on `127.0.0.1`. A TLS reverse proxy must expose it to Firebase.

Example conceptual Caddy configuration:

```caddy
YOUR_BRIDGE_HOSTNAME {
    reverse_proxy 127.0.0.1:8787
}
```

Firewall policy should expose only HTTPS (and SSH/admin access as required). The send endpoint additionally requires `Authorization: Bearer <BRIDGE_TOKEN>`.

The local `/v1/events` endpoint is HMAC-signed and is intended for wacli on localhost; it does not need to be called from the public internet.

## 6. Deploy the Firebase side

From an authenticated Firebase CLI for project `demac-corporation`:

```bash
firebase functions:secrets:set WACLI_WEBHOOK_SECRET
firebase functions:secrets:set WACLI_BRIDGE_URL
firebase functions:secrets:set WACLI_BRIDGE_TOKEN
```

Then deploy the new/changed functions and rules. A full safe project deployment is acceptable; if deploying selectively, include at least:

- `wacliWebhook`
- `sendQueuedWacliMessage`
- `appendCommunicationInternalNote`
- existing `sendQueuedWhatsAppMessage` because it now ignores explicit non-Meta queue items
- Firestore rules

After deployment, confirm the actual `wacliWebhook` HTTPS URL and put it into `ERP_WEBHOOK_URL` on the bridge host. Restart the bridge if that value changed.

## 7. End-to-end acceptance test

Use a second WhatsApp number, not the DEMAC number itself.

1. Open ERP Next `/communications` as manager and one office operator in separate sessions.
2. Both users should appear in the operator presence panel.
3. From the second phone, send a normal WhatsApp message to DEMAC.
4. The conversation should appear in **Unassigned** or be auto-routed to an available operator.
5. Manager view should show the entire conversation and current owner.
6. A non-owning operator should see pipeline ownership/status and be prevented from replying until taking ownership.
7. Owner sends a multiline reply from the ERP.
8. Verify it arrives in WhatsApp with line breaks preserved.
9. Verify the queue item becomes `sent` and the canonical wacli message appears in the conversation.
10. Read the message on the second phone and confirm the `read` receipt is stored.
11. Stop internet/Firebase access briefly, send a WhatsApp message, then restore access. `/health` should show pending webhook events return to zero after successful retry.
12. Restart both systemd services and confirm the linked session reconnects without another QR.

## Operational notes

- Keep `wacli` and the bridge under the same Linux user/store so sends delegate to the running `sync --follow` process instead of opening competing sessions.
- Never write directly to `session.db` or `wacli.db`.
- Back up the host securely, but treat the wacli store as sensitive credentials.
- The ERP transport is provider-neutral. When Meta Business Verification is approved, switch the configured provider to Meta after acceptance testing; do not rebuild the inbox.
- This bridge is intended for normal DEMAC customer-service/operational traffic, not bulk marketing automation.
