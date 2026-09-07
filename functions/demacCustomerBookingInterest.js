const { FieldValue } = require('firebase-admin/firestore');
const { resolveInboundParty } = require('./customerContactDirectory');
const { communicationCaseId } = require('./demacCommunicationCaseService');
const { communicationEpochDecision, customerSemanticContent } = require('./demacCustomerTurn');
const { loadMutationEpochReceipt } = require('./demacCustomerAppointmentMutationGuard');
const { activeAccountDecision } = require('./demacCommunicationIdentity');
const { configuredAllowlist, mayaReplyDecision, mayaSenderOwnershipDecision, resolveConversationPhone } = require('./demacCustomerAgentReplyPolicy');
const { cleanText, hashId, arubaDateParts } = require('./bookingSchedulingPrimitives');
const { dateKey, documentId, failure } = require('./mayaOperationsReadModel');

const NAME = 'record_booking_interest';
const DEFINITION = {
  type: 'function', name: NAME, strict: true,
  description: 'Record or withdraw an explicitly expressed request for an appointment or an earlier appointment. Resolve the customer and property first. Quote the current inbound message exactly as evidence. This records a waiting preference only: it never books, holds capacity, moves the existing appointment, or authorizes proactive contact. Use empty dates when no exact date was given, and an empty appointmentId for a customer without a booking. Never claim future contact or a reserved slot from this result.',
  parameters: {
    type: 'object', additionalProperties: false,
    required: ['action', 'kind', 'customerId', 'propertyId', 'appointmentId', 'sourceQuote', 'dateFrom', 'dateTo'],
    properties: {
      action: { type: 'string', enum: ['register', 'withdraw'] },
      kind: { type: 'string', enum: ['new_appointment', 'earlier_appointment'] },
      customerId: { type: 'string' }, propertyId: { type: 'string' }, appointmentId: { type: 'string' },
      sourceQuote: { type: 'string' }, dateFrom: { type: 'string' }, dateTo: { type: 'string' },
    },
  },
};
// Reuse canonical party resolution with all reads in the same transaction.
// This adapter deliberately exposes no writes.
function transactionalReader(db, transaction) {
  function wrap(target) {
    return {
      get: () => transaction.get(target),
      doc: id => wrap(target.doc(id)),
      where: (...args) => wrap(target.where(...args)),
      limit: n => wrap(target.limit(n)),
    };
  }
  return { collection: name => wrap(db.collection(name)) };
}
function normalizeInterest(args = {}, today) {
  if (!['register', 'withdraw'].includes(args.action) || !['new_appointment', 'earlier_appointment'].includes(args.kind)) {
    throw failure('invalid_request', 'Choose a supported waiting-list action and kind.');
  }
  const customerId = documentId(args.customerId);
  const propertyId = documentId(args.propertyId);
  const appointmentId = documentId(args.appointmentId, false);
  if ((args.kind === 'earlier_appointment') !== Boolean(appointmentId)) throw failure('invalid_request', 'Earlier-date interest requires an exact appointment; new-booking interest must not supply one.');
  const sourceQuote = typeof args.sourceQuote === 'string' ? args.sourceQuote.trim() : '';
  if (sourceQuote.length < 3 || sourceQuote.length > 800) throw failure('invalid_request', 'A short exact quote from the current customer message is required.');
  const dateFrom = args.dateFrom ? dateKey(args.dateFrom) : '';
  const dateTo = args.dateTo ? dateKey(args.dateTo) : '';
  if ((args.dateFrom && !dateFrom) || (args.dateTo && !dateTo) || (dateFrom && dateTo && dateFrom > dateTo)) {
    throw failure('invalid_request', 'Waiting-list dates must be exact valid dates in chronological order.');
  }
  if (args.action === 'register' && dateTo && dateTo < today) throw failure('invalid_request', 'A past deadline cannot become an active waiting request.');
  return { action: args.action, kind: args.kind, customerId, propertyId, appointmentId, sourceQuote, dateFrom, dateTo };
}
function createCustomerBookingInterestTools({ db, clock = () => new Date() } = {}) {
  async function record(args, context = {}) {
    const now = clock();
    const input = normalizeInterest(args, arubaDateParts(now).date);
    const conversationId = documentId(context.conversationId || context.conversationKey);
    const messageId = documentId(context.inboundMessageId || context.messageId);
    return db.runTransaction(async transaction => {
      const read = async (collection, id) => {
        const snapshot = await transaction.get(db.collection(collection).doc(id));
        return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
      };
      const [settings, communicationSettings, conversation, message] = await Promise.all([
        read('businessSettings', 'customer-agent'), read('businessSettings', 'whatsapp'),
        read('communicationConversations', conversationId), read('whatsappMessages', messageId),
      ]);
      if (settings?.bookingInterestEnabled !== true) throw failure('booking_interest_disabled', 'Waiting-list capture is not enabled.');
      if (!conversation || !message) throw failure('context_missing', 'The canonical conversation and current customer message are required.');
      const account = activeAccountDecision({ conversation, message, settings: communicationSettings || {} });
      if (!account.allowed) throw failure('permission_denied', account.reason);
      const ownership = mayaSenderOwnershipDecision({ conversation });
      if (!ownership.allowed) throw failure('permission_denied', ownership.reason);
      const receipt = await loadMutationEpochReceipt({ db, transaction, conversationId, inboundMessageId: messageId });
      if (!receipt.valid || receipt.communicationAccountId !== conversation.communicationAccountId) throw failure('stale_context', 'Current account-bound customer-turn receipt is required.');
      const epoch = communicationEpochDecision({ conversation, expectedOwnershipVersion: receipt.expectedOwnershipVersion, expectedCustomerInputVersion: receipt.expectedCustomerInputVersion });
      if (!epoch.allowed) throw failure('stale_context', epoch.reason);
      const phone = resolveConversationPhone({ conversation });
      const reply = mayaReplyDecision({ conversation, settings, communicationSettings: communicationSettings || {} });
      if (!reply.allowed || !configuredAllowlist(settings).includes(phone)) throw failure('permission_denied', 'Only currently authorized pilot contacts may change waiting preferences.');
      if (message.direction !== 'inbound' || message.conversationId !== conversationId
        || message.communicationAccountId !== conversation.communicationAccountId
        || message.customerInputVersion !== receipt.expectedCustomerInputVersion) throw failure('stale_context', 'The source message must belong to this exact account, conversation and current turn.');
      const content = customerSemanticContent(message, 8000);
      if (!content || !content.includes(input.sourceQuote)) throw failure('evidence_missing', 'The supplied quote is not in the current customer message.');
      const party = await resolveInboundParty(transactionalReader(db, transaction), { phone, whatsapp: phone });
      if (party.ambiguous || !party.customer || party.customer.id !== input.customerId) throw failure('identity_mismatch', 'The current sender must resolve unambiguously to this canonical customer.');
      const property = await read('properties', input.propertyId);
      if (!property || property.active === false || property.clientId !== input.customerId) throw failure('identity_mismatch', 'The property must belong to the resolved customer.');
      const appointment = input.appointmentId ? await read('appointments', input.appointmentId) : null;
      if (input.action === 'register' && input.appointmentId && (!appointment || appointment.customerId !== input.customerId
        || appointment.propertyId !== input.propertyId || !['confirmed', 'scheduled'].includes(appointment.status)
        || !dateKey(appointment.date) || appointment.date < arubaDateParts(now).date)) {
        throw failure('appointment_changed', 'Earlier-date interest requires the current open appointment for this customer and property.');
      }
      if (input.action === 'register' && appointment && input.dateFrom && input.dateFrom > appointment.date) {
        throw failure('invalid_request', 'An earlier-date request cannot start after the current booking.');
      }
      const caseId = communicationCaseId({ communicationAccountId: conversation.communicationAccountId, conversationId,
        caseType: `booking_interest|${input.propertyId}|${input.kind}|${input.appointmentId}` });
      const ref = db.collection('communicationCases').doc(caseId);
      const previous = await read('communicationCases', caseId);
      const fingerprint = hashId(JSON.stringify(input), 40);
      if (previous && (previous.caseType !== 'booking_interest' || previous.customerId !== input.customerId
        || previous.propertyId !== input.propertyId || previous.conversationId !== conversationId
        || previous.communicationAccountId !== conversation.communicationAccountId)) throw failure('identity_mismatch', 'Existing waiting preference identity is inconsistent.');
      if (previous?.lastSourceMessageId === messageId) {
        if (previous.interestFingerprint !== fingerprint) throw failure('idempotency_conflict', 'The same customer turn cannot record two different waiting preferences.');
        return { success: true, replayed: true, caseId, state: previous.state, capacityReserved: false, proactiveContactAuthorized: false };
      }
      if (input.action === 'withdraw' && !previous) throw failure('interest_not_found', 'No matching waiting preference exists.');
      const state = input.action === 'withdraw' ? 'WITHDRAWN' : 'WAITING';
      const event = { messageId, action: input.action, at: now.toISOString(), sourceQuote: input.sourceQuote,
        ownershipVersion: receipt.expectedOwnershipVersion, customerInputVersion: receipt.expectedCustomerInputVersion };
      const history = [...(Array.isArray(previous?.interestHistory) ? previous.interestHistory : []), event].slice(-40);
      const originalDate = appointment?.date || previous?.bookingInterest?.originalDate || '';
      const originalTime = appointment?.startTime || previous?.bookingInterest?.originalTime || '';
      transaction.set(ref, {
        id: caseId, caseType: 'booking_interest', version: 1,
        communicationAccountId: conversation.communicationAccountId, conversationId,
        customerId: input.customerId, propertyId: input.propertyId, appointmentId: input.appointmentId,
        state, lastSourceMessageId: messageId, interestFingerprint: fingerprint, interestHistory: history,
        bookingInterest: { kind: input.kind, sourceQuote: input.sourceQuote, dateFrom: input.dateFrom, dateTo: input.dateTo,
          originalDate, originalTime, capacityReserved: false, proactiveContactAuthorized: false },
        createdAt: previous?.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(), updatedAtIso: now.toISOString(),
      }, { merge: true });
      return { success: true, replayed: false, caseId, state, capacityReserved: false, proactiveContactAuthorized: false,
        existingAppointmentUnchanged: true };
    });
  }
  async function invoke(name, args, context) {
    if (name !== NAME) return { success: false, error: { code: 'unknown_tool', message: 'Unsupported waiting-list tool.' } };
    try { return await record(args, context); }
    catch (error) { return { success: false, error: { code: error.code || 'internal_error', message: cleanText(error.message, 500) } }; }
  }
  return { definitions: [DEFINITION], invoke, record };
}
module.exports = { NAME, DEFINITION, createCustomerBookingInterestTools, normalizeInterest, transactionalReader };
