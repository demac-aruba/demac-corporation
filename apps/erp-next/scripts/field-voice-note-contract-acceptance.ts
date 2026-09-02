import {
  parseFieldAddReportVoiceNoteResponse,
  parseFieldVoiceNoteJobResponse,
} from '../lib/field-voice-note-contract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD VOICE NOTE CONTRACT ACCEPTANCE FAILED: ${message}`);
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
      { id: 'voice', title: 'Nota de voz', type: 'voice_note', required: false },
      { id: 'ack', title: 'Confirmación del cliente', type: 'customer_acknowledgement', required: false },
    ],
  },
  sectionStatus: { voice: 'pending', ack: 'pending' }, evidence: [], measurements: [], findings: [], checklistResponses: [], freeTextResponses: [], customerAcknowledgements: [], voiceNotes: [],
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
};

const pending = parseFieldVoiceNoteJobResponse({ success: true, version: 1, job: baseJob });
assert(pending.job.canAddReportVoiceNote, 'pending canonical voice option should survive strict parsing');
assert(pending.job.interventionReports[0].voiceNotes.length === 0, 'pending section should expose no persisted voice note');

const voiceNote = {
  id: 'EVID-VOICE-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'voice', kind: 'voice_note',
  storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/voice/voice/report-voice-001.webm', contentType: 'audio/webm', sizeBytes: 2048, durationSeconds: 42.25,
  capturedAt: '2026-08-26T12:30:00.000Z', createdAt: '2026-08-26T12:30:00.000Z', createdBy: 'uid-1', version: 1,
};
const completedReport = { ...reportBase, sectionStatus: { voice: 'completed', ack: 'pending' }, voiceNotes: [voiceNote] };
const completedJob = { ...baseJob, interventionReports: [completedReport], reportVoiceNoteOptions: [], canAddReportVoiceNote: false };
const completed = parseFieldVoiceNoteJobResponse({ success: true, version: 1, job: completedJob });
assert(completed.job.interventionReports[0].voiceNotes[0].durationSeconds === 42.25, 'historical voice note should survive strict parsing');

const mutation = parseFieldAddReportVoiceNoteResponse({
  success: true, version: 1, replayed: false, evidence: voiceNote, workInterventionVersion: 3, allowedActions: ['read', 'evidence.add'], auditEventId: 'FE-1',
});
assert(mutation.workInterventionVersion === 3, 'mutation must expose authoritative intervention version');

assertThrows(() => parseFieldVoiceNoteJobResponse({ success: true, version: 1, job: { ...baseJob, reportVoiceNoteOptions: undefined } }), 'missing options must fail closed');
assertThrows(() => parseFieldVoiceNoteJobResponse({ success: true, version: 1, job: { ...baseJob, allowedActions: ['read', 'execute'] } }), 'browser cannot acquire voice evidence authority without evidence.add');
assertThrows(() => parseFieldVoiceNoteJobResponse({ success: true, version: 1, job: { ...completedJob, interventionReports: [{ ...completedReport, sectionStatus: { voice: 'pending', ack: 'pending' } }] } }), 'persisted voice note requires completed section state');
assertThrows(() => parseFieldVoiceNoteJobResponse({ success: true, version: 1, job: { ...completedJob, interventionReports: [{ ...completedReport, voiceNotes: [{ ...voiceNote, sectionId: 'wrong' }] }] } }), 'voice note cannot point outside frozen section');
assertThrows(() => parseFieldVoiceNoteJobResponse({ success: true, version: 1, job: { ...completedJob, interventionReports: [{ ...completedReport, voiceNotes: [{ ...voiceNote, assetId: 'AC-X' }] }] } }), 'voice note cannot drift from equipment identity');
assertThrows(() => parseFieldAddReportVoiceNoteResponse({ success: true, version: 1, replayed: false, evidence: { ...voiceNote, durationSeconds: 121 }, workInterventionVersion: 3, allowedActions: ['read', 'evidence.add'] }), 'duration over 120 seconds must fail closed');
assertThrows(() => parseFieldAddReportVoiceNoteResponse({ success: true, version: 1, replayed: false, evidence: { ...voiceNote, contentType: 'image/jpeg' }, workInterventionVersion: 3, allowedActions: ['read', 'evidence.add'] }), 'non-audio MIME must fail closed');
assertThrows(() => parseFieldAddReportVoiceNoteResponse({ success: true, version: 1, replayed: false, evidence: { ...voiceNote, sizeBytes: 6 * 1024 * 1024 + 1 }, workInterventionVersion: 3, allowedActions: ['read', 'evidence.add'] }), 'oversize voice evidence must fail closed');
assertThrows(() => parseFieldAddReportVoiceNoteResponse({ success: true, version: 1, replayed: false, evidence: { ...voiceNote, version: 2 }, workInterventionVersion: 3, allowedActions: ['read', 'evidence.add'] }), 'immutable voice evidence version drift must fail closed');

console.log('Field voice-note contract acceptance passed.');
