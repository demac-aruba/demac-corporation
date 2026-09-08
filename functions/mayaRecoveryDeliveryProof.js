'use strict';
const { digest } = require('./demacCustomerInterestHistory');
const { documentId } = require('./mayaOperationsReadModel');
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
  let temporal;
  if (queue.recoveryAcknowledgedAtIso !== undefined || message.recoveryAcknowledgedAtIso !== undefined) {
    const acknowledgedAt = Date.parse(queue.recoveryAcknowledgedAtIso || '');
    need(queue.recoveryAcknowledgedAtIso === message.recoveryAcknowledgedAtIso
      && Number.isFinite(acknowledgedAt) && message.queueId === queue.id, 'recovery_delivery_unproven');
    temporal = { timeBasis: 'bridge_acknowledgement', acknowledgedAt, ingestedAt: acknowledgedAt };
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
