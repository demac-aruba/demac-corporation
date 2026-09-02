import {
  parseFieldCustomerAcknowledgementJobResponse,
  parseFieldRecordCustomerAcknowledgementResponse,
} from '../lib/field-customer-acknowledgement-contract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD CUSTOMER ACKNOWLEDGEMENT CONTRACT ACCEPTANCE FAILED: ${message}`);
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
  template: { id: 'standard-report', name: 'Standard Report', serviceId: 'service-standard', version: 2, sections: [{ id: 'ack', title: 'Confirmación del cliente', type: 'customer_acknowledgement', required: true }] },
  sectionStatus: { ack: 'pending' }, evidence: [], measurements: [], findings: [], checklistResponses: [], freeTextResponses: [], customerAcknowledgements: [],
};
const baseJob = {
  id: 'WO-1', workOrderId: 'WO-1', appointmentId: 'APT-1', date: '2026-08-26', time: '08:30', status: 'En proceso', customerId: 'CLIENT-1', customerName: 'Customer', propertyId: 'PROPERTY-1', address: 'Santa Cruz 1',
  plannedWork: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }], estimatedQuantity: 1, vanId: 'VAN-1', responsibility: 'technician', assignmentSource: 'direct_staff',
  allowedActions: ['read', 'execute', 'report.edit', 'intervention.complete'], fieldVisit: visit, canPrepareVisit: false, canCreateReturnVisit: false, knownEquipment: [], visitAssets: [visitAsset], canAddExistingAsset: true,
  workInterventions: [intervention], plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 1, remainingQuantity: 0 }], plannedInterventionOptions: [],
  interventionExecutionOptions: [{ interventionId: 'WI-1', allowedTargets: ['completed', 'pending_part'] }], availableFieldServices: [], canAddPlannedIntervention: false,
  scopeChanges: [], additionalInterventionVisitAssetIds: [], canAddAdditionalIntervention: false, fieldApprovals: [], additionalApprovalInterventionIds: [], canRecordAdditionalApproval: false,
  interventionReports: [reportBase], reportPhotoOptions: [], canAddReportPhoto: false, reportMeasurementOptions: [], canAddReportMeasurement: false, reportFindingOptions: [], canAddReportFinding: false,
  reportChecklistOptions: [], canEditReportChecklist: false, reportFreeTextOptions: [], canEditReportFreeText: false,
  reportCustomerAcknowledgementOptions: [{ interventionId: 'WI-1', sectionIds: ['ack'] }], canRecordCustomerAcknowledgement: true,
};

const pending = parseFieldCustomerAcknowledgementJobResponse({ success: true, version: 1, job: baseJob });
assert(pending.job.canRecordCustomerAcknowledgement, 'pending canonical acknowledgement option should survive strict parsing');

const acknowledgement = {
  id: 'CACK-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'ack',
  receiverName: 'Maria Customer', method: 'verbal', note: 'Report reviewed on site.', acknowledgedAt: '2026-08-26T12:30:00.000Z', recordedByStaffId: 'staff-1',
  createdAt: '2026-08-26T12:30:00.000Z', createdBy: 'uid-1', version: 1,
};
const completedReport = { ...reportBase, sectionStatus: { ack: 'completed' }, customerAcknowledgements: [acknowledgement] };
const completedJob = { ...baseJob, interventionReports: [completedReport], reportCustomerAcknowledgementOptions: [], canRecordCustomerAcknowledgement: false };
const completed = parseFieldCustomerAcknowledgementJobResponse({ success: true, version: 1, job: completedJob });
assert(completed.job.interventionReports[0].customerAcknowledgements[0].receiverName === 'Maria Customer', 'historical acknowledgement should survive strict parsing');

const mutation = parseFieldRecordCustomerAcknowledgementResponse({ success: true, version: 1, replayed: false, acknowledgement, workInterventionVersion: 3, allowedActions: ['read', 'execute'], auditEventId: 'FE-1' });
assert(mutation.workInterventionVersion === 3, 'mutation must expose authoritative intervention version');

assertThrows(() => parseFieldCustomerAcknowledgementJobResponse({ success: true, version: 1, job: { ...baseJob, reportCustomerAcknowledgementOptions: undefined } }), 'missing options must fail closed');
assertThrows(() => parseFieldCustomerAcknowledgementJobResponse({ success: true, version: 1, job: { ...baseJob, allowedActions: ['read', 'report.edit'] } }), 'browser cannot acquire acknowledgement authority without execute');
assertThrows(() => parseFieldCustomerAcknowledgementJobResponse({ success: true, version: 1, job: { ...completedJob, interventionReports: [{ ...completedReport, sectionStatus: { ack: 'pending' } }] } }), 'persisted acknowledgement requires completed section state');
assertThrows(() => parseFieldCustomerAcknowledgementJobResponse({ success: true, version: 1, job: { ...completedJob, interventionReports: [{ ...completedReport, customerAcknowledgements: [{ ...acknowledgement, sectionId: 'wrong' }] }] } }), 'acknowledgement cannot point outside frozen section');
assertThrows(() => parseFieldRecordCustomerAcknowledgementResponse({ success: true, version: 1, replayed: false, acknowledgement: { ...acknowledgement, method: 'signature' }, workInterventionVersion: 3, allowedActions: ['read', 'execute'] }), 'client contract accepts only server-owned verbal method');
assertThrows(() => parseFieldRecordCustomerAcknowledgementResponse({ success: true, version: 1, replayed: false, acknowledgement: { ...acknowledgement, version: 2 }, workInterventionVersion: 3, allowedActions: ['read', 'execute'] }), 'immutable acknowledgement version drift must fail closed');

console.log('Field customer acknowledgement contract acceptance passed.');
