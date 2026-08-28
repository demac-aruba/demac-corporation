import {
  parseFieldCreateSaleLineResponse,
  parseFieldDecideSaleLineResponse,
  parseFieldSaleJobResponse,
  parseFieldTransitionSaleLineResponse,
} from '../lib/field-sale-contract';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`FIELD SALE CONTRACT ACCEPTANCE FAILED: ${message}`); }
function rejects(action: () => unknown, message: string) { let threw = false; try { action(); } catch { threw = true; } assert(threw, message); }

const visit = {
  id: 'visit-WO-1', appointmentId: 'APT-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
  scheduledScopeSnapshot: { appointmentId: 'APT-1', capturedAt: '2026-08-27T10:00:00.000Z', estimatedUnitCount: 1, workLines: [{ id: 'line-1', label: 'Service', quantity: 1 }] },
  status: 'in_progress', participatingStaffIds: ['staff-1'], requiresSecondVisit: false,
  createdAt: '2026-08-27T10:00:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-27T10:10:00.000Z', updatedBy: 'uid-1', version: 2, availableTransitions: [],
};
const preview = {
  version: 1, source: 'canonical_field_truth', visitId: 'visit-WO-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'in_progress',
  plannedQuantity: 1, unreconciledPlannedQuantity: 0, actualAssetCount: 0, interventionCount: 0, completedInterventionCount: 0,
  pendingPartInterventionCount: 0, notPerformedInterventionCount: 0, activeInterventionCount: 0, requiredSectionCount: 0, completedRequiredSectionCount: 0, incompleteRequiredSections: [],
};
const price = { currency: 'AWG', unitPrice: 75, lineTotal: 150, sourceCatalogItemId: 'product-switch', pricingVersion: 'service-catalog:product-switch:fixed', capturedAt: '2026-08-27T10:20:00.000Z' };
const proposed = {
  id: 'FSL-1', visitId: 'visit-WO-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', catalogItemId: 'product-switch',
  descriptionSnapshot: '220V Switch', quantity: 2, unit: 'ea', priceSnapshot: price, status: 'proposed', soldByStaffId: 'staff-1',
  requiresCustomerApproval: true, nonCatalog: false, officeReviewRequired: false, createdAt: '2026-08-27T10:20:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-27T10:20:00.000Z', updatedBy: 'uid-1', version: 1,
};
const approval = {
  id: 'FA-1', visitId: 'visit-WO-1', status: 'approved', method: 'verbal', affected: [{ type: 'sale_line', id: 'FSL-1' }], receiverName: 'Maria Client',
  decidedAt: '2026-08-27T10:25:00.000Z', technicianStaffId: 'staff-1', createdAt: '2026-08-27T10:25:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-27T10:25:00.000Z', updatedBy: 'uid-1', version: 1,
};
const baseJob = {
  id: 'WO-1', workOrderId: 'WO-1', appointmentId: 'APT-1', date: '2026-08-27', time: '08:30', status: 'En proceso', customerId: 'CLIENT-1', customerName: 'Customer', propertyId: 'PROPERTY-1', address: 'Aruba 1',
  plannedWork: [{ id: 'line-1', label: 'Service', quantity: 1 }], estimatedQuantity: 1, vanId: 'VAN-1', responsibility: 'lead', assignmentSource: 'direct_staff', allowedActions: ['read', 'execute', 'visit.complete'],
  fieldVisit: visit, canPrepareVisit: false, canCreateReturnVisit: false, knownEquipment: [], visitAssets: [], canAddExistingAsset: true,
  workInterventions: [], plannedWorkProgress: [{ id: 'line-1', plannedQuantity: 1, linkedActualQuantity: 0, disposedQuantity: 1, remainingQuantity: 0 }], plannedInterventionOptions: [], interventionExecutionOptions: [], availableFieldServices: [], canAddPlannedIntervention: false,
  plannedWorkDispositions: [{ id: 'PWD-1', visitId: 'visit-WO-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', plannedWorkLineId: 'line-1', quantity: 1, reasonCode: 'customer_cancelled', createdAt: '2026-08-27T10:15:00.000Z', createdBy: 'uid-1', version: 1 }], plannedWorkDispositionOptions: [], canRecordPlannedWorkDisposition: false,
  scopeChanges: [], additionalInterventionVisitAssetIds: [], canAddAdditionalIntervention: false, fieldApprovals: [], additionalApprovalInterventionIds: [], canRecordAdditionalApproval: false,
  interventionReports: [], reportPhotoOptions: [], canAddReportPhoto: false, reportMeasurementOptions: [], canAddReportMeasurement: false, reportFindingOptions: [], canAddReportFinding: false,
  reportChecklistOptions: [], canEditReportChecklist: false, reportFreeTextOptions: [], canEditReportFreeText: false, reportCustomerAcknowledgementOptions: [], canRecordCustomerAcknowledgement: false,
  reportVoiceNoteOptions: [], canAddReportVoiceNote: false, professionalReportPreview: preview,
  fieldSaleLines: [proposed], fieldSaleCatalogOptions: [{ catalogItemId: 'product-switch', label: '220V Switch', unit: 'ea', priceSnapshot: { ...price, lineTotal: 75 } }],
  fieldSaleDecisionLineIds: ['FSL-1'], fieldSaleTransitionOptions: [{ saleLineId: 'FSL-1', allowedTargets: ['voided'] }],
  canAddFieldSaleLine: true, canAddNonCatalogFieldSaleLine: true, canRecordFieldSaleDecision: true,
};

const parsed = parseFieldSaleJobResponse({ success: true, version: 1, job: baseJob });
assert(parsed.job.fieldSaleLines[0].priceSnapshot?.lineTotal === 150, 'canonical quantity price snapshot should survive strict parsing');
assert(parsed.job.fieldSaleDecisionLineIds[0] === 'FSL-1', 'server decision capability should survive strict parsing');

rejects(() => parseFieldSaleJobResponse({ success: true, version: 1, job: { ...baseJob, fieldSaleLines: [{ ...proposed, priceSnapshot: { ...price, unitPrice: -1 } }] } }), 'negative client price must fail closed');
rejects(() => parseFieldSaleJobResponse({ success: true, version: 1, job: { ...baseJob, fieldSaleLines: [{ ...proposed, nonCatalog: true, officeReviewRequired: true }] } }), 'non-catalog draft cannot retain catalog identity or price');
rejects(() => parseFieldSaleJobResponse({ success: true, version: 1, job: { ...baseJob, fieldSaleDecisionLineIds: ['FSL-OTHER'] } }), 'client cannot invent sale decision authority');
rejects(() => parseFieldSaleJobResponse({ success: true, version: 1, job: { ...baseJob, fieldSaleTransitionOptions: [] } }), 'client contract must require the exact server transition projection');

const created = parseFieldCreateSaleLineResponse({ success: true, version: 1, replayed: false, fieldSaleLine: proposed });
assert(created.fieldSaleLine.status === 'proposed', 'created sale line must preserve proposed status');

const approvedLine = { ...proposed, status: 'customer_approved', customerApprovalId: 'FA-1', updatedAt: approval.decidedAt, version: 2 };
const decided = parseFieldDecideSaleLineResponse({ success: true, version: 1, replayed: false, fieldSaleLine: approvedLine, approval });
assert(decided.approval.affected[0].type === 'sale_line', 'customer approval must bind the exact sale line');
rejects(() => parseFieldDecideSaleLineResponse({ success: true, version: 1, replayed: false, fieldSaleLine: { ...approvedLine, customerApprovalId: 'FA-OTHER' }, approval }), 'approval identity drift must fail closed');

const sold = parseFieldTransitionSaleLineResponse({ success: true, version: 1, replayed: false, fieldSaleLine: { ...approvedLine, status: 'sold', version: 4 } });
assert(sold.fieldSaleLine.inventoryMovementId === undefined && sold.fieldSaleLine.invoiceLineId === undefined, 'sold line must not fabricate Inventory or Billing handoff ids');
const voidedCustom = parseFieldTransitionSaleLineResponse({ success: true, version: 1, replayed: false, fieldSaleLine: {
  ...proposed, catalogItemId: undefined, priceSnapshot: undefined, descriptionSnapshot: 'Custom mounting bracket', status: 'voided',
  requiresCustomerApproval: false, nonCatalog: true, officeReviewRequired: true, notes: 'Customer changed scope.', version: 2,
} });
assert(voidedCustom.fieldSaleLine.status === 'voided', 'non-catalog Office Review drafts may be voided without becoming catalog sales');

const approvedJob = parseFieldSaleJobResponse({ success: true, version: 1, job: {
  ...baseJob, fieldSaleLines: [approvedLine], fieldApprovals: [approval], fieldSaleDecisionLineIds: [],
  fieldSaleTransitionOptions: [{ saleLineId: 'FSL-1', allowedTargets: ['installed', 'delivered', 'voided'] }], canRecordFieldSaleDecision: false,
} });
assert(approvedJob.job.fieldApprovals[0].status === 'approved', 'approved sale relation must remain coherent in job projection');

console.log('Field Sale contract acceptance passed.');
