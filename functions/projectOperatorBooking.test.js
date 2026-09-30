'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectApi } = require('./projectAuthority');
const { createBookingAuthority } = require('./bookingAuthorityFirestore');
const { createOfficeBookingApi, OFFICE_BOOKING_ACTIONS } = require('./officeBookingAuthority');
const { withProjectBookingLinks } = require('./projectBookingLinks');
const { GENERAL_PHASE } = require('./projectRecords');

class Snapshot {
  constructor(id, value) { this.id = id; this.exists = value !== undefined; this.value = value; }
  data() { return this.value; }
}

class Document {
  constructor(db, collection, id) { this.db = db; this.collectionName = collection; this.id = id; }
  get path() { return `${this.collectionName}/${this.id}`; }
  async get() { return new Snapshot(this.id, this.db.store.get(this.path)); }
  async set(value, options) {
    const previous = this.db.store.get(this.path);
    this.db.store.set(this.path, options?.merge ? { ...(previous || {}), ...value } : value);
  }
}

class Collection {
  constructor(db, name) { this.db = db; this.name = name; this.max = Infinity; }
  doc(id) { return new Document(this.db, this.name, id); }
  orderBy() { return this; }
  limit(max) { this.max = max; return this; }
  async get() {
    const docs = [...this.db.store.entries()]
      .filter(([key]) => key.startsWith(`${this.name}/`))
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, this.max)
      .map(([key, value]) => new Snapshot(key.slice(this.name.length + 1), value));
    return { docs, size: docs.length };
  }
}

class Db {
  constructor(seed = {}) { this.store = new Map(Object.entries(seed)); }
  collection(name) { return new Collection(this, name); }
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: ref => ref.get(),
      set: (ref, value, options) => writes.push([ref, value, options]),
    };
    const result = await callback(transaction);
    for (const [ref, value, options] of writes) await ref.set(value, options);
    return result;
  }
  read(path) { return this.store.get(path); }
}

function project(overrides = {}) {
  return {
    id: 'PROJECT-1', projectNumber: 'PRJ-1013', name: 'Existing VRF Project',
    customerId: 'CLIENT-1', customerName: 'Customer', siteId: 'PROPERTY-1',
    location: 'Aruba', type: 'VRF Project', status: 'Planned', serverVersion: 1,
    estimatedWorkDays: 2, estimatedSlots: 12, estimatedLaborHours: 12,
    scheduledFutureHours: 0, actualLaborHours: 0, slotsPerWorkDay: 6,
    slotDurationMinutes: 60, technicianInstructions: 'Use the west gate',
    phases: [{ id: 'PHASE-1', name: 'Installation', status: 'Planned', workflowStatus: 'Ready to Schedule',
      estimatedLaborHours: 6, actualLaborHours: 0, internalNotes: 'Private phase note' }],
    assignments: [], assignedVans: [], materials: [], expenses: [], costEntries: [],
    materialBudget: 9000, materialActual: 0, contactPerson: 'Private contact',
    internalNotes: 'Private management note',
    ...overrides,
  };
}

function fixture(role = 'office', active = true) {
  return new Db({
    'users/USER-1': { role, active, name: 'Office User' },
    'clients/CLIENT-1': { active: true, name: 'Customer' },
    'properties/PROPERTY-1': { active: true, clientId: 'CLIENT-1', address: 'Aruba' },
    'projectRecords/PROJECT-1': project(),
  });
}

function apiRequest(action, data = {}) {
  return { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: { action, data } };
}

function api(db) {
  return createProjectApi({ db, verifyIdToken: async () => ({ uid: 'USER-1' }),
    clock: () => new Date('2098-12-01T12:00:00.000Z') });
}

test('office role aliases receive only the scheduling Project projection', async () => {
  for (const role of ['office', 'operator', 'office_operator', 'Office Operator', 'office-operator']) {
    const db = fixture(role);
    db.store.set('projectRecords/PROJECT-1', project({ assignments: [{
      projectId: 'PROJECT-1', phaseId: 'PHASE-1', appointmentId: 'APT-1', workOrderId: 'WO-1',
      scheduledHours: 2, postedAt: '', internalNotes: 'Private assignment note',
    }] }));
    const result = await api(db).handle(apiRequest('schedule_list'));
    assert.equal(result.status, 200, role);
    assert.equal(result.body.projects.length, 1);
    const visible = result.body.projects[0];
    assert.deepEqual(Object.keys(visible).sort(), [
      'serverVersion', 'id', 'projectNumber', 'name', 'customerId', 'customerName', 'siteId',
      'location', 'type', 'status', 'technicianInstructions', 'slotsPerWorkDay',
      'slotDurationMinutes', 'estimatedSlots', 'estimatedLaborHours', 'scheduledFutureHours',
      'actualLaborHours', 'phases', 'assignments',
    ].sort());
    assert.deepEqual(Object.keys(visible.phases[0]).sort(), [
      'id', 'name', 'status', 'workflowStatus', 'estimatedLaborHours', 'actualLaborHours',
    ].sort());
    assert.deepEqual(Object.keys(visible.assignments[0]).sort(), [
      'projectId', 'phaseId', 'appointmentId', 'workOrderId', 'scheduledHours', 'postedAt',
    ].sort());
    for (const privateText of ['Private management note', 'Private phase note', 'Private assignment note', 'Private contact', '9000']) {
      assert.equal(JSON.stringify(visible).includes(privateText), false, `${role} leaked ${privateText}`);
    }
  }
});

test('Office Booking Authority accepts normalized operator aliases for ordinary Scheduling access', async () => {
  for (const role of ['office', 'operator', 'office_operator', 'Office Operator', 'office-operator']) {
    const officeApi = createOfficeBookingApi({
      db: fixture(role), verifyIdToken: async () => ({ uid: 'USER-1' }),
      bookingAuthority: {}, schedulingProvider: {},
    });
    const result = await officeApi.handle(apiRequest(OFFICE_BOOKING_ACTIONS.LIST_PRESETS));
    assert.equal(result.status, 200, role);
  }
});

test('operator Project availability reaches canonical Booking Authority with the Project identity', async () => {
  for (const role of ['office', 'operator', 'office_operator', 'Office Operator', 'office-operator']) {
    let captured;
    const officeApi = createOfficeBookingApi({
      db: fixture(role), verifyIdToken: async () => ({ uid: 'USER-1' }),
      bookingAuthority: {
        async checkAvailability(args) {
          captured = args;
          return { success: true, available: true, offer: { id: 'OFFER-1', version: 1 }, options: [] };
        },
      },
      schedulingProvider: {},
    });
    const result = await officeApi.handle(apiRequest(OFFICE_BOOKING_ACTIONS.CHECK_AVAILABILITY, {
      requestId: 'operator-project-availability', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
      project: { id: 'PROJECT-1', phaseId: GENERAL_PHASE, version: 1 },
      workLines: [{ presetId: 'other', quantity: 1, manualDurationMinutes: 120 }],
      requestedDate: '2098-12-20', requestedTime: '08:30', requiredVanId: 'VAN-1',
    }));
    assert.equal(result.status, 200, role);
    assert.deepEqual(captured.request.project, { id: 'PROJECT-1', phaseId: GENERAL_PHASE, version: 1 }, role);
    assert.equal(captured.context.projectActorId, 'USER-1', role);
    assert.equal(captured.context.channel, 'office', role);
  }
});

test('office operators cannot read Project planning, save planning, or access historical correction actions', async () => {
  const db = fixture('office_operator');
  const projectApi = api(db);
  for (const [action, data] of [
    ['list', {}],
    ['save', { project: project(), expectedVersion: 1, requestId: 'operator-save', dryRun: false }],
    ['history_sources', { projectId: 'PROJECT-1' }],
    ['history_capacity_sources', { projectId: 'PROJECT-1' }],
    ['history_adjust_capacity', { projectId: 'PROJECT-1' }],
    ['history_preview', { projectId: 'PROJECT-1' }],
    ['history_confirm', { projectId: 'PROJECT-1' }],
  ]) {
    const result = await projectApi.handle(apiRequest(action, data));
    assert.equal(result.status, 403, action);
    assert.equal(result.body.error.code, 'permission_denied', action);
  }
  assert.equal(db.read('projectRecords/PROJECT-1').serverVersion, 1);
  assert.equal([...db.store.keys()].some(key => key.startsWith('projectPlanningAudit/')), false);
});

test('unknown and inactive users cannot even read the scheduling Project projection', async () => {
  for (const [role, active] of [['technician', true], ['customer', true], ['finance', true], ['office', false], ['office', undefined]]) {
    const db = fixture(role, active);
    if (active === undefined) db.store.set('users/USER-1', { role, name: 'Office User' });
    const result = await api(db).handle(apiRequest('schedule_list'));
    assert.equal(result.status, 403, `${role}/${active}`);
    assert.equal(result.body.error.code, 'permission_denied');
  }
});

test('manager planning and history reads retain their prior access', async () => {
  const db = fixture('manager');
  const projectApi = api(db);
  const listed = await projectApi.handle(apiRequest('list'));
  assert.equal(listed.status, 200);
  assert.equal(listed.body.projects[0].materialBudget, 9000);
  const saved = await projectApi.handle(apiRequest('save', {
    project: project(), expectedVersion: 1, requestId: 'manager-dry-run', dryRun: true,
  }));
  assert.equal(saved.status, 200);
  assert.equal(saved.body.dryRun, true);
  assert.equal(db.read('projectRecords/PROJECT-1').serverVersion, 1);
  const history = await projectApi.handle(apiRequest('history_sources', { projectId: 'PROJECT-1' }));
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.sources, []);
});

test('legacy manager Project scheduling auth is not tightened by the operator-only active rule', async () => {
  const db = fixture('manager');
  db.store.set('users/USER-1', { role: 'manager', name: 'Manager' });
  const result = await api(db).handle(apiRequest('schedule_list'));
  assert.equal(result.status, 200);
});

function bookingProvider() {
  const option = {
    id: 'OPTION-1', date: '2098-12-20', time: '08:30', endTime: '10:30', capacityEndTime: '10:30',
    address: 'Aruba', zone: 'Aruba', presetId: 'other', presetLabel: 'Project',
    quantity: 1, durationMinutesPerUnit: 120,
    assignments: [{ vanId: 'VAN-1', vanName: 'Van 1', technicianIds: ['TECH-1'],
      quantity: 1, slots: 2, capacityEndTime: '10:30' }],
  };
  return {
    async checkAvailability() { return { options: [option], providerVersion: 'test-provider-v1' }; },
    async revalidateSelection({ option: selected }) { return { available: true, option: selected }; },
    async validateTransaction() {
      return { available: true, capacityLocks: [
        { id: 'LOCK-1', date: '2098-12-20', vanId: 'VAN-1', slot: '08:30' },
        { id: 'LOCK-2', date: '2098-12-20', vanId: 'VAN-1', slot: '09:30' },
      ] };
    },
    async buildWorkOrders({ appointment, option: selected, customer, property }) {
      return [{ id: `WO-${appointment.appointmentId}`, clientId: customer.id, propertyId: property.id,
        date: selected.date, time: selected.time, status: 'Confirmada', vanId: 'VAN-1',
        technicianIds: ['TECH-1'], scheduledSlots: 2 }];
    },
  };
}

function bookingFixture(role = 'office') {
  const db = fixture(role);
  const authority = createBookingAuthority({
    db, availabilityProvider: withProjectBookingLinks({ db, provider: bookingProvider() }),
    clock: () => new Date('2098-12-01T12:00:00.000Z'),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
  });
  const request = {
    project: { id: 'PROJECT-1', phaseId: GENERAL_PHASE, version: 1 },
    customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    workLines: [{ presetId: 'other', quantity: 1, manualDurationMinutes: 120,
      customerFacingDescription: 'Existing VRF Project' }],
    constraints: { requestedDate: '2098-12-20', requestedTime: '08:30' },
  };
  const context = { channel: 'office', projectActorId: 'USER-1', requestKey: 'operator-project-1' };
  return { db, authority, request, context };
}

test('office operator books a published Project through canonical Booking Authority and can replay the same booking', async () => {
  const { db, authority, request, context } = bookingFixture('office_operator');
  const offered = await authority.checkAvailability({ request, actor: { id: 'USER-1' }, context });
  assert.equal(offered.available, true);
  const args = { offerId: offered.offer.id, offerVersion: offered.offer.version,
    optionId: 'OPTION-1', idempotencyKey: 'operator-project-booking-1',
    actor: { id: 'USER-1', source: 'office-scheduling' }, context };
  const booked = await authority.createAppointment(args);
  assert.equal(booked.success, true);
  assert.equal(booked.replayed, false);
  assert.equal(db.read(`appointments/${booked.appointmentId}`).projectId, 'PROJECT-1');
  assert.equal(db.read(`workOrders/${booked.workOrderIds[0]}`).projectId, 'PROJECT-1');
  assert.equal(db.read(`projectBookingClaims/${booked.appointmentId}`).projectId, 'PROJECT-1');
  assert.equal(db.read('projectRecords/PROJECT-1').assignments.length, 1);
  assert.equal(db.read('projectRecords/PROJECT-1').assignments[0].scheduledSlots, 2);
  assert.equal(db.read('projectRecords/PROJECT-1').scheduledFutureHours, 2);
  assert.equal(db.read('projectRecords/PROJECT-1').serverVersion, 2);
  const replayed = await authority.createAppointment(args);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.appointmentId, booked.appointmentId);
  assert.equal(db.read('projectRecords/PROJECT-1').assignments.length, 1);
  assert.equal(db.read('projectRecords/PROJECT-1').scheduledFutureHours, 2);
});

test('office operator can reserve a Project Temporary Hold without bypassing the shared booking link', async () => {
  const { db, authority, request, context } = bookingFixture('operator');
  const offered = await authority.checkAvailability({ request, actor: { id: 'USER-1' }, context });
  const held = await authority.createAppointment({
    offerId: offered.offer.id, offerVersion: offered.offer.version,
    optionId: 'OPTION-1', idempotencyKey: 'operator-project-hold', createMode: 'temporary_hold',
    actor: { id: 'USER-1', source: 'office-scheduling' }, context,
  });
  assert.equal(held.success, true);
  assert.equal(db.read(`appointments/${held.appointmentId}`).status, 'temporary_hold');
  assert.equal(db.read(`appointments/${held.appointmentId}`).projectId, 'PROJECT-1');
  assert.equal(db.read('projectRecords/PROJECT-1').assignments[0].bookingStatus, 'temporary_hold');
  assert.equal(db.read(`projectBookingClaims/${held.appointmentId}`).projectId, 'PROJECT-1');
});

test('revoking the operator role after offer creation blocks commit without reserving capacity', async () => {
  const { db, authority, request, context } = bookingFixture('office');
  const offered = await authority.checkAvailability({ request, actor: { id: 'USER-1' }, context });
  db.store.set('users/USER-1', { role: 'technician', active: true });
  await assert.rejects(authority.createAppointment({
    offerId: offered.offer.id, offerVersion: offered.offer.version,
    optionId: 'OPTION-1', idempotencyKey: 'revoked-project-booking',
    actor: { id: 'USER-1', source: 'office-scheduling' }, context,
  }), error => error.code === 'permission_denied');
  assert.equal(db.read('projectRecords/PROJECT-1').assignments.length, 0);
  assert.equal([...db.store.keys()].some(key => key.startsWith('bookingCapacityLocks/')), false);
  assert.equal([...db.store.keys()].some(key => key.startsWith('appointments/')), false);
});

test('Project Booking Authority rejects unauthorized, inactive, mismatched and stale requests before writes', async () => {
  for (const role of ['technician', 'customer']) {
    const { db, authority, request, context } = bookingFixture(role);
    await assert.rejects(authority.checkAvailability({ request, actor: { id: 'USER-1' }, context }),
      error => error.code === 'permission_denied');
    assert.equal(db.read('projectRecords/PROJECT-1').assignments.length, 0);
  }
  const { db, authority, request, context } = bookingFixture();
  for (const invalid of [
    { request: { ...request, customerId: 'OTHER-CLIENT' }, context },
    { request: { ...request, project: { ...request.project, version: 2 } }, context },
    { request, context: { ...context, projectActorId: '' } },
    { request, context: { ...context, bookingMode: 'backdated' } },
  ]) {
    await assert.rejects(authority.checkAvailability({ ...invalid, actor: { id: 'USER-1' } }));
  }
  assert.equal(db.read('projectRecords/PROJECT-1').assignments.length, 0);
});

test('a deprovisioned operator cannot replay a Project appointment even with its idempotency key', async () => {
  const { db, authority, request, context } = bookingFixture('office');
  const offered = await authority.checkAvailability({ request, actor: { id: 'USER-1' }, context });
  const args = { offerId: offered.offer.id, offerVersion: offered.offer.version,
    optionId: 'OPTION-1', idempotencyKey: 'operator-project-replay',
    actor: { id: 'USER-1', source: 'office-scheduling' }, context };
  const booked = await authority.createAppointment(args);
  db.store.set('users/USER-1', { role: 'office', active: false });
  await assert.rejects(authority.createAppointment(args), error => error.code === 'permission_denied');
  assert.equal(db.read('projectRecords/PROJECT-1').assignments.length, 1);
  assert.equal(db.read(`appointments/${booked.appointmentId}`).projectId, 'PROJECT-1');
});
