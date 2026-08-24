const assert = require('node:assert/strict');
const test = require('node:test');
const {
  dateRange,
  loadAssignedJob,
  loadAssignedSchedule,
  normalizeFieldIdentity,
  normalizeFieldRole,
} = require('./fieldOperationsAuthorityCore');

function doc(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function matches(value, field, op, expected) {
  if (op === '==') return value?.[field] === expected;
  if (op === 'array-contains') return Array.isArray(value?.[field]) && value[field].includes(expected);
  throw new Error(`Unsupported fake query operator ${op}`);
}

function createDb(seed = {}) {
  const collections = new Map(Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, { ...item }]))]));
  function collection(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    const values = collections.get(name);
    const query = (filters = []) => ({
      where(field, op, expected) {
        return query([...filters, { field, op, expected }]);
      },
      async get() {
        return {
          docs: [...values.entries()]
            .filter(([, value]) => filters.every((filter) => matches(value, filter.field, filter.op, filter.expected)))
            .map(([id, value]) => doc(id, value)),
        };
      },
      doc(id) {
        return { async get() { return doc(id, values.get(id)); } };
      },
    });
    return query();
  }
  return { collection };
}

const baseSeed = {
  dailyVanAssignments: [
    { id: '2026-08-24-VAN-1', date: '2026-08-24', vanId: 'VAN-1', driverStaffId: 'staff-lead', helperStaffId: 'staff-helper' },
    { id: '2026-08-24-VAN-2', date: '2026-08-24', vanId: 'VAN-2', driverStaffId: 'staff-other' },
  ],
  vans: [
    { id: 'VAN-1', name: 'Van 1', responsibleStaffId: 'staff-lead', regularHelperId: 'staff-helper' },
    { id: 'VAN-2', name: 'Van 2', responsibleStaffId: 'staff-other' },
  ],
  workOrders: [
    {
      id: 'WO-1', appointmentId: 'APT-1', clientId: 'client-1', propertyId: 'property-1', date: '2026-08-24', time: '08:30',
      status: 'Confirmada', vanId: 'VAN-1', technicianIds: ['staff-lead', 'staff-helper'], airConditionerCount: 1,
      customerFacingDescription: '1 × Standard Service', technicianInstructions: 'Bring ladder',
      appointmentWorkItems: [{ id: 'line-1', serviceId: 'service-standard', presetId: 'standard_service', label: 'Standard Service', quantity: 1, durationMinutes: 60 }],
    },
    {
      id: 'WO-2', appointmentId: 'APT-2', clientId: 'client-2', propertyId: 'property-2', date: '2026-08-24', time: '09:30',
      status: 'Confirmada', vanId: 'VAN-2', technicianIds: ['staff-other'], airConditionerCount: 1,
      appointmentWorkItems: [{ id: 'line-2', serviceId: 'service-checkup', label: 'Check-up', quantity: 1, durationMinutes: 60 }],
    },
  ],
  clients: [
    { id: 'client-1', name: 'Assigned Customer', phone: '+2975600001', whatsapp: '+2975600001' },
    { id: 'client-2', name: 'Other Customer', phone: '+2975600002' },
  ],
  properties: [
    { id: 'property-1', name: 'House', address: 'Santa Cruz 1', accessInstructions: 'Side gate' },
    { id: 'property-2', name: 'Office', address: 'Noord 2' },
  ],
  appointments: [
    { id: 'APT-1', workLines: [{ id: 'line-1', serviceId: 'service-standard', presetId: 'standard_service', quantity: 1 }] },
    { id: 'APT-2', workLines: [{ id: 'line-2', serviceId: 'service-checkup', quantity: 1 }] },
  ],
  equipmentSystems: [
    {
      id: 'AC-1', clientId: 'client-1', propertyId: 'property-1', qrCode: 'DEMAC-0001', locationLabel: 'Sala', systemType: 'Split wall mounted', active: true,
      components: [
        { id: 'indoor-1', componentType: 'indoor', brand: 'Adina', model: 'OPT-12', serialNumber: 'IN-001', btu: 12000, refrigerant: 'R32', voltage: '220' },
        { id: 'outdoor-1', componentType: 'outdoor', brand: 'Adina', model: 'OPT-12-OD', serialNumber: 'OUT-001', btu: 12000, refrigerant: 'R32', voltage: '220' },
      ],
    },
    { id: 'AC-OTHER', clientId: 'client-2', propertyId: 'property-2', qrCode: 'DEMAC-9999', locationLabel: 'Office', active: true, components: [] },
  ],
};

function technician(staffId, vanId = '') {
  return normalizeFieldIdentity({
    uid: `uid-${staffId}`,
    profile: { active: true, role: 'technician', staffId, vanId, name: staffId },
    decoded: {},
  });
}

test('date range is bounded to one technician week', () => {
  assert.deepEqual(dateRange('2026-08-24', '2026-08-30'), ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']);
  assert.throws(() => dateRange('2026-08-24', '2026-08-31'), /limited to 7 days/);
});

test('technician identity requires canonical staff linkage', () => {
  assert.throws(() => normalizeFieldIdentity({ uid: 'uid-x', profile: { active: true, role: 'technician' } }), /staff profile/);
});

test('server role normalization matches ERP canonical vocabulary while preserving legacy aliases', () => {
  assert.equal(normalizeFieldRole('office_operator'), 'office_operator');
  assert.equal(normalizeFieldRole('office'), 'office_operator');
  assert.equal(normalizeFieldRole('operations'), 'operations');
  assert.equal(normalizeFieldRole('supervisor'), 'operations');
  assert.equal(normalizeFieldRole('super-admin'), 'super_admin');
  assert.equal(normalizeFieldRole('tech'), 'technician');

  const office = normalizeFieldIdentity({ uid: 'office-canonical', profile: { active: true, role: 'office_operator', name: 'Office' }, decoded: {} });
  const operations = normalizeFieldIdentity({ uid: 'ops-canonical', profile: { active: true, role: 'operations', name: 'Operations' }, decoded: {} });
  assert.equal(office.role, 'office_operator');
  assert.equal(office.operations, true);
  assert.equal(operations.role, 'operations');
  assert.equal(operations.operations, true);
  assert.throws(
    () => normalizeFieldIdentity({ uid: 'finance-1', profile: { active: true, role: 'finance', name: 'Finance' }, decoded: {} }),
    /not authorized for Field Operations/,
  );
});

test('assigned schedule query returns only the technician van/team work with lead actions', async () => {
  const db = createDb(baseSeed);
  const jobs = await loadAssignedSchedule(db, technician('staff-lead', 'VAN-1'), '2026-08-24', '2026-08-24');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].workOrderId, 'WO-1');
  assert.equal(jobs[0].customerName, 'Assigned Customer');
  assert.equal(jobs[0].responsibility, 'lead');
  assert.equal(jobs[0].assignmentSource, 'daily_assignment');
  assert.equal(jobs[0].plannedWork[0].quantity, 1);
  assert.ok(jobs[0].allowedActions.includes('visit.complete'));
  assert.ok(jobs[0].allowedActions.includes('intervention.add'));
});

test('completed assigned work remains visible in schedule/detail but is read-only', async () => {
  const seed = {
    ...baseSeed,
    workOrders: [...baseSeed.workOrders, {
      id: 'WO-COMPLETE', appointmentId: 'APT-COMPLETE', clientId: 'client-1', propertyId: 'property-1', date: '2026-08-24', time: '11:30',
      status: 'Completada', vanId: 'VAN-1', technicianIds: ['staff-lead', 'staff-helper'], airConditionerCount: 2,
      appointmentWorkItems: [{ id: 'complete-line', serviceId: 'service-standard', label: 'Standard Service', quantity: 2, durationMinutes: 120 }],
    }],
    appointments: [...baseSeed.appointments, { id: 'APT-COMPLETE', workLines: [] }],
  };
  const db = createDb(seed);
  const jobs = await loadAssignedSchedule(db, technician('staff-lead', 'VAN-1'), '2026-08-24', '2026-08-24');
  assert.deepEqual(jobs.map((job) => job.workOrderId), ['WO-1', 'WO-COMPLETE']);
  const completed = jobs.find((job) => job.workOrderId === 'WO-COMPLETE');
  assert.deepEqual(completed.allowedActions, ['read']);
  const detail = await loadAssignedJob(db, technician('staff-lead', 'VAN-1'), 'WO-COMPLETE');
  assert.equal(detail.status, 'Completada');
  assert.deepEqual(detail.allowedActions, ['read']);
});

test('helper receives reporting actions but cannot receive billable or scope actions', async () => {
  const db = createDb(baseSeed);
  const jobs = await loadAssignedSchedule(db, technician('staff-helper', 'VAN-1'), '2026-08-24', '2026-08-24');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].workOrderId, 'WO-1');
  assert.equal(jobs[0].responsibility, 'helper');
  assert.ok(jobs[0].allowedActions.includes('report.edit'));
  assert.ok(jobs[0].allowedActions.includes('evidence.add'));
  assert.ok(!jobs[0].allowedActions.includes('asset.add'));
  assert.ok(!jobs[0].allowedActions.includes('intervention.add'));
  assert.ok(!jobs[0].allowedActions.includes('sale.propose'));
  assert.ok(!jobs[0].allowedActions.includes('visit.complete'));
});

test('another team work order is denied even when its id is known', async () => {
  const db = createDb(baseSeed);
  await assert.rejects(() => loadAssignedJob(db, technician('staff-lead', 'VAN-1'), 'WO-2'), /not assigned/);
});

test('assigned job adapts production-shaped equipment components without inventing root technical fields', async () => {
  const db = createDb(baseSeed);
  const job = await loadAssignedJob(db, technician('staff-lead', 'VAN-1'), 'WO-1');
  assert.equal(job.workOrderId, 'WO-1');
  assert.equal(job.knownEquipment.length, 1);
  assert.deepEqual(job.knownEquipment[0], {
    id: 'AC-1',
    qrCode: 'DEMAC-0001',
    locationLabel: 'Sala',
    systemType: 'Split wall mounted',
    brand: 'Adina',
    model: 'OPT-12',
    serial: 'IN-001',
    btu: 12000,
    refrigerant: 'R32',
    voltage: '220',
    condition: '',
    active: true,
  });
  assert.equal(job.accessInstructions, 'Side gate');
});

test('direct staff assignment remains authoritative even outside the dated Van crew', async () => {
  const seed = {
    ...baseSeed,
    workOrders: [...baseSeed.workOrders, {
      id: 'WO-DIRECT', appointmentId: 'APT-DIRECT', clientId: 'client-1', propertyId: 'property-1', date: '2026-08-24', time: '10:30',
      status: 'Confirmada', vanId: 'VAN-2', technicianIds: ['staff-direct'], airConditionerCount: 0,
    }],
    appointments: [...baseSeed.appointments, { id: 'APT-DIRECT', workLines: [] }],
  };
  const jobs = await loadAssignedSchedule(createDb(seed), technician('staff-direct'), '2026-08-24', '2026-08-24');
  assert.deepEqual(jobs.map((job) => job.workOrderId), ['WO-DIRECT']);
  assert.equal(jobs[0].responsibility, 'technician');
  assert.equal(jobs[0].assignmentSource, 'direct_staff');
  assert.ok(jobs[0].allowedActions.includes('intervention.add'));
  assert.ok(!jobs[0].allowedActions.includes('visit.complete'));
});

test('profile Van fallback is discoverable but remains read-only without resolved staff membership', async () => {
  const seed = {
    ...baseSeed,
    dailyVanAssignments: baseSeed.dailyVanAssignments.filter((assignment) => assignment.vanId !== 'VAN-1'),
    vans: [
      { id: 'VAN-1', name: 'Van 1', responsibleStaffId: 'someone-else', regularHelperId: 'another-person' },
      ...baseSeed.vans.filter((van) => van.id !== 'VAN-1'),
    ],
    workOrders: baseSeed.workOrders.map((order) => order.id === 'WO-1' ? { ...order, technicianIds: [] } : order),
  };
  const jobs = await loadAssignedSchedule(createDb(seed), technician('staff-fallback', 'VAN-1'), '2026-08-24', '2026-08-24');
  assert.deepEqual(jobs.map((job) => job.workOrderId), ['WO-1']);
  assert.equal(jobs[0].assignmentSource, 'profile_van_fallback');
  assert.deepEqual(jobs[0].allowedActions, ['read']);
});

test('canonical Van aliases resolve historical Work Order and daily assignment identifiers', async () => {
  const seed = {
    dailyVanAssignments: [{ id: 'alias-day', date: '2026-08-24', vanId: 'v4', driverStaffId: 'staff-alias' }],
    vans: [{ id: 'van-1783800405341', name: 'Van 4', responsibleStaffId: 'regular-four' }],
    workOrders: [{
      id: 'WO-ALIAS', appointmentId: 'APT-ALIAS', clientId: 'client-1', propertyId: 'property-1', date: '2026-08-24', time: '13:30',
      status: 'Confirmada', vanId: 'van-1783800405341', technicianIds: [], airConditionerCount: 1,
    }],
    clients: baseSeed.clients,
    properties: baseSeed.properties,
    appointments: [{ id: 'APT-ALIAS', workLines: [] }],
    equipmentSystems: baseSeed.equipmentSystems,
  };
  const jobs = await loadAssignedSchedule(createDb(seed), technician('staff-alias'), '2026-08-24', '2026-08-24');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].workOrderId, 'WO-ALIAS');
  assert.equal(jobs[0].vanId, 'VAN-4');
  assert.equal(jobs[0].responsibility, 'lead');
  assert.equal(jobs[0].assignmentSource, 'daily_assignment');
});

test('canonical office_operator and legacy office aliases share Office Field behavior', async () => {
  const db = createDb(baseSeed);
  for (const role of ['office_operator', 'office']) {
    const office = normalizeFieldIdentity({ uid: `office-${role}`, profile: { active: true, role, name: 'Office' }, decoded: {} });
    const jobs = await loadAssignedSchedule(db, office, '2026-08-24', '2026-08-24');
    assert.equal(office.role, 'office_operator');
    assert.deepEqual(jobs.map((job) => job.workOrderId), ['WO-1', 'WO-2']);
    assert.ok(jobs.every((job) => job.responsibility === 'office'));
    assert.ok(jobs.every((job) => job.allowedActions.includes('office.review')));
    assert.ok(jobs.every((job) => !job.allowedActions.includes('execute')));
    assert.ok(jobs.every((job) => !job.allowedActions.includes('price.override')));
  }
});

test('canonical operations and legacy supervisor aliases share governed price override', async () => {
  const db = createDb(baseSeed);
  for (const role of ['operations', 'supervisor']) {
    const operations = normalizeFieldIdentity({ uid: `ops-${role}`, profile: { active: true, role, name: 'Operations' }, decoded: {} });
    const jobs = await loadAssignedSchedule(db, operations, '2026-08-24', '2026-08-24');
    assert.equal(operations.role, 'operations');
    assert.ok(jobs.every((job) => job.allowedActions.includes('price.override')));
    assert.ok(jobs.every((job) => job.allowedActions.includes('office.review')));
    assert.ok(jobs.every((job) => !job.allowedActions.includes('execute')));
  }
});
