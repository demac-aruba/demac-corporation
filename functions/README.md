# DEMAC Cloud Functions

This folder contains secure backend integrations that must never run in the browser.

## First deployment

From the repository root:

```bash
npm install -g firebase-tools
firebase login
firebase use demac-corporation
firebase functions:secrets:set WHATSAPP_VERIFY_TOKEN
cd functions
npm install
cd ..
firebase deploy --only functions:whatsappWebhook
```

The secret command prompts for a private verification value. Use the same value later in Meta's **Verify token** field.

After deployment, Firebase prints the public HTTPS endpoint for `whatsappWebhook`. Paste that URL into Meta's **Callback URL** field.

## What the webhook stores

- `whatsappWebhookEvents`: complete webhook payloads for troubleshooting.
- `whatsappMessages`: normalized inbound customer messages.
- `whatsappMessageStatuses`: sent, delivered, read, and failed status updates.

The current phase receives and stores events only. Automated replies and outgoing appointment messages will be added after webhook verification succeeds.
