const assert = require('node:assert/strict');
const test = require('node:test');
const {
  dateRange,
  loadAssignedJob,
  loadAssignedSchedule,
  normalizeFieldIdentity,
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
    { id: 'VAN-1', responsibleStaffId: 'staff-lead', regularHelperId: 'staff-helper' },
    { id: 'VAN-2', responsibleStaffId: 'staff-other' },
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
    { id: 'AC-1', clientId: 'client-1', propertyId: 'property-1', qrCode: 'DEMAC-0001', locationLabel: 'Sala', systemType: 'Split', btu: 12000, active: true },
    { id: 'AC-OTHER', clientId: 'client-2', propertyId: 'property-2', qrCode: 'DEMAC-9999', locationLabel: 'Office', active: true },
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

test('assigned schedule query returns only the technician van/team work', async () => {
  const db = createDb(baseSeed);
  const jobs = await loadAssignedSchedule(db, technician('staff-lead', 'VAN-1'), '2026-08-24', '2026-08-24');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].workOrderId, 'WO-1');
  assert.equal(jobs[0].customerName, 'Assigned Customer');
  assert.equal(jobs[0].responsibility, 'lead');
  assert.equal(jobs[0].plannedWork[0].quantity, 1);
});

test('helper receives only assigned work and helper responsibility', async () => {
  const db = createDb(baseSeed);
  const jobs = await loadAssignedSchedule(db, technician('staff-helper', 'VAN-1'), '2026-08-24', '2026-08-24');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].workOrderId, 'WO-1');
  assert.equal(jobs[0].responsibility, 'helper');
});

test('another team work order is denied even when its id is known', async () => {
  const db = createDb(baseSeed);
  await assert.rejects(() => loadAssignedJob(db, technician('staff-lead', 'VAN-1'), 'WO-2'), /not assigned/);
});

test('assigned job exposes only equipment from the assigned customer/property', async () => {
  const db = createDb(baseSeed);
  const job = await loadAssignedJob(db, technician('staff-lead', 'VAN-1'), 'WO-1');
  assert.equal(job.workOrderId, 'WO-1');
  assert.equal(job.knownEquipment.length, 1);
  assert.equal(job.knownEquipment[0].id, 'AC-1');
  assert.equal(job.knownEquipment[0].btu, 12000);
  assert.equal(job.accessInstructions, 'Side gate');
});

test('operations may inspect field schedule without impersonating a technician assignment', async () => {
  const db = createDb(baseSeed);
  const office = normalizeFieldIdentity({ uid: 'office-1', profile: { active: true, role: 'office', name: 'Office' }, decoded: {} });
  const jobs = await loadAssignedSchedule(db, office, '2026-08-24', '2026-08-24');
  assert.deepEqual(jobs.map((job) => job.workOrderId), ['WO-1', 'WO-2']);
  assert.ok(jobs.every((job) => job.responsibility === 'office'));
});
