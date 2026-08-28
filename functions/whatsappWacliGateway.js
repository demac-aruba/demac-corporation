const crypto = require("node:crypto");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const {
  assignedCustomerInputVersion,
  safeEpoch,
  wacliCanonicalIdentity,
  wacliCanonicalStatusId,
  wacliCommunicationAccountDecision,
  wacliOutboundClaimDecision,
} = require("./wacliCommunicationBoundary");

const db = getFirestore();
const storage = getStorage();
const wacliBridgeToken = defineSecret("WACLI_BRIDGE_TOKEN");

const MAX_RECENT_MESSAGES = 120;
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

function httpError(statusCode, message, code = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

async function requireBoundCommunicationAccount(request) {
  const snapshot = await db.collection("businessSettings").doc("whatsapp").get();
  const settings = snapshot.exists ? snapshot.data() || {} : {};
  const decision = wacliCommunicationAccountDecision({ request, settings });
  if (decision.allowed) return decision.assertedAccountId;
  const statusCode = decision.reason === "communication-account-not-configured" ? 503 : 403;
  throw httpError(statusCode, `Wacli communication account rejected: ${decision.reason}.`, decision.reason);
}

function conversationIngressState({ current = {}, exists = false, inbound = false } = {}) {
  const owner = current?.owner || null;
  const ownerUserId = current?.ownerUserId || null;
  const lockedBy = current?.lockedBy || null;
  const lockedByUserId = current?.lockedByUserId || null;
  const explicitDisposition = String(current?.aiDisposition || "").trim();
  const humanOwned = Boolean(owner || ownerUserId || lockedBy || lockedByUserId) || explicitDisposition === "human_active";
  const queue = exists && String(current?.queue || "").trim() ? current.queue : "general";
  const aiDisposition = humanOwned
    ? "human_active"
    : explicitDisposition || (inbound ? "ai_active" : "human_active");
  const status = inbound
    ? (current?.status && !["resolved", "closed"].includes(current.status) ? current.status : (humanOwned ? "assigned" : "new"))
    : (current?.status || "waiting_customer");

  return {
    queue,
    status,
    owner,
    ownerUserId,
    routeReason: current?.routeReason || null,
    aiDisposition,
    lockedBy,
    lockedByUserId,
  };
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

async function fetchAndStoreProfilePicture({ communicationAccountId, conversationId, profilePicture }) {
  if (!communicationAccountId || !conversationId || !profilePicture?.sourceUrl) return null;
  const conversationRef = db.collection("communicationConversations").doc(conversationId);
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
  const storagePath = `communication-avatars/wacli/${safeStorageSegment(communicationAccountId)}/${safeStorageSegment(conversationId)}`;
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
    providerMessageId: message.providerMessageId || null,
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
    customerInputVersion: Number.isSafeInteger(Number(message.customerInputVersion))
      ? Number(message.customerInputVersion)
      : null,
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

function existingMessageMatchesIdentity(existing = {}, identity = {}, providerMessageId = "") {
  return String(existing.communicationAccountId || "").trim().toLowerCase() === String(identity.communicationAccountId || "").trim().toLowerCase()
    && String(existing.conversationId || "") === String(identity.conversationId || "")
    && String(existing.providerMessageId || existing.remoteMessageId || "") === String(providerMessageId || "");
}

async function persistCanonicalMessage({
  communicationAccountId,
  payload,
  providerMessageId,
  chat,
  phone,
  chatName,
  inbound,
  profilePicture,
  media,
  text,
  reactionEmoji,
  reactionToId,
  webhookEventId,
}) {
  const identity = wacliCanonicalIdentity({ communicationAccountId, chat, providerMessageId });
  if (!identity.conversationId || !identity.messageId) {
    throw httpError(400, "Canonical Wacli conversation/message identity is incomplete.", "invalid-canonical-identity");
  }
  const messageRef = db.collection("whatsappMessages").doc(identity.messageId);
  const conversationRef = db.collection("communicationConversations").doc(identity.conversationId);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (transaction) => {
    const [messageSnapshot, conversationSnapshot] = await Promise.all([
      transaction.get(messageRef),
      transaction.get(conversationRef),
    ]);
    if (messageSnapshot.exists) {
      const existingMessage = messageSnapshot.data() || {};
      if (!existingMessageMatchesIdentity(existingMessage, { ...identity, communicationAccountId }, providerMessageId)) {
        throw httpError(409, "Canonical provider message identity conflicts with an existing record.", "provider-message-identity-conflict");
      }
      return {
        conversationId: identity.conversationId,
        messageId: identity.messageId,
        providerMessageId,
        customerInputVersion: Number.isSafeInteger(Number(existingMessage.customerInputVersion))
          ? Number(existingMessage.customerInputVersion)
          : null,
        replayed: true,
      };
    }

    const current = conversationSnapshot.exists ? conversationSnapshot.data() || {} : {};
    const customerInputVersion = assignedCustomerInputVersion({
      currentConversation: current,
      existingMessage: {},
      inbound,
      messageExists: false,
    });
    const recentMessages = mergeRecentMessages(current.recentMessages, {
      id: identity.messageId,
      providerMessageId,
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
      customerInputVersion,
    });
    const ingress = conversationIngressState({ current, exists: conversationSnapshot.exists, inbound });
    const lastMessageText = String(text || media?.mediaCaption || reactionEmoji || (media ? mediaPreview(media) : ""));
    const unread = inbound ? Number(current.unread || 0) + 1 : Number(current.unread || 0);
    const conversationInputVersion = inbound
      ? Math.max(safeEpoch(current.customerInputVersion), Number(customerInputVersion || 0))
      : safeEpoch(current.customerInputVersion);

    transaction.set(messageRef, {
      provider: "wacli",
      channel: "whatsapp",
      messageId: identity.messageId,
      providerMessageId,
      remoteMessageId: providerMessageId,
      conversationId: identity.conversationId,
      communicationAccountId,
      remoteConversationId: identity.remoteConversationId,
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
      customerInputVersion,
      status: inbound ? "received" : "sent",
      raw: payload,
      webhookEventId,
      receivedAt: FieldValue.serverTimestamp(),
      firstReceivedAt: FieldValue.serverTimestamp(),
      firstIngestedAtIso: nowIso,
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(conversationRef, {
      channel: "whatsapp",
      provider: "wacli",
      communicationAccountId,
      conversationId: identity.conversationId,
      remoteConversationId: identity.remoteConversationId,
      externalChatId: chat || null,
      chatJid: chat || null,
      phone: phone || current.phone || null,
      customer: chatName || current.customer || phone || "WhatsApp contact",
      customerId: current.customerId || null,
      property: current.property || null,
      equipment: current.equipment || null,
      language: current.language || "unknown",
      queue: ingress.queue,
      status: ingress.status,
      owner: ingress.owner,
      ownerUserId: ingress.ownerUserId,
      routeReason: ingress.routeReason,
      aiDisposition: ingress.aiDisposition,
      lockedBy: ingress.lockedBy,
      lockedByUserId: ingress.lockedByUserId,
      ownershipVersion: safeEpoch(current.ownershipVersion),
      customerInputVersion: conversationInputVersion,
      unread,
      lastMessageText,
      lastActivityAt: FieldValue.serverTimestamp(),
      customerTyping: false,
      recentMessages,
      ...(profilePicture || {}),
      createdAt: current.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      conversationId: identity.conversationId,
      messageId: identity.messageId,
      providerMessageId,
      customerInputVersion,
      replayed: false,
    };
  });
}

async function updateReceipt(communicationAccountId, payload) {
  const providerMessageIds = Array.isArray(payload.MessageIDs) ? payload.MessageIDs.filter(Boolean) : [];
  if (!providerMessageIds.length) return;
  const status = String(payload.Type || "delivered");
  const chat = String(payload.Chat || "").trim();
  if (!chat) throw httpError(400, "Receipt Chat is required for account-scoped message identity.", "receipt-chat-missing");
  const conversationIdentity = wacliCanonicalIdentity({ communicationAccountId, chat });
  if (!conversationIdentity.conversationId) throw httpError(400, "Receipt conversation identity is invalid.");
  const conversationRef = db.collection("communicationConversations").doc(conversationIdentity.conversationId);
  const canonicalMessageIds = [];

  for (const providerMessageId of providerMessageIds) {
    const identity = wacliCanonicalIdentity({ communicationAccountId, chat, providerMessageId });
    if (!identity.messageId) continue;
    canonicalMessageIds.push(identity.messageId);
    const messageRef = db.collection("whatsappMessages").doc(identity.messageId);
    const messageSnapshot = await messageRef.get();
    if (messageSnapshot.exists) {
      await messageRef.set({
        communicationAccountId,
        conversationId: identity.conversationId,
        remoteConversationId: identity.remoteConversationId,
        providerMessageId,
        status,
        lastStatusAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    const statusId = wacliCanonicalStatusId({
      communicationAccountId,
      chat,
      providerMessageId,
      status,
      providerTimestamp: payload.Timestamp,
    });
    if (!statusId) continue;
    await db.collection("whatsappMessageStatuses").doc(statusId).set({
      provider: "wacli",
      channel: "whatsapp",
      communicationAccountId,
      conversationId: identity.conversationId,
      messageId: identity.messageId,
      providerMessageId,
      remoteConversationId: identity.remoteConversationId,
      chat,
      status,
      whatsappTimestamp: payload.Timestamp || null,
      raw: payload,
      receivedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  if (canonicalMessageIds.length) {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(conversationRef);
      if (!snapshot.exists) return;
      const current = snapshot.data() || {};
      const recentMessages = (Array.isArray(current.recentMessages) ? current.recentMessages : []).map((message) => (
        canonicalMessageIds.includes(String(message?.id)) ? { ...message, status } : message
      ));
      transaction.set(conversationRef, {
        recentMessages,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  }
}

async function updateChatPresence(communicationAccountId, payload) {
  const chat = String(payload.Chat || "").trim();
  if (!chat) return;
  const identity = wacliCanonicalIdentity({ communicationAccountId, chat });
  if (!identity.conversationId) return;
  const ref = db.collection("communicationConversations").doc(identity.conversationId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return;
  await ref.set({
    customerTyping: payload.State === "composing",
    typingMedia: payload.Media || null,
    lastPresenceAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

exports.wacliWebhook = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 120,
    secrets: [wacliBridgeToken],
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

    let eventRef = null;
    try {
      const communicationAccountId = await requireBoundCommunicationAccount(request);
      const payload = request.body ?? {};
      const eventType = String(payload.EventType || "message");
      eventRef = db.collection("whatsappWebhookEvents").doc();

      if (eventType === "receipt") {
        await updateReceipt(communicationAccountId, payload);
      } else if (eventType === "chat_presence") {
        await updateChatPresence(communicationAccountId, payload);
      } else {
        const chat = String(payload.Chat || "").trim();
        const providerMessageId = String(payload.ID || "").trim();
        if (!chat || !providerMessageId) {
          throw httpError(400, "Wacli message events require Chat and provider message ID.", "message-identity-missing");
        }
        const inbound = payload.FromMe === false;
        const chatName = String(payload.ChatName || payload.SenderName || "").trim();
        const resolvedPhone = digitsOnly(payload?.ResolvedPhone || payload?.Identity?.ResolvedPhone || "");
        const phone = resolvedPhone || phoneFromChat(chat);
        const media = normalizeMedia(payload);
        const identity = wacliCanonicalIdentity({ communicationAccountId, chat, providerMessageId });
        if (!identity.conversationId || !identity.messageId) throw httpError(400, "Wacli message identity is invalid.");

        let profilePicture = null;
        const profilePictureMeta = normalizeProfilePicture(payload);
        if (profilePictureMeta) {
          try {
            profilePicture = await fetchAndStoreProfilePicture({
              communicationAccountId,
              conversationId: identity.conversationId,
              profilePicture: profilePictureMeta,
            });
          } catch (error) {
            logger.warn("Could not persist WhatsApp profile picture; message processing continues.", {
              communicationAccountId,
              conversationId: identity.conversationId,
              errorMessage: error?.message || String(error),
            });
          }
        }

        const text = String(payload.Text || payload.Caption || media?.mediaCaption || (media ? mediaPreview(media) : ""));
        const reactionEmoji = String(payload.ReactionEmoji || "").trim() || null;
        const reactionToId = String(payload.ReactionToID || "").trim() || null;
        await persistCanonicalMessage({
          communicationAccountId,
          payload,
          providerMessageId,
          chat,
          phone,
          chatName,
          inbound,
          profilePicture,
          media,
          text,
          reactionEmoji,
          reactionToId,
          webhookEventId: eventRef.id,
        });
      }

      await eventRef.set({
        source: "wacli",
        provider: "wacli",
        channel: "whatsapp",
        communicationAccountId,
        eventType,
        processed: true,
        auth: "bridge-bearer-account-bound-v1",
        receivedAt: FieldValue.serverTimestamp(),
      });
      response.status(200).json({ ok: true });
    } catch (error) {
      logger.error("Could not process wacli webhook event.", error);
      if (eventRef) {
        await eventRef.set({
          source: "wacli",
          processed: false,
          errorCode: error?.code || null,
          errorMessage: error?.message || "Unknown wacli webhook error",
          receivedAt: FieldValue.serverTimestamp(),
        }).catch(() => {});
      }
      const status = Number(error?.statusCode || 500);
      response.status(status).json({ error: error?.message || "Webhook processing failed", code: error?.code || null });
    }
  },
);

function requestRawBody(request) {
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (Buffer.isBuffer(request.body)) return request.body;
  return Buffer.alloc(0);
}

function outboundMediaKind(media) {
  return String(media?.kind || media?.type || "text").trim().toLowerCase() || "text";
}

function outboundPreview(text, media) {
  if (String(text || "").trim()) return String(text);
  const kind = outboundMediaKind(media);
  return mediaPreview({ mediaType: kind });
}

exports.wacliMediaIngest = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    secrets: [wacliBridgeToken],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST");
      response.status(405).send("Method not allowed");
      return;
    }
    if (!authorizedBridgeRequest(request)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const communicationAccountId = await requireBoundCommunicationAccount(request);
      const chat = String(request.query.chat || "").trim();
      const providerMessageId = String(request.query.messageId || "").trim();
      const fileName = String(request.query.fileName || "").trim();
      const mediaType = String(request.query.mediaType || "").trim().toLowerCase();
      if (!chat || !providerMessageId) throw httpError(400, "chat and messageId are required.");
      if (chat.length > 220 || providerMessageId.length > 240 || fileName.length > 240) throw httpError(400, "Media metadata is too long.");

      const bytes = requestRawBody(request);
      if (!bytes.length) throw httpError(400, "Media body is empty.");
      if (bytes.length > MAX_MEDIA_BYTES) throw httpError(413, "WhatsApp media exceeds the configured maximum size.");

      const identity = wacliCanonicalIdentity({ communicationAccountId, chat, providerMessageId });
      if (!identity.conversationId || !identity.messageId) throw httpError(400, "Media canonical identity is invalid.");
      const contentType = String(request.get("content-type") || "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
      const extension = extensionFromMedia({ mediaFileName: fileName, mediaMimeType: contentType });
      const bucket = storage.bucket();
      const storagePath = `communication-media/wacli/${safeStorageSegment(communicationAccountId)}/${safeStorageSegment(identity.conversationId)}/${safeStorageSegment(identity.messageId)}${extension}`;
      const downloadToken = crypto.randomUUID();
      await bucket.file(storagePath).save(bytes, {
        resumable: false,
        metadata: {
          contentType,
          cacheControl: "private, max-age=3600",
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      });
      const mediaUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(downloadToken)}`;
      response.status(200).json({
        ok: true,
        communicationAccountId,
        conversationId: identity.conversationId,
        messageId: identity.messageId,
        providerMessageId,
        mediaUrl,
        mediaType: mediaType || null,
        mediaMimeType: contentType,
        mediaSize: bytes.length,
      });
    } catch (error) {
      logger.error("Could not ingest wacli media.", error);
      response.status(error?.statusCode || 500).json({ error: error?.message || "Media ingest failed", code: error?.code || null });
    }
  },
);

function outboundQueueAccountMatches(queueItem = {}, communicationAccountId = "") {
  return String(queueItem.communicationAccountId || "").trim().toLowerCase() === String(communicationAccountId || "").trim().toLowerCase();
}

async function claimOutboundCommandWithDb(database, bridgeId, communicationAccountId, now = Date.now()) {
  const snapshot = await database.collection("whatsappOutboundQueue")
    .where("communicationAccountId", "==", communicationAccountId)
    .get();
  const candidates = snapshot.docs
    .filter((doc) => String(doc.data()?.provider || "") === "wacli")
    .filter((doc) => ["queued", "processing"].includes(String(doc.data()?.status || "queued")))
    .filter((doc) => {
      const data = doc.data() || {};
      return data.status === "queued" || timestampMillis(data.leaseUntil) <= now;
    })
    .sort((left, right) => {
      const delta = timestampMillis(left.data()?.createdAt) - timestampMillis(right.data()?.createdAt);
      return delta || left.id.localeCompare(right.id);
    });

  for (const candidate of candidates) {
    const command = await database.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(candidate.ref);
      if (!currentSnapshot.exists) return null;
      const current = currentSnapshot.data() || {};
      if (current.provider !== "wacli") return null;
      if (!outboundQueueAccountMatches(current, communicationAccountId)) return null;
      if (!["queued", "processing"].includes(current.status || "queued")) return null;
      if (current.status === "processing" && timestampMillis(current.leaseUntil) > now) return null;

      let conversation = null;
      if (String(current.outboundClass || "").trim().toLowerCase() !== "transactional") {
        const conversationId = String(current.conversationId || "").trim();
        if (conversationId && !conversationId.includes("/")) {
          const conversationSnapshot = await transaction.get(database.collection("communicationConversations").doc(conversationId));
          conversation = conversationSnapshot.exists ? conversationSnapshot.data() || {} : null;
        }
      }
      const authorization = wacliOutboundClaimDecision({
        queueItem: current,
        conversation,
        communicationAccountId,
      });
      if (!authorization.allowed) {
        transaction.set(candidate.ref, {
          status: "failed",
          errorCode: "outbound_authorization_failed",
          authorizationReason: authorization.reason,
          authorizationEpochReason: authorization.epochReason || null,
          errorMessage: `Outbound command blocked before provider delivery: ${authorization.reason}.`,
          failedAt: FieldValue.serverTimestamp(),
          claimToken: null,
          leaseUntil: null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return null;
      }

      const to = String(current.to || current.phone || current.recipient || "").trim();
      const text = String(current.text || "");
      const media = current.media && typeof current.media === "object" ? current.media : null;
      if (!to || (!text.trim() && !media)) {
        transaction.set(candidate.ref, {
          status: "failed",
          errorCode: "invalid_outbound_command",
          errorMessage: "Outbound command has no recipient or customer-visible content.",
          failedAt: FieldValue.serverTimestamp(),
          claimToken: null,
          leaseUntil: null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return null;
      }

      const claimToken = crypto.randomUUID();
      const leaseUntil = Timestamp.fromMillis(now + 3 * 60 * 1000);
      transaction.set(candidate.ref, {
        status: "processing",
        claimToken,
        claimedBy: bridgeId || "demac-wacli-bridge",
        claimedCommunicationAccountId: communicationAccountId,
        claimedAt: FieldValue.serverTimestamp(),
        processingStartedAt: current.processingStartedAt || FieldValue.serverTimestamp(),
        leaseUntil,
        attempts: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return {
        queueId: candidate.id,
        claimToken,
        communicationAccountId,
        to,
        text,
        media,
      };
    });
    if (command) return command;
  }
  return null;
}

async function claimOutboundCommand(bridgeId, communicationAccountId) {
  return claimOutboundCommandWithDb(db, bridgeId, communicationAccountId);
}

exports.wacliOutboundPoll = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    secrets: [wacliBridgeToken],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST");
      response.status(405).send("Method not allowed");
      return;
    }
    if (!authorizedBridgeRequest(request)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const communicationAccountId = await requireBoundCommunicationAccount(request);
      const bridgeId = String(request.body?.bridgeId || "demac-wacli-bridge").trim().slice(0, 120);
      const command = await claimOutboundCommand(bridgeId, communicationAccountId);
      response.status(200).json({ ok: true, command });
    } catch (error) {
      logger.error("Could not poll wacli outbound queue.", error);
      response.status(error?.statusCode || 500).json({ error: error?.message || "Outbound poll failed", code: error?.code || null });
    }
  },
);

exports.wacliOutboundAck = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
    secrets: [wacliBridgeToken],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST");
      response.status(405).send("Method not allowed");
      return;
    }
    if (!authorizedBridgeRequest(request)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const communicationAccountId = await requireBoundCommunicationAccount(request);
      const queueId = String(request.body?.queueId || "").trim();
      const claimToken = String(request.body?.claimToken || "").trim();
      const sent = request.body?.sent === true;
      const reportedProviderMessageId = String(request.body?.messageId || "").trim();
      const storeWarning = String(request.body?.storeWarning || "").trim().slice(0, 1000) || null;
      const errorMessage = String(request.body?.error || "WhatsApp send failed").trim().slice(0, 1500);
      if (!queueId || !claimToken || queueId.includes("/")) throw httpError(400, "queueId and claimToken are required.");

      const queueRef = db.collection("whatsappOutboundQueue").doc(queueId);
      let ackResult = null;
      await db.runTransaction(async (transaction) => {
        const queueSnapshot = await transaction.get(queueRef);
        if (!queueSnapshot.exists) throw httpError(404, "Outbound queue item not found.");
        const current = queueSnapshot.data() || {};
        if (!outboundQueueAccountMatches(current, communicationAccountId)) {
          throw httpError(409, "Outbound queue item belongs to another communication account.", "communication-account-mismatch");
        }

        if (current.status === "sent" && sent) {
          ackResult = { alreadyAcknowledged: true, messageId: current.messageId || reportedProviderMessageId || queueId };
          return;
        }
        if (current.status !== "processing" || current.claimToken !== claimToken) {
          throw httpError(409, "Outbound queue claim is no longer active.");
        }
        if (String(current.claimedCommunicationAccountId || "").trim().toLowerCase() !== communicationAccountId) {
          throw httpError(409, "Outbound queue claim account no longer matches the bridge account.", "claim-account-mismatch");
        }

        if (!sent) {
          transaction.set(queueRef, {
            status: "failed",
            errorMessage,
            failedAt: FieldValue.serverTimestamp(),
            claimToken: null,
            leaseUntil: null,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          ackResult = { sent: false };
          return;
        }

        const providerMessageId = reportedProviderMessageId || queueId;
        const media = current.media && typeof current.media === "object" ? current.media : null;
        const text = String(current.text || "");
        let conversationRef = null;
        let conversationCurrent = null;
        if (current.conversationId) {
          conversationRef = db.collection("communicationConversations").doc(String(current.conversationId));
          const conversationSnapshot = await transaction.get(conversationRef);
          conversationCurrent = conversationSnapshot.exists ? conversationSnapshot.data() || {} : {};
          if (conversationSnapshot.exists && String(conversationCurrent.communicationAccountId || "").trim().toLowerCase() !== communicationAccountId) {
            throw httpError(409, "Conversation belongs to another communication account.", "conversation-account-mismatch");
          }
        }
        const remoteConversationId = String(
          conversationCurrent?.remoteConversationId
            || conversationCurrent?.chatJid
            || conversationCurrent?.externalChatId
            || current.to
            || current.phone
            || current.recipient
            || "",
        ).trim();
        const identity = wacliCanonicalIdentity({
          communicationAccountId,
          chat: remoteConversationId,
          providerMessageId,
        });
        if (!identity.messageId) throw httpError(409, "Outbound acknowledgement has no canonical message identity.");
        const messageRef = db.collection("whatsappMessages").doc(identity.messageId);

        transaction.set(messageRef, {
          provider: "wacli",
          channel: "whatsapp",
          communicationAccountId,
          conversationId: current.conversationId || identity.conversationId,
          remoteConversationId: identity.remoteConversationId,
          messageId: identity.messageId,
          providerMessageId,
          remoteMessageId: providerMessageId,
          direction: "outbound",
          to: String(current.to || current.phone || current.recipient || "").trim(),
          type: outboundMediaKind(media),
          text,
          status: "sent",
          queueId,
          sentByUserId: current.createdByUserId || null,
          sentByName: current.createdByName || "DEMAC",
          bridgeResponse: { sent: true, messageId: providerMessageId, storeWarning },
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        transaction.set(queueRef, {
          status: "sent",
          messageId: identity.messageId,
          providerMessageId,
          bridgeResponse: { sent: true, messageId: providerMessageId, storeWarning },
          completedAt: FieldValue.serverTimestamp(),
          claimToken: null,
          leaseUntil: null,
          errorMessage: null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        if (conversationRef) {
          const recentMessages = mergeRecentMessages(conversationCurrent?.recentMessages, {
            id: identity.messageId,
            providerMessageId,
            at: new Date().toISOString(),
            author: current.createdByName || "DEMAC",
            role: "operator",
            text,
            status: "sent",
            mediaType: media ? outboundMediaKind(media) : null,
            mediaFileName: media?.fileName || media?.filename || null,
            mediaMimeType: media?.mimeType || null,
            mediaUrl: media?.url || null,
          });
          transaction.set(conversationRef, {
            provider: "wacli",
            channel: "whatsapp",
            communicationAccountId,
            status: conversationCurrent?.status === "escalated" ? "escalated" : "waiting_customer",
            unread: 0,
            lastMessageText: outboundPreview(text, media),
            lastActivityAt: FieldValue.serverTimestamp(),
            recentMessages,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        ackResult = { sent: true, messageId: identity.messageId, providerMessageId };
      });

      response.status(200).json({ ok: true, ...ackResult });
    } catch (error) {
      const status = Number(error?.statusCode || 500);
      if (status >= 500) logger.error("Could not acknowledge wacli outbound queue item.", error);
      response.status(status).json({ error: error?.message || "Outbound acknowledgement failed", code: error?.code || null });
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

module.exports.authorizedBridgeRequest = authorizedBridgeRequest;
module.exports.claimOutboundCommand = claimOutboundCommand;
module.exports.claimOutboundCommandWithDb = claimOutboundCommandWithDb;
module.exports.conversationIngressState = conversationIngressState;
module.exports.existingMessageMatchesIdentity = existingMessageMatchesIdentity;
module.exports.outboundQueueAccountMatches = outboundQueueAccountMatches;
module.exports.persistCanonicalMessage = persistCanonicalMessage;
module.exports.requireBoundCommunicationAccount = requireBoundCommunicationAccount;
module.exports.updateChatPresence = updateChatPresence;
