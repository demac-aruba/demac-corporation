import { parseFieldProfessionalReportJobResponse } from '../lib/field-professional-report-contract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD PROFESSIONAL REPORT CONTRACT ACCEPTANCE FAILED: ${message}`);
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
const reportBase = {
  interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
  template: {
    id: 'standard-report', name: 'Standard Report', serviceId: 'service-standard', version: 2,
    sections: [
      { id: 'voice', title: 'Nota de voz', type: 'voice_note', required: true },
      { id: 'ack', title: 'Confirmación del cliente', type: 'customer_acknowledgement', required: false },
    ],
  },
  sectionStatus: { voice: 'pending', ack: 'pending' }, evidence: [], measurements: [], findings: [], checklistResponses: [], freeTextResponses: [], customerAcknowledgements: [], voiceNotes: [],
  completion: {
    requiredSectionCount: 1,
    completedRequiredSectionCount: 0,
    incompleteRequiredSections: [{ id: 'voice', title: 'Nota de voz', type: 'voice_note', status: 'pending' }],
    complete: false,
  },
};
const preview = {
  version: 1, source: 'canonical_field_truth', visitId: 'visit-WO-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
  status: 'incomplete_report', plannedQuantity: 1, unreconciledPlannedQuantity: 0, actualAssetCount: 1, interventionCount: 1, completedInterventionCount: 0,
  pendingPartInterventionCount: 0, notPerformedInterventionCount: 0, activeInterventionCount: 1,
  requiredSectionCount: 1, completedRequiredSectionCount: 0,
  incompleteRequiredSections: [{ interventionId: 'WI-1', sectionId: 'voice', title: 'Nota de voz', type: 'voice_note', status: 'pending' }],
};
const baseJob = {
  id: 'WO-1', workOrderId: 'WO-1', appointmentId: 'APT-1', date: '2026-08-26', time: '08:30', status: 'En proceso', customerId: 'CLIENT-1', customerName: 'Customer', propertyId: 'PROPERTY-1', address: 'Santa Cruz 1',
  plannedWork: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }], estimatedQuantity: 1, vanId: 'VAN-1', responsibility: 'technician', assignmentSource: 'direct_staff',
  allowedActions: ['read', 'execute', 'evidence.add', 'report.edit', 'intervention.complete'], fieldVisit: visit, canPrepareVisit: false, canCreateReturnVisit: false, knownEquipment: [], visitAssets: [visitAsset], canAddExistingAsset: true,
  workInterventions: [intervention], plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 1, remainingQuantity: 0 }], plannedInterventionOptions: [],
  interventionExecutionOptions: [{ interventionId: 'WI-1', allowedTargets: ['completed', 'pending_part'] }], availableFieldServices: [], canAddPlannedIntervention: false,
  scopeChanges: [], additionalInterventionVisitAssetIds: [], canAddAdditionalIntervention: false, fieldApprovals: [], additionalApprovalInterventionIds: [], canRecordAdditionalApproval: false,
  interventionReports: [reportBase], reportPhotoOptions: [], canAddReportPhoto: false, reportMeasurementOptions: [], canAddReportMeasurement: false, reportFindingOptions: [], canAddReportFinding: false,
  reportChecklistOptions: [], canEditReportChecklist: false, reportFreeTextOptions: [], canEditReportFreeText: false,
  reportCustomerAcknowledgementOptions: [], canRecordCustomerAcknowledgement: false,
  reportVoiceNoteOptions: [{ interventionId: 'WI-1', sectionIds: ['voice'] }], canAddReportVoiceNote: true,
  professionalReportPreview: preview,
};

const parsed = parseFieldProfessionalReportJobResponse({ success: true, version: 1, job: baseJob });
assert(parsed.job.professionalReportPreview?.status === 'incomplete_report', 'server Professional Report readiness should survive strict parsing');
assert(parsed.job.professionalReportPreview?.unreconciledPlannedQuantity === 0, 'canonical reconciliation count should survive strict parsing');
assert(parsed.job.interventionReports[0].completion.incompleteRequiredSections[0].id === 'voice', 'exact required blocker should survive strict parsing');

const completedReport = {
  ...reportBase,
  sectionStatus: { voice: 'completed', ack: 'pending' },
  voiceNotes: [{
    id: 'EVID-VOICE-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'voice', kind: 'voice_note',
    storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/voice/voice/report-voice-001.webm', contentType: 'audio/webm', sizeBytes: 2048, durationSeconds: 42,
    capturedAt: '2026-08-26T12:30:00.000Z', createdAt: '2026-08-26T12:30:00.000Z', createdBy: 'uid-1', version: 1,
  }],
  completion: { requiredSectionCount: 1, completedRequiredSectionCount: 1, incompleteRequiredSections: [], complete: true },
};
const readyPreview = { ...preview, status: 'in_progress', completedRequiredSectionCount: 1, incompleteRequiredSections: [] };
const readyJob = { ...baseJob, interventionReports: [completedReport], reportVoiceNoteOptions: [], canAddReportVoiceNote: false, professionalReportPreview: readyPreview };
const ready = parseFieldProfessionalReportJobResponse({ success: true, version: 1, job: readyJob });
assert(ready.job.interventionReports[0].completion.complete, 'completed required sections should parse as complete while execution remains in progress');

const unreconciledJob = {
  ...readyJob,
  plannedWork: [{ id: 'line-standard', label: 'Standard Service', quantity: 2 }],
  plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 2, linkedActualQuantity: 1, remainingQuantity: 1 }],
  professionalReportPreview: { ...readyPreview, plannedQuantity: 2, unreconciledPlannedQuantity: 1 },
};
const unreconciled = parseFieldProfessionalReportJobResponse({ success: true, version: 1, job: unreconciledJob });
assert(unreconciled.job.professionalReportPreview?.status === 'in_progress', 'unreconciled planned work must prevent field-complete projection');

assertThrows(() => parseFieldProfessionalReportJobResponse({
  success: true, version: 1, job: { ...baseJob, professionalReportPreview: { ...preview, actualAssetCount: 2 } },
}), 'preview counts cannot drift from canonical VisitAssets');
assertThrows(() => parseFieldProfessionalReportJobResponse({
  success: true, version: 1, job: { ...baseJob, professionalReportPreview: { ...preview, unreconciledPlannedQuantity: 1 } },
}), 'preview unreconciled quantity cannot drift from canonical planned-work progress');
assertThrows(() => parseFieldProfessionalReportJobResponse({
  success: true, version: 1, job: { ...baseJob, interventionReports: [{ ...reportBase, completion: { ...reportBase.completion, complete: true } }] },
}), 'completion flag cannot contradict required section state');
assertThrows(() => parseFieldProfessionalReportJobResponse({
  success: true, version: 1, job: { ...baseJob, professionalReportPreview: { ...preview, status: 'field_complete' } },
}), 'browser cannot promote active work to a final field-complete report');
assertThrows(() => parseFieldProfessionalReportJobResponse({
  success: true, version: 1, job: { ...baseJob, professionalReportPreview: undefined },
}), 'Professional Report preview field is required on canonical get_job responses');

console.log('Field Professional Report contract acceptance passed.');
