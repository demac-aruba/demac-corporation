'use strict';
const { digest } = require('./demacCustomerInterestHistory');
const { documentId } = require('./mayaOperationsReadModel');
const { recoveryClaimIsUnchanged } = require('./mayaRecoveryDispatchReceipt');
const P = require('./mayaRecoveryOfferPolicy');
const need = P.requireCondition;
async function read(reader, collection, id) {
  const snapshot = await reader.collection(collection).doc(documentId(id)).get();
  return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
}
// The real gateway stores a canonical queue.messageId AND providerMessageId.
// Never conflate them, or invent a provider timestamp from the server clock.
async function deliveryProof(reader, offer, queueId, messageId, now = new Date()) {
  const [queue, message] = await Promise.all([read(reader, 'whatsappOutboundQueue', queueId), read(reader, 'whatsappMessages', messageId)]);
  const r = offer.recovery;
  need(queue && message && ['sent', 'delivered', 'read'].includes(queue.status)
    && queue.outboundClass === 'conversation_maya' && queue.provider === 'wacli'
    && queue.communicationAccountId === r.account && queue.conversationId === r.conversationId
    && queue.expectedOwnershipVersion === r.ownershipVersion && queue.expectedCustomerInputVersion === r.customerInputVersion
    && queue.recoveryOfferId === offer.id && queue.recoveryOfferVersion === offer.version
    && queue.recoveryOfferFingerprint === r.fingerprint && queue.text === r.messageText
    && message.direction === 'outbound' && message.provider === 'wacli'
    && message.communicationAccountId === r.account && message.conversationId === r.conversationId
    && message.text === r.messageText && typeof message.providerMessageId === 'string' && message.providerMessageId
    && queue.messageId === message.id && queue.providerMessageId === message.providerMessageId
    && queue.providerMessageId !== queue.id, 'recovery_delivery_unproven');
  const governed = Boolean(r.outbound) || queue.recoveryDispatchVersion !== undefined || queueId.startsWith('MRO-');
  if (governed) {
    need(recoveryClaimIsUnchanged(queueId, queue) && r.outbound?.queueId === queueId
      && r.outbound.policyFingerprint === queue.recoveryContactPolicyFingerprint && queue.to === r.phone
      && typeof queue.recoveryAcknowledgedAtIso === 'string' && typeof message.recoveryAcknowledgedAtIso === 'string',
    'recovery_delivery_unproven');
  }
  let temporal;
  if (queue.recoveryAcknowledgedAtIso !== undefined || message.recoveryAcknowledgedAtIso !== undefined) {
    const acknowledgedAt = Date.parse(queue.recoveryAcknowledgedAtIso || '');
    need(queue.recoveryAcknowledgedAtIso === message.recoveryAcknowledgedAtIso
      && Number.isFinite(acknowledgedAt) && acknowledgedAt <= now.getTime() && message.queueId === queue.id,
    'recovery_delivery_unproven');
    if (governed) {
      const attemptedAt = Date.parse(queue.recoveryDispatchAttemptedAtIso || '');
      need(attemptedAt >= Date.parse(offer.createdAtIso) && attemptedAt <= acknowledgedAt, 'recovery_delivery_unproven');
    }
    temporal = { timeBasis: 'bridge_acknowledgement', acknowledgedAt, ingestedAt: acknowledgedAt };
    // The ACK may lag behind an already materialized provider echo. Use that
    // earlier chronology only when its authenticated webhook was fully processed.
    // Existing bound proof keeps its chosen basis; later metadata cannot silently
    // change it. A missing/invalid previously used echo fails, never falls back.
    const useEcho = governed && (r.delivery?.timeBasis === 'provider_message_with_ack'
      || (!r.delivery && Boolean(message.webhookEventId)));
    if (useEcho) {
      const eventId = documentId(message.webhookEventId);
      const event = await read(reader, 'whatsappWebhookEvents', eventId);
      need(event?.processed === true && event.source === 'wacli' && event.provider === 'wacli'
        && event.communicationAccountId === r.account && event.auth === 'bridge-bearer-account-bound-v1'
        && event.eventType === 'message', 'recovery_delivery_unproven');
      const times = P.canonicalTime(message);
      const attemptedAt = Date.parse(queue.recoveryDispatchAttemptedAtIso || '');
      need(times.provider >= attemptedAt && times.ingested >= attemptedAt
        && times.provider <= acknowledgedAt && times.ingested <= acknowledgedAt, 'recovery_delivery_unproven');
      temporal = { timeBasis: 'provider_message_with_ack', providerAt: times.provider,
        ingestedAt: times.ingested, acknowledgedAt, webhookEventId: eventId };
    }
  } else {
    const times = P.canonicalTime(message);
    temporal = { timeBasis: 'provider_message', providerAt: times.provider, ingestedAt: times.ingested };
  }
  const sentEvidenceAt = temporal.providerAt ?? temporal.acknowledgedAt;
  const created = Date.parse(offer.createdAtIso);
  const expires = Date.parse(offer.expiresAt);
  need(Number.isFinite(created) && Number.isFinite(expires)
    && sentEvidenceAt >= created && temporal.ingestedAt >= created
    && sentEvidenceAt < expires && temporal.ingestedAt < expires, 'recovery_delivery_expired');
  need(sentEvidenceAt <= now.getTime() && temporal.ingestedAt <= now.getTime(), 'recovery_delivery_unproven');
  return { queueId, messageId, ...temporal,
    fingerprint: digest([queueId, messageId, queue.providerMessageId, message.text, temporal]) };
}
module.exports = { deliveryProof };
