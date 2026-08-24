import type {
  FieldApproval,
  FieldSaleLine,
  PlannedWorkDisposition,
  ScopeChange,
  VisitAsset,
  WorkIntervention,
  WorkVisit,
} from '../lib/field-operations-domain';
import {
  buildBillingCandidateLines,
  canStartWorkVisit,
  createScheduledScopeSnapshot,
  plannedVsActualSummary,
  reconcilePlannedScope,
  transitionWorkVisit,
  validateVisitForOfficeReview,
} from '../lib/field-operations';

const now = '2026-08-24T16:00:00.000Z';
const actor = { userId: 'user-tech-1', role: 'technician', staffId: 'staff-tech-1', correlationId: 'acceptance-field-domain' };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD DOMAIN ACCEPTANCE FAILED: ${message}`);
}

function audit(id: string) {
  return { id, createdAt: now, updatedAt: now, createdBy: actor.userId, updatedBy: actor.userId };
}

function visit(args: { id?: string; plannedQuantity?: number; requiresSecondVisit?: boolean; secondVisitReason?: string }): WorkVisit {
  const quantity = args.plannedQuantity ?? 1;
  return {
    ...audit(args.id ?? 'visit-1'),
    appointmentId: 'apt-1',
    workOrderId: 'wo-1',
    customerId: 'customer-1',
    propertyId: 'property-1',
    scheduledScopeSnapshot: createScheduledScopeSnapshot({
      appointmentId: 'apt-1',
      capturedAt: now,
      estimatedUnitCount: quantity,
      workLines: [{ id: 'planned-service', schedulingWorkTypeId: 'standard_service', description: 'Standard Service', quantity }],
    }),
    status: 'in_progress',
    leadTechnicianStaffId: actor.staffId,
    participatingStaffIds: [actor.staffId!],
    startedAt: now,
    requiresSecondVisit: args.requiresSecondVisit ?? false,
    secondVisitReason: args.secondVisitReason,
  };
}

function asset(id: string, assetId = `asset-${id}`, addedOnSite = false): VisitAsset {
  return {
    ...audit(id),
    visitId: 'visit-1',
    assetId,
    sequence: Number(id.replace(/\D/g, '')) || 1,
    locationLabel: id,
    source: addedOnSite ? 'registered_on_site' : 'existing_asset',
    status: 'completed',
    addedOnSite,
    addedReason: addedOnSite ? 'Client requested service on another unit.' : undefined,
  };
}

function intervention(args: {
  id: string;
  visitAssetId: string;
  assetId: string;
  origin?: WorkIntervention['origin'];
  plannedWorkLineId?: string;
  scopeChangeId?: string;
  type?: string;
  catalogId?: string;
  status?: WorkIntervention['status'];
  unitPrice?: number;
}): WorkIntervention {
  return {
    ...audit(args.id),
    visitId: 'visit-1',
    visitAssetId: args.visitAssetId,
    assetId: args.assetId,
    plannedWorkLineId: args.plannedWorkLineId,
    serviceCatalogItemId: args.catalogId ?? 'service-standard',
    interventionType: args.type ?? 'Standard Service',
    origin: args.origin ?? 'planned',
    requestedBy: args.origin && args.origin !== 'planned' ? 'client' : 'office',
    status: args.status ?? 'completed',
    scopeChangeId: args.scopeChangeId,
    performedByStaffIds: [actor.staffId!],
    completedAt: args.status === 'completed' || !args.status ? now : undefined,
    priceSnapshot: args.unitPrice === undefined ? undefined : {
      currency: 'AWG',
      unitPrice: args.unitPrice,
      lineTotal: args.unitPrice,
      sourceCatalogItemId: args.catalogId ?? 'service-standard',
      capturedAt: now,
    },
  };
}

function scopeChange(id: string): ScopeChange {
  return {
    ...audit(id),
    visitId: 'visit-1',
    origin: 'client_requested_additional_work',
    reason: 'Customer requested additional work on site.',
    requestedByStaffId: actor.staffId,
    requestedAt: now,
  };
}

function disposition(quantity: number): PlannedWorkDisposition {
  return {
    ...audit(`disposition-${quantity}`),
    visitId: 'visit-1',
    plannedWorkLineId: 'planned-service',
    quantity,
    reason: 'cancelled_by_customer',
    note: 'Customer chose not to service remaining unit.',
    recordedByStaffId: actor.staffId,
  };
}

function gate(args: {
  workVisit: WorkVisit;
  visitAssets: VisitAsset[];
  interventions: WorkIntervention[];
  scopeChanges?: ScopeChange[];
  dispositions?: PlannedWorkDisposition[];
  approvals?: FieldApproval[];
  saleLines?: FieldSaleLine[];
}) {
  return validateVisitForOfficeReview({
    visit: args.workVisit,
    visitAssets: args.visitAssets,
    interventions: args.interventions,
    scopeChanges: args.scopeChanges ?? [],
    dispositions: args.dispositions ?? [],
    approvals: args.approvals ?? [],
    saleLines: args.saleLines ?? [],
  });
}

// Start gate: exact equipment count is intentionally NOT an input.
const start = canStartWorkVisit({
  workOrderAuthorized: true,
  assignmentAuthorized: true,
  customerId: 'customer-1',
  propertyId: 'property-1',
});
assert(start.allowed, 'released assigned Work Order should start without pre-confirming exact equipment quantity');

// Scenario 1: booked 1, actual 1.
{
  const workVisit = visit({});
  const visitAssets = [asset('va-1')];
  const interventions = [intervention({ id: 'i-1', visitAssetId: 'va-1', assetId: 'asset-va-1', plannedWorkLineId: 'planned-service' })];
  const result = gate({ workVisit, visitAssets, interventions });
  assert(result.allowed, `scenario 1 should submit: ${result.blockers.join(' | ')}`);
  const summary = plannedVsActualSummary({ visit: workVisit, interventions });
  assert(summary.plannedQuantity === 1 && summary.actualInterventionCount === 1, 'scenario 1 must preserve planned=1 actual=1');
}

// Scenario 2: booked 1, actual 2 units. Appointment snapshot stays 1; second intervention is added on site.
{
  const workVisit = visit({});
  const visitAssets = [asset('va-1'), asset('va-2', 'asset-va-2', true)];
  const changes = [scopeChange('scope-2')];
  const interventions = [
    intervention({ id: 'i-1', visitAssetId: 'va-1', assetId: 'asset-va-1', plannedWorkLineId: 'planned-service' }),
    intervention({ id: 'i-2', visitAssetId: 'va-2', assetId: 'asset-va-2', origin: 'added_on_site_client_request', scopeChangeId: 'scope-2' }),
  ];
  const result = gate({ workVisit, visitAssets, interventions, scopeChanges: changes });
  assert(result.allowed, `scenario 2 should submit: ${result.blockers.join(' | ')}`);
  const summary = plannedVsActualSummary({ visit: workVisit, interventions });
  assert(workVisit.scheduledScopeSnapshot.workLines[0].quantity === 1, 'scenario 2 appointment snapshot must remain 1');
  assert(summary.actualInterventionCount === 2 && summary.addedOnSiteInterventionCount === 1, 'scenario 2 actual must contain two independent interventions');
}

// Scenario 3: same A/C, Standard Service + Check-up as independent interventions.
{
  const workVisit = visit({});
  const visitAssets = [asset('va-1')];
  const changes = [scopeChange('scope-checkup')];
  const interventions = [
    intervention({ id: 'i-standard', visitAssetId: 'va-1', assetId: 'asset-va-1', plannedWorkLineId: 'planned-service' }),
    intervention({ id: 'i-checkup', visitAssetId: 'va-1', assetId: 'asset-va-1', origin: 'added_on_site_client_request', scopeChangeId: 'scope-checkup', type: 'Check-up', catalogId: 'service-checkup' }),
  ];
  assert(gate({ workVisit, visitAssets, interventions, scopeChanges: changes }).allowed, 'scenario 3 should allow two interventions on the same asset');
  assert(new Set(interventions.map((item) => item.id)).size === 2 && new Set(interventions.map((item) => item.assetId)).size === 1, 'scenario 3 interventions must remain independent while sharing one asset');
}

// Scenario 4: booked 2, one performed, one explicitly not performed.
{
  const workVisit = visit({ plannedQuantity: 2 });
  const visitAssets = [asset('va-1')];
  const interventions = [intervention({ id: 'i-1', visitAssetId: 'va-1', assetId: 'asset-va-1', plannedWorkLineId: 'planned-service' })];
  const dispositions = [disposition(1)];
  const reconciliation = reconcilePlannedScope({ snapshot: workVisit.scheduledScopeSnapshot, interventions, dispositions });
  assert(reconciliation[0].remainingQuantity === 0, 'scenario 4 planned work must reconcile performed + not-performed quantity');
  assert(gate({ workVisit, visitAssets, interventions, dispositions }).allowed, 'scenario 4 should preserve original plan and explicit disposition');
  assert(workVisit.scheduledScopeSnapshot.workLines[0].quantity === 2, 'scenario 4 original booked quantity must remain 2');
}

// Scenario 5: BTU is not part of the visit start or final field-domain gate.
{
  const workVisit = visit({});
  const visitAssets = [asset('va-1')];
  const interventions = [intervention({ id: 'i-1', visitAssetId: 'va-1', assetId: 'asset-va-1', plannedWorkLineId: 'planned-service' })];
  assert(gate({ workVisit, visitAssets, interventions }).allowed, 'scenario 5 must not require BTU during booking/visit orchestration');
}

// Scenario 6: on-site registration can start unresolved, but must resolve to canonical Asset before Office Review.
{
  const workVisit = visit({});
  const unresolved = { ...asset('va-1', 'asset-va-1', true), assetId: undefined };
  const interventions = [intervention({ id: 'i-1', visitAssetId: 'va-1', assetId: 'asset-va-1', plannedWorkLineId: 'planned-service' })];
  const blocked = gate({ workVisit, visitAssets: [unresolved], interventions });
  assert(!blocked.allowed && blocked.blockers.some((item) => item.includes('canonical CRM Asset')), 'scenario 6 unresolved field registration must block final submission, not visit start');
  const resolved = { ...unresolved, assetId: 'asset-va-1' };
  assert(gate({ workVisit, visitAssets: [resolved], interventions }).allowed, 'scenario 6 should submit after on-site equipment is canonically registered');
}

// Scenario 13: declined add-on remains recorded but never becomes a billing candidate.
{
  const declined: FieldSaleLine = {
    ...audit('sale-declined'), visitId: 'visit-1', catalogItemId: 'product-switch', descriptionSnapshot: '220V Switch', quantity: 1, unit: 'ea',
    priceSnapshot: { currency: 'AWG', unitPrice: 75, lineTotal: 75, capturedAt: now, sourceCatalogItemId: 'product-switch' },
    status: 'declined', soldByStaffId: actor.staffId!, requiresCustomerApproval: true, nonCatalog: false, officeReviewRequired: false,
  };
  assert(buildBillingCandidateLines({ visitId: 'visit-1', interventions: [], saleLines: [declined] }).length === 0, 'scenario 13 declined add-on must not be billed');
}

// Scenario 14/15: completed work remains complete while another intervention is pending a part and a return visit is explicit.
{
  const workVisit = visit({ plannedQuantity: 3, requiresSecondVisit: true, secondVisitReason: 'Replacement capacitor required.' });
  const visitAssets = [asset('va-1'), asset('va-2'), asset('va-3')];
  const interventions = [
    intervention({ id: 'i-1', visitAssetId: 'va-1', assetId: 'asset-va-1', plannedWorkLineId: 'planned-service' }),
    intervention({ id: 'i-2', visitAssetId: 'va-2', assetId: 'asset-va-2', plannedWorkLineId: 'planned-service' }),
    intervention({ id: 'i-3', visitAssetId: 'va-3', assetId: 'asset-va-3', plannedWorkLineId: 'planned-service', status: 'pending_part' }),
  ];
  const result = gate({ workVisit, visitAssets, interventions });
  assert(result.allowed, `scenario 14/15 should preserve partial completion and explicit return context: ${result.blockers.join(' | ')}`);
  assert(interventions.filter((item) => item.status === 'completed').length === 2 && interventions[2].status === 'pending_part', 'scenario 14 must retain two completed plus one pending intervention');
}

// Scenario 25/26: billing projection uses Actual Approved/Completed work, while planned quantity remains immutable historical intent.
{
  const workVisit = visit({});
  const changes = [scopeChange('scope-second-service'), scopeChange('scope-checkup')];
  const visitAssets = [asset('va-1'), asset('va-2', 'asset-va-2', true)];
  const interventions = [
    intervention({ id: 'i-service-1', visitAssetId: 'va-1', assetId: 'asset-va-1', plannedWorkLineId: 'planned-service', unitPrice: 125 }),
    intervention({ id: 'i-service-2', visitAssetId: 'va-2', assetId: 'asset-va-2', origin: 'added_on_site_client_request', scopeChangeId: 'scope-second-service', unitPrice: 125 }),
    intervention({ id: 'i-checkup', visitAssetId: 'va-2', assetId: 'asset-va-2', origin: 'added_on_site_client_request', scopeChangeId: 'scope-checkup', type: 'Check-up', catalogId: 'service-checkup', unitPrice: 75 }),
  ];
  const soldSwitch: FieldSaleLine = {
    ...audit('sale-switch'), visitId: 'visit-1', interventionId: 'i-service-2', assetId: 'asset-va-2', catalogItemId: 'product-switch', descriptionSnapshot: '220V Switch', quantity: 1, unit: 'ea',
    priceSnapshot: { currency: 'AWG', unitPrice: 75, lineTotal: 75, capturedAt: now, sourceCatalogItemId: 'product-switch' },
    status: 'sold', soldByStaffId: actor.staffId!, requiresCustomerApproval: false, nonCatalog: false, officeReviewRequired: false,
  };
  const result = gate({ workVisit, visitAssets, interventions, scopeChanges: changes, saleLines: [soldSwitch] });
  assert(result.allowed, `scenario 25 should submit actual work: ${result.blockers.join(' | ')}`);
  const billing = buildBillingCandidateLines({ visitId: workVisit.id, interventions, saleLines: [soldSwitch] });
  assert(billing.length === 4, 'scenario 25 billing candidate must include 2 services + 1 check-up + 1 switch');
  assert(workVisit.scheduledScopeSnapshot.workLines[0].quantity === 1, 'scenario 26 planned booking quantity must remain unchanged');
  assert(plannedVsActualSummary({ visit: workVisit, interventions, saleLines: [soldSwitch] }).actualInterventionCount === 3, 'scenario 26 actual work must be independently countable');
}

// State machine must reject arbitrary jumps.
{
  const workVisit = { ...visit({}), status: 'scheduled' as const };
  let rejected = false;
  try {
    transitionWorkVisit({ visit: workVisit, to: 'completed', actor, at: now });
  } catch {
    rejected = true;
  }
  assert(rejected, 'Work Visit state machine must reject scheduled -> completed');
}

console.log('Field operations canonical domain acceptance: PASS');
