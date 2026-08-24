import { fieldActionAllowed, type FieldAllowedAction } from '../lib/field-authorization';
import { hasCapability as hasLegacyCapability } from '../lib/capabilities';
import { parseFieldJobResponse, parseFieldScheduleResponse } from '../lib/field-authority-contract';
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

// Canonical ERP capability vocabulary is authoritative; old `*.read` vocabulary is only a projection.
assert(hasLegacyCapability('super_admin', 'work_orders.read'), 'legacy work_orders.read adapter should project canonical super-admin access');
assert(!hasLegacyCapability('technician', 'inventory.read'), 'legacy adapter must not re-grant inventory access removed from canonical technician policy');

// Navigation authority is reused for post-login routing and direct-route guards.
assert(defaultAuthenticatedRoute('technician') === '/field', 'technician login should enter the canonical Field App');
assert(isAuthenticatedRouteAllowed('/field', 'technician'), 'technician should be allowed to open Field App');
assert(!isAuthenticatedRouteAllowed('/dashboard', 'technician'), 'technician must not open management dashboard directly');
assert(defaultAuthenticatedRoute('super_admin') === '/dashboard', 'super admin should keep the management dashboard as default');
assert(isAuthenticatedRouteAllowed('/scheduling/dispatch', 'operations'), 'operations nested scheduling route should remain allowed');

// Authentication-role capabilities stay coarse. Assignment responsibility and action-level authority are server decisions.
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

// The client must obey the server projection literally instead of reconstructing responsibility rules.
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

// Read transport must fail closed on malformed/old 2xx payloads instead of crashing the UI or
// displaying stale assumptions about assignment/action data.
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
  technicianIds: ['staff-tech'],
  responsibility: 'technician',
  assignmentSource: 'direct_staff',
  allowedActions: ['read', 'execute'],
};
const validSchedule = parseFieldScheduleResponse({ success: true, version: 1, jobs: [representativeJob] });
assert(validSchedule.jobs[0].workOrderId === 'WO-1', 'valid schedule transport should parse');
const validJob = parseFieldJobResponse({ success: true, version: 1, job: { ...representativeJob, knownEquipment: [] } });
assert(validJob.job.knownEquipment.length === 0, 'valid job transport should parse');
assertThrows(() => parseFieldScheduleResponse({ success: true, version: 2, jobs: [] }), 'unknown API version must fail closed');
assertThrows(() => parseFieldScheduleResponse({ success: true, version: 1 }), 'missing jobs array must fail closed');
assertThrows(() => parseFieldScheduleResponse({ success: true, version: 1, jobs: [{ ...representativeJob, allowedActions: null }] }), 'malformed action projection must fail closed');
assertThrows(() => parseFieldJobResponse({ success: true, version: 1, job: representativeJob }), 'missing knownEquipment must fail closed');
assertThrows(() => parseFieldJobResponse({ success: true, version: 1, job: { ...representativeJob, knownEquipment: [{ id: 'AC-1' }] } }), 'malformed equipment row must fail closed');

// Client capability guards also fail closed for inactive principals; server identity checks remain authoritative.
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

// Mandatory scenarios 17 (helper scope denial) and 18 (other-team known-ID denial) are
// canonical server-security claims and are exercised in fieldOperationsAuthorityCore.test.js.
console.log('Field client capability, route guard and transport-contract acceptance: PASS');