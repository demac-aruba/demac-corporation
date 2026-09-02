import {
  parseFieldAddReportMeasurementResponse,
  parseFieldAddReportPhotoEvidenceResponse,
  parseFieldReportJobResponse,
} from '../lib/field-report-contract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD REPORT CONTRACT ACCEPTANCE FAILED: ${message}`);
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
  id: 'visit-WO-1',
  appointmentId: 'APT-1',
  workOrderId: 'WO-1',
  customerId: 'CLIENT-1',
  propertyId: 'PROPERTY-1',
  scheduledScopeSnapshot: {
    appointmentId: 'APT-1',
    capturedAt: '2026-08-25T12:00:00.000Z',
    estimatedUnitCount: 1,
    workLines: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }],
  },
  status: 'in_progress',
  participatingStaffIds: ['staff-1'],
  arrivedAt: '2026-08-25T12:15:00.000Z',
  startedAt: '2026-08-25T12:20:00.000Z',
  requiresSecondVisit: false,
  createdAt: '2026-08-25T12:00:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:20:00.000Z',
  updatedBy: 'uid-1',
  version: 4,
  availableTransitions: [],
};

const visitAsset = {
  id: 'VA-1',
  visitId: 'visit-WO-1',
  assetId: 'AC-1',
  sequence: 1,
  locationLabel: 'Sala',
  source: 'existing_asset',
  status: 'identified',
  addedOnSite: true,
  createdAt: '2026-08-25T12:20:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:20:00.000Z',
  updatedBy: 'uid-1',
  version: 1,
};

const intervention = {
  id: 'WI-1',
  visitId: 'visit-WO-1',
  visitAssetId: 'VA-1',
  assetId: 'AC-1',
  plannedWorkLineId: 'line-standard',
  serviceCatalogItemId: 'service-standard',
  interventionType: 'Standard Service',
  origin: 'planned',
  requestedBy: 'office',
  status: 'in_progress',
  templateId: 'standard-report',
  templateVersion: 2,
  startedAt: '2026-08-25T12:25:00.000Z',
  performedByStaffIds: ['staff-1'],
  createdAt: '2026-08-25T12:22:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:25:00.000Z',
  updatedBy: 'uid-1',
  version: 2,
};

const reportTemplate = {
  id: 'standard-report',
  name: 'Standard Service Report',
  serviceId: 'service-standard',
  version: 2,
  sections: [
    { id: 'condition', title: 'Condition', type: 'checklist', required: true },
    { id: 'measurements', title: 'Measurements', type: 'measurement_table', required: true, minMeasurementCount: 1 },
    { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 2 },
  ],
};

const evidence = {
  id: 'EVID-1',
  visitId: 'visit-WO-1',
  visitAssetId: 'VA-1',
  assetId: 'AC-1',
  interventionId: 'WI-1',
  sectionId: 'photos',
  kind: 'photo',
  storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/photos/photo-001.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 2048,
  caption: 'Before service',
  capturedAt: '2026-08-25T12:30:00.000Z',
  createdAt: '2026-08-25T12:30:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:30:00.000Z',
  updatedBy: 'uid-1',
  version: 1,
};

const measurement = {
  id: 'MEAS-1',
  visitId: 'visit-WO-1',
  visitAssetId: 'VA-1',
  assetId: 'AC-1',
  interventionId: 'WI-1',
  sectionId: 'measurements',
  metric: 'Supply temperature',
  value: 18.5,
  unit: '°C',
  moment: 'after',
  technicianStaffId: 'staff-1',
  measuredAt: '2026-08-25T12:29:00.000Z',
  createdAt: '2026-08-25T12:29:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:29:00.000Z',
  updatedBy: 'uid-1',
  version: 1,
};

const report = {
  interventionId: 'WI-1',
  visitAssetId: 'VA-1',
  assetId: 'AC-1',
  serviceCatalogItemId: 'service-standard',
  template: reportTemplate,
  sectionStatus: { condition: 'pending', measurements: 'in_progress', photos: 'in_progress' },
  evidence: [evidence],
  measurements: [measurement],
};

const baseJob = {
  id: 'WO-1',
  workOrderId: 'WO-1',
  appointmentId: 'APT-1',
  date: '2026-08-25',
  time: '08:30',
  status: 'En proceso',
  customerId: 'CLIENT-1',
  customerName: 'Customer',
  propertyId: 'PROPERTY-1',
  address: 'Santa Cruz 1',
  plannedWork: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }],
  estimatedQuantity: 1,
  vanId: 'VAN-1',
  responsibility: 'technician',
  assignmentSource: 'direct_staff',
  allowedActions: ['read', 'execute', 'report.edit', 'evidence.add', 'measurement.add', 'intervention.complete'],
  fieldVisit: visit,
  canPrepareVisit: false,
  canCreateReturnVisit: false,
  knownEquipment: [],
  visitAssets: [visitAsset],
  canAddExistingAsset: true,
  workInterventions: [intervention],
  plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 1, remainingQuantity: 0 }],
  plannedInterventionOptions: [],
  interventionExecutionOptions: [{ interventionId: 'WI-1', allowedTargets: ['completed', 'pending_part'] }],
  availableFieldServices: [],
  canAddPlannedIntervention: false,
  scopeChanges: [],
  additionalInterventionVisitAssetIds: [],
  canAddAdditionalIntervention: false,
  fieldApprovals: [],
  additionalApprovalInterventionIds: [],
  canRecordAdditionalApproval: false,
  interventionReports: [report],
  reportPhotoOptions: [{ interventionId: 'WI-1', sectionIds: ['photos'] }],
  canAddReportPhoto: true,
  reportMeasurementOptions: [{ interventionId: 'WI-1', sectionIds: ['measurements'] }],
  canAddReportMeasurement: true,
};

const parsed = parseFieldReportJobResponse({ success: true, version: 1, job: baseJob });
assert(parsed.job.interventionReports.length === 1, 'frozen intervention report should survive strict transport parsing');
assert(parsed.job.interventionReports[0].template.id === 'standard-report', 'template identity should survive strict parsing');
assert(parsed.job.interventionReports[0].evidence[0].id === 'EVID-1', 'report photo evidence should survive strict parsing');
assert(parsed.job.interventionReports[0].measurements[0].id === 'MEAS-1', 'report measurement should survive strict parsing');
assert(parsed.job.reportPhotoOptions[0].sectionIds[0] === 'photos', 'server-owned photo option should survive strict parsing');
assert(parsed.job.reportMeasurementOptions[0].sectionIds[0] === 'measurements', 'server-owned measurement option should survive strict parsing');

const photoResponse = parseFieldAddReportPhotoEvidenceResponse({
  success: true,
  version: 1,
  replayed: false,
  evidence,
  workInterventionVersion: 3,
  allowedActions: ['read', 'report.edit', 'evidence.add'],
  auditEventId: 'FE-1',
});
assert(photoResponse.evidence.sectionId === 'photos', 'valid report photo mutation response should parse');
assert(photoResponse.workInterventionVersion === 3, 'report photo mutation must expose authoritative intervention version');

const measurementResponse = parseFieldAddReportMeasurementResponse({
  success: true,
  version: 1,
  replayed: false,
  measurement,
  workInterventionVersion: 3,
  allowedActions: ['read', 'report.edit', 'measurement.add'],
  auditEventId: 'FE-2',
});
assert(measurementResponse.measurement.value === 18.5, 'valid report measurement mutation response should parse');
assert(measurementResponse.workInterventionVersion === 3, 'report measurement mutation must expose authoritative intervention version');

assertThrows(
  () => parseFieldReportJobResponse({ success: true, version: 1, job: { ...baseJob, interventionReports: undefined } }),
  'missing intervention report projection must fail closed',
);
assertThrows(
  () => parseFieldReportJobResponse({
    success: true,
    version: 1,
    job: { ...baseJob, interventionReports: [{ ...report, serviceCatalogItemId: 'service-other' }] },
  }),
  'report Service identity drift must fail closed',
);
assertThrows(
  () => parseFieldReportJobResponse({
    success: true,
    version: 1,
    job: { ...baseJob, interventionReports: [{ ...report, sectionStatus: { condition: 'pending', photos: 'in_progress' } }] },
  }),
  'missing frozen section status must fail closed',
);
assertThrows(
  () => parseFieldReportJobResponse({
    success: true,
    version: 1,
    job: { ...baseJob, interventionReports: [{ ...report, sectionStatus: { condition: 'pending', measurements: 'pending', photos: 'future' } }] },
  }),
  'unknown section status must fail closed',
);
assertThrows(
  () => parseFieldReportJobResponse({
    success: true,
    version: 1,
    job: { ...baseJob, interventionReports: [{ ...report, evidence: [{ ...evidence, sectionId: 'condition' }] }] },
  }),
  'photo evidence targeting a non-photo section must fail closed',
);
assertThrows(
  () => parseFieldReportJobResponse({
    success: true,
    version: 1,
    job: { ...baseJob, interventionReports: [{ ...report, measurements: [{ ...measurement, sectionId: 'photos' }] }] },
  }),
  'measurement targeting a non-measurement section must fail closed',
);
assertThrows(
  () => parseFieldReportJobResponse({
    success: true,
    version: 1,
    job: { ...baseJob, reportPhotoOptions: [{ interventionId: 'WI-1', sectionIds: ['condition'] }] },
  }),
  'photo mutation option targeting a non-photo section must fail closed',
);
assertThrows(
  () => parseFieldReportJobResponse({
    success: true,
    version: 1,
    job: { ...baseJob, reportMeasurementOptions: [{ interventionId: 'WI-1', sectionIds: ['photos'] }] },
  }),
  'measurement mutation option targeting a non-measurement section must fail closed',
);
assertThrows(
  () => parseFieldReportJobResponse({ success: true, version: 1, job: { ...baseJob, canAddReportPhoto: false } }),
  'report photo eligibility boolean cannot contradict its projected targets',
);
assertThrows(
  () => parseFieldReportJobResponse({ success: true, version: 1, job: { ...baseJob, canAddReportMeasurement: false } }),
  'report measurement eligibility boolean cannot contradict its projected targets',
);
assertThrows(
  () => parseFieldReportJobResponse({
    success: true,
    version: 1,
    job: { ...baseJob, allowedActions: ['read', 'report.edit', 'measurement.add'], canAddReportPhoto: true },
  }),
  'client cannot acquire report photo authority without server evidence.add action',
);
assertThrows(
  () => parseFieldReportJobResponse({
    success: true,
    version: 1,
    job: { ...baseJob, allowedActions: ['read', 'report.edit', 'evidence.add'], canAddReportMeasurement: true },
  }),
  'client cannot acquire report measurement authority without server measurement.add action',
);
assertThrows(
  () => parseFieldReportJobResponse({
    success: true,
    version: 1,
    job: {
      ...baseJob,
      workInterventions: [{ ...intervention, templateId: undefined, templateVersion: undefined }],
      interventionReports: [report],
    },
  }),
  'report cannot exist without frozen template identity on the Work Intervention',
);
assertThrows(
  () => parseFieldAddReportPhotoEvidenceResponse({
    success: true,
    version: 1,
    replayed: false,
    evidence: { ...evidence, contentType: 'application/pdf' },
    workInterventionVersion: 3,
    allowedActions: ['read', 'evidence.add'],
  }),
  'report photo mutation cannot accept non-image evidence',
);
assertThrows(
  () => parseFieldAddReportMeasurementResponse({
    success: true,
    version: 1,
    replayed: false,
    measurement: { ...measurement, value: Number.NaN },
    workInterventionVersion: 3,
    allowedActions: ['read', 'measurement.add'],
  }),
  'report measurement mutation cannot accept non-finite numeric values',
);
assertThrows(
  () => parseFieldAddReportMeasurementResponse({
    success: true,
    version: 1,
    replayed: false,
    measurement: { ...measurement, moment: 'future' },
    workInterventionVersion: 3,
    allowedActions: ['read', 'measurement.add'],
  }),
  'report measurement mutation cannot accept unknown measurement moments',
);
assertThrows(
  () => parseFieldAddReportPhotoEvidenceResponse({
    success: true,
    version: 1,
    replayed: false,
    evidence,
    workInterventionVersion: 0,
    allowedActions: ['read', 'evidence.add'],
  }),
  'report photo mutation response must carry a positive canonical Work Intervention version',
);
assertThrows(
  () => parseFieldAddReportMeasurementResponse({
    success: true,
    version: 1,
    replayed: false,
    measurement,
    workInterventionVersion: 0,
    allowedActions: ['read', 'measurement.add'],
  }),
  'report measurement mutation response must carry a positive canonical Work Intervention version',
);

console.log('Field report contract acceptance passed.');
