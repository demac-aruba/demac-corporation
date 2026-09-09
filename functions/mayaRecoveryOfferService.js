'use strict';

// Internal composition service: no endpoint, sender, trigger or live activation.
const { FieldValue } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { createBookingAuthority } = require('./bookingAuthorityFirestore');
const { createBookingAppointmentLifecycle } = require('./bookingAuthorityAppointmentLifecycle');
const { createSchedulingProvider } = require('./bookingAuthoritySchedulingProvider');
const { createRecoveryLifecycleProvider } = require('./mayaRecoverySchedulingGuard');
const { normalizeBookingRequest, normalizeOfferOption } = require('./bookingAuthorityCore');
const { createMayaRecoveryMatching, recoveryTarget, releasedCapacityMatches } = require('./mayaRecoveryMatching');
const { activeAccountDecision } = require('./demacCommunicationIdentity');
const { communicationEpochDecision, customerSemanticContent } = require('./demacCustomerTurn');
const { loadMutationEpochReceipt } = require('./demacCustomerAppointmentMutationGuard');
const { resolveInboundParty } = require('./customerContactDirectory');
const { configuredAllowlist, mayaReplyDecision, mayaSenderOwnershipDecision, resolveConversationPhone } = require('./demacCustomerAgentReplyPolicy');
const { digest } = require('./demacCustomerInterestHistory');
const { documentId } = require('./mayaOperationsReadModel');
const { analyzeRecoveryResponse, validateDecision } = require('./mayaRecoveryResponseAnalysis');
const { deliveryProof } = require('./mayaRecoveryDeliveryProof');
const { loadRecoveryResponseWindow } = require('./mayaRecoveryResponseWindow');
const P = require('./mayaRecoveryOfferPolicy');
const need = P.requireCondition;

// Reuse one real transaction for all domain reads and the canonical lifecycle.
function transactionView(db, transaction, acceptedOfferId = '') {
  const targets = new WeakMap();
  const raw = target => targets.get(target) || target;
  function project(snapshot, target) {
    if (acceptedOfferId && raw(target).id === acceptedOfferId && raw(target).path === `bookingOffers/${acceptedOfferId}` && snapshot.exists) {
      return { id: snapshot.id, ref: snapshot.ref, exists: true, data: () => ({ ...snapshot.data(), status: 'open' }) };
    }
    return snapshot;
  }
  const t = { get: async target => project(await transaction.get(raw(target)), target),
    set: (target, value, options) => transaction.set(raw(target), value, options) };
  function wrap(target) {
    const result = { id: target.id, path: target.path, get: () => t.get(target), set: (value, options) => t.set(target, value, options),
      doc: id => wrap(target.doc(id)), where: (...args) => wrap(target.where(...args)), limit: count => wrap(target.limit(count)),
      orderBy: (...args) => wrap(target.orderBy(...args)), startAfter: cursor => wrap(target.startAfter(cursor)) };
    targets.set(result, target); return result;
  }
  return { db: { collection: name => wrap(db.collection(name)), runTransaction: callback => callback(t) }, transaction: t };
}
async function read(db, collection, id) {
  if (!id) return null;
  const snapshot = await db.collection(collection).doc(documentId(id)).get();
  return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
}
function publicOffer(offer, replayed = false) {
  const option = offer.options[0];
  return { success: true, replayed, offerId: offer.id, offerVersion: offer.version, state: offer.recovery.state,
    appointmentId: offer.recovery.appointmentId, date: option.date, time: option.time, endTime: option.endTime,
    expiresAt: offer.expiresAt, messageText: offer.recovery.messageText, ...P.NO_RESERVATION };
}
async function currentPilot(db, conversationId) {
  const [settings, comms, conversation] = await Promise.all([read(db, 'businessSettings', 'customer-agent'),
    read(db, 'businessSettings', 'whatsapp'), read(db, 'communicationConversations', conversationId)]);
  need(settings?.recoveryOffersEnabled === true, 'recovery_offers_disabled');
  need(conversation && activeAccountDecision({ conversation, settings: comms || {} }).allowed, 'recovery_account_changed');
  const phone = resolveConversationPhone({ conversation });
  need(configuredAllowlist(settings).includes(phone)
    && mayaReplyDecision({ conversation, settings, communicationSettings: comms || {} }).allowed
    && mayaSenderOwnershipDecision({ conversation }).allowed, 'recovery_pilot_blocked');
  return { settings, comms, conversation, phone };
}
async function unchangedBasis(db, offer, pilot) {
  const r = offer.recovery;
  need(pilot.conversation.communicationAccountId === r.account && pilot.phone === r.phone
    && pilot.conversation.ownershipVersion === r.ownershipVersion, 'recovery_account_changed');
  const [record, original, cancellation, property] = await Promise.all([read(db, 'communicationCases', r.caseId),
    read(db, 'appointments', r.appointmentId), read(db, 'appointments', r.cancellationId), read(db, 'properties', offer.request.propertyId)]);
  need(record?.state === 'WAITING' && P.preferenceFingerprint(record) === r.preferenceFingerprint, 'recovery_preference_changed');
  need(original && P.originalFingerprint(original) === r.originalFingerprint, 'recovery_original_changed');
  need(cancellation && P.originalFingerprint(cancellation) === r.cancellationFingerprint, 'recovery_cancellation_changed');
  const party = await resolveInboundParty(db, { phone: pilot.phone, whatsapp: pilot.phone });
  need(!party.ambiguous && party.customer?.active !== false && party.customer?.id === offer.request.customerId
    && property?.clientId === party.customer.id && property.active !== false, 'recovery_customer_changed');
  return { record, original, cancellation };
}
async function originalOwnership(db, original) {
  for (const field of ['workOrderIds', 'capacityLockIds']) {
    const ids = original[field];
    need(Array.isArray(ids) && ids.length > 0 && ids.length <= 48 && new Set(ids).size === ids.length, 'recovery_original_links_invalid');
    for (const id of ids) documentId(id);
  }
  const [orders, locks] = await Promise.all([Promise.all(original.workOrderIds.map(id => read(db, 'workOrders', id))),
    Promise.all(original.capacityLockIds.map(id => read(db, 'bookingCapacityLocks', id)))]);
  need(orders.every(order => order && order.appointmentId === original.id && order.clientId === original.customerId
    && order.propertyId === original.propertyId && order.date === original.date
    && ['confirmada', 'confirmed', 'scheduled'].includes(String(order.status).toLowerCase())
    && order.dispatchHoldActive !== true), 'recovery_original_work_changed');
  need(locks.every(lock => lock && lock.active === true && lock.appointmentId === original.id
    && lock.date === original.date), 'recovery_original_capacity_changed');
}
async function selectOption(db, transaction, provider, original, cancellation, now) {
  const target = recoveryTarget(cancellation, now);
  need(`${target.date}T${target.time}` < `${original.date}T${original.startTime}`, 'recovery_not_earlier');
  const request = normalizeBookingRequest({ customerId: original.customerId, propertyId: original.propertyId,
    workLines: original.workLines, notes: original.notes, constraints: { requestedDate: target.date, requestedTime: target.time } });
  const context = { channel: 'whatsapp', source: 'maya-recovery-offer', excludeAppointmentId: original.id, requiredPrimaryVanId: target.vanId };
  const available = await provider.checkAvailability({ request, context, now });
  for (const raw of available.options || []) {
    if (raw.date !== target.date || raw.time !== target.time || raw.endTime > target.endTime || raw.assignments?.[0]?.vanId !== target.vanId) continue;
    const option = normalizeOfferOption(raw);
    const valid = await provider.validateTransaction({ db, transaction, request, option, appointmentId: original.id, context, now });
    if (valid?.available !== true || !Array.isArray(valid.capacityLocks) || !valid.capacityLocks.length
      || valid.capacityLocks.some(lock => !target.formerCapacityIds.has(lock.id))) continue;
    const locks = await Promise.all(valid.capacityLocks.map(lock => read(db, 'bookingCapacityLocks', lock.id)));
    if (locks.some((lock, index) => !releasedCapacityMatches(lock, valid.capacityLocks[index]))) continue;
    return { request, context, option, available };
  }
  need(false, 'recovery_capacity_unavailable');
}
function pointerMatches(conversation, offer) {
  return conversation.mayaRecoveryOffer?.id === offer.id && conversation.mayaRecoveryOffer?.version === offer.version;
}
function responseMessageFingerprint(message) {
  return digest({ id: message.id, direction: message.direction, conversationId: message.conversationId,
    account: message.communicationAccountId, input: message.customerInputVersion, content: customerSemanticContent(message, 8000),
    firstIngestedAtIso: message.firstIngestedAtIso, whatsappTimestamp: message.whatsappTimestamp });
}
function createMayaRecoveryOfferService({ db, clock = () => new Date(), analyzeResponse = analyzeRecoveryResponse,
  apiKeyProvider = () => defineSecret('OPENAI_API_KEY').value() } = {}) {
  need(db && typeof db.runTransaction === 'function', 'transaction_required');
  async function prepare({ cancelledAppointmentId, caseId, afterId = '' } = {}) {
    documentId(cancelledAppointmentId); documentId(caseId); if (afterId) documentId(afterId);
    return db.runTransaction(async transaction => {
      const now = clock(); const view = transactionView(db, transaction); const reader = view.db;
      const record = await read(reader, 'communicationCases', caseId);
      need(record?.caseType === 'booking_interest' && record.bookingInterest?.kind === 'earlier_appointment', 'recovery_candidate_invalid');
      const pilot = await currentPilot(reader, record.conversationId);
      const ttl = P.configuredTtl(pilot.settings);
      const id = P.recoveryOfferId(pilot.conversation.communicationAccountId, cancelledAppointmentId);
      const [previous, pending, original, cancellation] = await Promise.all([read(reader, 'bookingOffers', id),
        read(reader, 'bookingOffers', pilot.conversation.mayaRecoveryOffer?.id), read(reader, 'appointments', record.appointmentId),
        read(reader, 'appointments', cancelledAppointmentId)]);
      if (previous) {
        P.assertOffer(previous, previous.version);
        if (P.isOpen(previous, now)) {
          need(previous.recovery.caseId === caseId && pointerMatches(pilot.conversation, previous), 'recovery_offer_already_pending');
          await unchangedBasis(reader, previous, pilot);
          need(pilot.conversation.customerInputVersion === previous.recovery.customerInputVersion, 'recovery_customer_turn_changed');
          return publicOffer(previous, true);
        }
        need(previous.recovery.state !== 'accepted', 'recovery_opening_already_used');
      }
      need(!pending || !P.isOpen(pending, now), 'recovery_conversation_has_offer');
      // Reuse the existing bounded inspector on the selected review page.
      const inspection = await createMayaRecoveryMatching({ db: { collection: db.collection.bind(db),
        runTransaction: callback => callback(transaction) }, clock: () => now,
      }).inspect({ cancelledAppointmentId, ...(afterId ? { afterId } : {}) });
      need(inspection.rows.some(row => row.caseId === caseId && row.status === 'compatible_for_review'), 'recovery_candidate_not_current');
      await originalOwnership(reader, original);
      const provider = createSchedulingProvider({ db: reader });
      const selection = await selectOption(reader, view.transaction, provider, original, cancellation, now);
      let staged;
      const stagingDb = { collection: name => {
        need(name === 'bookingOffers', 'recovery_offer_write_scope');
        return { doc: offerId => {
          need(offerId === id, 'recovery_offer_write_scope');
          return { get: async () => ({ exists: false, id }), set: async value => { staged = value; } };
        } };
      }, runTransaction: () => { throw new Error('No nested transaction is permitted.'); } };
      await createBookingAuthority({ db: stagingDb, clock: () => now, offerTtlMinutes: ttl,
        availabilityProvider: { checkAvailability: async () => ({ ...selection.available, options: [selection.option] }) },
      }).checkAvailability({ request: selection.request, actor: { id: 'demac-customer-agent', name: 'Maya', source: 'maya-recovery-offer' },
        context: { ...selection.context, requestKey: P.offerRequestKey(pilot.conversation.communicationAccountId, cancelledAppointmentId) } });
      need(staged, 'recovery_offer_not_created');
      const version = (previous?.version || 0) + 1;
      const expiresAt = new Date(Math.min(Date.parse(staged.expiresAt), Date.parse(`${selection.option.date}T${selection.option.time}:00-04:00`))).toISOString();
      const recovery = { version: P.VERSION, state: 'prepared', caseId, cancellationId: cancelledAppointmentId,
        conversationId: record.conversationId, account: pilot.conversation.communicationAccountId, phone: pilot.phone,
        appointmentId: original.id, originalFingerprint: P.originalFingerprint(original),
        cancellationFingerprint: P.originalFingerprint(cancellation), preferenceFingerprint: P.preferenceFingerprint(record),
        ownershipVersion: pilot.conversation.ownershipVersion, customerInputVersion: pilot.conversation.customerInputVersion,
        messageText: P.renderOffer(original, selection.option, expiresAt, pilot.conversation.language) };
      const offer = { ...staged, version, status: 'recovery_pending', expiresAt, recovery };
      recovery.fingerprint = P.offerFingerprint(offer);
      // Ordinary booking tools cannot consume this pending offer. It is opened
      // only in the transaction-local view of its verified acceptance below.
      transaction.set(db.collection('bookingOffers').doc(id), offer);
      transaction.set(db.collection('communicationConversations').doc(record.conversationId), { mayaRecoveryOffer: { id, version } }, { merge: true });
      return publicOffer(offer);
    });
  }
  async function bindDelivery({ offerId, offerVersion, queueId, outboundMessageId } = {}) {
    return db.runTransaction(async transaction => {
      const reader = transactionView(db, transaction).db; const offer = await read(reader, 'bookingOffers', offerId);
      const r = P.assertOffer(offer, offerVersion); const pilot = await currentPilot(reader, r.conversationId);
      need(pointerMatches(pilot.conversation, offer) && P.isOpen(offer, clock()), 'recovery_offer_expired');
      need(pilot.conversation.customerInputVersion === r.customerInputVersion, 'recovery_customer_turn_changed');
      await unchangedBasis(reader, offer, pilot);
      const delivery = await deliveryProof(reader, offer, documentId(queueId), documentId(outboundMessageId), clock());
      need(!r.delivery || digest(r.delivery) === digest(delivery), 'recovery_delivery_conflict');
      if (!r.delivery) transaction.set(db.collection('bookingOffers').doc(offer.id), { recovery: { ...r, state: 'sent', delivery } }, { merge: true });
      return publicOffer({ ...offer, recovery: { ...r, state: 'sent', delivery } }, Boolean(r.delivery));
    });
  }
  async function responseContext(reader, args, context) {
    const conversationId = documentId(context.conversationId); const messageId = documentId(context.inboundMessageId);
    let offer = await read(reader, 'bookingOffers', args.offerId); let r = P.assertOffer(offer, args.offerVersion);
    need(r.conversationId === conversationId, 'recovery_wrong_conversation');
    const pilot = await currentPilot(reader, conversationId);
    need(pointerMatches(pilot.conversation, offer) && pilot.phone === r.phone
      && pilot.conversation.communicationAccountId === r.account
      && pilot.conversation.ownershipVersion === r.ownershipVersion, 'recovery_pilot_blocked');
    const receipt = await loadMutationEpochReceipt({ db: reader, transaction: { get: ref => ref.get() }, conversationId, inboundMessageId: messageId });
    need(receipt.valid && receipt.communicationAccountId === r.account
      && communicationEpochDecision({ conversation: pilot.conversation, expectedOwnershipVersion: receipt.expectedOwnershipVersion,
        expectedCustomerInputVersion: receipt.expectedCustomerInputVersion }).allowed, 'recovery_stale_response');
    const message = await read(reader, 'whatsappMessages', messageId);
    need(message, 'recovery_response_missing');
    need(message.direction === 'inbound' && message.communicationAccountId === r.account && message.conversationId === conversationId
      && message.customerInputVersion === receipt.expectedCustomerInputVersion, 'recovery_stale_response');
    // Every consecutive source is read from canonical storage, including earlier
    // parts that may contain a qualification or reversal of the current fragment.
    const evidence = await loadRecoveryResponseWindow({ reader, offer, conversation: pilot.conversation,
      message, receipt, quote: args.sourceQuote, now: clock() });
    offer = evidence.offer; r = offer.recovery;
    const sourceFingerprint = responseMessageFingerprint(message);
    const fingerprint = digest({ offer: r.fingerprint, state: r.state, delivery: r.delivery || null, response: r.response || null,
      sourceFingerprint, responseWindow: evidence.proof,
      ownershipVersion: pilot.conversation.ownershipVersion, customerInputVersion: pilot.conversation.customerInputVersion });
    return { offer, r, pilot, receipt, message, sourceFingerprint, fingerprint, evidence };
  }
  async function respond(args = {}, context = {}) {
    const { decision, sourceQuote } = args;
    need(['accept', 'decline'].includes(decision), 'invalid_recovery_response');
    const first = await db.runTransaction(transaction => responseContext(transactionView(db, transaction).db, args, context), { readOnly: true });
    let interpretation = null;
    if (!first.r.response) {
      // Semantic interpretation is outside every Firestore transaction. Its result
      // never overrides deterministic binding, current state or capacity checks.
      const customerText = first.evidence.text;
      interpretation = validateDecision(await analyzeResponse({ offerText: first.r.messageText,
        customerText, customerMessages: first.evidence.entries.map(entry => entry.text), apiKey: apiKeyProvider() }), customerText);
      need(first.evidence.entries.some(entry => entry.text.includes(interpretation.quote.trim()))
        && interpretation.decision === decision && interpretation.confidence >= 0.9 && interpretation.ambiguous === false,
      'recovery_response_requires_clarification');
    }
    return db.runTransaction(async transaction => {
      const now = clock(); const reader = transactionView(db, transaction).db;
      const currentContext = await responseContext(reader, args, context);
      const { offer, r, pilot, receipt, message, sourceFingerprint } = currentContext;
      if (r.response) {
        need(r.response.messageId === message.id && r.response.decision === decision && r.response.sourceQuote === sourceQuote
          && r.response.sourceFingerprint === sourceFingerprint, 'recovery_response_conflict');
        if (decision === 'decline') return { success: true, replayed: true, state: 'declined', ...P.NO_RESERVATION };
        const current = await read(reader, 'appointments', r.appointmentId);
        need(current?.status === 'confirmed' && current.offerId === offer.id && current.offerVersion === offer.version
          && current.selectedOptionId === offer.options[0].id && current.date === offer.options[0].date
          && current.startTime === offer.options[0].time && P.originalFingerprint(current) === r.response.canonicalFingerprint,
        'recovery_replay_changed');
        return { success: true, replayed: true, state: 'accepted', appointmentId: current.id,
          changeKind: 'customer_reschedule', appointment: current, capacityReserved: true, proactiveContactAuthorized: false };
      }
      need(currentContext.fingerprint === first.fingerprint, 'recovery_stale_response');
      const response = { messageId: message.id, decision, sourceQuote, sourceFingerprint, interpretation,
        responseWindow: currentContext.evidence.proof,
        at: now.toISOString(), customerInputVersion: receipt.expectedCustomerInputVersion };
      if (decision === 'decline') {
        // Declining this offer is not withdrawal from all waiting preferences.
        transaction.set(db.collection('bookingOffers').doc(offer.id), { status: 'declined', recovery: { ...r, state: 'declined', response } }, { merge: true });
        return { success: true, replayed: false, state: 'declined', ...P.NO_RESERVATION };
      }
      // A delayed worker cannot move the appointment after this source already
      // produced a reply. The ordinary reply transaction also reads the source
      // completion marker, so both commit orderings preserve one turn outcome.
      const published = await reader.collection('whatsappOutboundQueue').where('conversationId', '==', r.conversationId)
        .where('sourceInboundMessageId', '==', message.id).limit(1).get();
      need(published.docs.length === 0, 'recovery_response_already_published');
      need(pilot.settings.autoRescheduleEnabled === true, 'recovery_reschedule_disabled');
      const { record, original, cancellation } = await unchangedBasis(reader, offer, pilot);
      await originalOwnership(reader, original);
      const provider = createSchedulingProvider({ db: reader });
      const fresh = await selectOption(reader, { get: ref => ref.get() }, provider, original, cancellation, now);
      need(P.optionFingerprint(fresh.option) === P.optionFingerprint(offer.options[0])
        && digest(fresh.request) === digest(offer.request), 'recovery_option_changed');
      const acceptedView = transactionView(db, transaction, offer.id);
      const lifecycle = createBookingAppointmentLifecycle({ db: acceptedView.db,
        schedulingProvider: createRecoveryLifecycleProvider({ db: acceptedView.db }), clock: () => now });
      const result = await lifecycle.rescheduleAppointment({ appointmentId: original.id, offerId: offer.id,
        offerVersion: offer.version, optionId: offer.options[0].id, reason: 'customer_accepted_earlier_appointment',
        note: sourceQuote, actor: { id: 'demac-customer-agent', name: 'Maya', source: 'maya-recovery-offer' },
        changeKind: 'customer_reschedule', context: fresh.context });
      need(result.success === true && result.appointment?.offerId === offer.id && result.appointment.startTime === fresh.option.time
        && result.appointment.date === fresh.option.date, 'recovery_canonical_proof_missing');
      response.canonicalFingerprint = P.originalFingerprint(result.appointment);
      transaction.set(db.collection('bookingOffers').doc(offer.id), { recovery: { ...r, state: 'accepted', response } }, { merge: true });
      // A derived source pointer survives a lost model/final-reply result. It is
      // committed with the move, not a second booking status or send instruction.
      transaction.set(db.collection('whatsappMessages').doc(message.id), { mayaRecoveryCompletion: {
        version: 1, offerId: offer.id, offerVersion: offer.version, appointmentId: original.id,
        responseFingerprint: digest(response),
      } }, { merge: true });
      transaction.set(db.collection('communicationCases').doc(record.id), { state: 'FULFILLED', fulfilledAtIso: now.toISOString(),
        fulfillment: { offerId: offer.id, offerVersion: offer.version, appointmentId: original.id, sourceMessageId: message.id },
        updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ...result, replayed: false, state: 'accepted', capacityReserved: true, proactiveContactAuthorized: false };
    });
  }
  return { prepare, bindDelivery, respond };
}
module.exports = { createMayaRecoveryOfferService, transactionView, currentPilot, unchangedBasis,
  originalOwnership, selectOption, read, pointerMatches };
