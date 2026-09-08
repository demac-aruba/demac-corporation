'use strict';

// A scoped adapter inside the existing Customer Runtime registry, not a new
// agent/tool loop, sender, scheduling authority or public endpoint.
const { createMayaRecoveryOfferService, transactionView, currentPilot, unchangedBasis, originalOwnership, read } = require('./mayaRecoveryOfferService');
const { loadMutationEpochReceipt } = require('./demacCustomerAppointmentMutationGuard');
const { communicationEpochDecision, customerSemanticContent } = require('./demacCustomerTurn');
const { resolveInboundParty } = require('./customerContactDirectory');
const { digest } = require('./demacCustomerInterestHistory');
const { documentId } = require('./mayaOperationsReadModel');
const { loadRecoveryResponseWindow } = require('./mayaRecoveryResponseWindow');
const P = require('./mayaRecoveryOfferPolicy');
const need = P.requireCondition;
const READ = 'get_appointment_change_context';
const ACCEPT = 'reschedule_appointment';
const INTEREST = 'record_booking_interest';
const DECLINE_ACTION = 'decline_offer';
const EMPTY_INTEREST_FIELDS = ['kind', 'customerId', 'propertyId', 'appointmentId', 'sourceQuote', 'dateFrom', 'dateTo'];

function publicFailure(error) {
  const code = typeof error?.code === 'string' && (/^recovery_[a-z_]+$/.test(error.code) || error.code === 'invalid_request')
    ? error.code : 'recovery_chat_unavailable';
  return { success: false, error: { code,
    message: 'The earlier-offer action was not verified. Do not claim a booking change. Read the exact offer context, clarify, or hand off to scheduling.',
    details: {} } };
}

// Detection intentionally still recognizes a pending offer when routing has been
// disabled. A recorded route also prevents pointer removal from enabling fallback
// writes for the same inbound turn. Recording is reserved to the Observer caller.
async function readRecoveryTurnScope({ db, context = {}, recordRoute = false } = {}) {
  const conversationId = context.conversationId || context.conversationKey;
  const messageId = context.inboundMessageId || context.messageId;
  if (!conversationId || !messageId) return null;
  documentId(conversationId); documentId(messageId);
  const [initial, initialMessage] = await Promise.all([
    read(db, 'communicationConversations', conversationId), read(db, 'whatsappMessages', messageId),
  ]);
  if (!initial?.mayaRecoveryOffer && initialMessage?.mayaRecoveryResponseRoute === undefined) return null;
  need(typeof db.runTransaction === 'function', 'recovery_transaction_required');
  return db.runTransaction(async transaction => {
    const reader = transactionView(db, transaction).db;
    const conversation = await read(reader, 'communicationConversations', conversationId);
    need(conversation?.mayaRecoveryOffer, 'recovery_chat_scope_changed');
    const pointer = conversation.mayaRecoveryOffer;
    const offer = await read(reader, 'bookingOffers', documentId(pointer.id));
    const r = P.assertOffer(offer, pointer.version);
    need(r.conversationId === conversationId && r.account === conversation.communicationAccountId,
      'recovery_wrong_conversation');
    need(['prepared', 'sent', 'accepted', 'declined', 'expired'].includes(r.state), 'recovery_chat_scope_changed');
    const message = await read(reader, 'whatsappMessages', messageId);
    need(message && message.direction === 'inbound' && message.conversationId === conversationId
      && message.communicationAccountId === r.account && Number.isSafeInteger(message.customerInputVersion)
      && message.customerInputVersion > 0 && message.customerInputVersion === conversation.customerInputVersion,
    'recovery_stale_response');
    const recorded = message.mayaRecoveryResponseRoute;
    // The original request is not a response. A completed offer must not capture
    // a later unrelated conversation; its exact response may still replay.
    if (message.customerInputVersion <= r.customerInputVersion) {
      need(recorded === undefined, 'recovery_chat_scope_changed');
      return null;
    }
    if (r.response) {
      need(['accept', 'decline'].includes(r.response.decision)
        && r.state === (r.response.decision === 'accept' ? 'accepted' : 'declined')
        && offer.status === (r.response.decision === 'accept' ? 'booked' : 'declined')
        && Number.isSafeInteger(r.response.customerInputVersion)
        && r.response.customerInputVersion > r.customerInputVersion, 'recovery_chat_scope_changed');
      documentId(r.response.messageId);
      if (r.response.messageId !== messageId) {
        need(recorded === undefined && message.customerInputVersion > r.response.customerInputVersion,
          'recovery_chat_scope_changed');
        return null;
      }
    }
    const receipt = await loadMutationEpochReceipt({ db: reader, transaction: { get: ref => ref.get() },
      conversationId, inboundMessageId: messageId });
    need(receipt.valid && receipt.communicationAccountId === r.account
      && communicationEpochDecision({ conversation, expectedOwnershipVersion: receipt.expectedOwnershipVersion,
        expectedCustomerInputVersion: receipt.expectedCustomerInputVersion }).allowed,
    'recovery_stale_response');
    if (context.expectedOwnershipVersion !== undefined) {
      need(context.expectedOwnershipVersion === receipt.expectedOwnershipVersion, 'recovery_stale_response');
    }
    if (context.expectedCustomerInputVersion !== undefined) {
      need(context.expectedCustomerInputVersion === receipt.expectedCustomerInputVersion, 'recovery_stale_response');
    }
    const route = { version: 1, offerId: offer.id, offerVersion: offer.version, account: r.account,
      ownershipVersion: receipt.expectedOwnershipVersion, customerInputVersion: receipt.expectedCustomerInputVersion };
    if (recorded !== undefined) need(digest(recorded) === digest(route), 'recovery_chat_scope_changed');
    if (recordRoute && recorded === undefined) {
      transaction.set(db.collection('whatsappMessages').doc(messageId), { mayaRecoveryResponseRoute: route }, { merge: true });
    }
    return { conversationId, messageId, offerId: offer.id, offerVersion: offer.version };
  }, { readOnly: !recordRoute });
}

async function verifyScopedIdentity(reader, scope) {
  const pilot = await currentPilot(reader, scope.conversationId);
  need(pilot.conversation.mayaRecoveryOffer?.id === scope.offerId
    && pilot.conversation.mayaRecoveryOffer?.version === scope.offerVersion, 'recovery_chat_scope_changed');
  const offer = await read(reader, 'bookingOffers', scope.offerId);
  const r = P.assertOffer(offer, scope.offerVersion);
  need(r.conversationId === scope.conversationId && r.account === pilot.conversation.communicationAccountId
    && r.phone === pilot.phone && r.ownershipVersion === pilot.conversation.ownershipVersion, 'recovery_pilot_blocked');
  const party = await resolveInboundParty(reader, { phone: pilot.phone, whatsapp: pilot.phone });
  const property = await read(reader, 'properties', offer.request.propertyId);
  need(!party.ambiguous && party.customer?.active !== false && party.customer?.id === offer.request.customerId
    && property?.active !== false && property?.clientId === offer.request.customerId, 'recovery_customer_changed');
  if (r.response?.decision === 'accept') {
    const appointment = await read(reader, 'appointments', r.appointmentId);
    need(appointment?.customerId === offer.request.customerId && appointment?.propertyId === offer.request.propertyId
      && appointment?.status === 'confirmed' && appointment?.offerId === offer.id && appointment?.offerVersion === offer.version
      && P.originalFingerprint(appointment) === r.response.canonicalFingerprint, 'recovery_replay_changed');
    await originalOwnership(reader, appointment);
  }
}

function routingGuardedDb(db, scope) {
  return {
    collection: db.collection.bind(db),
    runTransaction: (callback, options) => db.runTransaction(async transaction => {
      const snapshot = await transaction.get(db.collection('businessSettings').doc('customer-agent'));
      need(snapshot.exists && snapshot.data()?.recoveryResponseRoutingEnabled === true, 'recovery_chat_routing_disabled');
      if (scope) await verifyScopedIdentity(transactionView(db, transaction).db, scope);
      return callback(transaction);
    }, options),
  };
}

function compactAppointment(appointment) {
  return { id: appointment.id, customerId: appointment.customerId, propertyId: appointment.propertyId,
    status: appointment.status, date: appointment.date, startTime: appointment.startTime, endTime: appointment.endTime };
}

function createMayaRecoveryConversationTools({ db, clock = () => new Date(), analyzeResponse, apiKeyProvider } = {}) {
  function recoveryService(scope) {
    // A fresh adapter captures exactly this scope; never retain another chat's
    // identity in a shared service instance.
    return createMayaRecoveryOfferService({ db: routingGuardedDb(db, scope), clock,
      ...(analyzeResponse ? { analyzeResponse } : {}), ...(apiKeyProvider ? { apiKeyProvider } : {}) });
  }
  async function loadCurrent(scope) {
    return routingGuardedDb(db, scope).runTransaction(async transaction => {
      const reader = transactionView(db, transaction).db;
      const pilot = await currentPilot(reader, scope.conversationId);
      const offer = await read(reader, 'bookingOffers', scope.offerId);
      const r = P.assertOffer(offer, scope.offerVersion);
      const receipt = await loadMutationEpochReceipt({ db: reader, transaction: { get: ref => ref.get() },
        conversationId: scope.conversationId, inboundMessageId: scope.messageId });
      need(receipt.valid && receipt.communicationAccountId === r.account
        && communicationEpochDecision({ conversation: pilot.conversation,
          expectedOwnershipVersion: receipt.expectedOwnershipVersion,
          expectedCustomerInputVersion: receipt.expectedCustomerInputVersion }).allowed, 'recovery_stale_response');
      const message = await read(reader, 'whatsappMessages', scope.messageId);
      need(message?.direction === 'inbound' && message.conversationId === scope.conversationId
        && message.communicationAccountId === r.account && message.customerInputVersion === receipt.expectedCustomerInputVersion,
      'recovery_stale_response');
      const fullText = customerSemanticContent(message, 8001);
      need(fullText.length >= 2 && fullText.length <= 8000, 'recovery_response_requires_clarification');
      const original = r.response?.decision === 'accept'
        ? await read(reader, 'appointments', r.appointmentId)
        : (await unchangedBasis(reader, offer, pilot)).original;
      let evidence = null;
      let evidenceError = '';
      try {
        evidence = await loadRecoveryResponseWindow({ reader, offer, conversation: pilot.conversation,
          message, receipt, quote: fullText.slice(0, 800), now: clock() });
      } catch (error) {
        if (!/^recovery_[a-z_]+$/.test(error?.code || '')) throw error;
        evidenceError = error.code;
      }
      return { offer: evidence?.offer || offer, original, sourceQuote: fullText.slice(0, 800),
        responseEvidenceReady: Boolean(evidence), responseMessageCount: evidence?.entries.length || 0,
        deliveryReconciledReadOnly: evidence?.reconciledDelivery === true, evidenceError,
        context: { conversationId: scope.conversationId, inboundMessageId: scope.messageId } };
    }, { readOnly: true });
  }
  async function invokeIfScoped(name, args = {}, context = {}) {
    try {
      const scope = await readRecoveryTurnScope({ db, context });
      if (!scope) return null;
      const current = await loadCurrent(scope);
      const { offer, original, sourceQuote } = current;
      if (name === READ) {
        need(args && !Array.isArray(args) && Object.keys(args).length === 0, 'invalid_request');
        const option = offer.options[0];
        return { success: true, workflow: 'earlier_offer', appointmentId: original.id,
          appointment: compactAppointment(original), offerId: offer.id, offerVersion: offer.version,
          optionId: option.id, date: option.date, time: option.time, endTime: option.endTime,
          expiresAt: offer.expiresAt, state: offer.recovery.state,
          deliveryBound: Boolean(offer.recovery.delivery), capacityReserved: offer.recovery.state === 'accepted',
          responseEvidenceReady: current.responseEvidenceReady, responseMessageCount: current.responseMessageCount,
          deliveryReconciledReadOnly: current.deliveryReconciledReadOnly, responseEvidenceError: current.evidenceError,
          instructions: 'This is an existing earlier-time offer, not a new booking request. For an unequivocal acceptance call reschedule_appointment with these exact IDs, reason and note as empty strings. For rejection of this one time call record_booking_interest with action=decline_offer and every other field empty. The server reads all consecutive response fragments together. Do not call check_availability, create_appointment or cancel_appointment. A question, condition, expired offer, responseEvidenceReady=false or other requested change requires clarification or scheduling handoff. A read-only delivery reconciliation proves transport but does not change an appointment or resend anything. Do not claim any move until reschedule_appointment returns canonical success.' };
      }
      if (name === ACCEPT) {
        const keys = ['appointmentId', 'offerId', 'offerVersion', 'optionId', 'reason', 'note'];
        need(args && !Array.isArray(args) && Object.keys(args).length === keys.length
          && keys.every(key => Object.prototype.hasOwnProperty.call(args, key))
          && args.appointmentId === offer.recovery.appointmentId && args.offerId === offer.id
          && args.offerVersion === offer.version && args.optionId === offer.options[0].id
          && typeof args.reason === 'string' && typeof args.note === 'string', 'recovery_chat_option_mismatch');
        // Consent is interpreted from the complete canonical response by the
        // existing service. Caller prose cannot replace customer evidence.
        return await recoveryService(scope).respond({ offerId: offer.id, offerVersion: offer.version,
          decision: 'accept', sourceQuote }, current.context);
      }
      if (name === INTEREST && args?.action === DECLINE_ACTION) {
        need(Object.keys(args).length === 8 && EMPTY_INTEREST_FIELDS.every(field => args[field] === ''),
          'invalid_request');
        return await recoveryService(scope).respond({ offerId: offer.id, offerVersion: offer.version,
          decision: 'decline', sourceQuote }, current.context);
      }
      need(false, 'recovery_chat_use_scoped_offer');
    } catch (error) {
      return publicFailure(error);
    }
  }
  return { invokeIfScoped };
}

function recoveryToolDefinition(definition) {
  if (definition.name === READ) return { ...definition, description: `${definition.description} When an earlier-time offer is visible in this conversation, call this tool first; workflow=earlier_offer returns the existing exact offer and its response instructions.` };
  if (definition.name === ACCEPT) return { ...definition, description: `${definition.description} For workflow=earlier_offer from get_appointment_change_context, reuse those exact IDs rather than checking new availability. Call only after unequivocal acceptance and pass empty reason/note; the server re-reads the complete customer message and validates consent.` };
  if (definition.name !== INTEREST) return definition;
  return { ...definition,
    description: `${definition.description} To decline only the particular earlier-time offer returned by get_appointment_change_context, use action=decline_offer with EVERY other field empty. This never withdraws the general preference or cancels the existing appointment.`,
    parameters: { ...definition.parameters, properties: { ...definition.parameters.properties,
      action: { ...definition.parameters.properties.action,
        enum: [...definition.parameters.properties.action.enum, DECLINE_ACTION] } } } };
}

module.exports = { READ, ACCEPT, INTEREST, DECLINE_ACTION, publicFailure, readRecoveryTurnScope,
  routingGuardedDb, createMayaRecoveryConversationTools, recoveryToolDefinition };
