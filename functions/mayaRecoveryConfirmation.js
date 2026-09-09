'use strict';

// Confirmation composition on the existing Communication Authority queue. This
// module never creates, cancels or reschedules an appointment and never sends.
const { FieldValue } = require('firebase-admin/firestore');
const { transactionView, currentPilot, originalOwnership, read } = require('./mayaRecoveryOfferService');
const { loadRecoveryResponseWindow } = require('./mayaRecoveryResponseWindow');
const { deliveryProof } = require('./mayaRecoveryDeliveryProof');
const { loadMutationEpochReceipt } = require('./demacCustomerAppointmentMutationGuard');
const { communicationEpochDecision, customerSemanticContent } = require('./demacCustomerTurn');
const { resolveInboundParty } = require('./customerContactDirectory');
const { digest } = require('./demacCustomerInterestHistory');
const { documentId, dateKey, timeKey } = require('./mayaOperationsReadModel');
const { hashId, arubaDateParts } = require('./bookingSchedulingPrimitives');
const { sessionIdentity, updateCustomerConversationStateAfterTool, recordCustomerConversationOutcome } = require('./demacCustomerConversationState');
const P = require('./mayaRecoveryOfferPolicy');
const need = P.requireCondition;
const VERSION = 1;
const PREFIX = 'MRC-';
const QUEUE = 'whatsappOutboundQueue';
const MARKERS = ['recoveryConfirmation', 'confirmationDispatchFingerprint', 'confirmationAttemptedAtIso'];

function confirmationQueueId(conversationId, messageId) {
  return `${PREFIX}${hashId(`${conversationId}|${messageId}|recovery-confirmation`, 40).toUpperCase()}`;
}
function ordinaryReplyId(conversationId, messageId) {
  return `AI-${hashId(`${conversationId}|${messageId}|outbound`, 40).toUpperCase()}`;
}
function isRecoveryConfirmation(queueId, item = {}) {
  return String(queueId || '').startsWith(PREFIX) || MARKERS.some(key => Object.prototype.hasOwnProperty.call(item, key));
}
function completionPin(offer) {
  return { version: VERSION, offerId: offer.id, offerVersion: offer.version,
    appointmentId: offer.recovery.appointmentId, responseFingerprint: digest(offer.recovery.response) };
}
function renderConfirmation(appointment, language) {
  need(dateKey(appointment.date) && timeKey(appointment.startTime), 'recovery_confirmation_invalid_date');
  need(['en', 'es'].includes(language), 'recovery_confirmation_language_pending');
  return language === 'es'
    ? `Tu cita quedó adelantada al *${appointment.date}* a las *${appointment.startTime}* (hora de Aruba).`
    : `Your appointment has been moved earlier to *${appointment.date}* at *${appointment.startTime}* (Aruba time).`;
}

async function completedCandidate(reader, context) {
  const conversationId = documentId(context.conversationId);
  const messageId = documentId(context.inboundMessageId);
  const [conversation, message] = await Promise.all([read(reader, 'communicationConversations', conversationId),
    read(reader, 'whatsappMessages', messageId)]);
  const pin = message?.mayaRecoveryCompletion;
  const route = message?.mayaRecoveryResponseRoute;
  const pointer = pin || (route ? { id: route.offerId, version: route.offerVersion } : conversation?.mayaRecoveryOffer);
  if (!pointer) return null;
  const offerId = documentId(pin ? pin.offerId : pointer.id);
  const offerVersion = pin ? pin.offerVersion : pointer.version;
  const offer = await read(reader, 'bookingOffers', offerId);
  // An old completed offer must not capture a later unrelated customer turn.
  if (pin === undefined && offer?.recovery?.response?.messageId !== messageId) return null;
  need(offer, 'recovery_confirmation_completion_missing');
  const r = P.assertOffer(offer, offerVersion);
  if (pin === undefined && r.response?.decision !== 'accept') return null;
  need(message && r.state === 'accepted' && offer.status === 'booked'
    && r.response?.decision === 'accept' && r.response.messageId === messageId,
  'recovery_confirmation_completion_changed');
  if (pin !== undefined) need(digest(pin) === digest(completionPin(offer)), 'recovery_confirmation_completion_changed');
  return { conversation, message, offer };
}

async function verifiedConfirmation(reader, context, now) {
  const candidate = await completedCandidate(reader, context);
  if (!candidate) return null;
  const { offer, message } = candidate;
  const r = offer.recovery;
  const pilot = await currentPilot(reader, context.conversationId);
  need(pilot.settings.recoveryConfirmationEnabled === true && pilot.settings.recoveryResponseRoutingEnabled === true,
    'recovery_confirmation_disabled');
  need(pilot.conversation.provider === 'wacli' && pilot.conversation.communicationAccountId === r.account
    && pilot.phone === r.phone && pilot.conversation.ownershipVersion === r.ownershipVersion
    && pilot.conversation.mayaRecoveryOffer?.id === offer.id && pilot.conversation.mayaRecoveryOffer?.version === offer.version,
  'recovery_confirmation_context_changed');
  need(message.direction === 'inbound' && message.provider === 'wacli'
    && message.conversationId === r.conversationId && message.communicationAccountId === r.account,
  'recovery_confirmation_source_changed');
  const receipt = await loadMutationEpochReceipt({ db: reader, transaction: { get: ref => ref.get() },
    conversationId: r.conversationId, inboundMessageId: message.id });
  need(receipt.valid && receipt.communicationAccountId === r.account
    && receipt.expectedOwnershipVersion === r.ownershipVersion
    && receipt.expectedCustomerInputVersion === r.response.customerInputVersion
    && message.customerInputVersion === r.response.customerInputVersion
    && communicationEpochDecision({ conversation: pilot.conversation, expectedOwnershipVersion: receipt.expectedOwnershipVersion,
      expectedCustomerInputVersion: receipt.expectedCustomerInputVersion }).allowed,
  'recovery_confirmation_stale_turn');
  for (const [key, expected] of [['communicationAccountId', r.account], ['expectedOwnershipVersion', r.ownershipVersion],
    ['expectedCustomerInputVersion', r.response.customerInputVersion]]) {
    if (context[key] !== undefined) need(context[key] === expected, 'recovery_confirmation_stale_turn');
  }
  const acceptedAt = Date.parse(r.response.at || '');
  need(Number.isFinite(acceptedAt) && acceptedAt >= Date.parse(offer.createdAtIso)
    && acceptedAt < Date.parse(offer.expiresAt) && acceptedAt <= now.getTime(), 'recovery_confirmation_completion_changed');
  need(r.response.responseWindow?.version === 1, 'recovery_confirmation_source_changed');
  await loadRecoveryResponseWindow({ reader, offer, conversation: pilot.conversation, message, receipt,
    quote: r.response.sourceQuote, now });
  const sourceFingerprint = digest({ id: message.id, direction: message.direction, conversationId: message.conversationId,
    account: message.communicationAccountId, input: message.customerInputVersion, content: customerSemanticContent(message, 8000),
    firstIngestedAtIso: message.firstIngestedAtIso, whatsappTimestamp: message.whatsappTimestamp });
  need(sourceFingerprint === r.response.sourceFingerprint, 'recovery_confirmation_source_changed');
  need(r.delivery, 'recovery_confirmation_delivery_missing');
  const delivery = await deliveryProof(reader, offer, documentId(r.delivery.queueId), documentId(r.delivery.messageId), now);
  need(digest(delivery) === digest(r.delivery), 'recovery_confirmation_delivery_changed');
  const [appointment, property, record, party] = await Promise.all([
    read(reader, 'appointments', r.appointmentId), read(reader, 'properties', offer.request.propertyId),
    read(reader, 'communicationCases', r.caseId), resolveInboundParty(reader, { phone: pilot.phone, whatsapp: pilot.phone }),
  ]);
  need(!party.ambiguous && party.customer?.active !== false && party.customer?.id === offer.request.customerId
    && property?.active !== false && property?.clientId === offer.request.customerId,
  'recovery_confirmation_customer_changed');
  need(appointment?.customerId === offer.request.customerId && appointment?.propertyId === offer.request.propertyId
    && appointment?.status === 'confirmed' && appointment.offerId === offer.id && appointment.offerVersion === offer.version
    && appointment.selectedOptionId === offer.options[0].id && appointment.date === offer.options[0].date
    && appointment.startTime === offer.options[0].time && P.originalFingerprint(appointment) === r.response.canonicalFingerprint,
  'recovery_confirmation_appointment_changed');
  await originalOwnership(reader, appointment);
  const currentTime = arubaDateParts(now);
  need(`${appointment.date}T${appointment.startTime}` > `${currentTime.date}T${currentTime.time}`,
    'recovery_confirmation_appointment_elapsed');
  need(record?.state === 'FULFILLED' && record.customerId === offer.request.customerId
    && record.propertyId === offer.request.propertyId && record.conversationId === r.conversationId
    && record.communicationAccountId === r.account && record.fulfillment?.offerId === offer.id
    && record.fulfillment.offerVersion === offer.version && record.fulfillment.appointmentId === appointment.id
    && record.fulfillment.sourceMessageId === message.id, 'recovery_confirmation_waiting_changed');
  const identity = sessionIdentity({ communicationAccountId: r.account, provider: 'wacli', conversationId: r.conversationId });
  need(identity, 'recovery_confirmation_context_changed');
  const session = await read(reader, 'customerAgentSessions', identity.sessionId);
  need(!session || (session.status !== 'HUMAN_ACTIVE' && session.requiresHuman !== true
    && (!session.communicationAccountId || session.communicationAccountId === r.account)), 'recovery_confirmation_human_review');
  const language = pilot.conversation.language;
  const text = renderConfirmation(appointment, language);
  const proof = { ...completionPin(offer), sourceMessageId: message.id, language,
    canonicalFingerprint: r.response.canonicalFingerprint, responseWindowFingerprint: r.response.responseWindow.fingerprint };
  const material = { provider: 'wacli', outboundClass: 'conversation_maya', communicationAccountId: r.account,
    conversationId: r.conversationId, sourceInboundMessageId: message.id, to: pilot.phone, text,
    expectedOwnershipVersion: r.ownershipVersion, expectedCustomerInputVersion: r.response.customerInputVersion,
    recoveryConfirmation: proof };
  return { offer, appointment, context: { ...context, communicationAccountId: r.account, provider: 'wacli' },
    material, result: { draft: text, source: 'maya-canonical-recovery-confirmation', warning: '', metadata: {
      outcome: 'appointment_rescheduled', language, appointmentId: appointment.id, appointmentRescheduled: true,
      requiresHuman: false, humanActive: false, handoffQueue: '', handoffReason: '', recoveryConfirmation: proof } } };
}

function confirmationMaterial(item) {
  const fields = ['provider', 'outboundClass', 'communicationAccountId', 'conversationId', 'sourceInboundMessageId', 'to', 'text',
    'expectedOwnershipVersion', 'expectedCustomerInputVersion', 'recoveryConfirmation'];
  return Object.fromEntries(fields.map(key => [key, item[key] ?? null]));
}
function confirmationDispatchFingerprint(queueId, item) {
  return digest({ queueId, material: confirmationMaterial(item), media: item.media ?? null });
}
function confirmationClaimIsUnchanged(queueId, item) {
  return isRecoveryConfirmation(queueId, item) && typeof item.confirmationAttemptedAtIso === 'string'
    && Number.isFinite(Date.parse(item.confirmationAttemptedAtIso))
    && item.confirmationDispatchFingerprint === confirmationDispatchFingerprint(queueId, item);
}
function assertQueue(queueId, queue, verified) {
  need(queueId === confirmationQueueId(verified.material.conversationId, verified.material.sourceInboundMessageId)
    && !queue.media && digest(confirmationMaterial(queue)) === digest(verified.material), 'recovery_confirmation_queue_changed');
}

function createMayaRecoveryConfirmation({ db, clock = () => new Date() } = {}) {
  async function recover(context) {
    return db.runTransaction(async transaction => {
      const verified = await verifiedConfirmation(transactionView(db, transaction).db, context, clock());
      return verified?.result || null;
    }, { readOnly: true });
  }
  async function runWithRecovery({ context, run }) {
    const prior = await recover(context);
    if (prior) return prior;
    let result;
    try { result = await run(); }
    catch (error) {
      const committed = await recover(context);
      if (committed) return committed;
      throw error;
    }
    // A successful model response is still not canonical proof. Replace its
    // prose when this exact turn has a verified committed earlier move.
    return (await recover(context)) || result;
  }
  async function enqueueIfCompleted({ context, result } = {}) {
    return db.runTransaction(async transaction => {
      const reader = transactionView(db, transaction).db;
      const verified = await verifiedConfirmation(reader, context, clock());
      if (!verified) {
        need(!result?.metadata?.recoveryConfirmation, 'recovery_confirmation_completion_missing');
        return null;
      }
      const { material, appointment } = verified;
      const queueId = confirmationQueueId(material.conversationId, material.sourceInboundMessageId);
      const [existing, ordinary] = await Promise.all([read(reader, QUEUE, queueId),
        read(reader, QUEUE, ordinaryReplyId(material.conversationId, material.sourceInboundMessageId))]);
      need(!ordinary, 'recovery_confirmation_other_reply_exists');
      if (existing) {
        assertQueue(queueId, existing, verified);
        need(['queued', 'processing', 'sent', 'delivered', 'read'].includes(existing.status),
          'recovery_confirmation_reconciliation_required');
        return { queued: true, id: queueId, existing: true, recoveryConfirmation: true };
      }
      transaction.set(db.collection(QUEUE).doc(queueId), { id: queueId, ...material, status: 'queued', type: 'text', attempts: 0,
        createdByUserId: 'demac-customer-agent', createdByName: 'Maya', createdAt: FieldValue.serverTimestamp(),
        createdAtIso: clock().toISOString(), updatedAt: FieldValue.serverTimestamp() });
      transaction.set(db.collection('communicationConversations').doc(material.conversationId), {
        aiDisposition: 'ai_active', status: 'waiting_customer', agentLastOutcome: 'appointment_rescheduled',
        agentLastAppointmentId: appointment.id, agentLastHandoffQueue: null, agentLastHandoffReason: null,
        agentLastInboundMessageId: material.sourceInboundMessageId, agentLastProcessedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(db.collection('whatsappMessages').doc(material.sourceInboundMessageId), {
        mayaRecoveryConfirmationQueued: { version: VERSION, queueId, proofFingerprint: digest(material.recoveryConfirmation) },
      }, { merge: true });
      // Existing session services write through this same transaction-bound view.
      // They perform no reads after the queue/conversation writes above.
      await updateCustomerConversationStateAfterTool({ db: reader, context: verified.context, toolName: 'reschedule_appointment',
        result: { success: true, appointmentId: appointment.id }, now: clock() });
      await recordCustomerConversationOutcome({ db: reader, context: verified.context, outcome: 'appointment_rescheduled',
        language: material.recoveryConfirmation.language, appointmentId: appointment.id, now: clock() });
      return { queued: true, id: queueId, existing: false, recoveryConfirmation: true };
    });
  }
  return { recover, runWithRecovery, enqueueIfCompleted };
}

async function recoveryConfirmationClaimDecision({ db, transaction, queueId, queueItem, now = new Date() }) {
  if (!isRecoveryConfirmation(queueId, queueItem)) return null;
  try {
    need(queueItem.status === 'queued' && !queueItem.processingStartedAt && !queueItem.confirmationAttemptedAtIso
      && (queueItem.attempts === undefined || queueItem.attempts === 0), 'recovery_confirmation_reconciliation_required');
    const verified = await verifiedConfirmation(transactionView(db, transaction).db, {
      conversationId: queueItem.conversationId, inboundMessageId: queueItem.sourceInboundMessageId,
      communicationAccountId: queueItem.communicationAccountId, expectedOwnershipVersion: queueItem.expectedOwnershipVersion,
      expectedCustomerInputVersion: queueItem.expectedCustomerInputVersion,
    }, now);
    need(verified, 'recovery_confirmation_completion_missing');
    assertQueue(queueId, queueItem, verified);
    return { allowed: true, reason: 'recovery-confirmation-current', claimPatch: {
      confirmationAttemptedAtIso: now.toISOString(), confirmationDispatchFingerprint: confirmationDispatchFingerprint(queueId, queueItem) } };
  } catch (error) {
    if (error?.code === 'invalid_request' || String(error?.code || '').startsWith('recovery_')) {
      return { allowed: false, reason: 'recovery-confirmation-blocked', recoveryReason: error.code };
    }
    throw error;
  }
}
module.exports = { VERSION, PREFIX, completionPin, confirmationQueueId, ordinaryReplyId, isRecoveryConfirmation,
  renderConfirmation, verifiedConfirmation, confirmationMaterial, confirmationDispatchFingerprint, confirmationClaimIsUnchanged,
  createMayaRecoveryConfirmation, recoveryConfirmationClaimDecision };
