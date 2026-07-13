const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");

initializeApp();

const db = getFirestore();
const whatsappVerifyToken = defineSecret("WHATSAPP_VERIFY_TOKEN");

function queryValue(value) {
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

function safeDocumentId(value) {
  return String(value || "unknown")
    .replaceAll("/", "_")
    .replaceAll("#", "_")
    .slice(0, 1200);
}

function messageText(message) {
  if (message?.type === "text") return message.text?.body ?? "";
  if (message?.type === "button") return message.button?.text ?? "";
  if (message?.type === "interactive") {
    return message.interactive?.button_reply?.title
      ?? message.interactive?.list_reply?.title
      ?? "";
  }
  return "";
}

/**
 * Meta WhatsApp webhook.
 *
 * GET verifies the endpoint with Meta.
 * POST acknowledges incoming events and stores messages/status updates in
 * Firestore for the next integration phase.
 */
exports.whatsappWebhook = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
    secrets: [whatsappVerifyToken],
  },
  async (request, response) => {
    if (request.method === "GET") {
      const mode = queryValue(request.query["hub.mode"]);
      const token = queryValue(request.query["hub.verify_token"]);
      const challenge = queryValue(request.query["hub.challenge"]);

      if (
        mode === "subscribe"
        && token === whatsappVerifyToken.value()
        && challenge
      ) {
        logger.info("Meta webhook verification completed.");
        response.status(200).send(challenge);
        return;
      }

      logger.warn("Meta webhook verification rejected.", { mode });
      response.status(403).send("Verification failed");
      return;
    }

    if (request.method !== "POST") {
      response.set("Allow", "GET, POST");
      response.status(405).send("Method not allowed");
      return;
    }

    try {
      const payload = request.body ?? {};
      const eventRef = db.collection("whatsappWebhookEvents").doc();
      const batch = db.batch();

      batch.set(eventRef, {
        source: "meta-whatsapp",
        object: payload.object ?? null,
        payload,
        processed: false,
        receivedAt: FieldValue.serverTimestamp(),
      });

      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value ?? {};
          const metadata = value.metadata ?? {};
          const contactByWaId = new Map(
            (value.contacts ?? []).map((contact) => [contact.wa_id, contact]),
          );

          for (const message of value.messages ?? []) {
            const contact = contactByWaId.get(message.from);
            const messageId = safeDocumentId(message.id || `${eventRef.id}-${message.from}`);
            const messageRef = db.collection("whatsappMessages").doc(messageId);

            batch.set(messageRef, {
              messageId: message.id ?? messageId,
              direction: "inbound",
              from: message.from ?? null,
              contactName: contact?.profile?.name ?? null,
              type: message.type ?? "unknown",
              text: messageText(message),
              whatsappTimestamp: message.timestamp ?? null,
              phoneNumberId: metadata.phone_number_id ?? null,
              displayPhoneNumber: metadata.display_phone_number ?? null,
              status: "received",
              raw: message,
              webhookEventId: eventRef.id,
              receivedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }

          for (const status of value.statuses ?? []) {
            const statusId = safeDocumentId(
              `${status.id || eventRef.id}-${status.status || "unknown"}-${status.timestamp || Date.now()}`,
            );
            const statusRef = db.collection("whatsappMessageStatuses").doc(statusId);

            batch.set(statusRef, {
              messageId: status.id ?? null,
              recipientId: status.recipient_id ?? null,
              status: status.status ?? "unknown",
              conversation: status.conversation ?? null,
              pricing: status.pricing ?? null,
              errors: status.errors ?? null,
              whatsappTimestamp: status.timestamp ?? null,
              phoneNumberId: metadata.phone_number_id ?? null,
              webhookEventId: eventRef.id,
              receivedAt: FieldValue.serverTimestamp(),
            });
          }
        }
      }

      await batch.commit();
      logger.info("WhatsApp webhook event stored.", { eventId: eventRef.id });

      // Meta expects a fast 200 response so it does not retry the event.
      response.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      logger.error("Could not process WhatsApp webhook event.", error);
      response.status(500).send("Webhook processing failed");
    }
  },
);
