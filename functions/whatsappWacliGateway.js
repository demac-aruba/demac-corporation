const crypto = require("node:crypto");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");

const db = getFirestore();
const storage = getStorage();
const wacliBridgeUrl = defineSecret("WACLI_BRIDGE_URL");
const wacliBridgeToken = defineSecret("WACLI_BRIDGE_TOKEN");


const MAX_RECENT_MESSAGES = 120;
const OPERATOR_STALE_MS = 5 * 60 * 1000;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function safeDocumentId(value) {
  return String(value || "unknown")
    .replaceAll("/", "_")
    .replaceAll("#", "_")
    .slice(0, 1200);
}

function safeStorageSegment(value) {
  return String(value || "unknown")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 180) || "unknown";
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

function safeSecretEqual(left, right) {
  const first = Buffer.from(String(left || ""));
  const second = Buffer.from(String(right || ""));
  return first.length === second.length && first.length > 0 && crypto.timingSafeEqual(first, second);
}

function authorizedBridgeRequest(request) {
  const header = String(request.get("authorization") || "");
  if (!header.startsWith("Bearer ")) return false;
  return safeSecretEqual(header.slice(7).trim(), String(wacliBridgeToken.value() || "").trim());
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

function normalizeMedia(payload) {
  const media = payload?.Media;
  if (!media || typeof media !== "object") return null;
  const mediaType = String(media.Type ?? media.type ?? media.kind ?? "").trim().toLowerCase();
  if (!mediaType) return null;
  const mediaSize = Number(media.FileLength ?? media.fileLength ?? media.file_length ?? media.size ?? 0);
  return {
    mediaType,
    mediaCaption: String(media.Caption ?? media.caption ?? "").trim() || null,
    mediaFileName: String(media.Filename ?? media.filename ?? media.fileName ?? "").trim() || null,
    mediaMimeType: String(media.MimeType ?? media.mimeType ?? media.mime_type ?? "").trim() || null,
    mediaSize: Number.isFinite(mediaSize) && mediaSize > 0 ? mediaSize : null,
    mediaUrl: media.mediaUrl ?? media.url ?? null,
  };
}

function normalizeProfilePicture(payload) {
  const value = payload?.ProfilePicture;
  if (!value || typeof value !== "object") return null;
  const sourceUrl = String(value.sourceUrl || value.url || "").trim();
  if (!/^https:\/\//i.test(sourceUrl)) return null;
  return {
    sourceUrl,
    updatedAt: normalizeTimestamp(value.updatedAt),
  };
}

function mediaPreview(media) {
  const type = String(media?.mediaType || "media").toLowerCase();
  const label = type === "image" ? "Photo"
    : type === "sticker" ? "Sticker"
      : type === "audio" || type === "voice" ? "Audio"
        : type === "video" || type === "gif" ? "Video"
          : type === "document" ? "Document"
            : "Media";
  return `[${label}]`;
}

function extensionFromMedia(media) {
  const name = String(media?.mediaFileName || "");
  const match = name.match(/(\.[A-Za-z0-9]{1,8})$/);
  if (match) return match[1].toLowerCase();
  const mime = String(media?.mediaMimeType || "").toLowerCase();
  if (mime.includes("jpeg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mpeg")) return ".mp3";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("pdf")) return ".pdf";
  return "";
}

function bridgeEndpoint(pathname) {
  const base = String(wacliBridgeUrl.value() || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) throw new Error("WACLI_BRIDGE_URL must be an HTTPS URL.");
  return `${base}${pathname}`;
}

async function fetchAndStoreWacliMedia({ chat, messageId, media }) {
  if (!media || media.mediaUrl || !chat || !messageId) return media;
  const token = String(wacliBridgeToken.value() || "").trim();
  if (!token) throw new Error("WACLI_BRIDGE_TOKEN is not configured.");

  const response = await fetch(bridgeEndpoint("/v1/media"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat,
      messageId,
      fileName: media.mediaFileName,
      mimeType: media.mediaMimeType,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`wacli bridge media fetch failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const lengthHeader = Number(response.headers.get("content-length") || 0);
  if (lengthHeader > MAX_MEDIA_BYTES) throw new Error("WhatsApp media exceeds the configured maximum size.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("wacli bridge returned an empty media file.");
  if (bytes.length > MAX_MEDIA_BYTES) throw new Error("WhatsApp media exceeds the configured maximum size.");

  const bucket = storage.bucket();
  const extension = extensionFromMedia(media);
  const storagePath = `communication-media/wacli/${safeStorageSegment(chat)}/${safeStorageSegment(messageId)}${extension}`;
  const downloadToken = crypto.randomUUID();
  const contentType = media.mediaMimeType || response.headers.get("content-type") || "application/octet-stream";
  await bucket.file(storagePath).save(bytes, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: "private, max-age=3600",
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  });

  const mediaUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(downloadToken)}`;
  return { ...media, mediaMimeType: contentType, mediaSize: bytes.length, mediaUrl };
}

async function fetchAndStoreProfilePicture({ chat, profilePicture }) {
  if (!chat || !profilePicture?.sourceUrl) return null;
  const conversationRef = db.collection("communicationConversations").doc(safeDocumentId(chat));
  const currentSnapshot = await conversationRef.get();
  const current = currentSnapshot.exists ? currentSnapshot.data() : {};
  if (current?.profilePictureSourceUrl === profilePicture.sourceUrl && current?.profilePictureUrl) {
    return {
      profilePictureUrl: current.profilePictureUrl,
      profilePictureSourceUrl: current.profilePictureSourceUrl,
      profilePictureUpdatedAt: current.profilePictureUpdatedAt || profilePicture.updatedAt,
    };
  }

  const response = await fetch(profilePicture.sourceUrl, {
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`WhatsApp profile picture returned HTTP ${response.status}`);
  const lengthHeader = Number(response.headers.get("content-length") || 0);
  if (lengthHeader > MAX_AVATAR_BYTES) throw new Error("WhatsApp profile picture exceeds the configured maximum size.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("WhatsApp profile picture was empty.");
  if (bytes.length > MAX_AVATAR_BYTES) throw new Error("WhatsApp profile picture exceeds the configured maximum size.");

  const bucket = storage.bucket();
  const storagePath = `communication-avatars/wacli/${safeStorageSegment(chat)}`;
  const downloadToken = crypto.randomUUID();
  const contentType = response.headers.get("content-type") || "image/jpeg";
  await bucket.file(storagePath).save(bytes, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: "private, max-age=86400",
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  });
  const profilePictureUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(downloadToken)}`;
  return {
    profilePictureUrl,
    profilePictureSourceUrl: profilePicture.sourceUrl,
    profilePictureUpdatedAt: profilePicture.updatedAt,
  };
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
    mediaType: message.mediaType || null,
    mediaCaption: message.mediaCaption || null,
    mediaFileName: message.mediaFileName || null,
    mediaMimeType: message.mediaMimeType || null,
    mediaSize: Number(message.mediaSize || 0) || null,
    mediaUrl: message.mediaUrl || null,
    reactionToId: message.reactionToId || null,
    reactionEmoji: message.reactionEmoji || null,
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

async function appendConversationMessage({ chat, phone, chatName, message, inbound, profilePicture }) {
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
    const lastMessageText = String(message.text || message.mediaCaption || message.reactionEmoji || (message.mediaType ? mediaPreview(message) : ""));

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
      lastMessageText,
      lastActivityAt: FieldValue.serverTimestamp(),
      customerTyping: false,
      recentMessages,
      ...(profilePicture || {}),
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

exports.wacliWebhook = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 120,
    secrets: [wacliBridgeUrl, wacliBridgeToken],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST");
      response.status(405).send("Method not allowed");
      return;
    }
    if (!authorizedBridgeRequest(request)) {
      logger.warn("Rejected DEMAC bridge webhook with invalid bearer token.");
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    const payload = request.body ?? {};
    const eventType = String(payload.EventType || "message");
    const eventRef = db.collection("whatsappWebhookEvents").doc();

    try {
      if (eventType === "receipt") {
        await updateReceipt(payload);
      } else if (eventType === "chat_presence") {
        await updateChatPresence(payload);
      } else {
        const chat = String(payload.Chat || "");
        const messageId = String(payload.ID || `${eventRef.id}-${Date.now()}`);
        const inbound = payload.IsFromMe !== true;
        const chatName = String(payload.ChatName || payload.SenderName || "").trim();
        const resolvedPhone = digitsOnly(payload?.ResolvedPhone || payload?.Identity?.ResolvedPhone || "");
        const phone = resolvedPhone || phoneFromChat(chat);

        let media = normalizeMedia(payload);
        if (media) {
          try {
            media = await fetchAndStoreWacliMedia({ chat, messageId, media });
          } catch (error) {
            logger.error("Could not fetch/store wacli media; preserving message metadata.", error);
          }
        }

        let profilePicture = null;
        const profilePictureMeta = normalizeProfilePicture(payload);
        if (profilePictureMeta) {
          try {
            profilePicture = await fetchAndStoreProfilePicture({ chat, profilePicture: profilePictureMeta });
          } catch (error) {
            logger.warn("Could not persist WhatsApp profile picture; message processing continues.", {
              chat,
              errorMessage: error?.message || String(error),
            });
          }
        }

        const text = String(payload.Text || payload.Caption || media?.mediaCaption || (media ? mediaPreview(media) : ""));
        const reactionEmoji = String(payload.ReactionEmoji || "").trim() || null;
        const reactionToId = String(payload.ReactionToID || "").trim() || null;

        await db.collection("whatsappMessages").doc(safeDocumentId(messageId)).set({
          provider: "wacli",
          channel: "whatsapp",
          messageId,
          chat,
          chatName: chatName || null,
          phone: phone || null,
          senderJid: payload.SenderJID || null,
          senderName: payload.SenderName || null,
          direction: inbound ? "inbound" : "outbound",
          type: reactionEmoji ? "reaction" : (media?.mediaType || "text"),
          text,
          reactionEmoji,
          reactionToId,
          mediaType: media?.mediaType || null,
          mediaCaption: media?.mediaCaption || null,
          mediaFileName: media?.mediaFileName || null,
          mediaMimeType: media?.mediaMimeType || null,
          mediaSize: media?.mediaSize || null,
          mediaUrl: media?.mediaUrl || null,
          whatsappTimestamp: payload.Timestamp || null,
          status: inbound ? "received" : "sent",
          raw: payload,
          webhookEventId: eventRef.id,
          receivedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        await appendConversationMessage({
          chat,
          phone,
          chatName,
          inbound,
          profilePicture,
          message: {
            id: messageId,
            at: payload.Timestamp,
            author: inbound ? (chatName || phone || "Customer") : "DEMAC",
            role: inbound ? "customer" : "operator",
            text,
            status: inbound ? "received" : "sent",
            mediaType: media?.mediaType || null,
            mediaCaption: media?.mediaCaption || null,
            mediaFileName: media?.mediaFileName || null,
            mediaMimeType: media?.mediaMimeType || null,
            mediaSize: media?.mediaSize || null,
            mediaUrl: media?.mediaUrl || null,
            reactionEmoji,
            reactionToId,
          },
        });
      }

      await eventRef.set({
        source: "wacli",
        eventType,
        processed: true,
        auth: "bridge-bearer-v1",
        receivedAt: FieldValue.serverTimestamp(),
      });
      response.status(200).json({ ok: true });
    } catch (error) {
      logger.error("Could not process wacli webhook event.", error);
      await eventRef.set({
        source: "wacli",
        eventType,
        processed: false,
        errorMessage: error?.message || "Unknown wacli webhook error",
        receivedAt: FieldValue.serverTimestamp(),
      }).catch(() => {});
      response.status(500).send("Webhook processing failed");
    }
  },
);

function parseBridgeResponse(response) {
  return response.json().catch(() => ({}));
}

exports.sendQueuedWacliMessage = onDocumentCreated(
  {
    document: "whatsappOutboundQueue/{queueId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 120,
    secrets: [wacliBridgeUrl, wacliBridgeToken],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const original = snapshot.data() || {};
    if (original.provider !== "wacli") return;
    if (original.status && original.status !== "queued") return;

    const queueRef = snapshot.ref;
    const to = String(original.to || original.phone || original.recipient || "").trim();
    const text = String(original.text || "");
    const media = original.media && typeof original.media === "object" ? original.media : null;
    if (!to || (!text.trim() && !media)) {
      await queueRef.set({ status: "failed", errorMessage: "Recipient and text or media are required.", failedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    try {
      await queueRef.set({ status: "processing", processingStartedAt: FieldValue.serverTimestamp() }, { merge: true });
      const response = await fetch(bridgeEndpoint("/v1/send"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${wacliBridgeToken.value()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to,
          text,
          media,
          clientMessageId: snapshot.id,
        }),
        signal: AbortSignal.timeout(120000),
      });
      const responseBody = await parseBridgeResponse(response);
      if (!response.ok || responseBody.sent !== true) {
        throw new Error(responseBody?.error || `Bridge returned HTTP ${response.status}`);
      }

      const messageId = responseBody.messageId || snapshot.id;
      const messageRef = db.collection("whatsappMessages").doc(safeDocumentId(messageId));
      const batch = db.batch();
      batch.set(messageRef, {
        provider: "wacli",
        channel: "whatsapp",
        messageId,
        direction: "outbound",
        to,
        type: media?.kind || media?.type || "text",
        text,
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
            text,
            status: "sent",
          });
          transaction.set(conversationRef, {
            provider: "wacli",
            channel: "whatsapp",
            status: current?.status === "escalated" ? "escalated" : "waiting_customer",
            unread: 0,
            lastMessageText: text,
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
