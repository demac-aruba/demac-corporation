'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { resolveInboundParty } = require('./customerContactDirectory');
const { activeAccountDecision } = require('./demacCommunicationIdentity');
const { communicationEpochDecision } = require('./demacCustomerTurn');
const { loadMutationEpochReceipt } = require('./demacCustomerAppointmentMutationGuard');
const { configuredAllowlist, mayaReplyDecision, mayaSenderOwnershipDecision, resolveConversationPhone } = require('./demacCustomerAgentReplyPolicy');
const { bookingInterestCaseId, transactionalReader, normalizeInterest } = require('./demacCustomerBookingInterest');
const { cleanText, arubaDateParts, hashId } = require('./bookingSchedulingPrimitives');
const { dateKey, timeKey, documentId, failure } = require('./mayaOperationsReadModel');
const { HISTORY_VERSION, digest, interestMaterial, loadHistoryWindow } = require('./demacCustomerInterestHistory');
const { analyzeInterestHistory } = require('./demacCustomerInterestAnalysis');

// Internal action dispatched by the EXISTING record_booking_interest tool.
const NAME = 'recover_recent_booking_interest';
const DECISION_KEYS = ['caseId', 'kind', 'propertyId', 'appointmentId', 'state', 'evidenceMessageId', 'quote', 'confidence', 'ambiguous', 'dateFrom', 'dateTo'];
const SAFE_CODES = new Set(['interest_recovery_disabled', 'permission_denied', 'stale_context', 'context_missing', 'history_incomplete', 'history_identity_mismatch', 'history_too_large', 'identity_mismatch', 'scope_too_large', 'invalid_request', 'evidence_missing', 'interest_review_failed', 'appointment_changed', 'interest_not_found', 'idempotency_conflict']);
function publicFailure(error) {
  const code = SAFE_CODES.has(error?.code) ? error.code : 'interest_review_failed';
  return { success: false, error: { code, message: 'Waiting preferences were not changed. Review current context or retry when the conversation is complete.' } };
}
function noActions(extra = {}) { return { ...extra, capacityReserved: false, proactiveContactAuthorized: false, existingAppointmentUnchanged: true }; }
function caseVersion(record) { return { ...interestMaterial(record), interestHistory: record.interestHistory || [], interestReview: record.interestReview || null }; }
function casesDigest(records) { return digest(records.map(caseVersion).sort((a, b) => a.id.localeCompare(b.id))); }
function profileProperty(property) {
  return { id: property.id, clientId: property.clientId, active: property.active !== false,
    address: cleanText(property.address || property.addressRaw, 500), sector: cleanText(property.operationalZone || property.zone, 120) };
}
function profileAppointment(appointment) {
  return { id: appointment.id, customerId: appointment.customerId, propertyId: appointment.propertyId, status: appointment.status,
    date: appointment.date || '', startTime: appointment.startTime || '', dispatchHoldActive: appointment.dispatchHold?.active === true,
    workFingerprint: digest(appointment.workLines || []) };
}
function replayResult(snapshot) {
  const receipt = snapshot.conversation.mayaInterestRecovery;
  if (!receipt || receipt.version !== HISTORY_VERSION || receipt.windowFingerprint !== snapshot.window.fingerprint
    || receipt.scopeFingerprint !== snapshot.scopeFingerprint || receipt.casesFingerprint !== casesDigest(snapshot.cases)) return null;
  return noActions({ success: true, replayed: true, results: receipt.results || [], coverage: snapshot.window.coverage });
}
function createCustomerInterestRecovery({ db, analyze = analyzeInterestHistory, clock = () => new Date(), apiKeyProvider = () => defineSecret('OPENAI_API_KEY').value() } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') throw new Error('Transactional database required.');
  async function loadSnapshot(reader, context) {
    const conversationId = documentId(context.conversationId || context.conversationKey);
    async function read(collection, id) {
      const snapshot = await reader.collection(collection).doc(documentId(id)).get();
      return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
    }
    const [settings, comms, conversation] = await Promise.all([
      read('businessSettings', 'customer-agent'), read('businessSettings', 'whatsapp'), read('communicationConversations', conversationId),
    ]);
    if (settings?.bookingInterestRecoveryEnabled !== true || settings?.bookingInterestEnabled !== true) throw failure('interest_recovery_disabled', 'Recovery must be explicitly enabled.');
    if (!conversation) throw failure('context_missing', 'Conversation missing.');
    if (context.communicationAccountId && context.communicationAccountId !== conversation.communicationAccountId) throw failure('permission_denied', 'Caller account does not match the conversation.');
    const phone = resolveConversationPhone({ conversation });
    if (!activeAccountDecision({ conversation, settings: comms || {} }).allowed
      || !configuredAllowlist(settings).includes(phone)
      || !mayaReplyDecision({ conversation, settings, communicationSettings: comms || {} }).allowed
      || !mayaSenderOwnershipDecision({ conversation }).allowed) throw failure('permission_denied', 'Pilot or ownership does not permit this operation.');
    const now = clock();
    const window = await loadHistoryWindow(reader, conversation, now);
    const inboundId = documentId(context.inboundMessageId || context.messageId || window.latestInbound.id);
    if (inboundId !== window.latestInbound.id) throw failure('stale_context', 'A newer customer turn exists.');
    // The reader already wraps transaction.get; never pass its wrapper to Firestore.
    const receipt = await loadMutationEpochReceipt({ db: reader, transaction: { get: reference => reference.get() }, conversationId, inboundMessageId: inboundId });
    if (!receipt.valid || receipt.communicationAccountId !== conversation.communicationAccountId
      || !communicationEpochDecision({ conversation, expectedOwnershipVersion: receipt.expectedOwnershipVersion,
        expectedCustomerInputVersion: receipt.expectedCustomerInputVersion }).allowed) throw failure('stale_context', 'Current customer-turn proof is missing.');
    const party = await resolveInboundParty(reader, { phone, whatsapp: phone });
    if (party.ambiguous || !party.customer || party.customer.active === false) throw failure('identity_mismatch', 'Resolve the sender through canonical CRM first.');
    const customerId = party.customer.id;
    const [propertySnapshot, appointmentSnapshot, caseSnapshot] = await Promise.all([
      reader.collection('properties').where('clientId', '==', customerId).limit(21).get(),
      reader.collection('appointments').where('customerId', '==', customerId).where('date', '>=', arubaDateParts(now).date).limit(11).get(),
      reader.collection('communicationCases').where('conversationId', '==', conversationId)
        .where('communicationAccountId', '==', conversation.communicationAccountId).where('caseType', '==', 'booking_interest').limit(11).get(),
    ]);
    if (propertySnapshot.docs.length > 20 || appointmentSnapshot.docs.length > 10 || caseSnapshot.docs.length > 10) throw failure('scope_too_large', 'This conversation requires a bounded manual review.');
    const properties = propertySnapshot.docs.map(doc => profileProperty({ ...doc.data(), id: doc.id }));
    const appointments = appointmentSnapshot.docs.map(doc => profileAppointment({ ...doc.data(), id: doc.id }));
    const cases = caseSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    if (cases.some(record => record.customerId !== customerId || record.caseType !== 'booking_interest'
      || record.conversationId !== conversationId || record.communicationAccountId !== conversation.communicationAccountId)) throw failure('identity_mismatch', 'Stored waiting identity conflicts with current CRM.');
    const scope = { conversationId, communicationAccountId: conversation.communicationAccountId, customerId,
      ownershipVersion: conversation.ownershipVersion, customerInputVersion: conversation.customerInputVersion,
      properties: properties.sort((a, b) => a.id.localeCompare(b.id)), appointments: appointments.sort((a, b) => a.id.localeCompare(b.id)) };
    const scopeFingerprint = digest(scope);
    const precondition = digest({ scope, window: window.fingerprint, cases: casesDigest(cases) });
    return { conversation, customerId, properties, appointments, cases, window, scopeFingerprint, precondition, now };
  }
  function modelContext(snapshot) {
    return { timezone: 'America/Aruba', now: snapshot.now.toISOString(), coverage: snapshot.window.coverage,
      messages: snapshot.window.entries.map(({ id, direction, text, at }) => ({ id, direction, text, at })),
      properties: snapshot.properties.filter(property => property.active), appointments: snapshot.appointments,
      previousInterests: snapshot.cases.map(record => ({ ...interestMaterial(record), id: record.id })) };
  }
  function plan(snapshot, decisions) {
    if (!Array.isArray(decisions) || decisions.length > 10) throw failure('interest_review_failed', 'Invalid decision list.');
    const planned = new Map();
    for (const decision of decisions) {
      if (!decision || Array.isArray(decision) || Object.keys(decision).length !== DECISION_KEYS.length
        || DECISION_KEYS.some(key => !Object.prototype.hasOwnProperty.call(decision, key))
        || DECISION_KEYS.filter(key => !['confidence', 'ambiguous'].includes(key)).some(key => typeof decision[key] !== 'string')
        || !['waiting', 'withdrawn', 'needs_review'].includes(decision.state)
        || typeof decision.ambiguous !== 'boolean' || !Number.isFinite(decision.confidence)
        || decision.confidence < 0 || decision.confidence > 1) throw failure('interest_review_failed', 'Invalid decision contract.');
      const source = snapshot.window.entries.find(message => message.id === decision.evidenceMessageId && message.direction === 'inbound');
      const quote = decision.quote.trim();
      if (!source || quote.length < 3 || quote.length > 800 || !source.text.includes(quote)) throw failure('evidence_missing', 'The exact customer quotation is missing.');
      const input = normalizeInterest({ action: decision.state === 'withdrawn' ? 'withdraw' : 'register', kind: decision.kind,
        customerId: snapshot.customerId, propertyId: decision.propertyId, appointmentId: decision.appointmentId,
        sourceQuote: quote, dateFrom: decision.dateFrom, dateTo: decision.dateTo }, arubaDateParts(snapshot.now).date);
      const property = snapshot.properties.find(item => item.id === input.propertyId && item.active && item.clientId === snapshot.customerId);
      if (!property) throw failure('identity_mismatch', 'The proposed property is not owned by this customer.');
      const id = bookingInterestCaseId(input, snapshot.conversation.communicationAccountId, snapshot.conversation.id);
      const previous = snapshot.cases.find(record => record.id === id);
      if ((previous && decision.caseId !== id) || (!previous && decision.caseId) || planned.has(id)) throw failure('identity_mismatch', 'The proposed waiting case is inconsistent or duplicated.');
      if (previous && (previous.propertyId !== input.propertyId || previous.appointmentId !== input.appointmentId || previous.bookingInterest?.kind !== input.kind)) throw failure('identity_mismatch', 'Stored interest target has changed.');
      if (decision.state === 'withdrawn' && !previous) throw failure('interest_not_found', 'No matching preference can be withdrawn.');
      const lastEvent = previous?.interestHistory?.at(-1);
      if (previous && (!lastEvent || !Number.isSafeInteger(lastEvent.customerInputVersion))) throw failure('evidence_missing', 'Prior source ordering requires review.');
      if (lastEvent && (source.customerInputVersion < lastEvent.customerInputVersion
        || (previous.state === 'WITHDRAWN' && decision.state === 'waiting' && source.customerInputVersion <= lastEvent.customerInputVersion))) throw failure('stale_context', 'Older evidence cannot override a later customer decision.');
      const fingerprint = hashId(JSON.stringify(input), 40);
      if (previous && previous.lastSourceMessageId === source.id && previous.interestFingerprint !== fingerprint
        && previous.state !== 'NEEDS_REVIEW') throw failure('idempotency_conflict', 'The same evidence cannot silently change material preferences.');
      let state = decision.state === 'withdrawn' ? 'WITHDRAWN' : decision.state === 'waiting' ? 'WAITING' : 'NEEDS_REVIEW';
      if (decision.ambiguous || decision.confidence < 0.9) state = 'NEEDS_REVIEW';
      let originalDate = previous?.bookingInterest?.originalDate || '';
      let originalTime = previous?.bookingInterest?.originalTime || '';
      if (state === 'WAITING' && input.kind === 'earlier_appointment') {
        const original = snapshot.appointments.find(item => item.id === input.appointmentId);
        const current = arubaDateParts(snapshot.now);
        if (!original || original.propertyId !== input.propertyId || original.customerId !== input.customerId
          || !['confirmed', 'scheduled'].includes(original.status) || original.dispatchHoldActive
          || !dateKey(original.date) || !timeKey(original.startTime)
          || `${original.date}T${original.startTime}` <= `${current.date}T${current.time}`
          || (previous && (originalDate !== original.date || originalTime !== original.startTime))) throw failure('appointment_changed', 'The original booking requires review.');
        if ((input.dateFrom && input.dateFrom > original.date) || (input.dateTo && input.dateTo > original.date)) throw failure('invalid_request', 'Earlier-date preferences cannot extend after the current appointment.');
        originalDate = original.date; originalTime = original.startTime;
      }
      const event = { messageId: source.id, action: state === 'WITHDRAWN' ? 'withdraw' : 'register', at: snapshot.now.toISOString(),
        sourceQuote: quote, ownershipVersion: snapshot.conversation.ownershipVersion, customerInputVersion: source.customerInputVersion,
        reviewedThroughCustomerInputVersion: snapshot.conversation.customerInputVersion, reviewFingerprint: snapshot.window.fingerprint };
      const record = { ...(previous || {}), id, version: 2, caseType: 'booking_interest',
        communicationAccountId: snapshot.conversation.communicationAccountId, conversationId: snapshot.conversation.id,
        customerId: input.customerId, propertyId: input.propertyId, appointmentId: input.appointmentId,
        state, lastSourceMessageId: source.id, interestFingerprint: fingerprint,
        interestHistory: [...(previous?.interestHistory || []), event].slice(-40),
        bookingInterest: { kind: input.kind, sourceQuote: quote, dateFrom: input.dateFrom, dateTo: input.dateTo,
          originalDate, originalTime, capacityReserved: false, proactiveContactAuthorized: false } };
      record.interestReview = { version: HISTORY_VERSION, windowFingerprint: snapshot.window.fingerprint,
        reviewedMessageIds: snapshot.window.entries.map(message => message.id),
        materialFingerprint: digest(interestMaterial(record)), ownershipVersion: snapshot.conversation.ownershipVersion,
        customerInputVersion: snapshot.conversation.customerInputVersion, reviewedAt: snapshot.now.toISOString() };
      planned.set(id, record);
    }
    return [...planned.values()];
  }
  async function recover(context = {}, apiKey) {
    const first = await db.runTransaction(transaction => loadSnapshot(transactionalReader(db, transaction), context), { readOnly: true });
    const replay = replayResult(first);
    if (replay) return replay;
    // External semantic analysis must never run inside a retried DB transaction.
    const decisions = await analyze({ context: modelContext(first), apiKey: apiKey === undefined ? apiKeyProvider() : apiKey });
    plan(first, decisions);
    return db.runTransaction(async transaction => {
      const current = await loadSnapshot(transactionalReader(db, transaction), context);
      const replayed = replayResult(current);
      if (replayed) return replayed;
      if (current.precondition !== first.precondition) throw failure('stale_context', 'Conversation, identity, preferences or appointment changed during review.');
      // Time can advance while the model runs even when document values do not.
      const planned = plan(current, decisions);
      const results = planned.map(record => ({ caseId: record.id, kind: record.bookingInterest.kind, state: record.state }));
      const merged = new Map(current.cases.map(record => [record.id, record]));
      // All reads are complete. Only derived preference Cases and their review receipt may be written.
      for (const record of planned) {
        merged.set(record.id, record);
        transaction.set(db.collection('communicationCases').doc(record.id), {
          ...record, createdAt: record.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedAtIso: current.now.toISOString(),
        }, { merge: true });
      }
      transaction.set(db.collection('communicationConversations').doc(current.conversation.id), {
        mayaInterestRecovery: { version: HISTORY_VERSION, windowFingerprint: current.window.fingerprint,
          scopeFingerprint: current.scopeFingerprint, casesFingerprint: casesDigest([...merged.values()]), results, checkedAt: current.now.toISOString() },
      }, { merge: true });
      return noActions({ success: true, replayed: false, results, coverage: current.window.coverage });
    });
  }
  async function invoke(name, args = {}, context = {}) {
    if (name !== NAME) return { success: false, error: { code: 'unknown_tool', message: 'Unsupported history recovery tool.' } };
    if (!args || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).length) return publicFailure(failure('invalid_request', 'This tool accepts no target override.'));
    if (!context.inboundMessageId && !context.messageId) return publicFailure(failure('stale_context', 'The caller must supply its exact inbound turn.'));
    try { return await recover(context); } catch (error) { return publicFailure(error); }
  }
  // Internal orchestration entry only. Each conversation is separately checked;
  // this does not create a scheduler, cross-chat model prompt or outbound loop.
  async function recoverMany({ conversationIds, apiKey } = {}) {
    if (!Array.isArray(conversationIds) || !conversationIds.length || conversationIds.length > 5
      || new Set(conversationIds).size !== conversationIds.length) throw failure('invalid_request', 'Review one to five distinct canonical conversations.');
    const ids = conversationIds.map(id => documentId(id));
    const results = [];
    for (const conversationId of ids) {
      try { results.push({ conversationId, ...await recover({ conversationId }, apiKey) }); }
      catch (error) { results.push({ conversationId, ...publicFailure(error) }); }
    }
    return noActions({ results });
  }
  return { invoke, recover, recoverMany };
}
module.exports = { NAME, createCustomerInterestRecovery, publicFailure };
