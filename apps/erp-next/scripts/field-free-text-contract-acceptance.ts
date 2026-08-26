import {
  parseFieldFreeTextJobResponse,
  parseFieldSetReportFreeTextResponse,
} from '../lib/field-free-text-contract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD FREE TEXT CONTRACT ACCEPTANCE FAILED: ${message}`);
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
const visitAsset = {
  id: 'VA-1', visitId: 'visit-WO-1', assetId: 'AC-1', sequence: 1, locationLabel: 'Sala', source: 'existing_asset', status: 'identified', addedOnSite: true,
  createdAt: '2026-08-26T12:20:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-26T12:20:00.000Z', updatedBy: 'uid-1', version: 1,
};
const intervention = {
  id: 'WI-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', plannedWorkLineId: 'line-standard', serviceCatalogItemId: 'service-standard',
  interventionType: 'Standard Service', origin: 'planned', requestedBy: 'office', status: 'in_progress', templateId: 'standard-report', templateVersion: 2,
  startedAt: '2026-08-26T12:25:00.000Z', performedByStaffIds: ['staff-1'], createdAt: '2026-08-26T12:22:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-26T12:25:00.000Z', updatedBy: 'uid-1', version: 2,
};
const response = {
  id: 'FTXT-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'notes', value: 'Drain and electrical connections checked.',
  technicianStaffId: 'staff-1', respondedAt: '2026-08-26T12:30:00.000Z', createdAt: '2026-08-26T12:30:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-26T12:30:00.000Z', updatedBy: 'uid-1', version: 1,
};
const report = {
  interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
  template: { id: 'standard-report', name: 'Standard Report', serviceId: 'service-standard', version: 2, sections: [{ id: 'notes', title: 'Notas técnicas', type: 'free_text', required: true }] },
  sectionStatus: { notes: 'completed' }, evidence: [], measurements: [], findings: [], checklistResponses: [], freeTextResponses: [response],
};
const baseJob = {
  id: 'WO-1', workOrderId: 'WO-1', appointmentId: 'APT-1', date: '2026-08-26', time: '08:30', status: 'En proceso', customerId: 'CLIENT-1', customerName: 'Customer', propertyId: 'PROPERTY-1', address: 'Santa Cruz 1',
  plannedWork: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }], estimatedQuantity: 1, vanId: 'VAN-1', responsibility: 'technician', assignmentSource: 'direct_staff',
  allowedActions: ['read', 'execute', 'report.edit', 'intervention.complete'], fieldVisit: visit, canPrepareVisit: false, knownEquipment: [], visitAssets: [visitAsset], canAddExistingAsset: true,
  workInterventions: [intervention], plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 1, remainingQuantity: 0 }], plannedInterventionOptions: [],
  interventionExecutionOptions: [{ interventionId: 'WI-1', allowedTargets: ['completed', 'pending_part'] }], availableFieldServices: [], canAddPlannedIntervention: false,
  scopeChanges: [], additionalInterventionVisitAssetIds: [], canAddAdditionalIntervention: false, fieldApprovals: [], additionalApprovalInterventionIds: [], canRecordAdditionalApproval: false,
  interventionReports: [report], reportPhotoOptions: [], canAddReportPhoto: false, reportMeasurementOptions: [], canAddReportMeasurement: false, reportFindingOptions: [], canAddReportFinding: false,
  reportChecklistOptions: [], canEditReportChecklist: false, reportFreeTextOptions: [{ interventionId: 'WI-1', sectionIds: ['notes'] }], canEditReportFreeText: true,
};

const parsed = parseFieldFreeTextJobResponse({ success: true, version: 1, job: baseJob });
assert(parsed.job.interventionReports[0].freeTextResponses[0].value.includes('Drain'), 'canonical free text should survive strict parsing');
assert(parsed.job.canEditReportFreeText, 'server-owned edit eligibility should survive strict parsing');

const mutation = parseFieldSetReportFreeTextResponse({ success: true, version: 1, replayed: false, response, sectionCompleted: true, workInterventionVersion: 3, allowedActions: ['read', 'report.edit'], auditEventId: 'FE-1' });
assert(mutation.workInterventionVersion === 3, 'mutation must expose authoritative intervention version');

assertThrows(() => parseFieldFreeTextJobResponse({ success: true, version: 1, job: { ...baseJob, reportFreeTextOptions: undefined } }), 'missing options must fail closed');
assertThrows(() => parseFieldFreeTextJobResponse({ success: true, version: 1, job: { ...baseJob, canEditReportFreeText: false } }), 'eligibility cannot contradict options');
assertThrows(() => parseFieldFreeTextJobResponse({ success: true, version: 1, job: { ...baseJob, allowedActions: ['read'] } }), 'browser cannot acquire report.edit authority');
assertThrows(() => parseFieldFreeTextJobResponse({ success: true, version: 1, job: { ...baseJob, interventionReports: [{ ...report, freeTextResponses: [{ ...response, sectionId: 'wrong' }] }] } }), 'wrong section must fail closed');
assertThrows(() => parseFieldFreeTextJobResponse({ success: true, version: 1, job: { ...baseJob, interventionReports: [{ ...report, freeTextResponses: [{ ...response, assetId: 'AC-X' }] }] } }), 'equipment identity drift must fail closed');
assertThrows(() => parseFieldSetReportFreeTextResponse({ success: true, version: 1, replayed: false, response: { ...response, value: '' }, sectionCompleted: true, workInterventionVersion: 3, allowedActions: ['read', 'report.edit'] }), 'completion cannot contradict empty canonical value');

console.log('Field free-text contract acceptance passed.');
