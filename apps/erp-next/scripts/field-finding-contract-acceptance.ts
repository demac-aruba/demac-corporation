import {
  parseFieldAddReportFindingResponse,
  parseFieldFindingJobResponse,
} from '../lib/field-finding-contract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD FINDING CONTRACT ACCEPTANCE FAILED: ${message}`);
}

function assertThrows(action: () => unknown, message: string) {
  let threw = false;
  try {
    action();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

const visit = {
  id: 'visit-WO-1', appointmentId: 'APT-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
  scheduledScopeSnapshot: {
    appointmentId: 'APT-1', capturedAt: '2026-08-25T12:00:00.000Z', estimatedUnitCount: 1,
    workLines: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }],
  },
  status: 'in_progress', participatingStaffIds: ['staff-1'], arrivedAt: '2026-08-25T12:15:00.000Z',
  startedAt: '2026-08-25T12:20:00.000Z', requiresSecondVisit: false,
  createdAt: '2026-08-25T12:00:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-25T12:20:00.000Z',
  updatedBy: 'uid-1', version: 4, availableTransitions: [],
};

const visitAsset = {
  id: 'VA-1', visitId: 'visit-WO-1', assetId: 'AC-1', sequence: 1, locationLabel: 'Sala', source: 'existing_asset',
  status: 'identified', addedOnSite: true, createdAt: '2026-08-25T12:20:00.000Z', createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:20:00.000Z', updatedBy: 'uid-1', version: 1,
};

const intervention = {
  id: 'WI-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', plannedWorkLineId: 'line-standard',
  serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service', origin: 'planned', requestedBy: 'office',
  status: 'in_progress', templateId: 'standard-report', templateVersion: 2, startedAt: '2026-08-25T12:25:00.000Z',
  performedByStaffIds: ['staff-1'], createdAt: '2026-08-25T12:22:00.000Z', createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:25:00.000Z', updatedBy: 'uid-1', version: 2,
};

const reportTemplate = {
  id: 'standard-report', name: 'Standard Service Report', serviceId: 'service-standard', version: 2,
  sections: [{ id: 'findings', title: 'Hallazgos', type: 'findings', required: true }],
};

const finding = {
  id: 'FIND-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1',
  sectionId: 'findings', summary: 'Drain restriction', details: 'Drain line contains visible buildup and drains slowly.',
  recommendation: 'Perform a deep drain cleaning.', technicianStaffId: 'staff-1', observedAt: '2026-08-25T12:30:00.000Z',
  createdAt: '2026-08-25T12:30:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-25T12:30:00.000Z',
  updatedBy: 'uid-1', version: 1,
};

const report = {
  interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
  template: reportTemplate, sectionStatus: { findings: 'in_progress' }, evidence: [], measurements: [], findings: [finding],
};

const baseJob = {
  id: 'WO-1', workOrderId: 'WO-1', appointmentId: 'APT-1', date: '2026-08-25', time: '08:30', status: 'En proceso',
  customerId: 'CLIENT-1', customerName: 'Customer', propertyId: 'PROPERTY-1', address: 'Santa Cruz 1',
  plannedWork: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }], estimatedQuantity: 1, vanId: 'VAN-1',
  responsibility: 'technician', assignmentSource: 'direct_staff',
  allowedActions: ['read', 'execute', 'report.edit', 'finding.add', 'intervention.complete'],
  fieldVisit: visit, canPrepareVisit: false, knownEquipment: [], visitAssets: [visitAsset], canAddExistingAsset: true,
  workInterventions: [intervention],
  plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 1, remainingQuantity: 0 }],
  plannedInterventionOptions: [], interventionExecutionOptions: [{ interventionId: 'WI-1', allowedTargets: ['completed', 'pending_part'] }],
  availableFieldServices: [], canAddPlannedIntervention: false, scopeChanges: [], additionalInterventionVisitAssetIds: [],
  canAddAdditionalIntervention: false, fieldApprovals: [], additionalApprovalInterventionIds: [], canRecordAdditionalApproval: false,
  interventionReports: [report], reportPhotoOptions: [], canAddReportPhoto: false, reportMeasurementOptions: [],
  canAddReportMeasurement: false, reportFindingOptions: [{ interventionId: 'WI-1', sectionIds: ['findings'] }], canAddReportFinding: true,
};

const parsed = parseFieldFindingJobResponse({ success: true, version: 1, job: baseJob });
assert(parsed.job.interventionReports[0].findings[0].id === 'FIND-1', 'canonical finding should survive strict parsing');
assert(parsed.job.reportFindingOptions[0].sectionIds[0] === 'findings', 'server-owned finding option should survive strict parsing');
assert(parsed.job.canAddReportFinding === true, 'finding eligibility should survive strict parsing');

const mutation = parseFieldAddReportFindingResponse({
  success: true, version: 1, replayed: false, finding, workInterventionVersion: 3,
  allowedActions: ['read', 'report.edit', 'finding.add'], auditEventId: 'FE-1',
});
assert(mutation.finding.summary === 'Drain restriction', 'valid finding mutation should parse');
assert(mutation.workInterventionVersion === 3, 'finding mutation must expose authoritative intervention version');

assertThrows(
  () => parseFieldFindingJobResponse({ success: true, version: 1, job: { ...baseJob, reportFindingOptions: undefined } }),
  'missing finding options must fail closed',
);
assertThrows(
  () => parseFieldFindingJobResponse({ success: true, version: 1, job: { ...baseJob, canAddReportFinding: false } }),
  'finding eligibility boolean cannot contradict projected targets',
);
assertThrows(
  () => parseFieldFindingJobResponse({
    success: true, version: 1,
    job: { ...baseJob, allowedActions: ['read', 'execute', 'report.edit', 'intervention.complete'] },
  }),
  'browser cannot acquire finding authority without server finding.add',
);
assertThrows(
  () => parseFieldFindingJobResponse({
    success: true, version: 1,
    job: { ...baseJob, interventionReports: [{ ...report, findings: [{ ...finding, sectionId: 'wrong-section' }] }] },
  }),
  'finding targeting a non-canonical section must fail closed',
);
assertThrows(
  () => parseFieldFindingJobResponse({
    success: true, version: 1,
    job: { ...baseJob, interventionReports: [{ ...report, findings: [{ ...finding, assetId: 'AC-OTHER' }] }] },
  }),
  'finding equipment identity drift must fail closed',
);
assertThrows(
  () => parseFieldFindingJobResponse({
    success: true, version: 1,
    job: { ...baseJob, reportFindingOptions: [{ interventionId: 'WI-1', sectionIds: ['wrong-section'] }] },
  }),
  'finding option outside a findings section must fail closed',
);
assertThrows(
  () => parseFieldAddReportFindingResponse({
    success: true, version: 1, replayed: false, finding: { ...finding, summary: 'x' }, workInterventionVersion: 3,
    allowedActions: ['read', 'finding.add'],
  }),
  'finding mutation with invalid summary must fail closed',
);
assertThrows(
  () => parseFieldAddReportFindingResponse({
    success: true, version: 1, replayed: true, finding, allowedActions: ['read', 'finding.add'],
  }),
  'finding replay without canonical intervention version must fail closed',
);

console.log('Field finding contract acceptance passed.');
