const crypto = require('node:crypto');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');

const db = getFirestore();
const wacliWebhookSecret = defineSecret('WACLI_WEBHOOK_SECRET');

function safeDocumentId(value) {
  return String(value || 'unknown').replaceAll('/', '_').replaceAll('#', '_').slice(0, 1200);
}

function safeEqual(left, right) {
  const first = Buffer.from(String(left || ''));
  const second = Buffer.from(String(right || ''));
  return first.length === second.length && first.length > 0 && crypto.timingSafeEqual(first, second);
}

function verifySignature(request) {
  const rawBody = request.rawBody instanceof Buffer ? request.rawBody : Buffer.from(JSON.stringify(request.body ?? {}));
  const digest = crypto.createHmac('sha256', wacliWebhookSecret.value()).update(rawBody).digest('hex');
  return safeEqual(String(request.get('x-wacli-signature') || '').trim(), `sha256=${digest}`);
}

function phone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

function cleanMedia(value) {
  if (!value || typeof value !== 'object') return null;
  const kind = String(value.kind || '').toLowerCase();
  if (!['image', 'video', 'document', 'audio', 'voice', 'sticker'].includes(kind)) return null;
  return {
    kind,
    storagePath: value.storagePath ? String(value.storagePath) : null,
    mimeType: value.mimeType ? String(value.mimeType) : null,
    fileName: value.fileName ? String(value.fileName) : null,
    size: Number.isFinite(Number(value.size)) ? Number(value.size) : null,
    durationSeconds: Number.isFinite(Number(value.durationSeconds)) ? Number(value.durationSeconds) : null,
    caption: value.caption ? String(value.caption) : null,
    width: Number.isFinite(Number(value.width)) ? Number(value.width) : null,
    height: Number.isFinite(Number(value.height)) ? Number(value.height) : null,
  };
}

exports.wacliBackfillUpdate = onRequest(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: [wacliWebhookSecret],
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.set('Allow', 'POST');
      response.status(405).json({ ok: false, error: 'Method not allowed' });
      return;
    }
    if (!verifySignature(request)) {
      response.status(401).json({ ok: false, error: 'Invalid signature' });
      return;
    }

    try {
      const input = request.body || {};
      const chat = String(input.chat || input.conversationId || '');
      const conversationId = safeDocumentId(input.conversationId || chat);
      if (!conversationId) throw new Error('conversationId is required.');
      const identity = input.identity && typeof input.identity === 'object' ? input.identity : {};
      const resolvedPhone = phone(identity.phone);
      const canonicalJid = String(identity.canonicalJid || '');
      const whatsappLid = String(identity.whatsappLid || '');
      const messageId = input.messageId ? String(input.messageId) : '';
      const media = cleanMedia(input.media);
      const avatar = input.avatar && typeof input.avatar === 'object' ? input.avatar : null;
      const conversationRef = db.collection('communicationConversations').doc(conversationId);

      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(conversationRef);
        if (!snapshot.exists) return;
        const current = snapshot.data() || {};
        const updates = { updatedAt: FieldValue.serverTimestamp() };
        if (resolvedPhone) {
          updates.phone = resolvedPhone;
          updates.phoneResolutionStatus = 'resolved';
        } else if (!current.phone && whatsappLid) {
          updates.phoneResolutionStatus = 'resolving';
        }
        if (canonicalJid.endsWith('@s.whatsapp.net')) updates.canonicalJid = canonicalJid;
        if (whatsappLid.endsWith('@lid')) updates.whatsappLid = whatsappLid;
        if (avatar?.storagePath) {
          updates.avatarStoragePath = String(avatar.storagePath);
          updates.avatarUpdatedAt = String(avatar.updatedAt || new Date().toISOString());
        }
        if (messageId && media) {
          updates.recentMessages = (Array.isArray(current.recentMessages) ? current.recentMessages : []).map((message) => {
            if (String(message?.id || '') !== messageId) return message;
            return {
              ...message,
              type: 'media',
              media,
              text: String(message?.text || input.text || ''),
            };
          });
        }
        transaction.set(conversationRef, updates, { merge: true });
      });

      if (messageId && media) {
        await db.collection('whatsappMessages').doc(safeDocumentId(messageId)).set({
          provider: 'wacli',
          messageId,
          conversationId,
          type: media.kind,
          media,
          phone: resolvedPhone,
          canonicalJid: canonicalJid || null,
          whatsappLid: whatsappLid || null,
          enrichedByBackfill: true,
          enrichedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      response.status(200).json({ ok: true, conversationId, messageId: messageId || null, media: Boolean(media), phoneResolved: Boolean(resolvedPhone) });
    } catch (error) {
      response.status(400).json({ ok: false, error: error?.message || String(error) });
    }
  },
);
