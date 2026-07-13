# DEMAC Cloud Functions

This folder contains secure backend integrations that must never run in the browser.

## Secrets

From the repository root:

```bash
firebase functions:secrets:set WHATSAPP_VERIFY_TOKEN
firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN
```

- `WHATSAPP_VERIFY_TOKEN` verifies the Meta webhook.
- `WHATSAPP_ACCESS_TOKEN` is the permanent Meta system-user token used only by backend functions.

## Deployment

```bash
cd functions
npm install
cd ..
firebase deploy --only functions --project demac-corporation
```

After deployment, Firebase prints the public HTTPS endpoint for `whatsappWebhook`. Paste that URL into Meta's **Callback URL** field.

## Incoming WhatsApp data

- `whatsappWebhookEvents`: complete webhook payloads for troubleshooting.
- `whatsappMessages`: normalized inbound and outbound messages.
- `whatsappMessageStatuses`: sent, delivered, read, and failed status updates.

## Sending an approved template

Create a document in `whatsappOutboundQueue` with these fields:

```text
to: "297XXXXXXXX"
phoneNumberId: "META_PHONE_NUMBER_ID"
templateName: "hello_world"
languageCode: "en_US"
bodyParameters: []
status: "queued"
```

The `sendQueuedWhatsAppMessage` Firestore trigger sends the approved template through Meta Cloud API, then changes the queue document to `sent` or `failed`. The Meta access token is never stored in the browser, Firestore, or GitHub.

Use phone numbers in international format with digits only. Templates with variables can provide strings in `bodyParameters` in the same order as the approved template body variables.
