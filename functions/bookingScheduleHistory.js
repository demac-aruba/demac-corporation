'use strict';

const { BookingAuthorityError, BOOKING_ERROR_CODES, cleanText } = require('./bookingAuthorityCore');
const PAGE_SIZE = 50;
const KINDS = new Set(['cancelled', 'customer_reschedule', 'operational_move']);
const FIELDS = ['customerId', 'propertyId', 'status', 'date', 'startTime', 'primaryVanId', 'workItems', 'createdAtIso', 'createdByName', 'lifecycleHistory', 'rescheduledAtIso', 'cancelledAtIso', 'updatedAt'];
const PHASE_FIELDS = { moves: 'rescheduledAtIso', cancellations: 'cancelledAtIso', updates: 'updatedAt' };
function invalid() { throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, 'Invalid schedule history cursor.'); }
function iso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) invalid();
  return value;
}
function placement(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(['dateKey', 'primaryVanId', 'primaryStart', 'primaryEnd', 'primaryCapacityEnd', 'supportVanId', 'supportStart'].map(key => [key, cleanText(value[key], 120)]));
}
function projectHistory(id, appointment) {
  // This is a read projection of the existing audit, never a reservation or a new store.
  const events = (Array.isArray(appointment.lifecycleHistory) ? appointment.lifecycleHistory : [])
    .filter(event => event && KINDS.has(event.kind) && event.from)
    .map((event, index) => ({
      id: cleanText(event.id, 180) || `${id}-${index}`, kind: event.kind,
      at: cleanText(event.at, 80), actorName: cleanText(event.actorName, 160),
      reason: cleanText(event.reason, 500), note: cleanText(event.note, 1500),
      from: placement(event.from), to: placement(event.to),
    }));
  return {
    appointmentId: id, customerId: cleanText(appointment.customerId, 180), propertyId: cleanText(appointment.propertyId, 180),
    status: cleanText(appointment.status, 40), date: cleanText(appointment.date, 20), startTime: cleanText(appointment.startTime, 20),
    primaryVanId: cleanText(appointment.primaryVanId, 120),
    createdAt: cleanText(appointment.createdAtIso, 80), createdByName: cleanText(appointment.createdByName, 160),
    workLabel: (Array.isArray(appointment.workItems) ? appointment.workItems : []).map(item => cleanText(item?.label, 160)).filter(Boolean).join(' · '),
    events,
  };
}

async function listScheduleHistory({ db, data = {}, now = new Date() }) {
  const cursor = data.cursor;
  if (cursor != null && (typeof cursor !== 'object' || Array.isArray(cursor))) invalid();
  const since = data.since ? iso(data.since) : '';
  const phase = cursor?.phase || (since ? 'updates' : 'moves');
  if (!PHASE_FIELDS[phase] || (since ? phase !== 'updates' : phase === 'updates')) invalid();
  // Server-time checkpoint precedes all reads. Delta queries use Firestore's commit
  // timestamp (updatedAt), not lifecycle's pre-transaction wall clock. A one-minute
  // overlap accommodates clock skew; stable appointment/event identities deduplicate.
  const checkpoint = cursor ? iso(cursor.checkpoint) : new Date(now.getTime() - 60_000).toISOString();
  const field = PHASE_FIELDS[phase];
  let query = db.collection('appointments').where(field, '>=', phase === 'updates' ? new Date(since) : '')
    .orderBy(field).orderBy('__name__').select(...FIELDS).limit(PAGE_SIZE);
  if (cursor?.afterId) {
    if (typeof cursor.afterId !== 'string' || cursor.afterId.length > 180 || cursor.afterId.includes('/')) invalid();
    let afterTime;
    if (phase === 'updates') {
      const timestamp = cursor.afterTimestamp;
      if (!timestamp || !Number.isInteger(timestamp.seconds) || timestamp.seconds < 0 || timestamp.seconds > 253402300799
        || !Number.isInteger(timestamp.nanoseconds) || timestamp.nanoseconds < 0 || timestamp.nanoseconds >= 1e9) invalid();
      const { Timestamp } = require('firebase-admin/firestore');
      afterTime = new Timestamp(timestamp.seconds, timestamp.nanoseconds);
    } else afterTime = iso(cursor.afterTime);
    query = query.startAfter(afterTime, db.collection('appointments').doc(cursor.afterId));
  } else if (cursor?.afterTime || cursor?.afterTimestamp) invalid();
  const snapshot = await query.get();
  const appointments = snapshot.docs.map(doc => projectHistory(doc.id, doc.data())).filter(item => item.events.length);
  let nextCursor = null;
  if (snapshot.docs.length === PAGE_SIZE) {
    const last = snapshot.docs.at(-1), time = last.data()[field];
    // Date/ISO truncates sub-millisecond precision and can replay the same full
    // page forever when many commits share a Timestamp. Keep the exact cursor.
    nextCursor = { phase, checkpoint, afterId: last.id,
      ...(phase === 'updates' ? { afterTimestamp: { seconds: time.seconds, nanoseconds: time.nanoseconds } } : { afterTime: time }) };
  } else if (phase === 'moves') nextCursor = { phase: 'cancellations', checkpoint };
  return { success: true, appointments, nextCursor, checkpoint };
}

module.exports = { listScheduleHistory, projectHistory, PAGE_SIZE };
