import {
  parseFieldApprovalJobResponse,
  parseFieldRecordAdditionalWorkDecisionResponse,
} from '../lib/field-approval-contract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD APPROVAL CONTRACT ACCEPTANCE FAILED: ${message}`);
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

const priceSnapshot = {
  currency: 'AWG',
  unitPrice: 125,
  sourceCatalogItemId: 'service-standard',
  pricingVersion: 'company-service-pricing-rules:v7:standard_service:12000',
  capturedAt: '2026-08-25T12:30:00.000Z',
};

const pendingIntervention = {
  id: 'WI-1',
  visitId: 'visit-WO-1',
  visitAssetId: 'VA-1',
  assetId: 'AC-1',
  serviceCatalogItemId: 'service-standard',
  interventionType: '12K Standard Service',
  origin: 'added_on_site_client_request',
  requestedBy: 'client',
  status: 'pending_authorization',
  priceSnapshot,
  scopeChangeId: 'SC-1',
  performedByStaffIds: [],
  createdAt: '2026-08-25T12:30:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:30:00.000Z',
  updatedBy: 'uid-1',
  version: 1,
};

const pendingScopeChange = {
  id: 'SC-1',
  visitId: 'visit-WO-1',
  visitAssetId: 'VA-1',
  interventionId: 'WI-1',
  origin: 'client_requested_additional_work',
  reason: 'Client requested service for an additional A/C.',
  requestedByStaffId: 'staff-1',
  requestedAt: '2026-08-25T12:30:00.000Z',
  createdAt: '2026-08-25T12:30:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-25T12:30:00.000Z',
  updatedBy: 'uid-1',
  version: 1,
};

const baseJob = {
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
  workInterventions: [pendingIntervention],
  plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 0, remainingQuantity: 1 }],
  plannedInterventionOptions: [],
  interventionExecutionOptions: [],
  availableFieldServices: [{ id: 'service-standard', bookingCode: 'standard_service', label: 'Standard Service', kind: 'Maintenance', durationMinutesPerUnit: 60 }],
  canAddPlannedIntervention: false,
  scopeChanges: [pendingScopeChange],
  additionalInterventionVisitAssetIds: ['VA-1'],
  canAddAdditionalIntervention: true,
  fieldApprovals: [],
  additionalApprovalInterventionIds: ['WI-1'],
  canRecordAdditionalApproval: true,
};

const pending = parseFieldApprovalJobResponse({ success: true, version: 1, job: baseJob });
assert(pending.job.canRecordAdditionalApproval, 'pending additional work should expose governed customer decision eligibility');
assert(pending.job.additionalApprovalInterventionIds[0] === 'WI-1', 'server decision target should survive strict parsing');

const decidedAt = '2026-08-25T12:35:00.000Z';
const approvedScopeChange = {
  ...pendingScopeChange,
  resolvedAt: decidedAt,
  updatedAt: decidedAt,
  version: 2,
};
const approvedIntervention = {
  ...pendingIntervention,
  status: 'confirmed',
  updatedAt: decidedAt,
  version: 2,
};
const approval = {
  id: 'FA-1',
  visitId: 'visit-WO-1',
  status: 'approved',
  method: 'verbal',
  affected: [
    { type: 'intervention', id: 'WI-1' },
    { type: 'scope_change', id: 'SC-1' },
  ],
  receiverName: 'Maria Customer',
  decidedAt,
  technicianStaffId: 'staff-1',
  note: 'Approved verbally on site.',
  createdAt: decidedAt,
  createdBy: 'uid-1',
  updatedAt: decidedAt,
  updatedBy: 'uid-1',
  version: 1,
};

const approved = parseFieldApprovalJobResponse({
  success: true,
  version: 1,
  job: {
    ...baseJob,
    workInterventions: [approvedIntervention],
    scopeChanges: [approvedScopeChange],
    fieldApprovals: [approval],
    additionalApprovalInterventionIds: [],
    canRecordAdditionalApproval: false,
  },
});
assert(approved.job.fieldApprovals[0].receiverName === 'Maria Customer', 'recorded approval evidence should survive transport parsing');
assert(approved.job.workInterventions[0].status === 'confirmed', 'approved additional work should be confirmed, not completed automatically');

const decision = parseFieldRecordAdditionalWorkDecisionResponse({
  success: true,
  version: 1,
  replayed: false,
  fieldApproval: approval,
  scopeChange: approvedScopeChange,
  workIntervention: approvedIntervention,
  allowedActions: ['read', 'execute', 'intervention.add'],
  auditEventId: 'FE-1',
});
assert(decision.fieldApproval.status === 'approved', 'valid verbal customer decision should parse');
assert(decision.workIntervention.priceSnapshot?.unitPrice === 125, 'customer decision must preserve the exact presented price snapshot');

const rejectedApproval = { ...approval, status: 'rejected', note: 'Customer declined additional work.' };
const rejectedIntervention = { ...approvedIntervention, status: 'declined' };
const rejected = parseFieldRecordAdditionalWorkDecisionResponse({
  success: true,
  version: 1,
  replayed: false,
  fieldApproval: rejectedApproval,
  scopeChange: approvedScopeChange,
  workIntervention: rejectedIntervention,
  allowedActions: ['read', 'execute'],
});
assert(rejected.workIntervention.status === 'declined', 'customer rejection should preserve historical proposal and mark work declined');

assertThrows(
  () => parseFieldApprovalJobResponse({ success: true, version: 1, job: { ...baseJob, fieldApprovals: undefined } }),
  'missing FieldApproval projection must fail closed',
);
assertThrows(
  () => parseFieldApprovalJobResponse({ success: true, version: 1, job: { ...baseJob, additionalApprovalInterventionIds: ['WI-OTHER'] } }),
  'decision eligibility for an unknown intervention must fail closed',
);
assertThrows(
  () => parseFieldApprovalJobResponse({ success: true, version: 1, job: { ...baseJob, canRecordAdditionalApproval: false } }),
  'server decision boolean cannot contradict its projected targets',
);
assertThrows(
  () => parseFieldApprovalJobResponse({
    success: true,
    version: 1,
    job: {
      ...baseJob,
      workInterventions: [approvedIntervention],
      scopeChanges: [approvedScopeChange],
      fieldApprovals: [{ ...approval, affected: [{ type: 'intervention', id: 'WI-OTHER' }, { type: 'scope_change', id: 'SC-1' }] }],
      additionalApprovalInterventionIds: [],
      canRecordAdditionalApproval: false,
    },
  }),
  'approval referencing another intervention must fail closed',
);
assertThrows(
  () => parseFieldRecordAdditionalWorkDecisionResponse({
    success: true,
    version: 1,
    replayed: false,
    fieldApproval: approval,
    scopeChange: approvedScopeChange,
    workIntervention: { ...approvedIntervention, status: 'completed' },
    allowedActions: ['read', 'execute'],
  }),
  'customer approval command cannot claim work was completed automatically',
);
assertThrows(
  () => parseFieldRecordAdditionalWorkDecisionResponse({
    success: true,
    version: 1,
    replayed: false,
    fieldApproval: { ...approval, method: 'email' },
    scopeChange: approvedScopeChange,
    workIntervention: approvedIntervention,
    allowedActions: ['read', 'execute'],
  }),
  'current technician decision command must remain verbal and server-owned',
);
assertThrows(
  () => parseFieldRecordAdditionalWorkDecisionResponse({
    success: true,
    version: 1,
    replayed: false,
    fieldApproval: approval,
    scopeChange: approvedScopeChange,
    workIntervention: { ...approvedIntervention, priceSnapshot: undefined },
    allowedActions: ['read', 'execute'],
  }),
  'approval response without exact presented price must fail closed',
);
assertThrows(
  () => parseFieldRecordAdditionalWorkDecisionResponse({
    success: true,
    version: 1,
    replayed: false,
    fieldApproval: { ...approval, status: 'rejected' },
    scopeChange: approvedScopeChange,
    workIntervention: approvedIntervention,
    allowedActions: ['read', 'execute'],
  }),
  'approval evidence and resulting intervention status must agree',
);

console.log('Field approval contract acceptance passed.');