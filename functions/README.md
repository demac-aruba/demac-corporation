# DEMAC Cloud Functions

This folder contains secure backend integrations that must never run in the browser.

## Secrets

From the repository root:

```bash
firebase functions:secrets:set WHATSAPP_VERIFY_TOKEN
firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN
firebase functions:secrets:set OPENAI_API_KEY
```

- `WHATSAPP_VERIFY_TOKEN` verifies the Meta webhook.
- `WHATSAPP_ACCESS_TOKEN` is the permanent Meta system-user token used only by backend functions.
- `OPENAI_API_KEY` transcribes technician voice notes on the server with `gpt-4o-transcribe`. It is never included in the web or mobile application.

## Deployment

```bash
cd functions
npm install
cd ..
firebase deploy --only functions --project demac-corporation
```

After deployment, Firebase prints the public HTTPS endpoint for `whatsappWebhook`. Paste that URL into Meta's **Callback URL** field.

The `transcribeWorkOrderVoiceNote` Firestore trigger runs automatically after an audio evidence document is created. It downloads the private Storage object, sends it to OpenAI from the backend, and saves the transcript and processing status on `workOrderEvidence`.

The `generateProfessionalCustomerReport` trigger prepares a concise Spanish customer draft when the technician submits an intervention for office review. The `generateProfessionalReportTranslation` trigger runs only after the office approves the Spanish report and explicitly requests English or Papiamento di Aruba. Papiamento output is checked against the official April 2009 vocabulary published by Departamento di Enseñansa Aruba, while operator-approved corrections are supplied as future DEMAC translation examples.

Deploy both report functions with the same `OPENAI_API_KEY` secret:

```bash
firebase deploy --only "functions:generateProfessionalCustomerReport,functions:generateProfessionalReportTranslation" --project demac-corporation
```

The `generateProfessionalCustomerReport` trigger runs when a technician sends an intervention for office review or when the office requests a new draft. It waits briefly for pending voice transcriptions, combines the verified report fields, measurements, findings and add-ons, and saves an editable customer-facing draft on `workInterventions`. The original technical evidence is never replaced.

Appointment `officeNotes` are technician-only instructions. They are deliberately excluded from customer WhatsApp payloads and from the AI context used to create professional customer reports.

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
