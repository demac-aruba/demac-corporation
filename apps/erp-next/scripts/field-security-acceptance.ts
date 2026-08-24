import { authorizeFieldAction, filterAssignedFieldScopes, type FieldAssignmentScope } from '../lib/field-authorization';
import { hasCapability as hasLegacyCapability } from '../lib/capabilities';
import { roleCapabilities, type AuthPrincipal } from '../lib/security';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FIELD SECURITY ACCEPTANCE FAILED: ${message}`);
}

function principal(args: {
  userId: string;
  staffId?: string;
  vanId?: string;
  role?: AuthPrincipal['role'];
  active?: boolean;
}): AuthPrincipal {
  const role = args.role ?? 'technician';
  return {
    userId: args.userId,
    displayName: args.userId,
    role,
    active: args.active ?? true,
    staffId: args.staffId,
    vanId: args.vanId,
    capabilities: roleCapabilities[role],
  };
}

const assigned: FieldAssignmentScope = {
  workOrderId: 'wo-team-1',
  vanIds: ['VAN-1'],
  members: [
    { staffId: 'staff-lead', responsibility: 'lead' },
    { staffId: 'staff-tech', responsibility: 'technician' },
    { staffId: 'staff-helper', responsibility: 'helper' },
  ],
};

const otherTeam: FieldAssignmentScope = {
  workOrderId: 'wo-team-2',
  vanIds: ['VAN-2'],
  members: [{ staffId: 'staff-other', responsibility: 'lead' }],
};

// Canonical security vocabulary is authoritative; old `*.read` vocabulary is only a projection.
assert(hasLegacyCapability('super_admin', 'work_orders.read'), 'legacy work_orders.read adapter should project canonical super-admin access');
assert(!hasLegacyCapability('technician', 'inventory.read'), 'legacy adapter must not re-grant inventory access removed from canonical technician policy');

// Lead can coordinate and finish an assigned visit.
{
  const lead = principal({ userId: 'user-lead', staffId: 'staff-lead', vanId: 'VAN-1' });
  assert(authorizeFieldAction(lead, assigned, 'read').allowed, 'lead should read assigned work');
  assert(authorizeFieldAction(lead, assigned, 'intervention.add').allowed, 'lead should add interventions');
  assert(authorizeFieldAction(lead, assigned, 'sale.propose').allowed, 'lead should propose catalog sales');
  assert(authorizeFieldAction(lead, assigned, 'visit.complete').allowed, 'lead should finalize visit');
}

// Normal technician can execute and add actual work, but cannot close the whole visit unless assigned lead responsibility.
{
  const tech = principal({ userId: 'user-tech', staffId: 'staff-tech', vanId: 'VAN-1' });
  assert(authorizeFieldAction(tech, assigned, 'read').allowed, 'technician should read assigned work');
  assert(authorizeFieldAction(tech, assigned, 'asset.add').allowed, 'technician should add equipment where allowed');
  assert(authorizeFieldAction(tech, assigned, 'intervention.add').allowed, 'technician should add interventions');
  assert(authorizeFieldAction(tech, assigned, 'sale.propose').allowed, 'technician should propose field sale');
  assert(!authorizeFieldAction(tech, assigned, 'visit.complete').allowed, 'non-lead technician must not finalize visit');
}

// Mandatory scenario 17: helper cannot alter billable/operational scope.
{
  const helper = principal({ userId: 'user-helper', staffId: 'staff-helper', vanId: 'VAN-1' });
  assert(authorizeFieldAction(helper, assigned, 'report.edit').allowed, 'helper should edit assigned report sections');
  assert(authorizeFieldAction(helper, assigned, 'evidence.add').allowed, 'helper should upload evidence');
  assert(authorizeFieldAction(helper, assigned, 'measurement.add').allowed, 'helper should enter measurements');
  assert(authorizeFieldAction(helper, assigned, 'finding.add').allowed, 'helper should record findings');
  assert(!authorizeFieldAction(helper, assigned, 'asset.add').allowed, 'helper must not add assets');
  assert(!authorizeFieldAction(helper, assigned, 'intervention.add').allowed, 'helper must not change scope');
  assert(!authorizeFieldAction(helper, assigned, 'sale.propose').allowed, 'helper must not add billable work');
  assert(!authorizeFieldAction(helper, assigned, 'visit.complete').allowed, 'helper must not close visit');
}

// Mandatory scenario 18: knowing another team's Work Order id does not grant access.
{
  const tech = principal({ userId: 'user-tech', staffId: 'staff-tech', vanId: 'VAN-1' });
  assert(!authorizeFieldAction(tech, otherTeam, 'read').allowed, 'technician must not read another team work order by id');
  assert(!authorizeFieldAction(tech, otherTeam, 'execute').allowed, 'technician must not mutate another team work order by id');
  const visible = filterAssignedFieldScopes(tech, [assigned, otherTeam]);
  assert(visible.length === 1 && visible[0].workOrderId === assigned.workOrderId, 'assigned query projection must exclude other team work');
}

// A legacy Work Order carrying only a van id may be visible, but may not be mutated until canonical crew membership is resolved.
{
  const vanOnlyScope: FieldAssignmentScope = { workOrderId: 'wo-legacy-van', vanIds: ['VAN-1'], members: [] };
  const tech = principal({ userId: 'user-tech', staffId: 'staff-tech', vanId: 'VAN-1' });
  assert(authorizeFieldAction(tech, vanOnlyScope, 'read').allowed, 'van-scoped legacy work should remain discoverable');
  assert(!authorizeFieldAction(tech, vanOnlyScope, 'execute').allowed, 'van-only fallback must be read-only until explicit staff membership is resolved');
}

// Office Review is a separate authority and does not impersonate a technician assignment.
{
  const office = principal({ userId: 'user-office', role: 'office_operator' });
  assert(authorizeFieldAction(office, otherTeam, 'office.review').allowed, 'office should review field submissions without technician assignment');
  assert(!authorizeFieldAction(office, otherTeam, 'execute').allowed, 'office reviewer must not inherit technician execution authority');
}

// Inactive principals fail closed even if all other identifiers match.
{
  const inactive = principal({ userId: 'user-disabled', staffId: 'staff-lead', vanId: 'VAN-1', active: false });
  assert(!authorizeFieldAction(inactive, assigned, 'read').allowed, 'inactive principal must be denied');
}

console.log('Field assignment and authorization acceptance: PASS');
