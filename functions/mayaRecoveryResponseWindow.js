'use strict';

// Read-only evidence assembly. No model, source-list argument, send, schedule
// write or nested transaction; the caller supplies a transaction-bound reader.
const { customerSemanticContent, messageMediaType } = require('./demacCustomerTurn');
const { digest } = require('./demacCustomerInterestHistory');
const { documentId } = require('./mayaOperationsReadModel');
const { deliveryProof } = require('./mayaRecoveryDeliveryProof');
const P = require('./mayaRecoveryOfferPolicy');
const need = P.requireCondition;
const VERSION = 1;
const MAX_TEXT = 8000;
const MAX_RECENT_MESSAGES = 120;

async function deliveredResponseOffer(reader, offer, now) {
  const r = offer.recovery;
  if (r.response) return offer;
  let reference = r.delivery;
  if (!reference) {
    need(r.state === 'prepared' && P.isOpen(offer, now) && r.outbound?.queueId, 'recovery_offer_not_delivered');
    const snapshot = await reader.collection('whatsappOutboundQueue').doc(documentId(r.outbound.queueId)).get();
    const queued = snapshot.exists ? snapshot.data() : null;
    need(queued && ['sent', 'delivered', 'read'].includes(queued.status) && queued.messageId,
      'recovery_offer_not_delivered');
    reference = { queueId: r.outbound.queueId, messageId: documentId(queued.messageId) };
  }
  const delivery = await deliveryProof(reader, offer, documentId(reference.queueId), documentId(reference.messageId), now);
  if (r.delivery) need(digest(r.delivery) === digest(delivery), 'recovery_delivery_changed');
  // This is only a transaction-local view, never a persisted claim of delivery.
  // A valid accepted/declined result later persists the same proof atomically.
  return { ...offer, recovery: { ...r, state: 'sent', delivery } };
}

function partEvidence(part, offer, expectedVersion, now) {
  const r = offer.recovery;
  need(part && part.direction === 'inbound' && part.conversationId === r.conversationId
    && part.communicationAccountId === r.account && part.provider === 'wacli'
    && part.customerInputVersion === expectedVersion && (!part.messageId || part.messageId === part.id),
  'recovery_response_window_incomplete');
  documentId(part.id);
  const type = messageMediaType(part) || 'text';
  const voice = type === 'audio' || type === 'voice';
  need(['text', 'audio', 'voice'].includes(type) && (!voice || part.transcriptionStatus === 'completed'),
    'recovery_response_requires_clarification');
  const text = customerSemanticContent(part, MAX_TEXT + 1);
  need(text.length > 0 && text.length <= MAX_TEXT, 'recovery_response_requires_clarification');
  const times = P.canonicalTime(part);
  need(times.provider <= now.getTime() && times.ingested <= now.getTime(), 'recovery_response_predates_offer');
  if (part.mayaRecoveryResponseRoute !== undefined) {
    const route = part.mayaRecoveryResponseRoute;
    need(route?.version === 1 && route.offerId === offer.id && route.offerVersion === offer.version
      && route.account === r.account && route.ownershipVersion === r.ownershipVersion
      && route.customerInputVersion === expectedVersion, 'recovery_chat_scope_changed');
  }
  return { id: part.id, account: r.account, conversationId: r.conversationId, customerInputVersion: expectedVersion,
    type, text, providerAt: times.provider, ingestedAt: times.ingested,
    transcriptionVersion: voice ? String(part.transcriptionVersion || '') : '' };
}

function observedMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return typeof value === 'string' ? Date.parse(value) : NaN;
}
async function assertNoInterveningOutbound(reader, offer, conversation) {
  const r = offer.recovery;
  const recent = conversation.recentMessages;
  need(Array.isArray(recent) && recent.length <= MAX_RECENT_MESSAGES, 'recovery_response_ambiguous');
  const ids = [...new Set(recent.filter(item => item?.direction === 'outbound'
    || ['operator', 'ai', 'assistant'].includes(item?.role)).map(item => item.id))];
  const others = ids.filter(id => id !== r.delivery.messageId);
  const createdAt = Date.parse(offer.createdAtIso);
  need(Number.isFinite(createdAt), 'recovery_response_ambiguous');
  // A delayed ACK can append the offer at the end of the cache after a newer
  // question. Check the ORIGINAL outbound records, not just cache position/time.
  // Use preparation time conservatively: ACK-only time cannot prove when the
  // physical send happened. Any later/unknown other outbound requires review.
  await Promise.all(others.map(async id => {
    const snapshot = await reader.collection('whatsappMessages').doc(documentId(id)).get();
    const original = snapshot.exists ? snapshot.data() : null;
    need(original && original.direction === 'outbound' && original.provider === 'wacli'
      && original.communicationAccountId === r.account && original.conversationId === r.conversationId,
    'recovery_response_ambiguous');
    const values = [original.whatsappTimestamp, original.firstIngestedAtIso,
      original.recoveryAcknowledgedAtIso, original.createdAt].filter(value => value !== undefined && value !== null);
    need(values.length > 0 && values.every(value => {
      const time = observedMillis(value); return Number.isFinite(time) && time < createdAt;
    }), 'recovery_response_ambiguous');
  }));
}

async function loadRecoveryResponseWindow({ reader, offer, conversation, message, receipt, quote, now = new Date() }) {
  const r = P.assertOffer(offer, offer?.version);
  const last = receipt.expectedCustomerInputVersion;
  const first = r.customerInputVersion + 1;
  const count = last - r.customerInputVersion;
  need(Number.isSafeInteger(r.customerInputVersion) && r.customerInputVersion > 0
    && Number.isSafeInteger(last) && count > 0 && count <= P.MAX_RESPONSE_MESSAGES
    && conversation.customerInputVersion === last && message.customerInputVersion === last,
  'recovery_response_window_incomplete');
  const messages = await Promise.all(Array.from({ length: count }, async (_, index) => {
    const version = first + index;
    // Equality queries reuse the existing canonical conversation and monotonic
    // inbound versions. Limit two is deliberate: ambiguity is an error, not first().
    const result = await reader.collection('whatsappMessages').where('conversationId', '==', r.conversationId)
      .where('customerInputVersion', '==', version).limit(2).get();
    need(result.docs.length === 1, 'recovery_response_window_incomplete');
    const snapshot = result.docs[0];
    return { ...snapshot.data(), id: snapshot.id };
  }));
  need(messages.at(-1).id === message.id, 'recovery_stale_response');
  const entries = messages.map((part, index) => partEvidence(part, offer, first + index, now));
  const text = entries.map(entry => entry.text).join('\n\n');
  need(text.length <= MAX_TEXT, 'recovery_response_requires_clarification');
  const readyOffer = await deliveredResponseOffer(reader, offer, now);
  const proof = { version: VERSION, messageIds: entries.map(entry => entry.id),
    fingerprint: digest({ offerId: offer.id, offerVersion: offer.version, entries,
      delivery: readyOffer.recovery.delivery || null }) };
  if (!r.response) {
    P.assertReplyEvidence({ offer: readyOffer, conversation, message, receipt, quote, now, responseMessages: messages });
    await assertNoInterveningOutbound(reader, readyOffer, conversation);
  } else if (r.response.responseWindow !== undefined) {
    need(digest(r.response.responseWindow) === digest(proof), 'recovery_response_conflict');
  } else {
    // Historical one-message receipts cannot be upgraded into multi-part proof.
    need(messages.length === 1, 'recovery_response_conflict');
  }
  return { offer: readyOffer, entries, text, proof, reconciledDelivery: !r.delivery && Boolean(readyOffer.recovery.delivery) };
}
module.exports = { VERSION, MAX_TEXT, MAX_RECENT_MESSAGES, deliveredResponseOffer, partEvidence,
  assertNoInterveningOutbound, loadRecoveryResponseWindow };
