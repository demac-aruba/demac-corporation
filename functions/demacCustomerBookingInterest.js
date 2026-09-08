const { FieldValue } = require('firebase-admin/firestore');
const { resolveInboundParty } = require('./customerContactDirectory');
const { communicationCaseId } = require('./demacCommunicationCaseService');
const { communicationEpochDecision, customerSemanticContent } = require('./demacCustomerTurn');
const { loadMutationEpochReceipt } = require('./demacCustomerAppointmentMutationGuard');
const { activeAccountDecision } = require('./demacCommunicationIdentity');
const { configuredAllowlist, mayaReplyDecision, mayaSenderOwnershipDecision, resolveConversationPhone } = require('./demacCustomerAgentReplyPolicy');
const { cleanText, hashId, arubaDateParts } = require('./bookingSchedulingPrimitives');
const { dateKey, timeKey, documentId, failure } = require('./mayaOperationsReadModel');
const { interestSourceFingerprint } = require('./demacCustomerInterestSourceProof');

const NAME = 'record_booking_interest';
const DEFINITION = {
  type: 'function', name: NAME, strict: true,
  description: 'Record or withdraw an explicitly expressed waiting/earlier-appointment preference from the current customer message. Resolve customer/property first and quote the customer exactly. For an earlier request elsewhere in this same conversation, or a later acknowledgment/change of mind affecting it, use action=recover_recent with EVERY other field an empty string: the server reviews the canonical recent conversation, never a caller-selected other chat. Recovery may retain interest after thanks or withdraw it after a later explicit reversal. This tool never books, holds capacity, moves an appointment or authorizes proactive contact. Never claim future contact, availability or a reserved slot from its result. Disabled/incomplete recovery is not successful capture.',
  parameters: {
    type: 'object', additionalProperties: false,
    required: ['action', 'kind', 'customerId', 'propertyId', 'appointmentId', 'sourceQuote', 'dateFrom', 'dateTo'],
    properties: {
      action: { type: 'string', enum: ['register', 'withdraw', 'recover_recent'] },
      kind: { type: 'string', enum: ['new_appointment', 'earlier_appointment', ''] },
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
function bookingInterestCaseId(input, communicationAccountId, conversationId) {
  // communicationCaseId bounds caseType to 80 characters. Hash the complete
  // material identity first so long IDs cannot truncate away the appointment.
  const material = JSON.stringify([input.customerId, input.propertyId, input.kind, input.appointmentId]);
  return communicationCaseId({ communicationAccountId, conversationId, caseType: `booking_interest:${hashId(material, 40)}` });
}
function createCustomerBookingInterestTools({ db, clock = () => new Date(), historyRecovery = null } = {}) {
  let recovery = historyRecovery;
  async function record(args, context = {}) {
    const now = clock();
    const currentTime = arubaDateParts(now);
    const input = normalizeInterest(args, currentTime.date);
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
      const sourceFingerprint = interestSourceFingerprint(message);
      const party = await resolveInboundParty(transactionalReader(db, transaction), { phone, whatsapp: phone });
      if (party.ambiguous || !party.customer || party.customer.id !== input.customerId) throw failure('identity_mismatch', 'The current sender must resolve unambiguously to this canonical customer.');
      const property = await read('properties', input.propertyId);
      if (!property || property.active === false || property.clientId !== input.customerId) throw failure('identity_mismatch', 'The property must belong to the resolved customer.');
      // Withdrawal preserves the previously recorded booking snapshot. It must
      // not copy details from an appointment whose ownership may have changed.
      const appointment = input.action === 'register' && input.appointmentId ? await read('appointments', input.appointmentId) : null;
      if (input.action === 'register' && input.appointmentId && (!appointment || appointment.customerId !== input.customerId
        || appointment.propertyId !== input.propertyId || !['confirmed', 'scheduled'].includes(appointment.status)
        || !dateKey(appointment.date) || !timeKey(appointment.startTime) || appointment.date < currentTime.date
        || (appointment.date === currentTime.date && appointment.startTime <= currentTime.time))) {
        throw failure('appointment_changed', 'Earlier-date interest requires the current future open appointment for this customer and property.');
      }
      if (input.action === 'register' && appointment && ((input.dateFrom && input.dateFrom > appointment.date) || (input.dateTo && input.dateTo > appointment.date))) {
        throw failure('invalid_request', 'An earlier-date request cannot extend after the current booking.');
      }
      const caseId = bookingInterestCaseId(input, conversation.communicationAccountId, conversationId);
      const ref = db.collection('communicationCases').doc(caseId);
      const previous = await read('communicationCases', caseId);
      const fingerprint = hashId(JSON.stringify(input), 40);
      if (previous && (previous.caseType !== 'booking_interest' || previous.customerId !== input.customerId
        || previous.propertyId !== input.propertyId || previous.conversationId !== conversationId
        || previous.appointmentId !== input.appointmentId || previous.bookingInterest?.kind !== input.kind
        || previous.communicationAccountId !== conversation.communicationAccountId)) throw failure('identity_mismatch', 'Existing waiting preference identity is inconsistent.');
      if (previous?.lastSourceMessageId === messageId) {
        if (previous.interestFingerprint !== fingerprint) throw failure('idempotency_conflict', 'The same customer turn cannot record two different waiting preferences.');
        if (previous.interestSourceFingerprint !== sourceFingerprint) throw failure('stale_context', 'The full source message changed or requires a new evidenced review.');
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
        interestSourceFingerprint: sourceFingerprint,
        interestReview: null,
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
    try {
      if (args?.action === 'recover_recent') {
        const fields = ['kind', 'customerId', 'propertyId', 'appointmentId', 'sourceQuote', 'dateFrom', 'dateTo'];
        if (Object.keys(args).length !== 8 || fields.some(field => args[field] !== '')) throw failure('invalid_request', 'History recovery does not accept target, quote or date overrides.');
        // Lazy import avoids coupling the existing register/withdraw path to model execution.
        if (!recovery) recovery = require('./demacCustomerInterestRecovery').createCustomerInterestRecovery({ db, clock });
        return await recovery.invoke('recover_recent_booking_interest', {}, context);
      }
      return await record(args, context);
    } catch (error) { return { success: false, error: { code: error.code || 'internal_error', message: cleanText(error.message, 500) } }; }
  }
  return { definitions: [DEFINITION], invoke, record };
}
module.exports = { NAME, DEFINITION, bookingInterestCaseId, createCustomerBookingInterestTools, normalizeInterest, transactionalReader };
