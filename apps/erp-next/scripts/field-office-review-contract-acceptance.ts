import {
  parseFieldDecideOfficeReviewResponse,
  parseFieldOfficeReviewJobResponse,
  parseFieldOfficeReviewQueueResponse,
  parseFieldSubmitOfficeReviewResponse,
} from '../lib/field-office-review-contract';
import { parseFieldHistoryJobResponse } from '../lib/field-history-contract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD OFFICE REVIEW CONTRACT ACCEPTANCE FAILED: ${message}`);
}
function assertThrows(action: () => unknown, message: string) {
  let threw = false;
  try { action(); } catch { threw = true; }
  assert(threw, message);
}

const visit = {
  id: 'visit-WO-1', appointmentId: 'APT-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
  scheduledScopeSnapshot: { appointmentId: 'APT-1', capturedAt: '2026-08-26T12:00:00.000Z', estimatedUnitCount: 1, workLines: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }] },
  status: 'in_progress', participatingStaffIds: ['staff-1'], arrivedAt: '2026-08-26T12:15:00.000Z', startedAt: '2026-08-26T12:20:00.000Z', requiresSecondVisit: false,
  createdAt: '2026-08-26T12:00:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-26T12:20:00.000Z', updatedBy: 'uid-1', version: 4, availableTransitions: [],
};
const disposition = {
  id: 'PWD-1', visitId: 'visit-WO-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
  plannedWorkLineId: 'line-standard', quantity: 1, reasonCode: 'customer_cancelled',
  createdAt: '2026-08-26T12:25:00.000Z', createdBy: 'uid-1', version: 1,
};
const preview = {
  version: 1, source: 'canonical_field_truth', visitId: 'visit-WO-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
  status: 'in_progress', plannedQuantity: 1, unreconciledPlannedQuantity: 0, actualAssetCount: 0, interventionCount: 0,
  completedInterventionCount: 0, pendingPartInterventionCount: 0, notPerformedInterventionCount: 0, activeInterventionCount: 0,
  requiredSectionCount: 0, completedRequiredSectionCount: 0, incompleteRequiredSections: [],
};
const baseJob = {
  id: 'WO-1', workOrderId: 'WO-1', appointmentId: 'APT-1', date: '2026-08-26', time: '08:30', status: 'En proceso', customerId: 'CLIENT-1', customerName: 'Customer', propertyId: 'PROPERTY-1', address: 'Santa Cruz 1',
  plannedWork: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }], estimatedQuantity: 1, vanId: 'VAN-1', responsibility: 'lead', assignmentSource: 'direct_staff',
  allowedActions: ['read', 'execute', 'asset.add', 'intervention.add', 'intervention.complete', 'visit.complete'], fieldVisit: visit, canPrepareVisit: false, canCreateReturnVisit: false, knownEquipment: [], visitAssets: [], canAddExistingAsset: true,
  workInterventions: [], plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 0, disposedQuantity: 1, remainingQuantity: 0 }], plannedInterventionOptions: [],
  interventionExecutionOptions: [], availableFieldServices: [], canAddPlannedIntervention: false,
  plannedWorkDispositions: [disposition], plannedWorkDispositionOptions: [], canRecordPlannedWorkDisposition: false,
  scopeChanges: [], additionalInterventionVisitAssetIds: [], canAddAdditionalIntervention: false, fieldApprovals: [], additionalApprovalInterventionIds: [], canRecordAdditionalApproval: false,
  interventionReports: [], reportPhotoOptions: [], canAddReportPhoto: false, reportMeasurementOptions: [], canAddReportMeasurement: false, reportFindingOptions: [], canAddReportFinding: false,
  reportChecklistOptions: [], canEditReportChecklist: false, reportFreeTextOptions: [], canEditReportFreeText: false,
  reportCustomerAcknowledgementOptions: [], canRecordCustomerAcknowledgement: false, reportVoiceNoteOptions: [], canAddReportVoiceNote: false,
  professionalReportPreview: preview,
  fieldSaleLines: [], fieldSaleCatalogOptions: [], fieldSaleDecisionLineIds: [], fieldSaleTransitionOptions: [],
  canAddFieldSaleLine: false, canAddNonCatalogFieldSaleLine: true, canRecordFieldSaleDecision: false,
  officeReviewSubmission: { allowed: true, status: 'ready', correctionRequired: false, blockers: [] },
};

const parsedJob = parseFieldOfficeReviewJobResponse({ success: true, version: 1, job: baseJob });
assert(parsedJob.job.officeReviewSubmission?.allowed, 'server readiness should survive strict parsing');
assert(parsedJob.job.officeReviewSubmission?.status === 'ready', 'only ready status may authorize submission');
assertThrows(() => parseFieldOfficeReviewJobResponse({
  success: true, version: 1, job: { ...baseJob, officeReviewSubmission: { allowed: true, status: 'blocked', correctionRequired: false, blockers: [] } },
}), 'client cannot turn a blocked projection into submission authority');
assertThrows(() => parseFieldOfficeReviewJobResponse({
  success: true, version: 1, job: { ...baseJob, officeReviewSubmission: { allowed: false, status: 'blocked', correctionRequired: false, blockers: [{ code: '', message: 'Missing' }] } },
}), 'readiness blocker identity must be complete');
assertThrows(() => parseFieldOfficeReviewJobResponse({
  success: true, version: 1, job: {
    ...baseJob,
    officeReviewSubmission: { allowed: true, status: 'ready', correctionRequired: true, blockers: [] },
  },
}), 'correction readiness must preserve the review identity and reviewer note');

const customerFieldHistory = {
  version: 1, source: 'canonical_field_truth', customerId: 'CLIENT-1',
  visits: [
    { id: 'visit-WO-1', workOrderId: 'WO-1', propertyId: 'PROPERTY-1', status: 'in_progress', startedAt: visit.startedAt, requiresSecondVisit: false, updatedAt: visit.updatedAt },
    { id: 'visit-WO-PAST', workOrderId: 'WO-PAST', propertyId: 'PROPERTY-1', status: 'completed', startedAt: '2026-07-01T12:00:00.000Z', completedAt: '2026-07-01T13:00:00.000Z', requiresSecondVisit: false, updatedAt: '2026-07-01T13:00:00.000Z' },
  ],
  interventions: [{ id: 'WI-PAST', visitId: 'visit-WO-PAST', workOrderId: 'WO-PAST', propertyId: 'PROPERTY-1', assetId: 'AC-HISTORY', serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service', origin: 'planned', status: 'completed', resultCode: 'ok', resultNotes: 'Cooling restored.', startedAt: '2026-07-01T12:10:00.000Z', completedAt: '2026-07-01T12:50:00.000Z', updatedAt: '2026-07-01T12:50:00.000Z' }],
  saleLines: [{ id: 'FSL-PAST', visitId: 'visit-WO-PAST', workOrderId: 'WO-PAST', propertyId: 'PROPERTY-1', assetId: 'AC-HISTORY', catalogItemId: 'product-switch', descriptionSnapshot: '220V Switch', quantity: 1, unit: 'ea', priceSnapshot: { currency: 'AWG', unitPrice: 75, lineTotal: 75, sourceCatalogItemId: 'product-switch', pricingVersion: 'service-catalog:product-switch:fixed', capturedAt: '2026-07-01T12:20:00.000Z' }, status: 'sold', customerApprovalId: 'FA-PAST', nonCatalog: false, updatedAt: '2026-07-01T12:55:00.000Z' }],
  findings: [{ id: 'FIND-PAST', visitId: 'visit-WO-PAST', workOrderId: 'WO-PAST', propertyId: 'PROPERTY-1', assetId: 'AC-HISTORY', interventionId: 'WI-PAST', summary: 'Drain restriction', details: 'Standing water observed.', recommendation: 'Flush drain.', observedAt: '2026-07-01T12:30:00.000Z' }],
};
const equipmentFieldHistories = [{ assetId: 'AC-HISTORY', locationLabel: 'Sala', interventionIds: ['WI-PAST'], findingIds: ['FIND-PAST'], saleLineIds: ['FSL-PAST'] }];
const historyJob = parseFieldHistoryJobResponse({ success: true, version: 1, job: { ...baseJob, customerFieldHistory, equipmentFieldHistories } });
assert(historyJob.job.customerFieldHistory.visits[0].id === 'visit-WO-1', 'current canonical visit must survive Customer history parsing');
assert(historyJob.job.equipmentFieldHistories[0].findingIds[0] === 'FIND-PAST', 'Equipment history must preserve exact canonical record links');
assertThrows(() => parseFieldHistoryJobResponse({
  success: true, version: 1, job: { ...baseJob, customerFieldHistory: { ...customerFieldHistory, customerId: 'CLIENT-OTHER' }, equipmentFieldHistories },
}), 'Customer history cannot drift from the assigned job Customer');
assertThrows(() => parseFieldHistoryJobResponse({
  success: true, version: 1, job: { ...baseJob, customerFieldHistory, equipmentFieldHistories: [{ assetId: 'AC-INVENTED', interventionIds: [], findingIds: [], saleLineIds: [] }] },
}), 'Equipment history cannot invent an asset outside canonical Customer field truth');
assertThrows(() => parseFieldHistoryJobResponse({
  success: true, version: 1, job: { ...baseJob, customerFieldHistory, equipmentFieldHistories: [{ ...equipmentFieldHistories[0], interventionIds: [] }] },
}), 'Equipment history cannot omit an intervention attached to the exact Asset');

const review = {
  id: 'FOR-1', workOrderId: 'WO-1', appointmentId: 'APT-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', visitId: 'visit-WO-1',
  status: 'pending', currentRevisionId: 'FORR-1', currentRevisionNumber: 1, submittedAt: '2026-08-26T12:30:00.000Z', submittedBy: 'uid-1',
  createdAt: '2026-08-26T12:30:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-26T12:30:00.000Z', version: 1,
};
const reviewVisitAsset = {
  id: 'VA-1', visitId: 'visit-WO-1', assetId: 'AC-1', sequence: 1, locationLabel: 'Sala', source: 'existing',
  status: 'linked', addedOnSite: false, version: 1,
};
const reviewIntervention = {
  id: 'WI-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
  interventionType: 'Standard Service', origin: 'additional', status: 'completed', resultCode: 'ok', resultNotes: 'Cooling restored.', version: 2,
};
const frozenReport = {
  interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
  template: {
    id: 'template-standard', name: 'Standard Report', serviceId: 'service-standard', version: 1,
    sections: [{ id: 'condition', title: 'Final condition', type: 'checklist', required: true, checklistItems: [{ id: 'filter-clean', label: 'Filter clean' }] }],
  },
  sectionStatus: { condition: 'completed' },
  completion: { requiredSectionCount: 1, completedRequiredSectionCount: 1, incompleteRequiredSections: [], complete: true },
  evidence: [], measurements: [], findings: [], freeTextResponses: [], customerAcknowledgements: [], voiceNotes: [],
  checklistResponses: [{
    id: 'CHECK-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1',
    sectionId: 'condition', itemId: 'filter-clean', checked: true, technicianStaffId: 'staff-1',
    respondedAt: '2026-08-26T12:28:00.000Z', createdAt: '2026-08-26T12:28:00.000Z', createdBy: 'uid-1',
    updatedAt: '2026-08-26T12:28:00.000Z', updatedBy: 'uid-1', version: 1,
  }],
};
const reviewPreview = {
  ...preview, status: 'field_complete', actualAssetCount: 1, interventionCount: 1, completedInterventionCount: 1,
  requiredSectionCount: 1, completedRequiredSectionCount: 1,
};
const reviewSnapshot = {
  version: 1, source: 'canonical_field_truth',
  visitChain: [{ id: 'visit-WO-1', status: 'in_progress', version: 4, requiresSecondVisit: false }],
  plannedWorkProgress: baseJob.plannedWorkProgress,
  professionalReportPreview: reviewPreview,
  visitAssets: [reviewVisitAsset], interventions: [reviewIntervention], plannedWorkDispositions: [disposition], scopeChanges: [], approvals: [],
  fieldSaleLines: [], reports: [frozenReport], visitAssetCount: 1, distinctAssetCount: 1,
};
const revision = {
  id: 'FORR-1', reviewId: 'FOR-1', revisionNumber: 1, workOrderId: 'WO-1', appointmentId: 'APT-1', customerId: 'CLIENT-1',
  propertyId: 'PROPERTY-1', visitId: 'visit-WO-1', sourceVisitVersion: 4, submittedAt: '2026-08-26T12:30:00.000Z',
  submittedBy: 'uid-1', requestId: 'office-review-submit-001', snapshot: reviewSnapshot, version: 1,
};
const submittedVisit = { ...visit, status: 'ready_for_office_review', submittedAt: '2026-08-26T12:30:00.000Z', updatedAt: '2026-08-26T12:30:00.000Z', version: 5 };

const submitted = parseFieldSubmitOfficeReviewResponse({ success: true, version: 1, replayed: false, review, revision, visit: submittedVisit });
assert(submitted.review.currentRevisionNumber === 1, 'submission revision identity should survive parsing');
const queue = parseFieldOfficeReviewQueueResponse({ success: true, version: 1, reviews: [{ ...review, currentRevision: revision }] });
assert(queue.reviews[0].currentRevision.snapshot.source === 'canonical_field_truth', 'queue must expose immutable canonical snapshot');
assert(queue.reviews[0].currentRevision.snapshot.reports[0].checklistResponses[0].checked, 'queue must preserve frozen report content');
assertThrows(() => parseFieldOfficeReviewQueueResponse({
  success: true,
  version: 1,
  reviews: [{
    ...review,
    currentRevision: {
      ...revision,
      snapshot: { ...reviewSnapshot, reports: [{ ...frozenReport, checklistResponses: [] }] },
    },
  }],
}), 'queue must reject a completed frozen report section whose canonical content is missing');
assertThrows(() => parseFieldOfficeReviewQueueResponse({
  success: true,
  version: 1,
  reviews: [{
    ...review,
    currentRevision: {
      ...revision,
      snapshot: { ...reviewSnapshot, professionalReportPreview: { ...reviewPreview, status: 'in_progress' } },
    },
  }],
}), 'queue must reject Professional Report readiness that drifts from the frozen canonical snapshot');

const correctedRevision = {
  ...revision,
  id: 'FORR-2',
  revisionNumber: 2,
  correctionOfRevisionId: 'FORR-1',
  officeReturnNote: 'Clarify condition.',
  technicianCorrectionNote: 'Clarified the final equipment condition.',
};
const correctedReview = { ...review, currentRevisionId: 'FORR-2', currentRevisionNumber: 2, version: 3 };
const correctedQueue = parseFieldOfficeReviewQueueResponse({
  success: true, version: 1, reviews: [{ ...correctedReview, currentRevision: correctedRevision }],
});
assert(correctedQueue.reviews[0].currentRevision.technicianCorrectionNote === 'Clarified the final equipment condition.', 'correction context must survive strict parsing');

const returnedReview = {
  ...review, status: 'returned', reviewedAt: '2026-08-26T12:40:00.000Z', reviewedBy: 'office-1', reviewerName: 'Office One',
  reviewerNote: 'Clarify condition.', updatedAt: '2026-08-26T12:40:00.000Z', version: 2,
};
const returnedVisit = { ...submittedVisit, status: 'in_progress', updatedAt: '2026-08-26T12:40:00.000Z', version: 6 };
const returned = parseFieldDecideOfficeReviewResponse({ success: true, version: 1, replayed: false, review: returnedReview, visit: returnedVisit, inventoryHandoff: null, billingCandidate: null });
assert(returned.review.status === 'returned', 'return decision should reopen the visit without replacing review identity');

const approvedReview = { ...returnedReview, status: 'approved', reviewerNote: 'Verified.', version: 2 };
const approvedVisit = { ...submittedVisit, status: 'completed', completedAt: '2026-08-26T12:40:00.000Z', updatedAt: '2026-08-26T12:40:00.000Z', version: 6 };
const inventoryHandoff = {
  id: 'FIH-1', officeReviewId: 'FOR-1', officeReviewRevisionId: 'FORR-1', revisionNumber: 1,
  workOrderId: 'WO-1', appointmentId: 'APT-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', visitId: 'visit-WO-1',
  sourceLocationId: 'VAN-1', status: 'ready_for_inventory_authority',
  lines: [{ sourceSaleLineId: 'FSL-1', itemKind: 'product', itemId: 'product-switch', descriptionSnapshot: '220V Switch', quantity: 2, unit: 'ea' }],
  blockers: [], inventoryMovementIds: [], sourceDecisionRequestId: 'office-review-approve-001',
  createdAt: '2026-08-26T12:40:00.000Z', createdBy: 'office-1', version: 1,
};
const billingCandidate = {
  id: 'FBC-1', officeReviewId: 'FOR-1', officeReviewRevisionId: 'FORR-1', revisionNumber: 1,
  workOrderId: 'WO-1', appointmentId: 'APT-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', visitId: 'visit-WO-1',
  status: 'ready_for_billing_review', lines: [{ sourceType: 'sale_line', sourceId: 'FSL-1', catalogItemId: 'product-switch', description: '220V Switch', quantity: 2, unitPrice: 75, currency: 'AWG', lineTotal: 150 }],
  blockers: [], invoiceLineIds: [], sourceDecisionRequestId: 'office-review-approve-001', createdAt: '2026-08-26T12:40:00.000Z', createdBy: 'office-1', version: 1,
};
const approved = parseFieldDecideOfficeReviewResponse({ success: true, version: 1, replayed: false, review: approvedReview, visit: approvedVisit, inventoryHandoff, billingCandidate });
assert(approved.inventoryHandoff?.status === 'ready_for_inventory_authority', 'approved review should preserve governed Inventory handoff readiness');
assert(approved.billingCandidate?.status === 'ready_for_billing_review', 'approved review should preserve governed Billing candidate readiness');

assertThrows(() => parseFieldOfficeReviewQueueResponse({
  success: true, version: 1, reviews: [{ ...review, currentRevision: { ...revision, workOrderId: 'WO-OTHER' } }],
}), 'revision cannot drift from review Work Order identity');
assertThrows(() => parseFieldSubmitOfficeReviewResponse({
  success: true, version: 1, replayed: false, review, revision, visit: { ...submittedVisit, status: 'completed' },
}), 'submission response cannot pretend Office Review already approved the visit');
assertThrows(() => parseFieldDecideOfficeReviewResponse({
  success: true, version: 1, replayed: false, review: returnedReview, visit: { ...returnedVisit, status: 'completed' }, inventoryHandoff: null, billingCandidate: null,
}), 'returned review cannot contradict reopened visit status');
assertThrows(() => parseFieldDecideOfficeReviewResponse({
  success: true, version: 1, replayed: false, review: approvedReview, visit: approvedVisit,
  inventoryHandoff: { ...inventoryHandoff, customerId: 'CLIENT-OTHER' },
  billingCandidate,
}), 'Inventory handoff cannot drift from approved Office Review identity');
assertThrows(() => parseFieldDecideOfficeReviewResponse({
  success: true, version: 1, replayed: false, review: approvedReview, visit: approvedVisit,
  inventoryHandoff: { ...inventoryHandoff, inventoryMovementIds: ['IM-FABRICATED'] },
  billingCandidate,
}), 'Field candidate must not fabricate an Inventory movement');
assertThrows(() => parseFieldDecideOfficeReviewResponse({
  success: true, version: 1, replayed: false, review: approvedReview, visit: approvedVisit, inventoryHandoff,
  billingCandidate: { ...billingCandidate, invoiceLineIds: ['INVOICE-LINE-FABRICATED'] },
}), 'Field candidate must not fabricate a Billing invoice line');
assertThrows(() => parseFieldDecideOfficeReviewResponse({
  success: true, version: 1, replayed: false, review: approvedReview, visit: approvedVisit, inventoryHandoff,
  billingCandidate: { ...billingCandidate, lines: [{ ...billingCandidate.lines[0], lineTotal: 151 }] },
}), 'Field candidate must not accept contradictory Billing totals');

console.log('Field Office Review contract acceptance passed.');
