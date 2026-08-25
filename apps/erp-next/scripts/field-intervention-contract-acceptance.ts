import {
  parseFieldCreateAdditionalInterventionResponse,
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

const priceSnapshot = {
  currency: 'AWG',
  unitPrice: 75,
  sourceCatalogItemId: 'service-repair',
  pricingVersion: 'service-catalog:service-repair:fixed',
  capturedAt: '2026-08-25T12:40:00.000Z',
};

const additionalIntervention = {
  id: 'WI-2',
  visitId: 'visit-WO-1',
  visitAssetId: 'VA-1',
  assetId: 'AC-1',
  serviceCatalogItemId: 'service-repair',
  interventionType: 'Drain Repair',
  origin: 'added_on_site_technician_discovery',
  requestedBy: 'technician',
  status: 'pending_authorization',
  priceSnapshot,
  scopeChangeId: 'SC-1',
  performedByStaffIds: [],
  createdAt: '2026-08-25T12:40:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:40:00.000Z',
  updatedBy: 'uid-1',
  version: 1,
};

const scopeChange = {
  id: 'SC-1',
  visitId: 'visit-WO-1',
  visitAssetId: 'VA-1',
  interventionId: 'WI-2',
  origin: 'technician_discovered_additional_need',
  reason: 'Condensate drain repair is also required.',
  requestedByStaffId: 'staff-1',
  requestedAt: '2026-08-25T12:40:00.000Z',
  createdAt: '2026-08-25T12:40:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:40:00.000Z',
  updatedBy: 'uid-1',
  version: 1,
};

const availableFieldServices = [
  { id: 'service-standard', bookingCode: '12k_standard', label: '12K Standard Service', kind: 'Maintenance', durationMinutesPerUnit: 60 },
  { id: 'service-repair', bookingCode: 'drain_repair', label: 'Drain Repair', kind: 'Repair', durationMinutesPerUnit: 60 },
];

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
  availableFieldServices,
  canAddPlannedIntervention: true,
  scopeChanges: [],
  additionalInterventionVisitAssetIds: ['VA-1'],
  canAddAdditionalIntervention: true,
};

const valid = parseFieldExecutionJobResponse({ success: true, version: 1, job });
assert(valid.job.canAddPlannedIntervention, 'valid intervention-enabled job should parse');
assert(valid.job.canAddAdditionalIntervention, 'valid additional-work eligibility should parse');
assert(valid.job.plannedInterventionOptions[0].visitAssetId === 'VA-1', 'server per-Asset planned option must survive transport parsing');
assert(valid.job.additionalInterventionVisitAssetIds[0] === 'VA-1', 'server per-Asset additional-work eligibility must survive transport parsing');

const created = parseFieldCreatePlannedInterventionResponse({
  success: true,
  version: 1,
  replayed: false,
  workIntervention: intervention,
  allowedActions: ['read', 'execute', 'intervention.add'],
  auditEventId: 'FE-1',
});
assert(created.workIntervention.performedByStaffIds.length === 0, 'confirmed work must not require a false performer claim');

const additionalCreated = parseFieldCreateAdditionalInterventionResponse({
  success: true,
  version: 1,
  replayed: false,
  scopeChange,
  workIntervention: additionalIntervention,
  allowedActions: ['read', 'execute', 'intervention.add'],
});
assert(additionalCreated.workIntervention.status === 'pending_authorization', 'additional work must remain pending authorization after proposal');
assert(additionalCreated.scopeChange.interventionId === additionalCreated.workIntervention.id, 'ScopeChange and additional WorkIntervention must remain linked');
assert(additionalCreated.workIntervention.priceSnapshot?.unitPrice === 75, 'additional work must carry the exact governed price snapshot presented for authorization');

assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, workInterventions: undefined } }),
  'missing WorkIntervention projection must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, scopeChanges: undefined } }),
  'missing ScopeChange projection must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, plannedInterventionOptions: [{ visitAssetId: 'VA-OTHER', plannedWorkLineIds: ['line-standard'] }] } }),
  'per-Asset planned option referencing a foreign VisitAsset must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, plannedInterventionOptions: [{ visitAssetId: 'VA-1', plannedWorkLineIds: ['line-missing'] }] } }),
  'planned option referencing unknown planned work must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, additionalInterventionVisitAssetIds: ['VA-OTHER'] } }),
  'additional-work eligibility referencing a foreign VisitAsset must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, canAddAdditionalIntervention: true, additionalInterventionVisitAssetIds: [] } }),
  'true additional-work eligibility without a server VisitAsset option must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, canAddAdditionalIntervention: false, additionalInterventionVisitAssetIds: ['VA-1'] } }),
  'additional-work option cannot survive when server eligibility is false',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, availableFieldServices: [{ ...job.availableFieldServices[0], id: '' }] } }),
  'malformed canonical service choice must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({ success: true, version: 1, job: { ...job, canAddPlannedIntervention: true, plannedInterventionOptions: [] } }),
  'true planned mutation eligibility without server options must fail closed',
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
  () => parseFieldExecutionJobResponse({
    success: true,
    version: 1,
    job: { ...job, workInterventions: [{ ...additionalIntervention, priceSnapshot: undefined }], scopeChanges: [scopeChange] },
  }),
  'priced additional WorkIntervention without its governed price snapshot must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({
    success: true,
    version: 1,
    job: { ...job, workInterventions: [{ ...additionalIntervention, priceSnapshot: { ...priceSnapshot, sourceCatalogItemId: 'service-other' } }], scopeChanges: [scopeChange] },
  }),
  'additional WorkIntervention price must reference the same canonical Service',
);
assertThrows(
  () => parseFieldExecutionJobResponse({
    success: true,
    version: 1,
    job: { ...job, workInterventions: [{ ...additionalIntervention, priceSnapshot: { ...priceSnapshot, unitPrice: -1 } }], scopeChanges: [scopeChange] },
  }),
  'negative or malformed presented price must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({
    success: true,
    version: 1,
    job: { ...job, workInterventions: [additionalIntervention], scopeChanges: [] },
  }),
  'additional WorkIntervention without its ScopeChange must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({
    success: true,
    version: 1,
    job: { ...job, workInterventions: [additionalIntervention], scopeChanges: [{ ...scopeChange, interventionId: 'WI-OTHER' }] },
  }),
  'ScopeChange with inconsistent WorkIntervention linkage must fail closed',
);
assertThrows(
  () => parseFieldExecutionJobResponse({
    success: true,
    version: 1,
    job: { ...job, workInterventions: [additionalIntervention], scopeChanges: [{ ...scopeChange, requestedAt: 'not-a-timestamp' }] },
  }),
  'malformed ScopeChange timestamp must fail closed',
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
assertThrows(
  () => parseFieldCreateAdditionalInterventionResponse({
    success: true,
    version: 1,
    replayed: false,
    scopeChange,
    workIntervention: { ...additionalIntervention, status: 'completed' },
    allowedActions: ['intervention.add'],
  }),
  'additional-work creation response cannot claim automatic completion',
);
assertThrows(
  () => parseFieldCreateAdditionalInterventionResponse({
    success: true,
    version: 1,
    replayed: false,
    scopeChange,
    workIntervention: { ...additionalIntervention, priceSnapshot: undefined },
    allowedActions: ['intervention.add'],
  }),
  'additional-work creation response must include the governed price presented for authorization',
);
assertThrows(
  () => parseFieldCreateAdditionalInterventionResponse({
    success: true,
    version: 1,
    replayed: false,
    scopeChange: { ...scopeChange, interventionId: 'WI-OTHER' },
    workIntervention: additionalIntervention,
    allowedActions: ['intervention.add'],
  }),
  'additional-work mutation must fail closed on ScopeChange linkage drift',
);
assertThrows(
  () => parseFieldCreateAdditionalInterventionResponse({
    success: true,
    version: 1,
    replayed: false,
    scopeChange: { ...scopeChange, origin: 'office_updated_scope' },
    workIntervention: additionalIntervention,
    allowedActions: ['intervention.add'],
  }),
  'Technician additional-work command cannot return an office-only ScopeChange origin',
);

const withPlannedIntervention = parseFieldExecutionJobResponse({
  success: true,
  version: 1,
  job: {
    ...job,
    workInterventions: [intervention],
    plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 1, remainingQuantity: 0 }],
    plannedInterventionOptions: [],
    availableFieldServices,
    canAddPlannedIntervention: false,
    scopeChanges: [],
    additionalInterventionVisitAssetIds: ['VA-1'],
    canAddAdditionalIntervention: true,
  },
});
assert(withPlannedIntervention.job.workInterventions[0].status === 'confirmed', 'planned WorkIntervention should remain readable after planned quantity is linked');
assert(withPlannedIntervention.job.canAddAdditionalIntervention, 'exhausting planned quantity must not hide governed additional-work scope');

const withAdditionalIntervention = parseFieldExecutionJobResponse({
  success: true,
  version: 1,
  job: {
    ...job,
    workInterventions: [additionalIntervention],
    scopeChanges: [scopeChange],
  },
});
assert(withAdditionalIntervention.job.scopeChanges[0].reason === scopeChange.reason, 'canonical ScopeChange reason must remain readable with its pending intervention');
assert(withAdditionalIntervention.job.workInterventions[0].priceSnapshot?.unitPrice === 75, 'canonical presented price must remain readable with pending authorization');

console.log('Field WorkIntervention + ScopeChange + PriceSnapshot transport-contract acceptance: PASS');