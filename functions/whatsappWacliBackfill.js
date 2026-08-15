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

function millis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
  }
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (numeric > 1e12) return numeric;
    if (numeric > 1e9) return numeric * 1000;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function messageMediaKind(message) {
  const kind = String(message?.media?.kind || message?.type || '').toLowerCase();
  if (['image', 'video', 'document', 'audio', 'voice', 'sticker'].includes(kind)) return kind;
  const text = normalizedText(message?.text);
  if (/\[sticker\]/.test(text)) return 'sticker';
  if (/\[(audio|voice)\]/.test(text)) return 'audio';
  if (/\[image\]/.test(text)) return 'image';
  if (/\[video\]/.test(text)) return 'video';
  if (/\[(document|file|pdf)\]/.test(text)) return 'document';
  return '';
}

function kindCompatible(existing, incoming) {
  if (!existing) return true;
  if (existing === incoming) return true;
  return (existing === 'audio' && incoming === 'voice') || (existing === 'voice' && incoming === 'audio');
}

function chooseTimelineMessageIndex(messages, input, media) {
  const messageId = String(input.messageId || '');
  const exact = messages.findIndex((message) => String(message?.id || '') === messageId);
  if (exact >= 0) return { index: exact, mode: 'id' };

  const targetText = normalizedText(input.text);
  const targetAt = millis(input.at || input.timestamp);
  let bestIndex = -1;
  let bestScore = -1;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] || {};
    if (message?.media?.storagePath) continue;
    const existingKind = messageMediaKind(message);
    if (!kindCompatible(existingKind, media.kind)) continue;

    let score = existingKind ? 5 : 1;
    const candidateText = normalizedText(message.text || message?.media?.caption);
    if (targetText && candidateText && targetText === candidateText) score += 10;

    const candidateAt = millis(message.at);
    if (targetAt && candidateAt) {
      const delta = Math.abs(targetAt - candidateAt);
      if (delta > 5 * 60 * 1000) continue;
      if (delta <= 5000) score += 12;
      else if (delta <= 30000) score += 9;
      else if (delta <= 60000) score += 6;
      else score += 3;
    } else if (!targetText) {
      continue;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  if (bestIndex >= 0 && bestScore >= 8) return { index: bestIndex, mode: 'fuzzy' };

  // Legacy V1 messages can have synthetic IDs/timestamps, while still retaining
  // the correct media kind and chronological position. wacli's recent message
  // list is processed newest-first, so consuming the newest unresolved
  // placeholder of the same kind gives a deterministic, type-safe fallback.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] || {};
    if (message?.media?.storagePath) continue;
    const existingKind = messageMediaKind(message);
    if (!existingKind || !kindCompatible(existingKind, media.kind)) continue;
    return { index, mode: 'kind_order' };
  }

  return { index: -1, mode: 'none' };
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
      let mediaMatched = false;
      let mediaMatchMode = 'none';

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
          const messages = Array.isArray(current.recentMessages) ? [...current.recentMessages] : [];
          const match = chooseTimelineMessageIndex(messages, input, media);
          if (match.index >= 0) {
            const existing = messages[match.index] || {};
            messages[match.index] = {
              ...existing,
              type: 'media',
              media,
              text: String(existing?.text || input.text || ''),
            };
            updates.recentMessages = messages;
            mediaMatched = true;
            mediaMatchMode = match.mode;
          }
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
          whatsappTimestamp: input.at || input.timestamp || null,
          enrichedByBackfill: true,
          enrichedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      response.status(200).json({
        ok: true,
        conversationId,
        messageId: messageId || null,
        media: Boolean(media),
        mediaMatched,
        mediaMatchMode,
        phoneResolved: Boolean(resolvedPhone),
      });
    } catch (error) {
      response.status(400).json({ ok: false, error: error?.message || String(error) });
    }
  },
);
