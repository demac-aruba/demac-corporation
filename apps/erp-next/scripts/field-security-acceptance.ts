import { fieldActionAllowed } from '../lib/field-authorization';
import { hasCapability as hasLegacyCapability } from '../lib/capabilities';
import {
  parseFieldAttachVisitAssetResponse,
  parseFieldJobResponse,
  parseFieldPrepareVisitResponse,
  parseFieldScheduleResponse,
  parseFieldTransitionVisitResponse,
  type FieldAllowedAction,
} from '../lib/field-authority-contract';
import { defaultAuthenticatedRoute, isAuthenticatedRouteAllowed } from '../lib/role-routing';
import { requireCapability, roleCapabilities, type AuthPrincipal, type Capability } from '../lib/security';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD SECURITY ACCEPTANCE FAILED: ${message}`);
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

function hasFieldCapability(role: keyof typeof roleCapabilities, capability: Capability) {
  return roleCapabilities[role].has(capability);
}

assert(hasLegacyCapability('super_admin', 'work_orders.read'), 'legacy work_orders.read adapter should project canonical super-admin access');
assert(!hasLegacyCapability('technician', 'inventory.read'), 'legacy adapter must not re-grant inventory access removed from canonical technician policy');

assert(defaultAuthenticatedRoute('technician') === '/field', 'technician login should enter the canonical Field App');
assert(isAuthenticatedRouteAllowed('/field', 'technician'), 'technician should be allowed to open Field App');
assert(!isAuthenticatedRouteAllowed('/dashboard', 'technician'), 'technician must not open management dashboard directly');
assert(defaultAuthenticatedRoute('super_admin') === '/dashboard', 'super admin should keep the management dashboard as default');
assert(isAuthenticatedRouteAllowed('/field', 'super_admin'), 'super admin should retain access to the Technician Home for support/verification');
assert(!isAuthenticatedRouteAllowed('/field', 'operations'), 'operations Field read/review capability must not imply access to the Technician Home route');
assert(!isAuthenticatedRouteAllowed('/field', 'office_operator'), 'office Field read/review capability must not imply access to the Technician Home route');
assert(isAuthenticatedRouteAllowed('/scheduling/dispatch', 'operations'), 'operations nested scheduling route should remain allowed');

assert(hasFieldCapability('technician', 'field.read_assigned'), 'technician role should enter assigned Field work');
assert(hasFieldCapability('technician', 'field.execute'), 'technician role should be eligible for Field execution');
assert(hasFieldCapability('technician', 'field.scope.manage'), 'technician role should be eligible for actual-scope work');
assert(hasFieldCapability('technician', 'field.sale.propose'), 'technician role should be eligible to propose Field sales');
assert(hasFieldCapability('technician', 'field.complete'), 'technician role may be eligible to complete when server responsibility allows it');
assert(!hasFieldCapability('technician', 'field.review'), 'technician role must not gain Office Review capability');
assert(!hasFieldCapability('technician', 'field.price.override'), 'technician role must not gain price override capability');

assert(hasFieldCapability('office_operator', 'field.read_assigned'), 'office should read Field projections');
assert(hasFieldCapability('office_operator', 'field.review'), 'office should review Field submissions');
assert(!hasFieldCapability('office_operator', 'field.execute'), 'office role must not impersonate technician execution');
assert(!hasFieldCapability('office_operator', 'field.scope.manage'), 'office role must not inherit technician scope mutation');
assert(!hasFieldCapability('office_operator', 'field.price.override'), 'office operator must not receive price override by default');

assert(hasFieldCapability('operations', 'field.review'), 'operations should review Field submissions');
assert(hasFieldCapability('operations', 'field.price.override'), 'operations capability vocabulary includes governed price override');
assert(!hasFieldCapability('operations', 'field.execute'), 'operations role must not impersonate technician execution');

const leadProjection: { allowedActions: FieldAllowedAction[] } = {
  allowedActions: ['read', 'execute', 'report.edit', 'evidence.add', 'measurement.add', 'finding.add', 'asset.add', 'intervention.add', 'sale.propose', 'intervention.complete', 'visit.complete'],
};
assert(fieldActionAllowed(leadProjection, 'visit.complete'), 'client should render a server-authorized lead completion action');
assert(!fieldActionAllowed(leadProjection, 'office.review'), 'client must not infer Office Review from lead responsibility');

const helperProjection: { allowedActions: FieldAllowedAction[] } = {
  allowedActions: ['read', 'report.edit', 'evidence.add', 'measurement.add', 'finding.add'],
};
assert(fieldActionAllowed(helperProjection, 'report.edit'), 'client should render helper report editing when server projects it');
assert(!fieldActionAllowed(helperProjection, 'asset.add'), 'client must not invent helper asset authority');
assert(!fieldActionAllowed(helperProjection, 'intervention.add'), 'client must not invent helper scope authority');
assert(!fieldActionAllowed(helperProjection, 'sale.propose'), 'client must not invent helper billable authority');
assert(!fieldActionAllowed(helperProjection, 'visit.complete'), 'client must not invent helper completion authority');

const vanFallbackProjection: { allowedActions: FieldAllowedAction[] } = { allowedActions: ['read'] };
assert(fieldActionAllowed(vanFallbackProjection, 'read'), 'van compatibility projection should remain discoverable when server allows read');
assert(!fieldActionAllowed(vanFallbackProjection, 'execute'), 'client must preserve server read-only fallback');

const deniedProjection: { allowedActions: FieldAllowedAction[] } = { allowedActions: [] };
assert(!fieldActionAllowed(deniedProjection, 'read'), 'client must not expose another-team work when server projects no actions');
assert(!fieldActionAllowed(deniedProjection, 'execute'), 'client must not infer execution for a denied job');

const representativeVisit = {
  id: 'visit-WO-1',
  appointmentId: 'APT-1',
  workOrderId: 'WO-1',
  customerId: 'CLIENT-1',
  propertyId: 'PROPERTY-1',
  scheduledScopeSnapshot: {
    appointmentId: 'APT-1',
    capturedAt: '2026-08-24T12:00:00.000Z',
    estimatedUnitCount: 0,
    workLines: [{ id: 'line-1', label: 'Standard Service', quantity: 1 }],
  },
  status: 'scheduled',
  participatingStaffIds: ['staff-1'],
  requiresSecondVisit: false,
  createdAt: '2026-08-24T12:00:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-24T12:00:00.000Z',
  updatedBy: 'uid-1',
  version: 1,
  availableTransitions: ['en_route', 'no_access', 'cancelled'],
};

const representativeVisitAsset = {
  id: 'VA-1',
  visitId: 'visit-WO-1',
  assetId: 'AC-1',
  sequence: 1,
  locationLabel: 'Sala',
  source: 'existing_asset',
  status: 'identified',
  addedOnSite: true,
  createdAt: '2026-08-24T12:30:00.000Z',
  createdBy: 'uid-1',
  updatedAt: '2026-08-24T12:30:00.000Z',
  updatedBy: 'uid-1',
  version: 1,
};

const representativeJob = {
  id: 'WO-1',
  workOrderId: 'WO-1',
  appointmentId: 'APT-1',
  date: '2026-08-24',
  time: '08:30',
  status: 'Confirmada',
  customerId: 'CLIENT-1',
  customerName: 'Customer',
  propertyId: 'PROPERTY-1',
  address: 'Santa Cruz 1',
  plannedWork: [{ id: 'line-1', label: 'Standard Service', quantity: 1 }],
  estimatedQuantity: 0,
  vanId: 'VAN-1',
  responsibility: 'technician',
  assignmentSource: 'direct_staff',
  allowedActions: ['read', 'execute'],
  fieldVisit: null,
  canPrepareVisit: true,
  canCreateReturnVisit: false,
};
const validSchedule = parseFieldScheduleResponse({ success: true, version: 1, jobs: [representativeJob] });
assert(validSchedule.jobs[0].workOrderId === 'WO-1', 'valid public schedule transport should parse');
assert(validSchedule.jobs[0].fieldVisit === null, 'scheduled job may be readable before a physical WorkVisit is prepared');
assert(validSchedule.jobs[0].canPrepareVisit === true, 'server should explicitly project preparation eligibility');
const validJob = parseFieldJobResponse({
  success: true,
  version: 1,
  job: {
    ...representativeJob,
    fieldVisit: representativeVisit,
    canPrepareVisit: false,
    canCreateReturnVisit: false,
    knownEquipment: [],
    visitAssets: [],
    canAddExistingAsset: false,
  },
});
assert(validJob.job.knownEquipment.length === 0, 'valid public job transport should parse');
assert(validJob.job.visitAssets.length === 0, 'valid job transport should project actual VisitAsset scope explicitly');
assert(validJob.job.canAddExistingAsset === false, 'server should explicitly project actual-scope mutation eligibility');
assert(validJob.job.fieldVisit?.status === 'scheduled', 'job transport should preserve canonical WorkVisit state separately from WorkOrder status');

const validPrepare = parseFieldPrepareVisitResponse({
  success: true,
  version: 1,
  replayed: false,
  source: 'field_authority',
  visit: representativeVisit,
  allowedActions: ['read', 'execute'],
  auditEventId: 'FE-1',
});
assert(validPrepare.visit.status === 'scheduled' && validPrepare.replayed === false, 'valid visit preparation transport should parse');

const validTransition = parseFieldTransitionVisitResponse({
  success: true,
  version: 1,
  replayed: false,
  visit: { ...representativeVisit, status: 'en_route', version: 2, availableTransitions: ['on_site'] },
  allowedActions: ['read', 'execute'],
  auditEventId: 'FE-2',
});
const validPendingTransition = parseFieldTransitionVisitResponse({
  success: true,
  version: 1,
  replayed: false,
  visit: {
    ...representativeVisit,
    status: 'pending',
    pendingAt: '2026-08-24T13:00:00.000Z',
    pendingReason: 'Awaiting replacement part',
    pendingAction: 'Office orders the part',
    version: 5,
    availableTransitions: ['in_progress'],
  },
  allowedActions: ['read', 'execute'],
});
assert(validPendingTransition.visit.pendingReason === 'Awaiting replacement part', 'pending visit transport must preserve the canonical reason');
assert(validPendingTransition.visit.availableTransitions[0] === 'in_progress', 'pending visit transport must accept the server-projected resume transition');
const validNoAccessTransition = parseFieldTransitionVisitResponse({
  success: true,
  version: 1,
  replayed: false,
  visit: {
    ...representativeVisit,
    status: 'no_access',
    noAccessAt: '2026-08-24T13:00:00.000Z',
    noAccessReason: 'Property was locked',
    version: 2,
    availableTransitions: [],
  },
  allowedActions: ['read', 'execute'],
});
assert(validNoAccessTransition.visit.noAccessReason === 'Property was locked', 'no-access transport must preserve the canonical reason');
assert(validNoAccessTransition.visit.availableTransitions.length === 0, 'no-access transport must remain terminal');
const validCancelledTransition = parseFieldTransitionVisitResponse({
  success: true,
  version: 1,
  replayed: false,
  visit: {
    ...representativeVisit,
    status: 'cancelled',
    cancelledAt: '2026-08-24T13:00:00.000Z',
    cancellationReason: 'Customer cancelled this field visit',
    version: 2,
    availableTransitions: [],
  },
  allowedActions: ['read', 'execute'],
});
assert(validCancelledTransition.visit.cancellationReason === 'Customer cancelled this field visit', 'cancelled transport must preserve the canonical reason');
assert(validCancelledTransition.visit.availableTransitions.length === 0, 'cancelled transport must remain terminal');
const validReturnRequiredTransition = parseFieldTransitionVisitResponse({
  success: true,
  version: 1,
  replayed: false,
  visit: {
    ...representativeVisit,
    status: 'requires_return_visit',
    requiresSecondVisit: true,
    secondVisitRequiredAt: '2026-08-24T13:00:00.000Z',
    secondVisitReason: 'Return with ordered part',
    version: 5,
    availableTransitions: ['cancelled'],
  },
  allowedActions: ['read', 'execute'],
});
assert(validReturnRequiredTransition.visit.secondVisitReason === 'Return with ordered part', 'return-required transport must preserve the canonical reason');
assert(validTransition.visit.status === 'en_route' && validTransition.visit.version === 2, 'valid visit transition transport should parse');

const validAttach = parseFieldAttachVisitAssetResponse({
  success: true,
  version: 1,
  replayed: false,
  visitAsset: representativeVisitAsset,
  allowedActions: ['read', 'execute', 'asset.add'],
  auditEventId: 'FE-3',
});
assert(validAttach.visitAsset.assetId === 'AC-1' && validAttach.replayed === false, 'valid VisitAsset attachment transport should parse');

assertThrows(() => parseFieldScheduleResponse({ success: true, version: 2, jobs: [] }), 'unknown API version must fail closed');
assertThrows(() => parseFieldScheduleResponse({ success: true, version: 1 }), 'missing jobs array must fail closed');
assertThrows(() => parseFieldScheduleResponse({ success: true, version: 1, jobs: [{ ...representativeJob, fieldVisit: undefined }] }), 'missing current-visit projection must fail closed');
assertThrows(() => parseFieldScheduleResponse({ success: true, version: 1, jobs: [{ ...representativeJob, canPrepareVisit: undefined }] }), 'missing preparation projection must fail closed');
assertThrows(() => parseFieldScheduleResponse({ success: true, version: 1, jobs: [{ ...representativeJob, canCreateReturnVisit: undefined }] }), 'missing return-visit eligibility projection must fail closed');
assertThrows(() => parseFieldScheduleResponse({ success: true, version: 1, jobs: [{ ...representativeJob, allowedActions: null }] }), 'malformed action projection must fail closed');
assertThrows(() => parseFieldScheduleResponse({ success: true, version: 1, jobs: [{ ...representativeJob, allowedActions: ['read', 'future.action'] }] }), 'unknown server action name must fail closed');
assertThrows(() => parseFieldJobResponse({ success: true, version: 1, job: representativeJob }), 'missing knownEquipment and actual-scope projection must fail closed');
assertThrows(() => parseFieldJobResponse({ success: true, version: 1, job: { ...representativeJob, knownEquipment: [{ id: 'AC-1' }], visitAssets: [], canAddExistingAsset: false } }), 'malformed equipment row must fail closed');
assertThrows(() => parseFieldJobResponse({ success: true, version: 1, job: { ...representativeJob, knownEquipment: [], canAddExistingAsset: false } }), 'missing VisitAsset projection must fail closed');
assertThrows(() => parseFieldJobResponse({ success: true, version: 1, job: { ...representativeJob, knownEquipment: [], visitAssets: [], canAddExistingAsset: undefined } }), 'missing actual-scope eligibility must fail closed');
assertThrows(() => parseFieldJobResponse({ success: true, version: 1, job: { ...representativeJob, knownEquipment: [], visitAssets: [{ ...representativeVisitAsset, status: 'future_status' }], canAddExistingAsset: true } }), 'unknown VisitAsset status must fail closed');
assertThrows(() => parseFieldJobResponse({ success: true, version: 1, job: { ...representativeJob, knownEquipment: [], visitAssets: [{ ...representativeVisitAsset, version: 1.5 }], canAddExistingAsset: true } }), 'fractional VisitAsset version must fail closed');
assertThrows(() => parseFieldPrepareVisitResponse({ success: true, version: 2, replayed: false, source: 'field_authority', visit: representativeVisit, allowedActions: ['read'] }), 'prepare response with unknown API version must fail closed');
assertThrows(() => parseFieldPrepareVisitResponse({ success: true, version: 1, replayed: false, source: 'field_authority', visit: { ...representativeVisit, status: 'future_status' }, allowedActions: ['read'] }), 'prepare response with unknown visit status must fail closed');
assertThrows(() => parseFieldPrepareVisitResponse({ success: true, version: 1, replayed: false, source: 'field_authority', visit: { ...representativeVisit, availableTransitions: ['future_transition'] }, allowedActions: ['execute'] }), 'prepare response with unknown transition must fail closed');
assertThrows(() => parseFieldPrepareVisitResponse({ success: true, version: 1, replayed: false, source: 'field_authority', visit: representativeVisit, allowedActions: ['execute', 'future.action'] }), 'prepare response with unknown action must fail closed');
assertThrows(() => parseFieldTransitionVisitResponse({ success: true, version: 1, replayed: false, visit: { ...representativeVisit, availableTransitions: ['future_transition'] }, allowedActions: ['execute'] }), 'transition response with unknown next transition must fail closed');
assertThrows(() => parseFieldTransitionVisitResponse({ success: true, version: 1, replayed: false, visit: { ...representativeVisit, pendingReason: 42 }, allowedActions: ['execute'] }), 'transition response with malformed pending context must fail closed');
assertThrows(() => parseFieldTransitionVisitResponse({ success: true, version: 1, replayed: false, visit: { ...representativeVisit, noAccessReason: 42 }, allowedActions: ['execute'] }), 'transition response with malformed no-access context must fail closed');
assertThrows(() => parseFieldTransitionVisitResponse({ success: true, version: 1, replayed: false, visit: { ...representativeVisit, cancellationReason: 42 }, allowedActions: ['execute'] }), 'transition response with malformed cancellation context must fail closed');
assertThrows(() => parseFieldTransitionVisitResponse({ success: true, version: 1, replayed: false, visit: { ...representativeVisit, secondVisitRequiredAt: 42 }, allowedActions: ['execute'] }), 'transition response with malformed return-required context must fail closed');
assertThrows(() => parseFieldTransitionVisitResponse({ success: true, version: 1, replayed: false, visit: { ...representativeVisit, version: 1.5 }, allowedActions: ['execute'] }), 'fractional visit version must fail closed at the transport boundary');
assertThrows(() => parseFieldTransitionVisitResponse({ success: true, version: 1, replayed: false, visit: { ...representativeVisit, version: Number.MAX_SAFE_INTEGER + 1 }, allowedActions: ['execute'] }), 'unsafe visit version must fail closed at the transport boundary');
assertThrows(() => parseFieldAttachVisitAssetResponse({ success: true, version: 2, replayed: false, visitAsset: representativeVisitAsset, allowedActions: ['asset.add'] }), 'VisitAsset response with unknown API version must fail closed');
assertThrows(() => parseFieldAttachVisitAssetResponse({ success: true, version: 1, replayed: false, visitAsset: { ...representativeVisitAsset, source: 'future_source' }, allowedActions: ['asset.add'] }), 'VisitAsset response with unknown source must fail closed');
assertThrows(() => parseFieldAttachVisitAssetResponse({ success: true, version: 1, replayed: false, visitAsset: representativeVisitAsset, allowedActions: ['asset.add', 'future.action'] }), 'VisitAsset response with unknown action must fail closed');

const inactive: AuthPrincipal = {
  userId: 'user-disabled',
  displayName: 'Disabled',
  role: 'technician',
  active: false,
  staffId: 'staff-disabled',
  capabilities: roleCapabilities.technician,
};
let inactiveDenied = false;
try {
  requireCapability(inactive, 'field.read_assigned');
} catch {
  inactiveDenied = true;
}
assert(inactiveDenied, 'inactive client principal should fail the coarse capability guard');

console.log('Field client capability, route guard and transport-contract acceptance: PASS');
