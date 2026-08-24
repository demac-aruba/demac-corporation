const assert = require('node:assert/strict');
const test = require('node:test');
const { loadAssignedJob, profileVanFallbackAllowed, projectScheduleJob } = require('./fieldOperationsAuthorityCore');
const { projectCanonicalWorkVisit } = require('./fieldOperationsAuthorityWorkVisit');

function doc(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createReadDb(seed) {
  const collections = new Map(Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, item]))]));
  function collection(name) {
    const values = collections.get(name) || new Map();
    const query = (filters = []) => ({
      where(field, op, expected) {
        assert.equal(op, '==');
        return query([...filters, { field, expected }]);
      },
      async get() {
        return {
          docs: [...values.entries()]
            .filter(([, value]) => filters.every((filter) => value?.[filter.field] === filter.expected))
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

test('any dated staff assignment suppresses stale profile-Van fallback even when its Van id is unresolved', () => {
  const identity = { staffId: 'staff-moved', vanId: 'VAN-1' };
  const context = {
    dailyAssignments: [{
      id: 'malformed-override',
      date: '2026-08-24',
      vanId: 'historical-van-that-is-not-in-catalog',
      driverStaffId: 'staff-moved',
    }],
    memberships: [],
    vanAliases: new Map(),
  };
  assert.equal(profileVanFallbackAllowed(identity, context), false);
});

test('Legacy WorkVisit projection may fill validated structural ids without inventing historical planned work', () => {
  const projected = projectCanonicalWorkVisit({
    id: 'legacy-visit',
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    status: 'not_started',
    participatingStaffIds: ['staff-tech'],
    requiresSecondVisit: false,
    scheduledScopeSnapshot: {
      estimatedUnitCount: 1,
      problemDescription: 'Legacy scope text',
    },
    createdAt: '2026-08-20T10:00:00Z',
    createdByUserId: 'legacy-user',
    updatedAt: '2026-08-20T10:00:00Z',
    updatedByUserId: 'legacy-user',
    version: 1,
  }, {
    appointmentId: 'APT-1',
    propertyId: 'PROPERTY-1',
  });

  assert.equal(projected.appointmentId, 'APT-1');
  assert.equal(projected.propertyId, 'PROPERTY-1');
  assert.equal(projected.scheduledScopeSnapshot.appointmentId, 'APT-1');
  assert.deepEqual(projected.scheduledScopeSnapshot.workLines, []);
  assert.equal(projected.scheduledScopeSnapshot.customerFacingDescription, 'Legacy scope text');
});

test('missing Work Order property never broadens known-equipment read to every property for the customer', async () => {
  const db = createReadDb({
    dailyVanAssignments: [],
    vans: [],
    workOrders: [{
      id: 'WO-NO-PROPERTY',
      appointmentId: 'APT-1',
      clientId: 'CLIENT-1',
      propertyId: '',
      date: '2026-08-24',
      time: '08:30',
      status: 'Confirmada',
      technicianIds: ['staff-tech'],
      vanId: '',
      appointmentWorkItems: [],
    }],
    clients: [{ id: 'CLIENT-1', name: 'Multi-property customer' }],
    properties: [],
    appointments: [{ id: 'APT-1', workLines: [] }],
    equipmentSystems: [
      { id: 'AC-A', clientId: 'CLIENT-1', propertyId: 'PROPERTY-A', active: true },
      { id: 'AC-B', clientId: 'CLIENT-1', propertyId: 'PROPERTY-B', active: true },
    ],
  });
  const identity = {
    uid: 'uid-tech',
    staffId: 'staff-tech',
    vanId: '',
    role: 'technician',
    operations: false,
  };
  const job = await loadAssignedJob(db, identity, 'WO-NO-PROPERTY');
  assert.equal(job.propertyId, '');
  assert.deepEqual(job.knownEquipment, []);
});

test('missing or blank coordinates remain null instead of becoming the real coordinate 0,0', () => {
  const identity = { operations: false };
  const assignment = {
    responsibility: 'technician',
    source: 'direct_staff',
    assigned: true,
    readOnly: false,
    context: { vanAliases: new Map() },
  };
  const base = {
    order: {
      id: 'WO-COORD', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', date: '2026-08-24', time: '08:30',
      status: 'Confirmada', technicianIds: ['staff-tech'], vanId: '', appointmentWorkItems: [],
    },
    client: { id: 'CLIENT-1', name: 'Customer' },
    appointment: { id: 'APT-1', workLines: [] },
    identity,
    assignment,
  };
  const missing = projectScheduleJob({ ...base, property: { id: 'PROPERTY-1', latitude: null, longitude: '' } });
  assert.equal(missing.latitude, null);
  assert.equal(missing.longitude, null);

  const valid = projectScheduleJob({ ...base, property: { id: 'PROPERTY-1', latitude: '12.51', longitude: '-70.03' } });
  assert.equal(valid.latitude, 12.51);
  assert.equal(valid.longitude, -70.03);
});
