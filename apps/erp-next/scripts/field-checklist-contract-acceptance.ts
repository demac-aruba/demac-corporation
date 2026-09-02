import {
  parseFieldChecklistJobResponse,
  parseFieldSetReportChecklistItemResponse,
} from '../lib/field-checklist-contract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD CHECKLIST CONTRACT ACCEPTANCE FAILED: ${message}`);
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
  updatedAt: '2026-08-25T12:25:00.000Z', updatedBy: 'uid-1', version: 3,
};

const reportTemplate = {
  id: 'standard-report', name: 'Standard Service Report', serviceId: 'service-standard', version: 2,
  sections: [
    {
      id: 'condition', title: 'Condición', type: 'checklist', required: true,
      checklistItems: [
        { id: 'filter-clean', label: 'Filtro limpio y reinstalado' },
        { id: 'drain-clear', label: 'Drenaje verificado' },
      ],
    },
    { id: 'findings', title: 'Hallazgos', type: 'findings', required: false },
  ],
};

const finding = {
  id: 'FIND-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1',
  sectionId: 'findings', summary: 'Drain restriction', details: 'Drain line contains visible buildup and drains slowly.',
  recommendation: 'Perform a deep drain cleaning.', technicianStaffId: 'staff-1', observedAt: '2026-08-25T12:30:00.000Z',
  createdAt: '2026-08-25T12:30:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-25T12:30:00.000Z',
  updatedBy: 'uid-1', version: 1,
};

const checklistResponse = {
  id: 'CHECK-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1',
  sectionId: 'condition', itemId: 'filter-clean', checked: true, technicianStaffId: 'staff-1',
  respondedAt: '2026-08-25T12:29:00.000Z', createdAt: '2026-08-25T12:29:00.000Z', createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:29:00.000Z', updatedBy: 'uid-1', version: 1,
};

const report = {
  interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
  template: reportTemplate, sectionStatus: { condition: 'in_progress', findings: 'in_progress' },
  evidence: [], measurements: [], findings: [finding], checklistResponses: [checklistResponse],
};

const baseJob = {
  id: 'WO-1', workOrderId: 'WO-1', appointmentId: 'APT-1', date: '2026-08-25', time: '08:30', status: 'En proceso',
  customerId: 'CLIENT-1', customerName: 'Customer', propertyId: 'PROPERTY-1', address: 'Santa Cruz 1',
  plannedWork: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }], estimatedQuantity: 1, vanId: 'VAN-1',
  responsibility: 'technician', assignmentSource: 'direct_staff',
  allowedActions: ['read', 'execute', 'report.edit', 'finding.add', 'intervention.complete'],
  fieldVisit: visit, canPrepareVisit: false, canCreateReturnVisit: false, knownEquipment: [], visitAssets: [visitAsset], canAddExistingAsset: true,
  workInterventions: [intervention],
  plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 1, remainingQuantity: 0 }],
  plannedInterventionOptions: [], interventionExecutionOptions: [{ interventionId: 'WI-1', allowedTargets: ['completed', 'pending_part'] }],
  availableFieldServices: [], canAddPlannedIntervention: false, scopeChanges: [], additionalInterventionVisitAssetIds: [],
  canAddAdditionalIntervention: false, fieldApprovals: [], additionalApprovalInterventionIds: [], canRecordAdditionalApproval: false,
  interventionReports: [report], reportPhotoOptions: [], canAddReportPhoto: false, reportMeasurementOptions: [],
  canAddReportMeasurement: false, reportFindingOptions: [{ interventionId: 'WI-1', sectionIds: ['findings'] }],
  canAddReportFinding: true, reportChecklistOptions: [{ interventionId: 'WI-1', sectionIds: ['condition'] }],
  canEditReportChecklist: true,
};

const parsed = parseFieldChecklistJobResponse({ success: true, version: 1, job: baseJob });
assert(parsed.job.interventionReports[0].template.sections[0].checklistItems?.length === 2, 'frozen checklist items should survive strict parsing');
assert(parsed.job.interventionReports[0].checklistResponses[0].itemId === 'filter-clean', 'canonical checklist response should survive strict parsing');
assert(parsed.job.reportChecklistOptions[0].sectionIds[0] === 'condition', 'server-owned checklist option should survive strict parsing');
assert(parsed.job.canEditReportChecklist === true, 'checklist edit eligibility should survive strict parsing');

const mutation = parseFieldSetReportChecklistItemResponse({
  success: true, version: 1, replayed: false, response: checklistResponse, sectionCompleted: false,
  workInterventionVersion: 4, allowedActions: ['read', 'report.edit'], auditEventId: 'FE-1',
});
assert(mutation.response.checked === true, 'valid checklist mutation should parse');
assert(mutation.sectionCompleted === false, 'checklist mutation should expose authoritative section completion');
assert(mutation.workInterventionVersion === 4, 'checklist mutation must expose authoritative intervention version');

assertThrows(
  () => parseFieldChecklistJobResponse({
    success: true, version: 1,
    job: {
      ...baseJob,
      interventionReports: [{
        ...report,
        template: { ...reportTemplate, sections: [{ id: 'condition', title: 'Condición', type: 'checklist', required: true }, reportTemplate.sections[1]] },
      }],
    },
  }),
  'checklist section without frozen items must fail closed',
);
assertThrows(
  () => parseFieldChecklistJobResponse({
    success: true, version: 1,
    job: {
      ...baseJob,
      interventionReports: [{
        ...report,
        template: {
          ...reportTemplate,
          sections: [{
            ...reportTemplate.sections[0],
            checklistItems: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }],
          }, reportTemplate.sections[1]],
        },
      }],
    },
  }),
  'duplicate checklist item ids must fail closed',
);
assertThrows(
  () => parseFieldChecklistJobResponse({
    success: true, version: 1,
    job: { ...baseJob, interventionReports: [{ ...report, checklistResponses: [{ ...checklistResponse, itemId: 'invented' }] }] },
  }),
  'response targeting an item outside the frozen checklist must fail closed',
);
assertThrows(
  () => parseFieldChecklistJobResponse({
    success: true, version: 1,
    job: { ...baseJob, interventionReports: [{ ...report, sectionStatus: { condition: 'completed', findings: 'in_progress' } }] },
  }),
  'completed checklist section must match all canonical item responses',
);
assertThrows(
  () => parseFieldChecklistJobResponse({ success: true, version: 1, job: { ...baseJob, canEditReportChecklist: false } }),
  'checklist eligibility boolean cannot contradict projected targets',
);
assertThrows(
  () => parseFieldChecklistJobResponse({
    success: true, version: 1, job: { ...baseJob, allowedActions: ['read', 'execute', 'finding.add', 'intervention.complete'] },
  }),
  'browser cannot acquire checklist authority without server report.edit',
);
assertThrows(
  () => parseFieldSetReportChecklistItemResponse({
    success: true, version: 1, replayed: false, response: { ...checklistResponse, version: 0 }, sectionCompleted: false,
    workInterventionVersion: 4, allowedActions: ['read', 'report.edit'],
  }),
  'checklist mutation with invalid response version must fail closed',
);
assertThrows(
  () => parseFieldSetReportChecklistItemResponse({
    success: true, version: 1, replayed: false, response: checklistResponse, workInterventionVersion: 4,
    allowedActions: ['read', 'report.edit'],
  }),
  'non-replay checklist mutation without section completion must fail closed',
);
assertThrows(
  () => parseFieldSetReportChecklistItemResponse({
    success: true, version: 1, replayed: true, response: checklistResponse, allowedActions: ['read', 'report.edit'],
  }),
  'checklist replay without canonical intervention version must fail closed',
);

console.log('Field checklist contract acceptance passed.');
