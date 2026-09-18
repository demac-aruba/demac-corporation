'use strict';
const d = require('./registry-domain');
const { projectCanonicalWorkVisit } = require('../fieldOperationsAuthorityWorkVisit');
const { officeReviewDocumentId, projectOfficeReview, projectOfficeReviewRevision } = require('../fieldOperationsOfficeReview');
const PAGE_SIZE = 10;
const MAX_ORDERS = 200;
const MAX_VISITS = 500;
// Read-only compatibility with current Work Order lifecycle labels; never a capacity decision.
const CANCELLED = new Set(['Cancelada', 'Cancelado', 'cancelled', 'Reprogramada']);
const KNOWN = new Set(['Solicitud recibida', 'Reserva temporal', 'Confirmada', 'Asignada', 'En camino', 'En el sitio', 'En proceso', 'Pendiente', 'Completada', 'Facturada', 'Pagada', ...CANCELLED]);
const record = (snapshot) => snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
function groups(items, size = 10) { const result = []; for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size)); return result; }

/** Consistent, bounded canonical read. Never writes counters, capacity or field actuals. */
async function loadProjectActivity({ db, transaction, project, afterId }) {
  let query = db.collection('projectAppointmentLinks').where('projectId', '==', project.id).orderBy('__name__');
  if (afterId !== undefined) query = query.startAfter(d.id(afterId, 'activity cursor'));
  const linkSnapshot = await transaction.get(query.limit(PAGE_SIZE + 1));
  const linkDocs = linkSnapshot.docs.slice(0, PAGE_SIZE);
  const links = linkDocs.map(record);
  const importReviewPending = project.migration?.status === 'pending_reconciliation';
  const issues = importReviewPending ? [{ code: 'legacy_import_requires_reconciliation' }] : [];
  const more = linkSnapshot.docs.length > PAGE_SIZE;
  const selectedIds = links.map((link) => d.id(link.appointmentId));
  for (const link of links) {
    if (link.schemaVersion !== 1 || link.id !== link.appointmentId || link.projectId !== project.id || link.customerId !== project.customerId || link.propertyId !== project.propertyId || (link.phaseId !== null && !project.phases.some((phase) => phase.id === link.phaseId))) {
      throw d.fault('project_link_conflict', 'Project association requires reconciliation.', 409);
    }
  }
  const appointments = selectedIds.length ? (await transaction.getAll(...selectedIds.map((id) => db.collection('appointments').doc(id)))).map(record) : [];
  const byAppointment = new Map(appointments.filter(Boolean).map((row) => [row.id, row]));
  let orders = []; let visits = [];
  if (selectedIds.length) {
    const snapshot = await transaction.get(db.collection('workOrders').where('appointmentId', 'in', selectedIds).limit(MAX_ORDERS + 1));
    if (snapshot.docs.length > MAX_ORDERS) issues.push({ code: 'work_order_read_truncated' });
    orders = snapshot.docs.slice(0, MAX_ORDERS).map(record);
  }
  // Reject identity-conflicting parents before reading any of their Field children.
  const eligibleOrders = orders.filter((order) => {
    const appointment = byAppointment.get(order.appointmentId);
    return appointment && appointment.customerId === project.customerId && appointment.propertyId === project.propertyId
      && (appointment.clientId === undefined || appointment.clientId === project.customerId)
      && order.clientId === project.customerId && order.propertyId === project.propertyId
      && (order.customerId === undefined || order.customerId === project.customerId);
  });
  // Batch equality reads, never one unbounded full-collection read per row.
  for (const ids of groups(eligibleOrders.map((order) => order.id))) {
    const remaining = MAX_VISITS - visits.length;
    const snapshot = await transaction.get(db.collection('workVisits').where('workOrderId', 'in', ids).limit(remaining + 1));
    if (snapshot.docs.length > remaining) { issues.push({ code: 'work_visit_read_truncated' }); visits.push(...snapshot.docs.slice(0, remaining).map(record)); break; }
    visits.push(...snapshot.docs.map(record));
  }
  const reviewSnapshots = eligibleOrders.length ? await transaction.getAll(...eligibleOrders.map((order) => db.collection('fieldOfficeReviews').doc(officeReviewDocumentId(order.id)))) : [];
  const rawReviews = reviewSnapshots.filter((item) => item.exists).map(record);
  const orderIds = new Set(orders.map((item) => item.id));
  for (const review of rawReviews) if (!orderIds.has(review.workOrderId) || review.id !== officeReviewDocumentId(review.workOrderId)) issues.push({ code: 'office_review_identity_conflict' });
  const revisionIds = [...new Set(rawReviews.map((review) => review.currentRevisionId).filter((value) => typeof value === 'string'))];
  const revisions = revisionIds.length ? await transaction.getAll(...revisionIds.map((id) => db.collection('fieldOfficeReviewRevisions').doc(d.id(id, 'review revision')))) : [];
  const byRevision = new Map(revisions.filter((item) => item.exists).map((item) => [item.id, record(item)]));
  const byReview = new Map(rawReviews.map((item) => [item.workOrderId, item]));
  const visitsByOrder = new Map();
  for (const raw of visits) { const list = visitsByOrder.get(raw.workOrderId) || []; list.push(raw); visitsByOrder.set(raw.workOrderId, list); }
  const rows = [];
  for (const order of orders) {
    const appointment = byAppointment.get(order.appointmentId);
    const link = links.find((item) => item.appointmentId === order.appointmentId);
    if (!link || !appointment || appointment.customerId !== project.customerId || (appointment.clientId !== undefined && appointment.clientId !== project.customerId) || appointment.propertyId !== project.propertyId || order.clientId !== project.customerId || (order.customerId !== undefined && order.customerId !== project.customerId) || order.propertyId !== project.propertyId || (appointment.appointmentId && appointment.appointmentId !== appointment.id)) {
      issues.push({ code: 'work_identity_conflict', workOrderId: order.id }); continue;
    }
    const cancelled = CANCELLED.has(order.status) || appointment.status === 'cancelled';
    if (appointment.status === 'cancelled' && !CANCELLED.has(order.status)) issues.push({ code: 'appointment_lifecycle_mismatch', workOrderId: order.id });
    if (!['confirmed', 'temporary_hold', 'cancelled', 'completed'].includes(appointment.status) || !KNOWN.has(order.status)) issues.push({ code: 'unknown_scheduling_status', workOrderId: order.id });
    const plannedVanMinutes = Number.isSafeInteger(order.appointmentDurationMinutes) && order.appointmentDurationMinutes >= 0 ? order.appointmentDurationMinutes : null;
    const slots = Number.isSafeInteger(order.scheduledSlots) && order.scheduledSlots >= 0 ? order.scheduledSlots : null;
    if (!cancelled && (plannedVanMinutes === null || slots === null)) issues.push({ code: 'missing_allocation_measurement', workOrderId: order.id });
    const fieldVisits = [];
    for (const raw of visitsByOrder.get(order.id) || []) {
      try {
        if ((raw.clientId !== undefined && raw.clientId !== project.customerId) || (raw.customerId !== undefined && raw.customerId !== project.customerId)) throw new Error('conflicting Field identity');
        const visit = projectCanonicalWorkVisit(raw);
        if ([visit.startedAt, visit.completedAt].some((value) => value !== undefined && !Number.isFinite(Date.parse(value)))) throw new Error('invalid visit timestamp');
        if (visit.workOrderId !== order.id || visit.appointmentId !== appointment.id || visit.customerId !== project.customerId || visit.propertyId !== project.propertyId) throw new Error('identity conflict');
        fieldVisits.push({ id: visit.id, status: visit.status, startedAt: visit.startedAt || null, completedAt: visit.completedAt || null, source: `workVisits/${visit.id}` });
      } catch { issues.push({ code: 'field_visit_reconciliation_required', workOrderId: order.id, visitId: raw.id }); }
    }
    let review = null;
    if (byReview.has(order.id)) {
      try {
        const expected = { workOrderId: order.id, appointmentId: appointment.id, customerId: project.customerId, propertyId: project.propertyId };
        const rawReview = byReview.get(order.id);
        if ((rawReview.clientId !== undefined && rawReview.clientId !== project.customerId) || (rawReview.customerId !== undefined && rawReview.customerId !== project.customerId)) throw new Error('conflicting review identity');
        const validated = projectOfficeReview(rawReview, expected);
        const rawRevision = byRevision.get(validated.currentRevisionId);
        if ((rawRevision?.clientId !== undefined && rawRevision.clientId !== project.customerId) || (rawRevision?.customerId !== undefined && rawRevision.customerId !== project.customerId)) throw new Error('conflicting revision identity');
        const revision = projectOfficeReviewRevision(rawRevision, { ...expected, reviewId: validated.id, visitId: validated.visitId });
        if (revision.revisionNumber !== validated.currentRevisionNumber || !fieldVisits.some((visit) => visit.id === validated.visitId)) throw new Error('revision mismatch');
        review = { status: validated.status, source: `fieldOfficeReviews/${validated.id}`, revisionId: revision.id, reviewedAt: validated.reviewedAt || null };
      } catch { issues.push({ code: 'office_review_reconciliation_required', workOrderId: order.id }); }
    }
    rows.push({ workOrderId: order.id, appointmentId: appointment.id, phaseId: link.phaseId, vanId: order.vanId || null, date: order.date || null, start: order.time || null, status: order.status, cancelled, temporaryHold: appointment.status === 'temporary_hold', plannedVanMinutes, scheduledSlots: slots, visits: fieldVisits, review, source: `workOrders/${order.id}` });
  }
  for (const link of links) {
    if (!byAppointment.has(link.appointmentId)) issues.push({ code: 'linked_appointment_missing', appointmentId: link.appointmentId });
    const app = byAppointment.get(link.appointmentId);
    const expectedIds = [...(Array.isArray(app?.workOrderIds) ? app.workOrderIds : []), ...(app?.workOrderId ? [app.workOrderId] : [])];
    if (expectedIds.some((id) => !orders.some((order) => order.id === id && order.appointmentId === link.appointmentId))) issues.push({ code: 'appointment_work_order_missing', appointmentId: link.appointmentId });
    if (!orders.some((order) => order.appointmentId === link.appointmentId)) issues.push({ code: 'linked_appointment_work_missing', appointmentId: link.appointmentId });
  }
  const pageIsValid = issues.length === 0;
  const activeRows = rows.filter((row) => !row.cancelled);
  const planned = activeRows.reduce((sum, row) => sum + (row.plannedVanMinutes || 0), 0);
  const allProjectLinksIncluded = afterId === undefined && !more && pageIsValid;
  return {
    projectId: project.id, projectVersion: project.version, source: 'canonical_work_orders_and_field',
    rows, issues, nextCursor: more ? linkDocs[linkDocs.length - 1].id : null,
    coverage: { pageIsValid, allProjectLinksIncluded, linkedAppointmentsOnPage: links.length, importReviewPending },
    pageTotals: { plannedVanMinutes: pageIsValid ? planned : null, scheduledSlots: pageIsValid ? activeRows.reduce((sum, row) => sum + row.scheduledSlots, 0) : null, visits: rows.reduce((sum, row) => sum + row.visits.length, 0), approvedWorkOrders: rows.filter((row) => row.review?.status === 'approved').length },
    // Do not label a page subtotal as a project total, or a reservation as executed labor.
    projectForecast: allProjectLinksIncluded ? d.forecast(project.budget.currentMinutes, planned) : null,
    actualLabor: { personMinutes: null, vanMinutes: null, status: 'time_source_not_integrated' },
    physicalProgress: { percent: null, status: 'phase_completion_source_not_integrated' },
  };
}
module.exports = { PAGE_SIZE, loadProjectActivity };
