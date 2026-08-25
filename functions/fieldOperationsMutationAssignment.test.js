const assert = require('node:assert/strict');
const test = require('node:test');
const { createMutationAssignmentResolver } = require('./fieldOperationsMutationAssignment');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createDb(seed = {}) {
  const collections = new Map(
    Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, { ...item }]))]),
  );
  const reads = [];

  function ensure(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }

  function queryRef(name, filters = []) {
    return {
      kind: 'query',
      collectionName: name,
      filters,
      where(field, op, expected) { return queryRef(name, [...filters, { field, op, expected }]); },
    };
  }

  function matches(value, filter) {
    if (filter.op === '==') return value?.[filter.field] === filter.expected;
    throw new Error(`Unsupported fake query operator ${filter.op}`);
  }

  const db = {
    collection(name) {
      const query = queryRef(name);
      return {
        ...query,
        where(field, op, expected) { return queryRef(name, [{ field, op, expected }]); },
      };
    },
  };
  const transaction = {
    async get(target) {
      reads.push({ collectionName: target.collectionName, filters: target.filters || [] });
      const values = ensure(target.collectionName);
      return {
        docs: [...values.entries()]
          .filter(([, value]) => (target.filters || []).every((filter) => matches(value, filter)))
          .map(([id, value]) => snapshot(id, value)),
      };
    },
  };

  return { db, transaction, reads };
}

const vans = [
  { id: 'VAN-1', name: 'Van 1', responsibleStaffId: 'staff-a', regularHelperId: 'staff-helper-a', technicianIds: ['staff-a', 'staff-helper-a'], active: true },
  { id: 'VAN-2', name: 'Van 2', responsibleStaffId: 'staff-b', regularHelperId: 'staff-helper-b', technicianIds: ['staff-b', 'staff-helper-b'], active: true },
];

function identity(overrides = {}) {
  return {
    uid: 'uid-staff-a',
    staffId: 'staff-a',
    vanId: 'VAN-1',
    role: 'technician',
    operations: false,
    ...overrides,
  };
}

function order(overrides = {}) {
  return { id: 'WO-1', date: '2026-08-25', vanId: 'VAN-1', technicianIds: [], ...overrides };
}

test('mutation assignment reads dated crew and vans through the supplied transaction', async () => {
  const fixture = createDb({ vans, dailyVanAssignments: [] });
  const resolveAssignment = createMutationAssignmentResolver({ db: fixture.db });
  const result = await resolveAssignment({ transaction: fixture.transaction, identity: identity(), order: order() });

  assert.equal(result.assigned, true);
  assert.equal(result.responsibility, 'lead');
  assert.equal(result.source, 'regular_crew');
  assert.deepEqual(fixture.reads.map((item) => item.collectionName).sort(), ['dailyVanAssignments', 'vans']);
  const datedRead = fixture.reads.find((item) => item.collectionName === 'dailyVanAssignments');
  assert.deepEqual(datedRead.filters, [{ field: 'date', op: '==', expected: '2026-08-25' }]);
});

test('dated reassignment is authoritative inside the mutation transaction', async () => {
  const fixture = createDb({
    vans,
    dailyVanAssignments: [
      { id: 'assign-v1', date: '2026-08-25', vanId: 'VAN-1', driverStaffId: 'staff-b', helperStaffId: 'staff-helper-b' },
      { id: 'assign-v2', date: '2026-08-25', vanId: 'VAN-2', driverStaffId: 'staff-a', helperStaffId: 'staff-helper-a' },
    ],
  });
  const resolveAssignment = createMutationAssignmentResolver({ db: fixture.db });

  const oldVan = await resolveAssignment({ transaction: fixture.transaction, identity: identity(), order: order({ vanId: 'VAN-1' }) });
  const newVan = await resolveAssignment({ transaction: fixture.transaction, identity: identity(), order: order({ vanId: 'VAN-2' }) });

  assert.equal(oldVan.assigned, false, 'dated move must suppress stale profile/regular-crew access to old Van');
  assert.equal(newVan.assigned, true);
  assert.equal(newVan.responsibility, 'lead');
  assert.equal(newVan.source, 'daily_assignment');
});

test('direct Work Order staff assignment remains authoritative even when no crew Van matches', async () => {
  const fixture = createDb({ vans, dailyVanAssignments: [] });
  const resolveAssignment = createMutationAssignmentResolver({ db: fixture.db });
  const result = await resolveAssignment({
    transaction: fixture.transaction,
    identity: identity({ vanId: '' }),
    order: order({ vanId: 'UNKNOWN-VAN', technicianIds: ['staff-a'] }),
  });

  assert.equal(result.assigned, true);
  assert.equal(result.responsibility, 'technician');
  assert.equal(result.source, 'direct_staff');
});

test('helper responsibility remains non-lead under a dated override', async () => {
  const fixture = createDb({
    vans,
    dailyVanAssignments: [{ id: 'assign-v1', date: '2026-08-25', vanId: 'VAN-1', driverStaffId: 'staff-b', helperStaffId: 'staff-a' }],
  });
  const resolveAssignment = createMutationAssignmentResolver({ db: fixture.db });
  const result = await resolveAssignment({ transaction: fixture.transaction, identity: identity(), order: order() });

  assert.equal(result.assigned, true);
  assert.equal(result.responsibility, 'helper');
  assert.equal(result.source, 'daily_assignment');
});

test('invalid Work Order date fails closed before any mutation assignment is granted', async () => {
  const fixture = createDb({ vans, dailyVanAssignments: [] });
  const resolveAssignment = createMutationAssignmentResolver({ db: fixture.db });
  await assert.rejects(
    () => resolveAssignment({ transaction: fixture.transaction, identity: identity(), order: order({ date: 'not-a-date' }) }),
    /YYYY-MM-DD|invalid/i,
  );
});
