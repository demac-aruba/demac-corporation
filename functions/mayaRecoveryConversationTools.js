'use strict';

// A scoped adapter inside the existing Customer Runtime registry, not a new
// agent/tool loop, sender, scheduling authority or public endpoint.
const { createMayaRecoveryOfferService, transactionView, currentPilot, unchangedBasis, read } = require('./mayaRecoveryOfferService');
const { loadMutationEpochReceipt } = require('./demacCustomerAppointmentMutationGuard');
const { communicationEpochDecision, customerSemanticContent } = require('./demacCustomerTurn');
const { documentId } = require('./mayaOperationsReadModel');
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
// disabled. The adapter must reject rather than fall through to ordinary tools.
async function readRecoveryTurnScope({ db, context = {} } = {}) {
  const conversationId = context.conversationId || context.conversationKey;
  const messageId = context.inboundMessageId || context.messageId;
  if (!conversationId || !messageId) return null;
  documentId(conversationId); documentId(messageId);
  const initial = await read(db, 'communicationConversations', conversationId);
  if (!initial?.mayaRecoveryOffer) return null;
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
    const message = await read(reader, 'whatsappMessages', messageId);
    need(message && message.direction === 'inbound' && message.conversationId === conversationId
      && message.communicationAccountId === r.account && Number.isSafeInteger(message.customerInputVersion)
      && message.customerInputVersion > 0 && message.customerInputVersion === conversation.customerInputVersion,
    'recovery_stale_response');
    // The original request is not a response. A completed offer must not capture
    // a later unrelated conversation; its exact response may still replay.
    if (message.customerInputVersion <= r.customerInputVersion) return null;
    if (r.response && r.response.messageId !== messageId) return null;
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
    return { conversationId, messageId, offerId: offer.id, offerVersion: offer.version };
  }, { readOnly: true });
}

function routingGuardedDb(db) {
  return {
    collection: db.collection.bind(db),
    runTransaction: (callback, options) => db.runTransaction(async transaction => {
      const snapshot = await transaction.get(db.collection('businessSettings').doc('customer-agent'));
      need(snapshot.exists && snapshot.data()?.recoveryResponseRoutingEnabled === true, 'recovery_chat_routing_disabled');
      return callback(transaction);
    }, options),
  };
}

function compactAppointment(appointment) {
  return { id: appointment.id, customerId: appointment.customerId, propertyId: appointment.propertyId,
    status: appointment.status, date: appointment.date, startTime: appointment.startTime, endTime: appointment.endTime };
}

function createMayaRecoveryConversationTools({ db, clock = () => new Date(), analyzeResponse, apiKeyProvider } = {}) {
  let service;
  function recoveryService() {
    if (!service) service = createMayaRecoveryOfferService({ db: routingGuardedDb(db), clock,
      ...(analyzeResponse ? { analyzeResponse } : {}), ...(apiKeyProvider ? { apiKeyProvider } : {}) });
    return service;
  }
  async function loadCurrent(scope, context) {
    return routingGuardedDb(db).runTransaction(async transaction => {
      const reader = transactionView(db, transaction).db;
      const pilot = await currentPilot(reader, scope.conversationId);
      need(pilot.conversation.mayaRecoveryOffer?.id === scope.offerId
        && pilot.conversation.mayaRecoveryOffer?.version === scope.offerVersion, 'recovery_chat_scope_changed');
      const offer = await read(reader, 'bookingOffers', scope.offerId);
      const r = P.assertOffer(offer, scope.offerVersion);
      need(r.conversationId === scope.conversationId && r.account === pilot.conversation.communicationAccountId
        && pilot.conversation.ownershipVersion === r.ownershipVersion && pilot.phone === r.phone, 'recovery_pilot_blocked');
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
      let original;
      if (r.response?.decision === 'accept') {
        original = await read(reader, 'appointments', r.appointmentId);
        need(r.response.messageId === scope.messageId && original?.customerId === offer.request.customerId
          && original?.propertyId === offer.request.propertyId && original?.offerId === offer.id
          && original?.offerVersion === offer.version && original?.status === 'confirmed'
          && P.originalFingerprint(original) === r.response.canonicalFingerprint, 'recovery_replay_changed');
      } else {
        original = (await unchangedBasis(reader, offer, pilot)).original;
      }
      return { offer, original, sourceQuote: fullText.slice(0, 800), context: {
        conversationId: scope.conversationId, inboundMessageId: scope.messageId,
      } };
    }, { readOnly: true });
  }
  async function invokeIfScoped(name, args = {}, context = {}) {
    try {
      const scope = await readRecoveryTurnScope({ db, context });
      if (!scope) return null;
      const current = await loadCurrent(scope, context);
      const { offer, original, sourceQuote } = current;
      if (name === READ) {
        need(args && !Array.isArray(args) && Object.keys(args).length === 0, 'invalid_request');
        const option = offer.options[0];
        return { success: true, workflow: 'earlier_offer', appointmentId: original.id,
          appointment: compactAppointment(original), offerId: offer.id, offerVersion: offer.version,
          optionId: option.id, date: option.date, time: option.time, endTime: option.endTime,
          expiresAt: offer.expiresAt, state: offer.recovery.state,
          deliveryBound: Boolean(offer.recovery.delivery), capacityReserved: offer.recovery.state === 'accepted',
          instructions: 'This is an existing earlier-time offer, not a new booking request. For an unequivocal acceptance call reschedule_appointment with these exact IDs, reason and note as empty strings. For rejection of this one time call record_booking_interest with action=decline_offer and every other field empty. Do not call check_availability, create_appointment or cancel_appointment. A question, condition, expired/unbound offer or other requested change requires clarification or scheduling handoff. Do not claim any move until reschedule_appointment returns canonical success.' };
      }
      if (name === ACCEPT) {
        const keys = ['appointmentId', 'offerId', 'offerVersion', 'optionId', 'reason', 'note'];
        need(args && !Array.isArray(args) && Object.keys(args).length === keys.length
          && keys.every(key => Object.prototype.hasOwnProperty.call(args, key))
          && args.appointmentId === offer.recovery.appointmentId && args.offerId === offer.id
          && args.offerVersion === offer.version && args.optionId === offer.options[0].id
          && typeof args.reason === 'string' && typeof args.note === 'string', 'recovery_chat_option_mismatch');
        // Consent is interpreted from the complete canonical current message by
        // the existing service. Caller prose cannot replace customer evidence.
        return await recoveryService().respond({ offerId: offer.id, offerVersion: offer.version,
          decision: 'accept', sourceQuote }, current.context);
      }
      if (name === INTEREST && args?.action === DECLINE_ACTION) {
        need(Object.keys(args).length === 8 && EMPTY_INTEREST_FIELDS.every(field => args[field] === ''),
          'invalid_request');
        return await recoveryService().respond({ offerId: offer.id, offerVersion: offer.version,
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
