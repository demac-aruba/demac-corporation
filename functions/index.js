const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");

initializeApp();

const db = getFirestore();
const whatsappVerifyToken = defineSecret("WHATSAPP_VERIFY_TOKEN");
const whatsappAccessToken = defineSecret("WHATSAPP_ACCESS_TOKEN");

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


function messageLocation(message) {
  if (message?.type !== 'location' || !message.location) return {};
  return {
    latitude: Number(message.location.latitude),
    longitude: Number(message.location.longitude),
    locationName: message.location.name ?? null,
    locationAddress: message.location.address ?? null,
    locationUrl: message.location.url ?? null,
  };
}

function digitsOnly(value) {

  return String(value ?? "").replace(/\D/g, "");
}

function validateOutboundMessage(data) {
  const to = digitsOnly(data.to);
  const phoneNumberId = digitsOnly(data.phoneNumberId);
  const templateName = String(data.templateName || "hello_world").trim();
  const languageCode = String(data.languageCode || "en_US").trim();
  const bodyParameters = Array.isArray(data.bodyParameters)
    ? data.bodyParameters.map((value) => String(value))
    : [];

  if (!/^\d{8,15}$/.test(to)) {
    throw new Error("The recipient number must contain 8 to 15 digits, including country code.");
  }
  if (!/^\d{5,30}$/.test(phoneNumberId)) {
    throw new Error("A valid Meta phoneNumberId is required.");
  }
  if (!/^[a-z0-9_]{1,512}$/.test(templateName)) {
    throw new Error("The templateName contains unsupported characters.");
  }
  if (!/^[A-Za-z_-]{2,20}$/.test(languageCode)) {
    throw new Error("The languageCode is invalid.");
  }
  if (bodyParameters.length > 20 || bodyParameters.some((value) => value.length > 1024)) {
    throw new Error("Template body parameters exceed the supported limits.");
  }

  return { to, phoneNumberId, templateName, languageCode, bodyParameters };
}

function buildTemplatePayload(message) {
  const template = {
    name: message.templateName,
    language: { code: message.languageCode },
  };

  if (message.bodyParameters.length > 0) {
    template.components = [
      {
        type: "body",
        parameters: message.bodyParameters.map((text) => ({ type: "text", text })),
      },
    ];
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: message.to,
    type: "template",
    template,
  };
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
              ...messageLocation(message),
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

/**
 * Sends approved WhatsApp templates from documents created in
 * whatsappOutboundQueue. The browser never receives the Meta access token.
 */
exports.sendQueuedWhatsAppMessage = onDocumentCreated(
  {
    document: "whatsappOutboundQueue/{queueId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
    secrets: [whatsappAccessToken],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const queueRef = snapshot.ref;
    const original = snapshot.data() ?? {};

    try {
      if (original.status && original.status !== "queued") {
        logger.info("Skipping outbound queue item with non-queued status.", {
          queueId: snapshot.id,
          status: original.status,
        });
        return;
      }

      const message = validateOutboundMessage(original);
      const payload = buildTemplatePayload(message);

      await queueRef.set({
        status: "processing",
        processingStartedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const metaResponse = await fetch(
        `https://graph.facebook.com/v25.0/${message.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${whatsappAccessToken.value()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const responseBody = await metaResponse.json().catch(() => ({}));
      if (!metaResponse.ok) {
        const metaMessage = responseBody?.error?.message || `Meta returned HTTP ${metaResponse.status}`;
        const error = new Error(metaMessage);
        error.code = responseBody?.error?.code || metaResponse.status;
        error.meta = responseBody;
        throw error;
      }

      const messageId = responseBody?.messages?.[0]?.id;
      if (!messageId) {
        throw new Error("Meta accepted the request but did not return a message ID.");
      }

      const outboundRef = db.collection("whatsappMessages").doc(safeDocumentId(messageId));
      const batch = db.batch();

      batch.set(outboundRef, {
        messageId,
        direction: "outbound",
        to: message.to,
        type: "template",
        templateName: message.templateName,
        languageCode: message.languageCode,
        bodyParameters: message.bodyParameters,
        phoneNumberId: message.phoneNumberId,
        status: "accepted",
        queueId: snapshot.id,
        metaResponse: responseBody,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      batch.set(queueRef, {
        status: "sent",
        messageId,
        metaResponse: responseBody,
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      await batch.commit();
      logger.info("Queued WhatsApp template sent.", {
        queueId: snapshot.id,
        messageId,
      });
    } catch (error) {
      logger.error("Could not send queued WhatsApp message.", error);
      await queueRef.set({
        status: "failed",
        errorCode: error?.code ? String(error.code) : null,
        errorMessage: error?.message || "Unknown outbound messaging error",
        failedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  },
);
