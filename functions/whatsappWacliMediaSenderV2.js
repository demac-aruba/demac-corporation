const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const logger = require('firebase-functions/logger');
const { defineSecret } = require('firebase-functions/params');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');

const db = getFirestore();
const wacliBridgeUrl = defineSecret('WACLI_BRIDGE_URL');
const wacliBridgeToken = defineSecret('WACLI_BRIDGE_TOKEN');
const MAX_RECENT_MESSAGES = 160;

function safeDocumentId(value) {
  return String(value || 'unknown').replaceAll('/', '_').replaceAll('#', '_').slice(0, 1200);
}

function validateRecipient(value) {
  const to = String(value || '').trim();
  if (!to || (!/^\+?[0-9() .-]{8,24}$/.test(to) && !/@(s\.whatsapp\.net|lid|g\.us)$/.test(to))) {
    throw new Error('A valid WhatsApp phone number or JID is required.');
  }
  return to;
}

function bridgeEndpoint() {
  const base = String(wacliBridgeUrl.value() || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) throw new Error('WACLI_BRIDGE_URL must be HTTPS.');
  return `${base}/v1/send`;
}

async function signedReadUrl(storagePath) {
  const [url] = await getStorage().bucket().file(storagePath).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 10 * 60 * 1000,
  });
  return url;
}

function mergeRecentMessages(existing, incoming) {
  const byId = new Map();
  for (const message of Array.isArray(existing) ? existing : []) {
    if (message?.id) byId.set(String(message.id), message);
  }
  byId.set(String(incoming.id), incoming);
  return [...byId.values()]
    .sort((left, right) => Date.parse(left.at || 0) - Date.parse(right.at || 0))
    .slice(-MAX_RECENT_MESSAGES);
}

exports.sendQueuedWacliMediaMessageV2 = onDocumentCreated(
  {
    document: 'whatsappOutboundQueue/{queueId}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 90,
    secrets: [wacliBridgeUrl, wacliBridgeToken],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const ref = snapshot.ref;
    const original = snapshot.data() || {};
    if (original.provider !== 'wacli-v2' || (original.status && original.status !== 'queued')) return;

    try {
      const to = validateRecipient(original.to);
      const text = String(original.text || '');
      const kind = String(original.mediaKind || 'document');
      if (!['image', 'video', 'document', 'audio', 'voice', 'sticker'].includes(kind)) {
        throw new Error('Unsupported media kind.');
      }

      const storagePath = String(original.storagePath || '');
      const uid = String(original.createdByUserId || '');
      if (!uid || !storagePath.startsWith(`communication-media/outbound/${uid}/`)) {
        throw new Error('Outbound media path does not belong to the sending operator.');
      }

      const media = {
        kind,
        url: await signedReadUrl(storagePath),
        storagePath,
        mimeType: original.mimeType || 'application/octet-stream',
        fileName: original.fileName || null,
        size: Number(original.size || 0),
      };

      await ref.set({ status: 'processing', processingStartedAt: FieldValue.serverTimestamp() }, { merge: true });
      const bridgeResponse = await fetch(bridgeEndpoint(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${wacliBridgeToken.value()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to,
          text,
          media,
          clientMessageId: snapshot.id,
        }),
      });
      const result = await bridgeResponse.json().catch(() => ({}));
      if (!bridgeResponse.ok || result?.sent !== true) {
        throw new Error(result?.error || `wacli bridge returned HTTP ${bridgeResponse.status}`);
      }

      const messageId = String(result.messageId || result.id || snapshot.id);
      const messageMedia = {
        kind: media.kind,
        storagePath: media.storagePath,
        mimeType: media.mimeType,
        fileName: media.fileName,
        size: media.size,
        caption: text || null,
      };

      const batch = db.batch();
      batch.set(db.collection('whatsappMessages').doc(safeDocumentId(messageId)), {
        provider: 'wacli-v2',
        messageId,
        conversationId: original.conversationId || null,
        direction: 'outbound',
        to,
        type: media.kind,
        text,
        media: messageMedia,
        status: 'sent',
        queueId: snapshot.id,
        sentByUserId: original.createdByUserId || null,
        sentByName: original.createdByName || 'DEMAC',
        bridgeResponse: result,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(ref, {
        status: 'sent',
        messageId,
        bridgeResponse: result,
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await batch.commit();

      if (original.conversationId) {
        const conversationRef = db.collection('communicationConversations').doc(String(original.conversationId));
        await db.runTransaction(async (transaction) => {
          const conversationSnapshot = await transaction.get(conversationRef);
          const current = conversationSnapshot.exists ? conversationSnapshot.data() : {};
          transaction.set(conversationRef, {
            provider: 'wacli',
            channel: 'whatsapp',
            status: current?.status === 'escalated' ? 'escalated' : 'waiting_customer',
            unread: 0,
            lastMessageText: text || `[${media.kind}]`,
            lastActivityAt: FieldValue.serverTimestamp(),
            recentMessages: mergeRecentMessages(current?.recentMessages, {
              id: messageId,
              at: new Date().toISOString(),
              author: original.createdByName || 'DEMAC',
              role: 'operator',
              text,
              channel: 'whatsapp',
              status: 'sent',
              type: 'media',
              media: messageMedia,
            }),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        });
      }
    } catch (error) {
      logger.error('Could not send queued WhatsApp media through wacli V2.', error);
      await ref.set({
        status: 'failed',
        errorMessage: error?.message || String(error),
        failedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  },
);
