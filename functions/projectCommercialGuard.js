const { officeReviewDocumentId } = require('./fieldOperationsOfficeReview');
const { initialVisitDocumentId } = require('./fieldOperationsAuthorityWorkVisit');
const { fail } = require('./projectRecords');

function commercialEvidence(record) {
  if (['invoiceId', 'paymentId', 'billingCandidateId', 'fieldBillingCandidateId', 'payrollEntryId']
    .some(key => String(record?.[key] || '').trim())) return true;
  if (['invoiceIds', 'paymentIds', 'billingCandidateIds', 'payrollEntryIds']
    .some(key => {
      const value = record?.[key];
      return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && Boolean(String(value).trim());
    })) return true;
  if (record?.paid !== undefined && record.paid !== null
    && (!Number.isFinite(Number(record.paid)) || Number(record.paid) < 0 || Number(record.paid) > 0)) return true;
  return ['billingStatus', 'invoiceStatus', 'paymentStatus', 'payrollStatus'].map(key => record?.[key])
    .concat([record?.invoiceState?.status, record?.paymentState?.status, record?.payrollState?.status])
    .some(value => {
      const status = String(value || '').trim().toLowerCase();
      return status && !['pending', 'not_started', 'none', 'draft'].includes(status);
    });
}

async function assertNoLinkedCommercialEvidence({ db, get, appointment, order, workOrderId, appointmentId }) {
  if (commercialEvidence(appointment) || commercialEvidence(order)) {
    fail('This booking has commercial or payroll evidence requiring separate reconciliation.');
  }
  const review = await get(db.collection('fieldOfficeReviews').doc(officeReviewDocumentId(workOrderId)));
  if (review.exists) {
    // Even a pending or returned review means Field evidence already exists.
    fail('Field Office Review requires separate execution and financial reconciliation.');
  }
  // Local ERP mirrors cannot prove the absence of an external QuickBooks transaction.
  const references = [
    ['invoices', 'workOrderId', workOrderId], ['invoices', 'appointmentId', appointmentId],
    ['payments', 'workOrderId', workOrderId], ['payments', 'appointmentId', appointmentId],
    ['fieldBillingCandidates', 'workOrderId', workOrderId], ['fieldBillingCandidates', 'appointmentId', appointmentId],
  ];
  const snapshots = await Promise.all(references.map(([collection, field, id]) =>
    get(db.collection(collection).where(field, '==', id).limit(1))));
  for (const snapshot of snapshots) {
    if (typeof snapshot?.empty !== 'boolean' || !Array.isArray(snapshot.docs)
      || snapshot.empty !== (snapshot.docs.length === 0)) fail('Linked commercial records could not be reconciled safely.');
    if (!snapshot.empty) fail('This booking has linked commercial evidence requiring separate reconciliation.');
  }
}

function executionMarker(record, allowSyntheticBackdatedMarker = false) {
  return ['actualStartedAt', 'actualCompletedAt', 'startedAt', 'completedAt', 'executionOutcome',
    'workVisitId', 'workVisitIds', 'fieldReportId', 'fieldReportIds', 'actualWorkedMinutes', 'afterHoursWorkedMinutes',
    'actualHours', 'actualLaborHours',
    ...(allowSyntheticBackdatedMarker ? [] : ['workAlreadyPerformed'])]
    .some(key => {
      const value = record?.[key];
      return value !== undefined && value !== null && value !== false && value !== 0 && value !== ''
        && (!Array.isArray(value) || value.length > 0);
    });
}

function assertNoProjectAssignmentExecution(link) {
  if (!link || ['actualHours', 'unitsCompleted'].some(key => {
    const value = Number(link[key] || 0);
    return !Number.isFinite(value) || value !== 0;
  }) || Boolean(link.postedAt) || (link.fieldReports !== undefined && link.fieldReports !== null
    && (!Array.isArray(link.fieldReports) || link.fieldReports.length > 0))
    || (link.status && link.status !== 'Scheduled')) {
    fail('Project assignment has recorded execution requiring separate reconciliation.');
  }
}

async function assertNoFieldExecutionEvidence({ db, get, appointment, order, workOrderId, appointmentId,
  allowCancelled = false, allowSyntheticBackdatedMarker = false }) {
  const appointmentStatus = String(appointment?.status || '').trim().toLowerCase();
  const orderStatus = String(order?.status || '').trim().toLowerCase();
  const allowedAppointments = allowCancelled ? ['cancelled'] : ['confirmed', 'temporary_hold', 'pending'];
  const allowedOrders = allowCancelled ? ['cancelada'] : ['confirmada', 'reserva temporal', 'pendiente', 'asignada'];
  const syntheticBackdatedMarker = allowSyntheticBackdatedMarker
    && appointment?.bookingMode === 'backdated' && order?.bookingMode === 'backdated'
    && appointment?.backdatingAcknowledged === true && order?.backdatingAcknowledged === true
    && appointment?.workAlreadyPerformed === true && order?.workAlreadyPerformed === true;
  if (!allowedAppointments.includes(appointmentStatus) || !allowedOrders.includes(orderStatus)
    || executionMarker(appointment, syntheticBackdatedMarker) || executionMarker(order, syntheticBackdatedMarker)) {
    fail('Project Field execution requires separate reconciliation before changing the booking.');
  }
  // Field creates the first visit at a deterministic ID. Reading it in the same
  // transaction also conflicts with a concurrent first-visit create.
  const initialVisit = await get(db.collection('workVisits').doc(initialVisitDocumentId(workOrderId)));
  if (initialVisit.exists) fail('Project Field execution requires separate reconciliation before changing the booking.');
  const visits = await Promise.all([
    get(db.collection('workVisits').where('workOrderId', '==', workOrderId).limit(1)),
    get(db.collection('workVisits').where('appointmentId', '==', appointmentId).limit(1)),
  ]);
  for (const snapshot of visits) {
    if (typeof snapshot?.empty !== 'boolean' || !Array.isArray(snapshot.docs)
      || snapshot.empty !== (snapshot.docs.length === 0)) fail('Project Field visits could not be reconciled safely.');
    if (!snapshot.empty) fail('Project Field execution requires separate reconciliation before changing the booking.');
  }
}

module.exports = { assertNoLinkedCommercialEvidence, assertNoFieldExecutionEvidence, assertNoProjectAssignmentExecution };
