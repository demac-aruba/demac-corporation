import {
  parseFieldPlannedWorkDispositionJobResponse,
  parseFieldRecordPlannedWorkDispositionResponse,
} from '../lib/field-planned-work-disposition-contract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD PLANNED WORK DISPOSITION CONTRACT ACCEPTANCE FAILED: ${message}`);
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
  plannedWork: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }], estimatedQuantity: 1, vanId: 'VAN-1', responsibility: 'technician', assignmentSource: 'direct_staff',
  allowedActions: ['read', 'execute', 'asset.add', 'intervention.add', 'intervention.complete'], fieldVisit: visit, canPrepareVisit: false, knownEquipment: [], visitAssets: [], canAddExistingAsset: true,
  workInterventions: [], plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 0, disposedQuantity: 1, remainingQuantity: 0 }], plannedInterventionOptions: [],
  interventionExecutionOptions: [], availableFieldServices: [], canAddPlannedIntervention: false,
  plannedWorkDispositions: [disposition], plannedWorkDispositionOptions: [], canRecordPlannedWorkDisposition: false,
  scopeChanges: [], additionalInterventionVisitAssetIds: [], canAddAdditionalIntervention: false, fieldApprovals: [], additionalApprovalInterventionIds: [], canRecordAdditionalApproval: false,
  interventionReports: [], reportPhotoOptions: [], canAddReportPhoto: false, reportMeasurementOptions: [], canAddReportMeasurement: false, reportFindingOptions: [], canAddReportFinding: false,
  reportChecklistOptions: [], canEditReportChecklist: false, reportFreeTextOptions: [], canEditReportFreeText: false,
  reportCustomerAcknowledgementOptions: [], canRecordCustomerAcknowledgement: false, reportVoiceNoteOptions: [], canAddReportVoiceNote: false,
  professionalReportPreview: preview,
};

const parsed = parseFieldPlannedWorkDispositionJobResponse({ success: true, version: 1, job: baseJob });
assert(parsed.job.plannedWorkProgress[0].plannedQuantity === 1, 'planned quantity must remain immutable');
assert(parsed.job.plannedWorkProgress[0].disposedQuantity === 1, 'explicit disposition quantity must survive strict parsing');
assert(parsed.job.plannedWorkProgress[0].remainingQuantity === 0, 'disposition must reconcile remaining quantity to zero');
assert(parsed.job.visitAssets.length === 0 && parsed.job.workInterventions.length === 0, 'reconciliation must not invent equipment or WorkInterventions');
assert(parsed.job.professionalReportPreview?.unreconciledPlannedQuantity === 0, 'Professional Report must consume reconciled remaining quantity');

const pendingJob = {
  ...baseJob,
  plannedWorkDispositions: [],
  plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 0, disposedQuantity: 0, remainingQuantity: 1 }],
  plannedWorkDispositionOptions: [{ plannedWorkLineId: 'line-standard', maxQuantity: 1 }],
  canRecordPlannedWorkDisposition: true,
  professionalReportPreview: { ...preview, unreconciledPlannedQuantity: 1 },
};
const pending = parseFieldPlannedWorkDispositionJobResponse({ success: true, version: 1, job: pendingJob });
assert(pending.job.canRecordPlannedWorkDisposition, 'server-projected disposition option must survive strict parsing');

const mutation = parseFieldRecordPlannedWorkDispositionResponse({
  success: true, version: 1, replayed: false, disposition, allowedActions: ['read', 'intervention.complete'], auditEventId: 'FE-1',
});
assert(mutation.disposition.reasonCode === 'customer_cancelled', 'canonical disposition mutation must parse');

assertThrows(() => parseFieldPlannedWorkDispositionJobResponse({
  success: true, version: 1, job: { ...baseJob, plannedWorkProgress: [{ ...baseJob.plannedWorkProgress[0], remainingQuantity: 1 }] },
}), 'remaining quantity cannot contradict planned-linked-disposed math');
assertThrows(() => parseFieldPlannedWorkDispositionJobResponse({
  success: true, version: 1, job: { ...baseJob, plannedWorkDispositions: [{ ...disposition, propertyId: 'PROPERTY-OTHER' }] },
}), 'disposition cannot drift to another property');
assertThrows(() => parseFieldPlannedWorkDispositionJobResponse({
  success: true, version: 1, job: { ...pendingJob, plannedWorkDispositionOptions: [{ plannedWorkLineId: 'line-standard', maxQuantity: 2 }] },
}), 'browser option maximum must equal canonical remaining quantity');
assertThrows(() => parseFieldPlannedWorkDispositionJobResponse({
  success: true, version: 1, job: { ...pendingJob, allowedActions: ['read'], canRecordPlannedWorkDisposition: true },
}), 'browser cannot acquire disposition authority without intervention.complete');
assertThrows(() => parseFieldRecordPlannedWorkDispositionResponse({
  success: true, version: 1, replayed: false, disposition: { ...disposition, reasonCode: 'invented' }, allowedActions: ['read'],
}), 'mutation response rejects invented reason vocabulary');

console.log('Field Planned Work Disposition contract acceptance passed.');
