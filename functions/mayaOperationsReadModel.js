// Read-only operational projections. Appointment/capacity truth stays in Booking Authority.
const { cleanText, arubaDateParts } = require('./bookingSchedulingPrimitives');
const CANCELLED = new Set(['cancelled', 'canceled', 'cancelada']);
const OPEN = new Set(['confirmed', 'scheduled']);
const VERSION = 1;

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function documentId(value, required = true) {
  const id = typeof value === 'string' ? value.trim() : '';
  if ((!id && required) || id.includes('/') || id.length > 300 || id === '.' || id === '..') {
    throw failure('invalid_request', 'A valid canonical record ID is required.');
  }
  return id;
}
function dateKey(value) {
  const text = typeof value === 'string' ? value : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : '';
}
function timeKey(value) { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : ''; }
function cancellationRange(data = {}, now = new Date()) {
  const today = arubaDateParts(now).date;
  const from = data.from === undefined ? today : dateKey(data.from);
  const to = data.to === undefined ? today : dateKey(data.to);
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (!from || !to || days < 0 || days > 30) throw failure('invalid_request', 'Choose a valid range of at most 31 Aruba calendar days.');
  const start = new Date(`${from}T00:00:00-04:00`).toISOString();
  const end = new Date(Date.parse(`${to}T00:00:00-04:00`) + 86400000).toISOString();
  return { from, to, start, end };
}
function pageSize(value) {
  if (value === undefined) return 25;
  if (!Number.isInteger(value) || value < 1 || value > 50) throw failure('invalid_request', 'Page size must be between 1 and 50.');
  return value;
}
function scopeCustomer(appointment, customer, property) {
  const customerOk = Boolean(customer && appointment.customerId && customer.id === appointment.customerId);
  const propertyOk = Boolean(property && appointment.propertyId && property.id === appointment.propertyId && property.clientId === appointment.customerId);
  return {
    customer: customerOk ? cleanText(customer.name, 180) : 'Customer record unavailable',
    address: propertyOk ? cleanText(property.address || property.addressRaw, 500) : '',
    sector: propertyOk ? cleanText(property.operationalZone || property.zone, 120) : '',
    identityVerified: customerOk && propertyOk,
  };
}
function cancellationRow(appointment, customer, property) {
  if (!CANCELLED.has(cleanText(appointment.status, 40).toLowerCase())) return null;
  return {
    id: appointment.id,
    customerId: cleanText(appointment.customerId, 160),
    ...scopeCustomer(appointment, customer, property),
    scheduledDate: dateKey(appointment.date),
    scheduledTime: cleanText(appointment.startTime, 20),
    cancelledAt: cleanText(appointment.cancelledAtIso, 80),
    reason: cleanText(appointment.cancellationReason, 500),
    note: cleanText(appointment.cancellationNote, 1500),
    actor: cleanText(appointment.lastLifecycleActorName, 180),
    source: cleanText(appointment.lastLifecycleSource, 120),
    currentAvailabilityVerified: false,
    workLines: (Array.isArray(appointment.workLines) ? appointment.workLines : []).filter(line => line && typeof line === 'object').slice(0, 30).map(line => ({
      service: cleanText(line.label || line.presetId || line.serviceId, 180),
      quantity: Number.isFinite(line.quantity) ? line.quantity : null,
    })),
  };
}
function waitlistRow(record, customer, property, appointment, today, currentTime = '') {
  if (record.caseType !== 'booking_interest') return null;
  const interest = record.bookingInterest;
  if (!interest || typeof interest !== 'object' || Array.isArray(interest) || !['new_appointment', 'earlier_appointment'].includes(interest.kind)) return null;
  const identity = scopeCustomer(record, customer, property);
  let state = record.state === 'WITHDRAWN' ? 'withdrawn' : record.state === 'WAITING' ? 'waiting' : 'needs_review';
  if (state === 'waiting' && !identity.identityVerified) state = 'needs_review';
  const earlier = interest.kind === 'earlier_appointment';
  if (state === 'waiting' && earlier && (!appointment || appointment.customerId !== record.customerId
      || appointment.propertyId !== record.propertyId || !OPEN.has(appointment.status)
      || !dateKey(appointment.date) || !timeKey(appointment.startTime)
      || appointment.date !== interest.originalDate || appointment.startTime !== interest.originalTime)) state = 'needs_review';
  if (state === 'waiting' && interest.dateTo && interest.dateTo < today) state = 'expired';
  if (state === 'waiting' && earlier && (appointment.date < today || (appointment.date === today && currentTime && appointment.startTime <= currentTime))) state = 'expired';
  return {
    id: record.id, ...identity, state, kind: interest.kind,
    conversationId: cleanText(record.conversationId, 300),
    appointmentId: cleanText(record.appointmentId, 180),
    sourceMessageId: cleanText(record.lastSourceMessageId, 300),
    requestedAt: cleanText(record.updatedAtIso, 80),
    dateFrom: dateKey(interest.dateFrom), dateTo: dateKey(interest.dateTo),
    originalDate: dateKey(interest.originalDate), originalTime: cleanText(interest.originalTime, 20),
    preference: cleanText(interest.sourceQuote, 800),
    canContact: false, capacityReserved: false,
  };
}
function createMayaOperationsReadModel({ db, clock = () => new Date() } = {}) {
  async function read(collection, id) {
    if (!id) return null;
    const snapshot = await db.collection(collection).doc(documentId(id)).get();
    return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
  }
  async function enrich(record) {
    const [customer, property] = await Promise.all([read('clients', record.customerId), read('properties', record.propertyId)]);
    return { customer, property };
  }
  async function listCancellations(data = {}) {
    const range = cancellationRange(data, clock());
    const size = pageSize(data.pageSize);
    let query = db.collection('appointments').where('cancelledAtIso', '>=', range.start)
      .where('cancelledAtIso', '<', range.end).orderBy('cancelledAtIso', 'desc');
    if (data.afterId) {
      const cursor = await db.collection('appointments').doc(documentId(data.afterId)).get();
      const at = cursor.data()?.cancelledAtIso;
      if (!cursor.exists || typeof at !== 'string' || at < range.start || at >= range.end) {
        throw failure('invalid_cursor', 'The cancellation page changed. Refresh this date range.');
      }
      query = query.startAfter(cursor);
    }
    const snapshots = (await query.limit(size + 1).get()).docs;
    const page = snapshots.slice(0, size);
    const rows = await Promise.all(page.map(async snapshot => {
      const appointment = { ...snapshot.data(), id: snapshot.id };
      if (!CANCELLED.has(cleanText(appointment.status, 40).toLowerCase())) return null;
      const { customer, property } = await enrich(appointment);
      return cancellationRow(appointment, customer, property);
    }));
    return { success: true, version: VERSION, rows: rows.filter(Boolean),
      nextCursor: snapshots.length > size ? page[page.length - 1].id : null,
      from: range.from, to: range.to, timezone: 'America/Aruba',
      coverage: 'canonical_cancelledAtIso', readOnly: true, checkedAt: clock().toISOString() };
  }
  async function listWaitlist(data = {}) {
    const settings = await read('businessSettings', 'whatsapp');
    const account = cleanText(settings?.communicationAccountId, 180).toLowerCase();
    if (!account) throw failure('configuration_missing', 'The active WhatsApp communication account must be verified first.');
    const size = pageSize(data.pageSize);
    let query = db.collection('communicationCases').where('caseType', '==', 'booking_interest')
      .where('communicationAccountId', '==', account);
    if (data.afterId) {
      const cursor = await db.collection('communicationCases').doc(documentId(data.afterId)).get();
      if (!cursor.exists || cursor.data()?.caseType !== 'booking_interest' || cursor.data()?.communicationAccountId !== account) {
        throw failure('invalid_cursor', 'The waiting list changed. Refresh the list.');
      }
      query = query.startAfter(cursor);
    }
    const snapshots = (await query.limit(size + 1).get()).docs;
    const page = snapshots.slice(0, size);
    const current = arubaDateParts(clock());
    const rows = await Promise.all(page.map(async snapshot => {
      const record = { ...snapshot.data(), id: snapshot.id };
      if (record.caseType !== 'booking_interest' || record.communicationAccountId !== account) return null;
      const [{ customer, property }, appointment] = await Promise.all([enrich(record), read('appointments', record.appointmentId)]);
      return waitlistRow(record, customer, property, appointment, current.date, current.time);
    }));
    return { success: true, version: VERSION, rows: rows.filter(Boolean),
      nextCursor: snapshots.length > size ? page[page.length - 1].id : null,
      readOnly: true, proactiveOffersEnabled: false, checkedAt: clock().toISOString() };
  }
  return { listCancellations, listWaitlist };
}
module.exports = { CANCELLED, VERSION, cancellationRange, cancellationRow, createMayaOperationsReadModel, dateKey, timeKey, documentId, failure, pageSize, waitlistRow };
