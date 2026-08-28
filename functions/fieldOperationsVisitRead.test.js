const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachCurrentWorkVisitState,
  canCreateReturnVisit,
  canPrepareInitialVisit,
  projectFieldVisitState,
  orderedWorkVisitChain,
  selectCurrentWorkVisit,
} = require('./fieldOperationsVisitRead');

function snapshot(id, value) {
  return { id, data: () => value };
}

function createDb(visits = []) {
  return {
    collection(name) {
      assert.equal(name, 'workVisits');
      return {
        where(field, op, expected) {
          assert.equal(field, 'workOrderId');
          assert.equal(op, '==');
          return {
            async get() {
              return {
                docs: visits
                  .filter((visit) => visit.workOrderId === expected)
                  .map((visit) => snapshot(visit.id, visit)),
              };
            },
          };
        },
      };
    },
  };
}

function job(overrides = {}) {
  return {
    workOrderId: 'WO-1',
    appointmentId: 'APT-1',
    customerId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    status: 'Confirmada',
    allowedActions: ['read', 'execute'],
    ...overrides,
  };
}

function visit(overrides = {}) {
  return {
    id: 'visit-WO-1',
    workOrderId: 'WO-1',
    appointmentId: 'APT-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: {
      appointmentId: 'APT-1',
      capturedAt: '2026-08-24T12:00:00.000Z',
      estimatedUnitCount: 1,
      workLines: [{ id: 'line-1', label: 'Standard Service', quantity: 1 }],
    },
    status: 'not_started',
    participatingStaffIds: ['staff-1'],
    requiresSecondVisit: false,
    createdAt: '2026-08-24T12:00:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-24T12:00:00.000Z',
    updatedByUserId: 'uid-1',
    version: 1,
    ...overrides,
  };
}

test('read model keeps planned Work Order state separate and projects preparation eligibility before a WorkVisit exists', async () => {
  const result = await attachCurrentWorkVisitState(createDb([]), job());
  assert.equal(result.status, 'Confirmada');
  assert.equal(result.fieldVisit, null);
  assert.equal(result.canPrepareVisit, true);
  assert.equal(result.canCreateReturnVisit, false);
});

test('server preparation projection is limited to not-started active Work Orders with execute authority', () => {
  assert.equal(canPrepareInitialVisit(job({ status: 'Confirmada' }), null), true);
  assert.equal(canPrepareInitialVisit(job({ status: 'Asignada' }), null), true);
  assert.equal(canPrepareInitialVisit(job({ status: 'En camino' }), null), false);
  assert.equal(canPrepareInitialVisit(job({ status: 'En el sitio' }), null), false);
  assert.equal(canPrepareInitialVisit(job({ status: 'En proceso' }), null), false);
  assert.equal(canPrepareInitialVisit(job({ status: 'Pendiente' }), null), false);
  assert.equal(canPrepareInitialVisit(job({ allowedActions: ['read'] }), null), false);
  assert.equal(canPrepareInitialVisit(job(), visit()), false);
});

test('read model projects current WorkVisit status, version and next active server transition', async () => {
  const result = await attachCurrentWorkVisitState(createDb([
    visit({ status: 'on_the_way', departedAt: '2026-08-24T12:30:00.000Z', version: 2 }),
  ]), job());

  assert.equal(result.status, 'Confirmada', 'planned/release status must remain independent');
  assert.equal(result.canPrepareVisit, false);
  assert.equal(result.canCreateReturnVisit, false);
  assert.equal(result.fieldVisit.status, 'en_route');
  assert.equal(result.fieldVisit.version, 2);
  assert.equal(result.fieldVisit.departedAt, '2026-08-24T12:30:00.000Z');
  assert.deepEqual(result.fieldVisit.availableTransitions, ['on_site', 'pending', 'no_access', 'cancelled']);
});

test('helper/read-only projection receives visit state without execution transitions', () => {
  const projected = projectFieldVisitState(visit({ status: 'on_site' }), job({ allowedActions: ['read', 'report.edit'] }));
  assert.equal(projected.status, 'on_site');
  assert.deepEqual(projected.availableTransitions, []);
});

test('missing Legacy version defaults to one but explicit malformed versions fail closed', () => {
  const legacy = projectFieldVisitState(visit({ version: undefined }), job());
  assert.equal(legacy.version, 1);
  for (const version of [1.5, 0, null, '', '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => projectFieldVisitState(visit({ version }), job()),
      (error) => error?.code === 'invalid_visit_version' && error?.status === 409,
    );
  }
});

test('a linear return-visit chain resolves to its physical chain tip', () => {
  const initial = visit({ id: 'visit-1' });
  const returned = visit({ id: 'visit-2', previousVisitId: 'visit-1', status: 'on_site', version: 1 });
  assert.equal(selectCurrentWorkVisit([initial, returned], 'WO-1').id, 'visit-2');
  assert.deepEqual(
    orderedWorkVisitChain([returned, initial], 'WO-1').map((item) => item.id),
    ['visit-1', 'visit-2'],
    'the reusable chain must be ordered from the original physical visit to the current return',
  );
});

test('read model retains ordered chain ids only as internal server composition state', async () => {
  const initial = visit({ id: 'visit-1' });
  const returned = visit({ id: 'visit-2', previousVisitId: 'visit-1', status: 'on_site' });
  const result = await attachCurrentWorkVisitState(createDb([returned, initial]), job());
  assert.deepEqual(result._fieldVisitChainIds, ['visit-1', 'visit-2']);
  assert.equal(result.fieldVisit.id, 'visit-2');
});

test('branched, broken or cyclic visit history fails closed instead of guessing current truth', () => {
  const initial = visit({ id: 'visit-1' });
  const branchA = visit({ id: 'visit-2', previousVisitId: 'visit-1' });
  const branchB = visit({ id: 'visit-3', previousVisitId: 'visit-1' });
  assert.throws(() => selectCurrentWorkVisit([initial, branchA, branchB], 'WO-1'), /cannot be resolved/i);

  const broken = visit({ id: 'visit-4', previousVisitId: 'missing-visit' });
  assert.throws(() => selectCurrentWorkVisit([broken], 'WO-1'), /cannot be resolved/i);

  const cycleA = visit({ id: 'visit-a', previousVisitId: 'visit-b' });
  const cycleB = visit({ id: 'visit-b', previousVisitId: 'visit-a' });
  assert.throws(() => selectCurrentWorkVisit([cycleA, cycleB], 'WO-1'), /cannot be resolved/i);
});

test('visit identity mismatch fails closed before it can be shown under another Work Order context', () => {
  assert.throws(
    () => projectFieldVisitState(visit({ clientId: 'CLIENT-OTHER' }), job()),
    /identity does not match/i,
  );
});

test('read projection rejects an identity-conflicting ancestor instead of hiding it behind a valid chain tip', async () => {
  const initial = visit({ id: 'visit-1', clientId: 'CLIENT-OTHER' });
  const current = visit({ id: 'visit-2', previousVisitId: 'visit-1', status: 'on_site' });
  await assert.rejects(
    () => attachCurrentWorkVisitState(createDb([initial, current]), job()),
    (error) => error?.code === 'visit_identity_conflict' && error?.status === 409,
  );
});

test('read projection rejects conflicting identity aliases and snapshot appointment identity', async () => {
  for (const conflicting of [
    visit({ customerId: 'CLIENT-OTHER' }),
    visit({ siteId: 'PROPERTY-OTHER' }),
    visit({ scheduledScopeSnapshot: { appointmentId: 'APT-OTHER', capturedAt: '2026-08-24T12:00:00.000Z', estimatedUnitCount: 1, workLines: [] } }),
  ]) {
    await assert.rejects(
      () => attachCurrentWorkVisitState(createDb([conflicting]), job()),
      (error) => error?.code === 'visit_identity_conflict' && error?.status === 409,
    );
  }
});

test('return-visit creation eligibility is a server projection of canonical visit truth and execute authority', async () => {
  const returnRequired = visit({
    status: 'requires_return_visit',
    requiresSecondVisit: true,
    secondVisitReason: 'Return with replacement board.',
    secondVisitRequiredAt: '2026-08-24T14:00:00.000Z',
    version: 5,
  });
  const result = await attachCurrentWorkVisitState(createDb([returnRequired]), job());
  assert.equal(result.canCreateReturnVisit, true);
  assert.equal(canCreateReturnVisit(job({ allowedActions: ['read'] }), result.fieldVisit), false);
  assert.equal(canCreateReturnVisit(job(), { ...result.fieldVisit, secondVisitReason: undefined }), false);
});
