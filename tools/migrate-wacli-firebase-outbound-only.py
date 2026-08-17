from pathlib import Path

path = Path('functions/whatsappWacliGateway.js')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    'const { FieldValue, getFirestore } = require("firebase-admin/firestore");',
    'const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");',
    'firestore import',
)
replace_once(
    'const wacliBridgeUrl = defineSecret("WACLI_BRIDGE_URL");\n',
    '',
    'retire WACLI_BRIDGE_URL',
)

start = text.index('function bridgeEndpoint(pathname) {')
end = text.index('async function fetchAndStoreProfilePicture', start)
text = text[:start] + text[end:]

replace_once(
    '    secrets: [wacliBridgeUrl, wacliBridgeToken],',
    '    secrets: [wacliBridgeToken],',
    'webhook secrets',
)

old_media = '''        let media = normalizeMedia(payload);\n        if (media) {\n          try {\n            media = await fetchAndStoreWacliMedia({ chat, messageId, media });\n          } catch (error) {\n            logger.error("Could not fetch/store wacli media; preserving message metadata.", error);\n          }\n        }\n'''
replace_once(old_media, '        const media = normalizeMedia(payload);\n', 'webhook media pull')

start = text.index('function parseBridgeResponse(response) {')
end = text.index('exports.appendCommunicationInternalNote', start)
new_block = r'''function requestRawBody(request) {
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (Buffer.isBuffer(request.body)) return request.body;
  return Buffer.alloc(0);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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
      const chat = String(request.query.chat || "").trim();
      const messageId = String(request.query.messageId || "").trim();
      const fileName = String(request.query.fileName || "").trim();
      const mediaType = String(request.query.mediaType || "").trim().toLowerCase();
      if (!chat || !messageId) throw httpError(400, "chat and messageId are required.");
      if (chat.length > 220 || messageId.length > 240 || fileName.length > 240) throw httpError(400, "Media metadata is too long.");

      const bytes = requestRawBody(request);
      if (!bytes.length) throw httpError(400, "Media body is empty.");
      if (bytes.length > MAX_MEDIA_BYTES) throw httpError(413, "WhatsApp media exceeds the configured maximum size.");

      const contentType = String(request.get("content-type") || "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
      const extension = extensionFromMedia({ mediaFileName: fileName, mediaMimeType: contentType });
      const bucket = storage.bucket();
      const storagePath = `communication-media/wacli/${safeStorageSegment(chat)}/${safeStorageSegment(messageId)}${extension}`;
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
        mediaUrl,
        mediaType: mediaType || null,
        mediaMimeType: contentType,
        mediaSize: bytes.length,
      });
    } catch (error) {
      logger.error("Could not ingest wacli media.", error);
      response.status(error?.statusCode || 500).json({ error: error?.message || "Media ingest failed" });
    }
  },
);

async function claimOutboundCommand(bridgeId) {
  const now = Date.now();
  const snapshot = await db.collection("whatsappOutboundQueue")
    .where("status", "in", ["queued", "processing"])
    .limit(50)
    .get();
  const candidates = snapshot.docs
    .filter((doc) => String(doc.data()?.provider || "") === "wacli")
    .filter((doc) => {
      const data = doc.data() || {};
      return data.status === "queued" || timestampMillis(data.leaseUntil) <= now;
    })
    .sort((left, right) => {
      const delta = timestampMillis(left.data()?.createdAt) - timestampMillis(right.data()?.createdAt);
      return delta || left.id.localeCompare(right.id);
    });

  for (const candidate of candidates) {
    const command = await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(candidate.ref);
      if (!currentSnapshot.exists) return null;
      const current = currentSnapshot.data() || {};
      if (current.provider !== "wacli") return null;
      if (!["queued", "processing"].includes(current.status || "queued")) return null;
      if (current.status === "processing" && timestampMillis(current.leaseUntil) > Date.now()) return null;

      const to = String(current.to || current.phone || current.recipient || "").trim();
      const text = String(current.text || "");
      const media = current.media && typeof current.media === "object" ? current.media : null;
      const claimToken = crypto.randomUUID();
      const leaseUntil = Timestamp.fromMillis(Date.now() + 3 * 60 * 1000);
      transaction.set(candidate.ref, {
        status: "processing",
        claimToken,
        claimedBy: bridgeId || "demac-wacli-bridge",
        claimedAt: FieldValue.serverTimestamp(),
        processingStartedAt: current.processingStartedAt || FieldValue.serverTimestamp(),
        leaseUntil,
        attempts: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return {
        queueId: candidate.id,
        claimToken,
        to,
        text,
        media,
      };
    });
    if (command) return command;
  }
  return null;
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
      const bridgeId = String(request.body?.bridgeId || "demac-wacli-bridge").trim().slice(0, 120);
      const command = await claimOutboundCommand(bridgeId);
      response.status(200).json({ ok: true, command });
    } catch (error) {
      logger.error("Could not poll wacli outbound queue.", error);
      response.status(500).json({ error: "Outbound poll failed" });
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
      const queueId = String(request.body?.queueId || "").trim();
      const claimToken = String(request.body?.claimToken || "").trim();
      const sent = request.body?.sent === true;
      const reportedMessageId = String(request.body?.messageId || "").trim();
      const storeWarning = String(request.body?.storeWarning || "").trim().slice(0, 1000) || null;
      const errorMessage = String(request.body?.error || "WhatsApp send failed").trim().slice(0, 1500);
      if (!queueId || !claimToken || queueId.includes("/")) throw httpError(400, "queueId and claimToken are required.");

      const queueRef = db.collection("whatsappOutboundQueue").doc(queueId);
      let ackResult = null;
      await db.runTransaction(async (transaction) => {
        const queueSnapshot = await transaction.get(queueRef);
        if (!queueSnapshot.exists) throw httpError(404, "Outbound queue item not found.");
        const current = queueSnapshot.data() || {};

        if (current.status === "sent" && sent) {
          ackResult = { alreadyAcknowledged: true, messageId: current.messageId || reportedMessageId || queueId };
          return;
        }
        if (current.status !== "processing" || current.claimToken !== claimToken) {
          throw httpError(409, "Outbound queue claim is no longer active.");
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

        const messageId = reportedMessageId || queueId;
        const media = current.media && typeof current.media === "object" ? current.media : null;
        const text = String(current.text || "");
        const messageRef = db.collection("whatsappMessages").doc(safeDocumentId(messageId));
        let conversationRef = null;
        let conversationCurrent = null;
        if (current.conversationId) {
          conversationRef = db.collection("communicationConversations").doc(String(current.conversationId));
          const conversationSnapshot = await transaction.get(conversationRef);
          conversationCurrent = conversationSnapshot.exists ? conversationSnapshot.data() : {};
        }

        transaction.set(messageRef, {
          provider: "wacli",
          channel: "whatsapp",
          messageId,
          direction: "outbound",
          to: String(current.to || current.phone || current.recipient || "").trim(),
          type: outboundMediaKind(media),
          text,
          status: "sent",
          queueId,
          sentByUserId: current.createdByUserId || null,
          sentByName: current.createdByName || "DEMAC",
          bridgeResponse: { sent: true, messageId, storeWarning },
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        transaction.set(queueRef, {
          status: "sent",
          messageId,
          bridgeResponse: { sent: true, messageId, storeWarning },
          completedAt: FieldValue.serverTimestamp(),
          claimToken: null,
          leaseUntil: null,
          errorMessage: null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        if (conversationRef) {
          const recentMessages = mergeRecentMessages(conversationCurrent?.recentMessages, {
            id: messageId,
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
            status: conversationCurrent?.status === "escalated" ? "escalated" : "waiting_customer",
            unread: 0,
            lastMessageText: outboundPreview(text, media),
            lastActivityAt: FieldValue.serverTimestamp(),
            recentMessages,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        ackResult = { sent: true, messageId };
      });

      response.status(200).json({ ok: true, ...ackResult });
    } catch (error) {
      const status = Number(error?.statusCode || 500);
      if (status >= 500) logger.error("Could not acknowledge wacli outbound queue item.", error);
      response.status(status).json({ error: error?.message || "Outbound acknowledgement failed" });
    }
  },
);

'''
text = text[:start] + new_block + text[end:]

retired = ['wacliBridgeUrl', 'bridgeEndpoint(', 'fetchAndStoreWacliMedia', 'sendQueuedWacliMessage']
for needle in retired:
    if needle in text:
        raise SystemExit(f'retired symbol remains: {needle}')
for required in ['exports.wacliWebhook', 'exports.wacliMediaIngest', 'exports.wacliOutboundPoll', 'exports.wacliOutboundAck']:
    if required not in text:
        raise SystemExit(f'missing required export: {required}')

path.write_text(text, encoding='utf-8')
print('Firebase gateway converted to outbound-only connector boundary.')
