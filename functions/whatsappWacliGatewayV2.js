const crypto = require('node:crypto');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const logger = require('firebase-functions/logger');
const { defineSecret } = require('firebase-functions/params');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');

const db = getFirestore();
const wacliWebhookSecret = defineSecret('WACLI_WEBHOOK_SECRET');
const wacliBridgeUrl = defineSecret('WACLI_BRIDGE_URL');
const wacliBridgeToken = defineSecret('WACLI_BRIDGE_TOKEN');
const MAX_RECENT_MESSAGES = 160;
const OPERATOR_STALE_MS = 5 * 60 * 1000;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

function safeDocumentId(value) { return String(value || 'unknown').replaceAll('/', '_').replaceAll('#', '_').slice(0, 1200); }
function safePathSegment(value, fallback = 'item') { return String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140) || fallback; }
function digitsOnly(value) { return String(value ?? '').replace(/\D/g, ''); }
function validPhone(value) { const phone = digitsOnly(value); return /^\d{8,15}$/.test(phone) ? phone : ''; }
function normalizeTimestamp(value) { const parsed = Date.parse(String(value || '')); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString(); }
function timestampMillis(value) { if (!value) return 0; if (typeof value?.toMillis === 'function') return value.toMillis(); const parsed = Date.parse(String(value)); return Number.isFinite(parsed) ? parsed : 0; }
function safeEqual(left, right) { const first = Buffer.from(String(left || '')); const second = Buffer.from(String(right || '')); return first.length === second.length && first.length > 0 && crypto.timingSafeEqual(first, second); }
function signatureFor(rawBody) { return `sha256=${crypto.createHmac('sha256', wacliWebhookSecret.value()).update(rawBody).digest('hex')}`; }
function verifySignature(request) { const rawBody = request.rawBody instanceof Buffer ? request.rawBody : Buffer.from(JSON.stringify(request.body ?? {})); return safeEqual(String(request.get('x-wacli-signature') || '').trim(), signatureFor(rawBody)); }

function inferQueue(text) {
  const value = String(text || '').toLowerCase();
  if (/\b(complaint|queja|reclamo|angry|molest|problema con servicio)\b/.test(value)) return 'complaints';
  if (/\b(payment|invoice|pago|factura|saldo|transfer|deposit)\b/.test(value)) return 'finance';
  if (/\b(estimate|quote|cotiza|precio|price|comprar|buy|new airco|aire nuevo)\b/.test(value)) return 'sales';
  if (/\b(appointment|cita|schedule|agenda|disponib|mañana|tomorrow|hora)\b/.test(value)) return 'scheduling';
  if (/\b(not cooling|no enfria|no enfría|leak|fuga|error|breaker|gas|refrigerant|refrigerante)\b/.test(value)) return 'technical';
  return 'general';
}

function operatorSupportsQueue(operator, queue) { const queues = Array.isArray(operator.queues) ? operator.queues : []; return queues.length === 0 || queues.includes('all') || queues.includes(queue) || (queue === 'complaints' && queues.includes('general')); }
async function chooseAvailableOperator(queue) {
  const snapshot = await db.collection('communicationOperatorPresence').get();
  const now = Date.now();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((operator) => operator.presence === 'available')
    .filter((operator) => now - timestampMillis(operator.lastSeenAt) <= OPERATOR_STALE_MS)
    .filter((operator) => operatorSupportsQueue(operator, queue))
    .filter((operator) => !operator.activeVoiceCall)
    .sort((left, right) => Number(left.activeChats || 0) - Number(right.activeChats || 0))[0] || null;
}

function identityFromPayload(payload) {
  const chat = String(payload.Chat || '');
  const sender = String(payload.SenderJID || '');
  const resolvedPhone = validPhone(payload.ResolvedPhone || payload.Phone || payload.CanonicalPhone);
  const canonicalJid = String(payload.CanonicalJid || payload.CanonicalJID || '').endsWith('@s.whatsapp.net')
    ? String(payload.CanonicalJid || payload.CanonicalJID)
    : chat.endsWith('@s.whatsapp.net') ? chat : sender.endsWith('@s.whatsapp.net') ? sender : '';
  const phone = resolvedPhone || validPhone(canonicalJid.split('@')[0]);
  const whatsappLid = chat.endsWith('@lid') ? chat : sender.endsWith('@lid') ? sender : String(payload.WhatsAppLid || payload.LID || '').endsWith('@lid') ? String(payload.WhatsAppLid || payload.LID) : '';
  return {
    phone: phone || null,
    canonicalJid: canonicalJid || null,
    whatsappLid: whatsappLid || null,
    phoneResolutionStatus: phone ? 'resolved' : whatsappLid ? 'resolving' : 'unavailable',
  };
}

function normalizeMedia(value) {
  if (!value || typeof value !== 'object') return null;
  const rawKind = String(value.kind || value.type || '').toLowerCase();
  const kind = ['image', 'video', 'document', 'audio', 'voice', 'sticker'].includes(rawKind) ? rawKind : null;
  if (!kind) return null;
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

function normalizeRecentMessage(message) {
  return {
    id: String(message.id || `msg-${Date.now()}`),
    at: normalizeTimestamp(message.at),
    author: String(message.author || 'WhatsApp'),
    role: message.role || 'customer',
    text: String(message.text || ''),
    channel: 'whatsapp',
    status: message.status || null,
    provider: 'wacli',
    type: message.type || (message.media ? 'media' : 'text'),
    media: normalizeMedia(message.media),
    quotedMessageId: message.quotedMessageId || null,
    quotedText: message.quotedText || null,
  };
}

function mergeRecentMessages(existing, incoming) {
  const byId = new Map();
  for (const message of Array.isArray(existing) ? existing : []) if (message?.id) byId.set(String(message.id), message);
  const normalized = normalizeRecentMessage(incoming);
  byId.set(normalized.id, { ...(byId.get(normalized.id) || {}), ...normalized });
  return [...byId.values()].sort((left, right) => Date.parse(left.at || 0) - Date.parse(right.at || 0)).slice(-MAX_RECENT_MESSAGES);
}

async function appendConversationMessage({ payload, message, inbound }) {
  const chat = String(payload.Chat || '');
  const identity = identityFromPayload(payload);
  const conversationId = safeDocumentId(chat || identity.canonicalJid || identity.phone);
  const queue = inferQueue(message.text || message.media?.caption || '');
  const routedOperator = inbound ? await chooseAvailableOperator(queue) : null;
  const ref = db.collection('communicationConversations').doc(conversationId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() : {};
    const recentMessages = mergeRecentMessages(current?.recentMessages, message);
    const hasOwner = Boolean(current?.ownerUserId || current?.owner);
    const owner = !hasOwner && routedOperator ? routedOperator.displayName || routedOperator.name || null : current?.owner || null;
    const ownerUserId = !hasOwner && routedOperator ? routedOperator.id : current?.ownerUserId || null;
    const nextStatus = inbound ? (hasOwner || routedOperator ? 'assigned' : (current?.status && !['resolved', 'closed'].includes(current.status) ? current.status : 'new')) : (current?.status || 'waiting_customer');
    const avatar = payload.ProfilePicture && typeof payload.ProfilePicture === 'object' ? payload.ProfilePicture : {};
    transaction.set(ref, {
      channel: 'whatsapp', provider: 'wacli', externalChatId: chat || current?.externalChatId || null, chatJid: chat || current?.chatJid || null,
      phone: identity.phone || current?.phone || null,
      canonicalJid: identity.canonicalJid || current?.canonicalJid || null,
      whatsappLid: identity.whatsappLid || current?.whatsappLid || null,
      phoneResolutionStatus: identity.phone ? 'resolved' : current?.phone ? 'resolved' : identity.phoneResolutionStatus,
      customer: String(payload.ChatName || '').trim() || current?.customer || identity.phone || 'WhatsApp contact',
      customerId: current?.customerId || null, property: current?.property || null, equipment: current?.equipment || null,
      avatarStoragePath: avatar.storagePath || current?.avatarStoragePath || null,
      avatarUpdatedAt: avatar.updatedAt || current?.avatarUpdatedAt || null,
      language: current?.language || 'unknown', queue: current?.queue && current.queue !== 'general' ? current.queue : queue,
      status: nextStatus, owner, ownerUserId,
      routeReason: !hasOwner && routedOperator ? `Auto-routed from ${queue} queue to available operator.` : current?.routeReason || null,
      aiDisposition: current?.aiDisposition || 'human_active', lockedBy: current?.lockedBy || null, lockedByUserId: current?.lockedByUserId || null,
      unread: inbound ? FieldValue.increment(1) : Number(current?.unread || 0),
      lastMessageText: String(message.text || message.media?.caption || (message.media ? `[${message.media.kind}]` : '')),
      lastActivityAt: FieldValue.serverTimestamp(), customerTyping: false, recentMessages,
      createdAt: current?.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return conversationId;
}

async function updateReceipt(payload) {
  const ids = Array.isArray(payload.MessageIDs) ? payload.MessageIDs.filter(Boolean).map(String) : [];
  if (!ids.length) return;
  const status = String(payload.Type || 'delivered');
  const chat = String(payload.Chat || '');
  for (const messageId of ids) {
    await db.collection('whatsappMessages').doc(safeDocumentId(messageId)).set({ messageId, provider: 'wacli', status, lastStatusAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection('whatsappMessageStatuses').doc(safeDocumentId(`${messageId}-${status}-${payload.Timestamp || Date.now()}`)).set({ provider: 'wacli', messageId, chat: chat || null, status, whatsappTimestamp: payload.Timestamp || null, raw: payload, receivedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  if (!chat) return;
  const ref = db.collection('communicationConversations').doc(safeDocumentId(chat));
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref); if (!snapshot.exists) return;
    const current = snapshot.data() || {};
    transaction.set(ref, { recentMessages: (Array.isArray(current.recentMessages) ? current.recentMessages : []).map((message) => ids.includes(String(message?.id)) ? { ...message, status } : message), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

async function updateChatPresence(payload) {
  const chat = String(payload.Chat || ''); if (!chat) return;
  await db.collection('communicationConversations').doc(safeDocumentId(chat)).set({ customerTyping: payload.State === 'composing', typingMedia: payload.Media || null, lastPresenceAt: FieldValue.serverTimestamp() }, { merge: true });
}

exports.wacliWebhook = onRequest({ region: 'us-central1', memory: '512MiB', timeoutSeconds: 60, secrets: [wacliWebhookSecret] }, async (request, response) => {
  if (request.method !== 'POST') { response.set('Allow', 'POST'); response.status(405).send('Method not allowed'); return; }
  if (!verifySignature(request)) { response.status(401).send('Invalid signature'); return; }
  const payload = request.body ?? {};
  const eventType = String(payload.EventType || 'message');
  const eventRef = db.collection('whatsappWebhookEvents').doc();
  try {
    await eventRef.set({ source: 'wacli-v2', eventType, payload, processed: false, receivedAt: FieldValue.serverTimestamp() });
    if (eventType === 'receipt') await updateReceipt(payload);
    else if (eventType === 'chat_presence') await updateChatPresence(payload);
    else {
      const chat = String(payload.Chat || '');
      const messageId = String(payload.ID || `${eventRef.id}-${chat || 'unknown'}`);
      const fromMe = Boolean(payload.FromMe);
      const identity = identityFromPayload(payload);
      const text = String(payload.Text || '');
      const media = normalizeMedia(payload.Media);
      const chatName = String(payload.ChatName || '').trim() || identity.phone || 'WhatsApp contact';
      const conversationId = await appendConversationMessage({ payload, inbound: !fromMe, message: {
        id: messageId, at: normalizeTimestamp(payload.Timestamp), author: fromMe ? 'DEMAC WhatsApp' : chatName,
        role: fromMe ? 'operator' : 'customer', text, status: fromMe ? 'sent' : 'received', type: media ? 'media' : 'text', media,
        quotedMessageId: payload.QuotedMessageID || null, quotedText: payload.QuotedText || null,
      }});
      await db.collection('whatsappMessages').doc(safeDocumentId(messageId)).set({
        provider: 'wacli', messageId, conversationId, direction: fromMe ? 'outbound' : 'inbound',
        from: fromMe ? null : identity.phone, to: fromMe ? identity.phone : null,
        chatJid: chat || null, canonicalJid: identity.canonicalJid, whatsappLid: identity.whatsappLid,
        phoneResolutionStatus: identity.phoneResolutionStatus, contactName: chatName,
        type: media ? media.kind : 'text', text, media, status: fromMe ? 'sent' : 'received',
        whatsappTimestamp: payload.Timestamp || null, raw: payload, webhookEventId: eventRef.id, receivedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await eventRef.set({ processed: true, processedAt: FieldValue.serverTimestamp() }, { merge: true });
    response.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    logger.error('Could not process enriched wacli webhook event.', error);
    await eventRef.set({ processed: false, errorMessage: error?.message || String(error), failedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
    response.status(500).send('Webhook processing failed');
  }
});

function bridgeEndpoint() { const base = String(wacliBridgeUrl.value() || '').trim().replace(/\/+$/, ''); if (!/^https:\/\//i.test(base)) throw new Error('WACLI_BRIDGE_URL must be HTTPS.'); return `${base}/v1/send`; }
function validateRecipient(value) { const to = String(value || '').trim(); if (!to || (!/^\+?[0-9() .-]{8,24}$/.test(to) && !/@(s\.whatsapp\.net|lid|g\.us)$/.test(to))) throw new Error('A valid WhatsApp phone number or JID is required.'); return to; }
async function signedReadUrl(storagePath) { const [url] = await getStorage().bucket().file(storagePath).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 10 * 60 * 1000 }); return url; }

exports.sendQueuedWacliMessage = onDocumentCreated({ document: 'whatsappOutboundQueue/{queueId}', region: 'us-central1', memory: '512MiB', timeoutSeconds: 90, secrets: [wacliBridgeUrl, wacliBridgeToken] }, async (event) => {
  const snapshot = event.data; if (!snapshot) return;
  const ref = snapshot.ref; const original = snapshot.data() || {};
  if (original.provider !== 'wacli' || (original.status && original.status !== 'queued')) return;
  try {
    const to = validateRecipient(original.to);
    const text = String(original.text || '');
    let media = null;
    if (original.type === 'media' || original.storagePath) {
      const kind = String(original.mediaKind || 'document');
      if (!['image','video','document','audio','voice','sticker'].includes(kind)) throw new Error('Unsupported media kind.');
      const storagePath = String(original.storagePath || '');
      const uid = String(original.createdByUserId || '');
      if (!uid || !storagePath.startsWith(`communication-media/outbound/${uid}/`)) throw new Error('Outbound media path does not belong to the sending operator.');
      media = { kind, url: await signedReadUrl(storagePath), storagePath, mimeType: original.mimeType || 'application/octet-stream', fileName: original.fileName || null, size: Number(original.size || 0) };
    } else if (!text.trim()) throw new Error('Text or media is required.');
    await ref.set({ status: 'processing', processingStartedAt: FieldValue.serverTimestamp() }, { merge: true });
    const bridgeResponse = await fetch(bridgeEndpoint(), { method: 'POST', headers: { Authorization: `Bearer ${wacliBridgeToken.value()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ to, text, media, clientMessageId: snapshot.id }) });
    const result = await bridgeResponse.json().catch(() => ({}));
    if (!bridgeResponse.ok || result?.sent !== true) throw new Error(result?.error || `wacli bridge returned HTTP ${bridgeResponse.status}`);
    const messageId = String(result.messageId || result.id || snapshot.id);
    const messageMedia = media ? { kind: media.kind, storagePath: media.storagePath, mimeType: media.mimeType, fileName: media.fileName, size: media.size, caption: text || null } : null;
    const outboundRef = db.collection('whatsappMessages').doc(safeDocumentId(messageId));
    const batch = db.batch();
    batch.set(outboundRef, { provider: 'wacli', messageId, conversationId: original.conversationId || null, direction: 'outbound', to, type: media ? media.kind : 'text', text, media: messageMedia, status: 'sent', queueId: snapshot.id, sentByUserId: original.createdByUserId || null, sentByName: original.createdByName || 'DEMAC', bridgeResponse: result, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(ref, { status: 'sent', messageId, bridgeResponse: result, completedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
    if (original.conversationId) {
      const conversationRef = db.collection('communicationConversations').doc(String(original.conversationId));
      await db.runTransaction(async (transaction) => {
        const conversationSnapshot = await transaction.get(conversationRef); const current = conversationSnapshot.exists ? conversationSnapshot.data() : {};
        transaction.set(conversationRef, { provider: 'wacli', channel: 'whatsapp', status: current?.status === 'escalated' ? 'escalated' : 'waiting_customer', unread: 0, lastMessageText: text || (media ? `[${media.kind}]` : ''), lastActivityAt: FieldValue.serverTimestamp(), recentMessages: mergeRecentMessages(current?.recentMessages, { id: messageId, at: new Date().toISOString(), author: original.createdByName || 'DEMAC', role: 'operator', text, status: 'sent', type: media ? 'media' : 'text', media: messageMedia }), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      });
    }
  } catch (error) {
    logger.error('Could not send queued WhatsApp item through wacli v2.', error);
    await ref.set({ status: 'failed', errorMessage: error?.message || String(error), failedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
});

exports.wacliMediaUploadTicket = onRequest({ region: 'us-central1', memory: '256MiB', timeoutSeconds: 30, secrets: [wacliWebhookSecret] }, async (request, response) => {
  if (request.method !== 'POST') { response.set('Allow', 'POST'); response.status(405).json({ ok: false }); return; }
  if (!verifySignature(request)) { response.status(401).json({ ok: false, error: 'Invalid signature' }); return; }
  try {
    const input = request.body || {};
    const scope = input.scope === 'avatar' ? 'avatar' : 'inbound';
    const size = Number(input.size || 0);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_MEDIA_BYTES) throw new Error('Invalid media size.');
    const contentType = String(input.contentType || 'application/octet-stream').slice(0, 160);
    if (scope === 'avatar' && !contentType.startsWith('image/')) throw new Error('Avatar upload must be an image.');
    const fileName = safePathSegment(input.fileName || `${input.messageId || Date.now()}.bin`, 'media.bin');
    const storagePath = scope === 'avatar'
      ? `communication-media/avatars/${safePathSegment(input.identity || input.conversationId, 'identity')}/${Date.now()}-${fileName}`
      : `communication-media/inbound/${safePathSegment(input.conversationId, 'conversation')}/${safePathSegment(input.messageId, String(Date.now()))}-${fileName}`;
    const file = getStorage().bucket().file(storagePath);
    const [uploadUrl] = await file.getSignedUrl({ version: 'v4', action: 'write', expires: Date.now() + 10 * 60 * 1000, contentType });
    response.status(200).json({ ok: true, storagePath, uploadUrl, contentType, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  } catch (error) { response.status(400).json({ ok: false, error: error?.message || String(error) }); }
});
