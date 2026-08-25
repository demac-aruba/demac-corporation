import {
  parseFieldCreatePlannedInterventionResponse,
  parseFieldExecutionJobResponse,
} from '../lib/field-intervention-contract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD INTERVENTION CONTRACT ACCEPTANCE FAILED: ${message}`);
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
  status: 'on_site',
  participatingStaffIds: ['staff-1'],
  arrivedAt: '2026-08-25T12:15:00.000Z',
  requiresSecondVisit: false,
  createdAt: '2026-08-25T12:00:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:15:00.000Z',
  updatedBy: 'uid-1',
  version: 3,
  availableTransitions: ['in_progress'],
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
  interventionType: '12K Standard Service',
  origin: 'planned',
  requestedBy: 'office',
  status: 'confirmed',
  performedByStaffIds: [],
  createdAt: '2026-08-25T12:30:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:30:00.000Z',
  updatedBy: 'uid-1',
  version: 1,
};

const job = {
  id: 'WO-1',
  workOrderId: 'WO-1',
  appointmentId: 'APT-1',
  date: '2026-08-25',
  time: '08:30',
  status: 'En el sitio',
  customerId: 'CLIENT-1',
  customerName: 'Customer',
  propertyId: 'PROPERTY-1',
  address: 'Santa Cruz 1',
  plannedWork: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }],
  estimatedQuantity: 1,
  vanId: 'VAN-1',
  responsibility: 'technician',
  assignmentSource: 'direct_staff',
  allowedActions: ['read', 'execute', 'asset.add', 'intervention.add'],
  fieldVisit: visit,
  canPrepareVisit: false,
  knownEquipment: [],
  visitAssets: [visitAsset],
  canAddExistingAsset: true,
  workInterventions: [],
  plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 0, remainingQuantity: 1 }],
  plannedInterventionOptions: [{ visitAssetId: 'VA-1', plannedWorkLineIds: ['line-standard'] }],
  availableFieldServices: [{ id: 'service-standard', bookingCode: '12k_standard', label: '12K Standard Service', kind: 'Maintenance', durationMinutesPerUnit: 60 }],
  canAddPlannedIntervention: true,
};

const valid = parseFieldExecutionJobResponse({ success: true, version: 1, job });
assert(valid.job.canAddPlannedIntervention, 'valid intervention-enabled job should parse');
assert(valid.job.plannedInterventionOptions[0].visitAssetId === 'VA-1', 'server per-Asset option must survive transport parsing');

const created = parseFieldCreatePlannedInterventionResponse({
  success: true,
  version: 1,
  replayed: false,
  workIntervention: intervention,
  allowedActions: ['read', 'execute', 'intervention.add'],
  auditEventId: 'FE-1',
});
assert(created.workIntervention.performedByStaffIds.length === 0, 'confirmed work must not require a false performer claim');

assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, workInterventions: undefined } }),
  'missing WorkIntervention projection must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, plannedInterventionOptions: [{ visitAssetId: 'VA-OTHER', plannedWorkLineIds: ['line-standard'] }] } }),
  'per-Asset option referencing a foreign VisitAsset must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, plannedInterventionOptions: [{ visitAssetId: 'VA-1', plannedWorkLineIds: ['line-missing'] }] } }),
  'option referencing unknown planned work must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, availableFieldServices: [{ ...job.availableFieldServices[0], id: '' }] } }),
  'malformed canonical service choice must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, canAddPlannedIntervention: true, plannedInterventionOptions: [] } }),
  'true mutation eligibility without server options must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, workInterventions: [{ ...intervention, visitId: 'visit-other' }] } }),
  'intervention attached to another physical visit must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, workInterventions: [{ ...intervention, assetId: 'AC-OTHER' }] } }),
  'intervention Asset must match its VisitAsset',
);
assertThrows(
  () => parseFieldCreatePlannedInterventionResponse({ success: true, version: 2, replayed: false, workIntervention: intervention, allowedActions: ['intervention.add'] }),
  'unknown API version must fail closed for intervention mutation response',
);
assertThrows(
  () => parseFieldCreatePlannedInterventionResponse({ success: true, version: 1, replayed: false, workIntervention: { ...intervention, status: 'future_status' }, allowedActions: ['intervention.add'] }),
  'unknown WorkIntervention status must fail closed',
);
assertThrows(
  () => parseFieldCreatePlannedInterventionResponse({ success: true, version: 1, replayed: false, workIntervention: intervention, allowedActions: ['intervention.add', 'future.action'] }),
  'unknown action vocabulary must fail closed',
);

const withIntervention = parseFieldExecutionJobResponse({
  success: true,
  version: 1,
  job: {
    ...job,
    workInterventions: [intervention],
    plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 1, remainingQuantity: 0 }],
    plannedInterventionOptions: [],
    availableFieldServices: [],
    canAddPlannedIntervention: false,
  },
});
assert(withIntervention.job.workInterventions[0].status === 'confirmed', 'existing canonical WorkIntervention should remain readable after planned quantity is linked');

console.log('Field WorkIntervention transport-contract acceptance: PASS');
