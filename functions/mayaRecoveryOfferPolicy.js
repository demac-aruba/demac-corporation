'use strict';

const { digest, interestMaterial } = require('./demacCustomerInterestHistory');
const { canonicalOfferIdentity } = require('./bookingAuthorityFirestore');
const { dateKey, timeKey, documentId, failure } = require('./mayaOperationsReadModel');
const { normalizeOfferOption } = require('./bookingAuthorityCore');

const VERSION = 1;
const TERMINAL = new Set(['accepted', 'declined', 'expired']);
const NO_RESERVATION = Object.freeze({ capacityReserved: false, proactiveContactAuthorized: false });
function requireCondition(value, code) {
  if (!value) throw failure(code, 'Recovery offer could not be completed. No unverified appointment change is authorized.');
}
function offerRequestKey(account, cancellationId) {
  return `maya-recovery:${digest([account, cancellationId])}`;
}
function recoveryOfferId(account, cancellationId) {
  return canonicalOfferIdentity(offerRequestKey(account, cancellationId));
}
function originalFingerprint(appointment) {
  const fields = ['id', 'customerId', 'propertyId', 'status', 'date', 'startTime', 'endTime',
    'workLines', 'constraints', 'notes', 'assignments', 'workOrderIds', 'capacityLockIds', 'dispatchHold'];
  const material = Object.fromEntries(fields.map(key => [key, appointment[key] ?? null]));
  // The canonical dispatch service returns {} when there has never been a hold,
  // without writing that empty map to the Appointment. Missing/null and {} carry
  // the same no-hold meaning. Keep every populated hold field in the fingerprint:
  // active holds, changed case links and release history must still invalidate it.
  material.dispatchHold = appointment.dispatchHold ?? {};
  return digest(material);
}
function preferenceFingerprint(record) {
  return digest({ ...interestMaterial(record), interestHistory: record.interestHistory || [], interestReview: record.interestReview || null });
}
function optionFingerprint(option) { return digest(normalizeOfferOption(option)); }
function offerFingerprint(offer) {
  const r = offer.recovery;
  return digest({ id: offer.id, version: offer.version, request: offer.request, options: offer.options,
    expiresAt: offer.expiresAt, createdAtIso: offer.createdAtIso,
    recovery: { version: r.version, account: r.account, cancellationId: r.cancellationId, caseId: r.caseId,
      conversationId: r.conversationId, phone: r.phone, appointmentId: r.appointmentId,
      originalFingerprint: r.originalFingerprint, preferenceFingerprint: r.preferenceFingerprint,
      ownershipVersion: r.ownershipVersion, customerInputVersion: r.customerInputVersion,
      cancellationFingerprint: r.cancellationFingerprint, messageText: r.messageText } });
}
function assertOffer(offer, offerVersion) {
  requireCondition(offer && offer.recovery?.version === VERSION, 'recovery_offer_missing');
  const r = offer.recovery;
  for (const key of ['cancellationId', 'caseId', 'conversationId', 'appointmentId']) documentId(r[key]);
  requireCondition(Number.isSafeInteger(offerVersion) && offerVersion > 0 && offer.version === offerVersion, 'recovery_offer_version_changed');
  requireCondition(offer.id === recoveryOfferId(r.account, r.cancellationId)
    && r.fingerprint === offerFingerprint(offer) && offer.options?.length === 1, 'recovery_offer_proof_changed');
  return r;
}
function isOpen(offer, now) {
  return offer?.status === 'recovery_pending' && !TERMINAL.has(offer.recovery?.state)
    && Number.isFinite(Date.parse(offer.expiresAt)) && Date.parse(offer.expiresAt) > now.getTime();
}
function configuredTtl(settings) {
  const ttl = settings?.recoveryOfferTtlMinutes;
  requireCondition(Number.isInteger(ttl) && ttl >= 5 && ttl <= 180, 'recovery_offer_policy_missing');
  return ttl;
}
function renderOffer(original, option, expiresAt, language) {
  requireCondition(dateKey(original.date) && timeKey(original.startTime) && dateKey(option.date)
    && timeKey(option.time) && Number.isFinite(Date.parse(expiresAt)), 'invalid_recovery_message');
  // No customer name, cancelled customer's details or internal identifiers. English
  // and Spanish only in this backend slice; Papiamento requires a reviewed renderer.
  requireCondition(['en', 'es'].includes(language), 'recovery_language_not_supported');
  const until = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Aruba', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(expiresAt));
  return language === 'es'
    ? `Se liberó un espacio el ${option.date} a las ${option.time}. ¿Deseas adelantar tu cita del ${original.date} a ese horario? Responde antes de las ${until} (hora de Aruba). El espacio está sujeto a disponibilidad al confirmar; tu cita actual permanece sin cambios hasta completar el adelanto.`
    : `An opening is available on ${option.date} at ${option.time}. Would you like to move your ${original.date} appointment to that time? Please reply before ${until} (Aruba time). The opening is subject to availability when confirmed; your current appointment stays unchanged until the move is completed.`;
}
function canonicalTime(message) {
  const ingested = Date.parse(message?.firstIngestedAtIso || '');
  const provider = Date.parse(message?.whatsappTimestamp || '');
  requireCondition(Number.isFinite(ingested) && Number.isFinite(provider), 'recovery_message_time_missing');
  return { ingested, provider };
}
function assertReplyEvidence({ offer, conversation, message, receipt, quote, now }) {
  const r = offer.recovery;
  requireCondition(r.state === 'sent' && r.delivery, 'recovery_offer_not_delivered');
  requireCondition(isOpen(offer, now), 'recovery_offer_expired');
  requireCondition(message.direction === 'inbound' && message.conversationId === r.conversationId
    && message.communicationAccountId === r.account && message.customerInputVersion === receipt.expectedCustomerInputVersion
    && message.customerInputVersion === r.customerInputVersion + 1, 'recovery_response_ambiguous');
  const times = canonicalTime(message);
  requireCondition(times.ingested >= r.delivery.ingestedAt && times.provider >= r.delivery.providerAt
    && times.ingested <= now.getTime() && times.provider <= now.getTime(), 'recovery_response_predates_offer');
  const { customerSemanticContent } = require('./demacCustomerTurn');
  requireCondition(typeof quote === 'string' && quote.trim().length >= 2 && quote.length <= 800
    && customerSemanticContent(message, 8000).includes(quote.trim()), 'recovery_response_evidence_missing');
  const recent = Array.isArray(conversation.recentMessages) ? conversation.recentMessages : [];
  const lastOutbound = recent.filter(item => item?.direction === 'outbound' || ['operator', 'ai', 'assistant'].includes(item?.role)).at(-1);
  // A bare affirmation may not attach to an unrelated later question. Cached text
  // is never evidence; only its last outbound ID is used, then delivery is re-read.
  requireCondition(lastOutbound?.id === r.delivery.messageId, 'recovery_response_ambiguous');
}
module.exports = { VERSION, NO_RESERVATION, TERMINAL, assertOffer, assertReplyEvidence, canonicalTime,
  configuredTtl, isOpen, offerFingerprint, offerRequestKey, optionFingerprint, originalFingerprint,
  preferenceFingerprint, recoveryOfferId, renderOffer, requireCondition };
