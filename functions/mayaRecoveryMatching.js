'use strict';

// Read-only preparation, not an offer, reservation or proactive-contact authority.
const { normalizeBookingRequest } = require('./bookingAuthorityCore');
const { createSchedulingProvider } = require('./bookingAuthoritySchedulingProvider');
const { arubaDateParts, cleanText } = require('./bookingSchedulingPrimitives');
const { resolveInboundParty } = require('./customerContactDirectory');
const { activeAccountDecision } = require('./demacCommunicationIdentity');
const { customerSemanticContent } = require('./demacCustomerTurn');
const { bookingInterestCaseId } = require('./demacCustomerBookingInterest');
const { configuredAllowlist, mayaReplyDecision, mayaSenderOwnershipDecision, resolveConversationPhone } = require('./demacCustomerAgentReplyPolicy');
const { CANCELLED, dateKey, timeKey, documentId, failure } = require('./mayaOperationsReadModel');

const MATCHING_VERSION = 1;
const MAX_CANDIDATES_PER_PAGE = 10;
const OPEN_APPOINTMENTS = new Set(['confirmed', 'scheduled']);
const OPEN_WORK_ORDERS = new Set(['confirmada', 'confirmed', 'scheduled']);

// A page uses one consistent snapshot. Providers receive this restricted reader,
// not the underlying DB: no set/update/delete/batch/runTransaction is exposed.
function snapshotReader(db, transaction) {
  const cache = new Map();
  function wrap(target, key) {
    return {
      get() {
        if (!cache.has(key)) cache.set(key, Promise.resolve().then(() => transaction.get(target)));
        return cache.get(key);
      },
      doc(id) { return wrap(target.doc(id), `${key}/doc:${JSON.stringify(id)}`); },
      where(...args) { return wrap(target.where(...args), `${key}/where:${JSON.stringify(args)}`); },
      limit(value) { return wrap(target.limit(value), `${key}/limit:${value}`); },
      orderBy(...args) { return wrap(target.orderBy(...args), `${key}/order:${JSON.stringify(args)}`); },
      startAfter(cursor) { return wrap(target.startAfter(cursor), `${key}/after:${cursor.id}`); },
    };
  }
  return { collection(name) { return wrap(db.collection(name), name); } };
}

function recoveryTarget(appointment, now) {
  if (!appointment || !CANCELLED.has(cleanText(appointment.status, 40).toLowerCase())) {
    throw failure('not_cancelled', 'Select an actual cancelled appointment, not a pending request or dispatch hold.');
  }
  const cancelledAt = Date.parse(appointment.cancelledAtIso || '');
  const date = dateKey(appointment.date);
  const time = timeKey(appointment.startTime);
  const endTime = timeKey(appointment.endTime);
  const current = arubaDateParts(now);
  if (!Number.isFinite(cancelledAt) || cancelledAt > now.getTime() || !date || !time || !endTime || endTime <= time) {
    throw failure('invalid_cancellation', 'The cancellation is missing a valid recorded time or former scheduled interval.');
  }
  if (date < current.date || (date === current.date && time <= current.time)) {
    throw failure('target_elapsed', 'The former appointment start has already passed.');
  }
  const assignments = appointment.assignments;
  if (!Array.isArray(assignments) || !assignments.length || assignments.length > 4) {
    throw failure('invalid_cancellation', 'The former canonical Van assignment is required.');
  }
  const primary = assignments.find(item => item && item.role !== 'support');
  if (!primary || !primary.vanId || (primary.time && primary.time !== time)) {
    throw failure('invalid_cancellation', 'The former primary assignment is inconsistent.');
  }
  const locks = appointment.capacityLockIds;
  if (!Array.isArray(locks) || !locks.length || locks.length > 48
    || locks.some(id => typeof id !== 'string' || !id || id.includes('/')) || new Set(locks).size !== locks.length) {
    throw failure('invalid_cancellation', 'The former canonical capacity references are required.');
  }
  return { date, time, endTime, vanId: documentId(primary.vanId), formerCapacityIds: new Set(locks) };
}

function resultRow(record, status, reason, extra = {}) {
  return {
    caseId: record.id, status, reason,
    kind: record.bookingInterest?.kind || '',
    appointmentId: record.appointmentId || '',
    customerConfirmationRequired: true,
    capacityReserved: false, proactiveContactAuthorized: false,
    ...extra,
  };
}

function createMayaRecoveryMatching({ db, clock = () => new Date(), providerFactory = createSchedulingProvider } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new Error('A transactional Firestore-compatible DB is required.');
  }
  async function inspect(data = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || Object.keys(data).some(key => !['cancelledAppointmentId', 'afterId', 'pageSize'].includes(key))) {
      throw failure('invalid_request', 'Only a cancellation reference and pagination are accepted.');
    }
    const cancellationId = documentId(data.cancelledAppointmentId);
    const afterId = data.afterId ? documentId(data.afterId) : '';
    const size = data.pageSize === undefined ? MAX_CANDIDATES_PER_PAGE : data.pageSize;
    if (!Number.isInteger(size) || size < 1 || size > MAX_CANDIDATES_PER_PAGE) {
      throw failure('invalid_request', 'Inspect between one and ten waiting records per page.');
    }
    return db.runTransaction(async transaction => {
      const now = clock();
      const reader = snapshotReader(db, transaction);
      async function read(collection, id) {
        if (!id) return null;
        const snapshot = await reader.collection(collection).doc(documentId(id)).get();
        return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
      }
      const [cancelled, settings, comms] = await Promise.all([
        read('appointments', cancellationId), read('businessSettings', 'customer-agent'), read('businessSettings', 'whatsapp'),
      ]);
      const target = recoveryTarget(cancelled, now);
      const account = cleanText(comms?.communicationAccountId, 180).toLowerCase();
      if (!account) throw failure('configuration_missing', 'Verify the active WhatsApp account before matching candidates.');
      const scoped = record => record?.caseType === 'booking_interest' && record.communicationAccountId === account;
      let query = reader.collection('communicationCases').where('caseType', '==', 'booking_interest')
        .where('communicationAccountId', '==', account);
      if (afterId) {
        const cursor = await reader.collection('communicationCases').doc(afterId).get();
        if (!cursor.exists || !scoped(cursor.data())) throw failure('invalid_cursor', 'Refresh the active-account waiting list.');
        query = query.startAfter(cursor);
      }
      const snapshots = (await query.limit(size + 1).get()).docs;
      const page = snapshots.slice(0, size);
      const provider = providerFactory({ db: reader });
      const current = arubaDateParts(now);
      const rows = [];
      for (const snapshot of page) {
        const record = { ...snapshot.data(), id: snapshot.id };
        if (!scoped(record)) continue;
        const interest = record.bookingInterest;
        const reject = (reason, status = 'needs_review') => resultRow(record, status, reason);
        if (record.state !== 'WAITING') { rows.push(reject('interest_not_waiting', 'excluded')); continue; }
        if (!interest || !['new_appointment', 'earlier_appointment'].includes(interest.kind)) {
          rows.push(reject('invalid_interest')); continue;
        }
        if ((interest.dateFrom && !dateKey(interest.dateFrom)) || (interest.dateTo && !dateKey(interest.dateTo))
          || (interest.dateFrom && interest.dateTo && interest.dateFrom > interest.dateTo)) {
          rows.push(reject('invalid_preference_dates')); continue;
        }
        if (interest.dateTo && interest.dateTo < current.date) { rows.push(reject('interest_expired', 'excluded')); continue; }
        if ((interest.dateFrom && target.date < interest.dateFrom) || (interest.dateTo && target.date > interest.dateTo)) {
          rows.push(reject('outside_requested_dates', 'incompatible')); continue;
        }
        const expectedId = bookingInterestCaseId({ customerId: record.customerId, propertyId: record.propertyId,
          kind: interest.kind, appointmentId: record.appointmentId || '' }, account, record.conversationId);
        if (expectedId !== record.id) { rows.push(reject('interest_identity_changed')); continue; }
        const [conversation, source] = await Promise.all([
          read('communicationConversations', record.conversationId), read('whatsappMessages', record.lastSourceMessageId),
        ]);
        if (!conversation || !source || source.direction !== 'inbound'
          || source.conversationId !== record.conversationId || source.communicationAccountId !== account
          || conversation.communicationAccountId !== account) { rows.push(reject('source_identity_changed')); continue; }
        const active = activeAccountDecision({ conversation, message: source, settings: comms });
        const phone = resolveConversationPhone({ conversation });
        if (!active.allowed || !configuredAllowlist(settings || {}).includes(phone)
          || !mayaReplyDecision({ conversation, settings: settings || {}, communicationSettings: comms }).allowed
          || !mayaSenderOwnershipDecision({ conversation }).allowed) {
          rows.push(reject('pilot_or_ownership_blocked', 'excluded')); continue;
        }
        const event = Array.isArray(record.interestHistory) ? record.interestHistory.at(-1) : null;
        if (!event || event.action !== 'register' || event.messageId !== source.id
          || !Number.isSafeInteger(source.customerInputVersion) || source.customerInputVersion <= 0
          || event.customerInputVersion !== source.customerInputVersion
          || conversation.customerInputVersion !== source.customerInputVersion
          || event.ownershipVersion !== conversation.ownershipVersion) {
          rows.push(reject('interest_requires_reconfirmation')); continue;
        }
        const quote = typeof interest.sourceQuote === 'string' ? interest.sourceQuote.trim() : '';
        if (quote.length < 3 || !customerSemanticContent(source, 8000).includes(quote)) {
          rows.push(reject('interest_evidence_missing')); continue;
        }
        const party = await resolveInboundParty(reader, { phone, whatsapp: phone });
        if (party.ambiguous || !party.customer || party.customer.id !== record.customerId || party.customer.active === false) {
          rows.push(reject('customer_identity_changed')); continue;
        }
        const property = await read('properties', record.propertyId);
        if (!property || property.active === false || property.clientId !== record.customerId
          || !cleanText(property.address || property.addressRaw, 500)
          || !cleanText(property.operationalZone || property.zone, 120)) {
          rows.push(reject('property_or_sector_requires_review')); continue;
        }
        const display = { customer: cleanText(party.customer.name, 180), address: cleanText(property.address || property.addressRaw, 500),
          sector: cleanText(property.operationalZone || property.zone, 120) };
        // #487 records no canonical workload for unbooked waiters. Never infer it.
        if (interest.kind === 'new_appointment') {
          rows.push(resultRow(record, 'needs_work_details', 'unbooked_workload_not_recorded', display)); continue;
        }
        const original = await read('appointments', record.appointmentId);
        if (!original || original.customerId !== record.customerId || original.propertyId !== record.propertyId
          || !OPEN_APPOINTMENTS.has(original.status) || original.dispatchHold?.active === true
          || !dateKey(original.date) || !timeKey(original.startTime)
          || original.date !== interest.originalDate || original.startTime !== interest.originalTime) {
          rows.push(reject('original_appointment_changed')); continue;
        }
        if (`${target.date}T${target.time}` >= `${original.date}T${original.startTime}`) {
          rows.push(reject('target_not_earlier', 'incompatible')); continue;
        }
        const workIds = original.workOrderIds;
        if (!Array.isArray(workIds) || !workIds.length || workIds.length > 4) {
          rows.push(reject('original_work_requires_review')); continue;
        }
        const workOrders = await Promise.all(workIds.map(id => read('workOrders', id)));
        if (workOrders.some(order => !order || order.appointmentId !== original.id || order.clientId !== record.customerId
          || order.propertyId !== record.propertyId || !OPEN_WORK_ORDERS.has(cleanText(order.status, 40).toLowerCase())
          || order.dispatchHoldActive === true)) {
          rows.push(reject('original_work_changed')); continue;
        }
        let request;
        try {
          request = normalizeBookingRequest({ customerId: record.customerId, propertyId: record.propertyId,
            workLines: original.workLines, constraints: { requestedDate: target.date, requestedTime: target.time } });
          if (request.customerId !== record.customerId || request.propertyId !== record.propertyId
            || request.workLines.length > 30) throw failure('invalid_request', 'Invalid canonical workload.');
        } catch { rows.push(reject('original_workload_invalid')); continue; }
        // The provider is deliberately NOT called as an office/manual move.
        const context = { channel: 'whatsapp', source: 'maya-recovery-preview',
          excludeAppointmentId: original.id, requiredPrimaryVanId: target.vanId };
        const available = await provider.checkAvailability({ request, context, now });
        let compatible = null;
        let reason = 'capacity_route_or_calendar_unavailable';
        for (const option of available.options || []) {
          if (option.date !== target.date || option.time !== target.time || !timeKey(option.endTime)
            || option.endTime > target.endTime || !option.assignments?.length
            || option.assignments[0].vanId !== target.vanId) continue;
          const validation = await provider.validateTransaction({ transaction, db: reader, request, option,
            appointmentId: original.id, context, now });
          if (validation?.available !== true || !Array.isArray(validation.capacityLocks) || !validation.capacityLocks.length) continue;
          if (validation.capacityLocks.some(lock => !target.formerCapacityIds.has(lock.id))) {
            reason = 'work_exceeds_cancelled_capacity'; continue;
          }
          const locks = await Promise.all(validation.capacityLocks.map(lock => read('bookingCapacityLocks', lock.id)));
          if (locks.some(lock => lock && lock.active !== false)) { reason = 'capacity_reoccupied_or_unreleased'; continue; }
          compatible = option;
          break;
        }
        if (!compatible) { rows.push(resultRow(record, 'incompatible', reason, display)); continue; }
        rows.push(resultRow(record, 'compatible_for_review', 'canonical_snapshot_compatible', {
          ...display, originalDate: original.date, originalTime: original.startTime,
          date: compatible.date, time: compatible.time, endTime: compatible.endTime,
          workLines: request.workLines.map(line => ({ presetId: line.presetId, serviceId: line.serviceId, quantity: line.quantity })),
          schedulingProviderVersion: available.providerVersion || '', routePolicy: available.metadata?.routePolicy || '',
        }));
      }
      return { success: true, version: MATCHING_VERSION, cancelledAppointmentId: cancellationId,
        target: { date: target.date, time: target.time, endTime: target.endTime }, rows,
        examined: page.length, nextCursor: snapshots.length > size ? page.at(-1).id : null,
        checkedAt: now.toISOString(), readOnly: true, capacityReserved: false, proactiveContactAuthorized: false,
        requiresFreshBookingOffer: true, rankingPolicyApplied: false };
    }, { readOnly: true });
  }
  return { inspect };
}

module.exports = { MATCHING_VERSION, MAX_CANDIDATES_PER_PAGE, snapshotReader, recoveryTarget, createMayaRecoveryMatching };
