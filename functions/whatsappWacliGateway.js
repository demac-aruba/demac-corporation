const crypto = require("node:crypto");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");

const db = getFirestore();
const wacliWebhookSecret = defineSecret("WACLI_WEBHOOK_SECRET");
const wacliBridgeUrl = defineSecret("WACLI_BRIDGE_URL");
const wacliBridgeToken = defineSecret("WACLI_BRIDGE_TOKEN");

const MAX_RECENT_MESSAGES = 120;
const OPERATOR_STALE_MS = 5 * 60 * 1000;

function safeDocumentId(value) {
  return String(value || "unknown")
    .replaceAll("/", "_")
    .replaceAll("#", "_")
    .slice(0, 1200);
}

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function phoneFromChat(chat) {
  const raw = String(chat || "");
  if (!raw.endsWith("@s.whatsapp.net")) return digitsOnly(raw.split("@")[0]);
  return digitsOnly(raw.slice(0, raw.indexOf("@")));
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeEqual(left, right) {
  const first = Buffer.from(String(left || ""));
  const second = Buffer.from(String(right || ""));
  return first.length === second.length && first.length > 0 && crypto.timingSafeEqual(first, second);
}

function verifyWacliSignature(request) {
  const provided = String(request.get("x-wacli-signature") || "").trim();
  const rawBody = request.rawBody instanceof Buffer
    ? request.rawBody
    : Buffer.from(JSON.stringify(request.body ?? {}));
  const digest = crypto.createHmac("sha256", wacliWebhookSecret.value()).update(rawBody).digest("hex");
  return safeEqual(provided, `sha256=${digest}`);
}

function inferQueue(text) {
  const value = String(text || "").toLowerCase();
  if (/\b(complaint|queja|reclamo|mad|angry|molest|problema con servicio)\b/.test(value)) return "complaints";
  if (/\b(payment|invoice|pago|factura|saldo|transfer|deposit)\b/.test(value)) return "finance";
  if (/\b(estimate|quote|cotiza|precio|price|comprar|buy|new airco|aire nuevo)\b/.test(value)) return "sales";
  if (/\b(appointment|cita|schedule|agenda|disponib|mañana|tomorrow|hora)\b/.test(value)) return "scheduling";
  if (/\b(not cooling|no enfria|no enfría|leak|fuga|error|breaker|gas|refrigerant|refrigerante)\b/.test(value)) return "technical";
  return "general";
}

function operatorSupportsQueue(operator, queue) {
  const queues = Array.isArray(operator.queues) ? operator.queues : [];
  return queues.length === 0 || queues.includes("all") || queues.includes(queue) || (queue === "complaints" && queues.includes("general"));
}

async function chooseAvailableOperator(queue) {
  const snapshot = await db.collection("communicationOperatorPresence").get();
  const now = Date.now();
  const candidates = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((operator) => operator.presence === "available")
    .filter((operator) => now - timestampMillis(operator.lastSeenAt) <= OPERATOR_STALE_MS)
    .filter((operator) => operatorSupportsQueue(operator, queue))
    .filter((operator) => !operator.activeVoiceCall)
    .sort((left, right) => Number(left.activeChats || 0) - Number(right.activeChats || 0));
  return candidates[0] ?? null;
}

function normalizeRecentMessage(message) {
  return {
    id: String(message.id || `msg-${Date.now()}`),
    at: normalizeTimestamp(message.at),
    author: String(message.author || "WhatsApp"),
    role: message.role || "customer",
    text: String(message.text || ""),
    channel: "whatsapp",
    status: message.status || null,
    provider: "wacli",
  };
}

function mergeRecentMessages(existing, incoming) {
  const byId = new Map();
  for (const message of Array.isArray(existing) ? existing : []) {
    if (message?.id) byId.set(String(message.id), message);
  }
  const normalized = normalizeRecentMessage(incoming);
  byId.set(normalized.id, { ...(byId.get(normalized.id) || {}), ...normalized });
  return [...byId.values()]
    .sort((left, right) => Date.parse(left.at || 0) - Date.parse(right.at || 0))
    .slice(-MAX_RECENT_MESSAGES);
}

async function appendConversationMessage({ chat, phone, chatName, message, inbound }) {
  const conversationId = safeDocumentId(chat || phone);
  const queue = inferQueue(message.text);
  const routedOperator = inbound ? await chooseAvailableOperator(queue) : null;
  const ref = db.collection("communicationConversations").doc(conversationId);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() : {};
    const recentMessages = mergeRecentMessages(current?.recentMessages, message);
    const hasOwner = Boolean(current?.ownerUserId || current?.owner);
    const owner = !hasOwner && routedOperator ? routedOperator.displayName || routedOperator.name || null : current?.owner || null;
    const ownerUserId = !hasOwner && routedOperator ? routedOperator.id : current?.ownerUserId || null;
    const nextStatus = inbound
      ? (hasOwner || routedOperator ? "assigned" : (current?.status && !["resolved", "closed"].includes(current.status) ? current.status : "new"))
      : (current?.status || "waiting_customer");

    transaction.set(ref, {
      channel: "whatsapp",
      provider: "wacli",
      externalChatId: chat || null,
      chatJid: chat || null,
      phone: phone || current?.phone || null,
      customer: chatName || current?.customer || phone || "WhatsApp contact",
      customerId: current?.customerId || null,
      property: current?.property || null,
      equipment: current?.equipment || null,
      language: current?.language || "unknown",
      queue: current?.queue && current.queue !== "general" ? current.queue : queue,
      status: nextStatus,
      owner,
      ownerUserId,
      routeReason: !hasOwner && routedOperator ? `Auto-routed from ${queue} queue to available operator.` : current?.routeReason || null,
      aiDisposition: current?.aiDisposition || "human_active",
      lockedBy: current?.lockedBy || null,
      lockedByUserId: current?.lockedByUserId || null,
      unread: inbound ? FieldValue.increment(1) : Number(current?.unread || 0),
      lastMessageText: String(message.text || ""),
      lastActivityAt: FieldValue.serverTimestamp(),
      customerTyping: false,
      recentMessages,
      createdAt: current?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return conversationId;
}

async function updateReceipt(payload) {
  const messageIds = Array.isArray(payload.MessageIDs) ? payload.MessageIDs.filter(Boolean) : [];
  if (!messageIds.length) return;
  const status = String(payload.Type || "delivered");
  const chat = String(payload.Chat || "");
  const conversationRef = chat ? db.collection("communicationConversations").doc(safeDocumentId(chat)) : null;

  for (const messageId of messageIds) {
    const messageRef = db.collection("whatsappMessages").doc(safeDocumentId(messageId));
    await messageRef.set({
      messageId,
      provider: "wacli",
      status,
      lastStatusAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const statusRef = db.collection("whatsappMessageStatuses").doc(
      safeDocumentId(`${messageId}-${status}-${payload.Timestamp || Date.now()}`),
    );
    await statusRef.set({
      provider: "wacli",
      messageId,
      chat: chat || null,
      status,
      whatsappTimestamp: payload.Timestamp || null,
      raw: payload,
      receivedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  if (conversationRef) {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(conversationRef);
      if (!snapshot.exists) return;
      const current = snapshot.data() || {};
      const recentMessages = (Array.isArray(current.recentMessages) ? current.recentMessages : []).map((message) => (
        messageIds.includes(String(message?.id)) ? { ...message, status } : message
      ));
      transaction.set(conversationRef, {
        recentMessages,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  }
}

async function updateChatPresence(payload) {
  const chat = String(payload.Chat || "");
  if (!chat) return;
  await db.collection("communicationConversations").doc(safeDocumentId(chat)).set({
    customerTyping: payload.State === "composing",
    typingMedia: payload.Media || null,
    lastPresenceAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Signed inbound webhook for wacli sync --follow.
 * Message payloads omit EventType; receipts and chat presence include it.
 */
exports.wacliWebhook = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
    secrets: [wacliWebhookSecret],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST");
      response.status(405).send("Method not allowed");
      return;
    }
    if (!verifyWacliSignature(request)) {
      logger.warn("Rejected wacli webhook with invalid signature.");
      response.status(401).send("Invalid signature");
      return;
    }

    const payload = request.body ?? {};
    const eventType = String(payload.EventType || "message");
    const eventRef = db.collection("whatsappWebhookEvents").doc();

    try {
      await eventRef.set({
        source: "wacli",
        eventType,
        payload,
        processed: false,
        receivedAt: FieldValue.serverTimestamp(),
      });

      if (eventType === "receipt") {
        await updateReceipt(payload);
      } else if (eventType === "chat_presence") {
        await updateChatPresence(payload);
      } else {
        const chat = String(payload.Chat || "");
        const messageId = String(payload.ID || `${eventRef.id}-${chat || "unknown"}`);
        const fromMe = Boolean(payload.FromMe);
        const phone = phoneFromChat(chat || payload.SenderJID);
        const text = String(payload.Text || "");
        const at = normalizeTimestamp(payload.Timestamp);
        const chatName = String(payload.ChatName || "").trim() || phone || "WhatsApp contact";
        const messageRef = db.collection("whatsappMessages").doc(safeDocumentId(messageId));
        const conversationId = await appendConversationMessage({
          chat,
          phone,
          chatName,
          inbound: !fromMe,
          message: {
            id: messageId,
            at,
            author: fromMe ? "DEMAC WhatsApp" : chatName,
            role: fromMe ? "operator" : "customer",
            text,
            status: fromMe ? "sent" : "received",
          },
        });

        await messageRef.set({
          provider: "wacli",
          messageId,
          conversationId,
          direction: fromMe ? "outbound" : "inbound",
          from: fromMe ? null : phone || null,
          to: fromMe ? phone || null : null,
          chatJid: chat || null,
          contactName: chatName,
          type: "text",
          text,
          status: fromMe ? "sent" : "received",
          whatsappTimestamp: payload.Timestamp || null,
          raw: payload,
          webhookEventId: eventRef.id,
          receivedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      await eventRef.set({ processed: true, processedAt: FieldValue.serverTimestamp() }, { merge: true });
      response.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      logger.error("Could not process wacli webhook event.", error);
      await eventRef.set({
        processed: false,
        errorMessage: error?.message || String(error),
        failedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => undefined);
      response.status(500).send("Webhook processing failed");
    }
  },
);

function validateWacliOutbound(data) {
  const to = String(data.to || "").trim();
  const text = String(data.text || "").trim();
  if (!to || (!/^\+?[0-9() .-]{8,24}$/.test(to) && !/@(s\.whatsapp\.net|lid|g\.us)$/.test(to))) {
    throw new Error("A valid WhatsApp phone number or JID is required.");
  }
  if (!text || text.length > 10000) {
    throw new Error("WhatsApp text must contain between 1 and 10000 characters.");
  }
  return { to, text };
}

function bridgeEndpoint() {
  const base = String(wacliBridgeUrl.value() || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) throw new Error("WACLI_BRIDGE_URL must be an HTTPS URL.");
  return `${base}/v1/send`;
}

/**
 * Processes wacli messages from the same provider-neutral outbound queue used by Meta.
 */
exports.sendQueuedWacliMessage = onDocumentCreated(
  {
    document: "whatsappOutboundQueue/{queueId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
    secrets: [wacliBridgeUrl, wacliBridgeToken],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const queueRef = snapshot.ref;
    const original = snapshot.data() || {};
    if (original.provider !== "wacli") return;
    if (original.status && original.status !== "queued") return;

    try {
      const message = validateWacliOutbound(original);
      await queueRef.set({
        status: "processing",
        processingStartedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const bridgeResponse = await fetch(bridgeEndpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${wacliBridgeToken.value()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: message.to,
          text: message.text,
          clientMessageId: snapshot.id,
        }),
      });
      const responseBody = await bridgeResponse.json().catch(() => ({}));
      if (!bridgeResponse.ok || responseBody?.sent !== true) {
        throw new Error(responseBody?.error || `wacli bridge returned HTTP ${bridgeResponse.status}`);
      }

      const messageId = String(responseBody.messageId || responseBody.id || responseBody.data?.id || snapshot.id);
      const outboundRef = db.collection("whatsappMessages").doc(safeDocumentId(messageId));
      const batch = db.batch();
      batch.set(outboundRef, {
        provider: "wacli",
        messageId,
        conversationId: original.conversationId || null,
        direction: "outbound",
        to: message.to,
        type: "text",
        text: message.text,
        status: "sent",
        queueId: snapshot.id,
        sentByUserId: original.createdByUserId || null,
        sentByName: original.createdByName || "DEMAC",
        bridgeResponse: responseBody,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(queueRef, {
        status: "sent",
        messageId,
        bridgeResponse: responseBody,
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await batch.commit();

      if (original.conversationId) {
        const conversationRef = db.collection("communicationConversations").doc(String(original.conversationId));
        await db.runTransaction(async (transaction) => {
          const conversationSnapshot = await transaction.get(conversationRef);
          const current = conversationSnapshot.exists ? conversationSnapshot.data() : {};
          const recentMessages = mergeRecentMessages(current?.recentMessages, {
            id: messageId,
            at: new Date().toISOString(),
            author: original.createdByName || "DEMAC",
            role: "operator",
            text: message.text,
            status: "sent",
          });
          transaction.set(conversationRef, {
            provider: "wacli",
            channel: "whatsapp",
            status: current?.status === "escalated" ? "escalated" : "waiting_customer",
            unread: 0,
            lastMessageText: message.text,
            lastActivityAt: FieldValue.serverTimestamp(),
            recentMessages,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        });
      }

      logger.info("Queued WhatsApp message sent through wacli.", { queueId: snapshot.id, messageId });
    } catch (error) {
      logger.error("Could not send queued WhatsApp message through wacli.", error);
      await queueRef.set({
        status: "failed",
        errorMessage: error?.message || "Unknown wacli outbound messaging error",
        failedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  },
);

exports.appendCommunicationInternalNote = onDocumentCreated(
  {
    document: "communicationInternalNotes/{noteId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const note = snapshot.data() || {};
    if (!note.conversationId || !note.text) return;
    const conversationRef = db.collection("communicationConversations").doc(String(note.conversationId));
    await db.runTransaction(async (transaction) => {
      const conversationSnapshot = await transaction.get(conversationRef);
      if (!conversationSnapshot.exists) return;
      const current = conversationSnapshot.data() || {};
      const recentMessages = mergeRecentMessages(current.recentMessages, {
        id: snapshot.id,
        at: note.createdAt?.toDate?.().toISOString?.() || new Date().toISOString(),
        author: note.createdByName || "Internal note",
        role: "internal_note",
        text: note.text,
        status: "saved",
      });
      transaction.set(conversationRef, {
        recentMessages,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  },
);
