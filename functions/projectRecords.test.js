'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectRecords } = require('./projectRecords');

class Snapshot {
  constructor(value) { this.exists = value !== undefined; this.value = value; }
  data() { return this.value; }
}

class FakeDb {
  constructor() {
    this.records = new Map([
      ['users/manager-1', { role: 'manager', active: true, name: 'Manager' }],
      ['clients/CLIENT-1', { active: true }],
      ['properties/PROPERTY-1', { active: true, clientId: 'CLIENT-1' }],
      ['properties/PROPERTY-2', { active: true, clientId: 'CLIENT-1' }],
      ['properties/FOREIGN', { active: true, clientId: 'CLIENT-2' }],
    ]);
  }
  collection(name) {
    return { doc: id => {
      if (!id) throw new Error('Empty Firestore document ID');
      return { path: `${name}/${id}`, get: async () => new Snapshot(this.records.get(`${name}/${id}`)) };
    } };
  }
  async runTransaction(callback) {
    const staged = [];
    const result = await callback({
      get: ref => ref.get(),
      set: (ref, value) => staged.push([ref.path, value]),
    });
    for (const [path, value] of staged) this.records.set(path, value);
    return result;
  }
  read(path) { return this.records.get(path); }
}

function draft(overrides = {}) {
  return {
    id: 'PROJECT-1', projectNumber: 'PRJ-1001', name: 'Customer Project',
    customerId: 'CLIENT-1', siteId: '', status: 'Draft',
    estimatedWorkDays: 1, estimatedSlots: 6, estimatedLaborHours: 6,
    totalUnits: 1, phases: [], assignments: [], ...overrides,
  };
}

test('a real shared Draft can be saved before its customer has a Service Property', async () => {
  const db = new FakeDb();
  const records = createProjectRecords({ db });
  const result = await records.save({ project: draft(), expectedVersion: 0, requestId: 'draft-1' }, 'manager-1');
  assert.equal(result.project.siteId, '');
  assert.equal(result.project.serverVersion, 1);
  assert.equal(db.read('projectRecords/PROJECT-1').siteId, '');
});

test('an unexecuted Draft can attach one active canonical property, then its identity is fixed', async () => {
  const db = new FakeDb();
  const records = createProjectRecords({ db });
  const created = await records.save({ project: draft(), expectedVersion: 0, requestId: 'draft-1' }, 'manager-1');
  const attached = await records.save({ project: { ...created.project, siteId: 'PROPERTY-1', location: 'Aruba' },
    expectedVersion: 1, requestId: 'attach-1' }, 'manager-1');
  assert.equal(attached.project.siteId, 'PROPERTY-1');
  assert.equal(attached.project.serverVersion, 2);
  await assert.rejects(records.save({ project: { ...attached.project, siteId: 'PROPERTY-2' },
    expectedVersion: 2, requestId: 'change-1' }, 'manager-1'), /identity cannot be changed/);
  assert.equal(db.read('projectRecords/PROJECT-1').siteId, 'PROPERTY-1');
});

test('a property-free Project cannot advance status or record operational activity', async () => {
  const db = new FakeDb();
  const records = createProjectRecords({ db });
  await assert.rejects(records.save({ project: draft({ status: 'Planned' }), expectedVersion: 0, requestId: 'planned-1' }, 'manager-1'), /unexecuted Draft/);
  await assert.rejects(records.save({ project: draft({ scheduledFutureHours: 1 }), expectedVersion: 0, requestId: 'booked-1' }, 'manager-1'), /unexecuted Draft/);
  assert.equal(db.read('projectRecords/PROJECT-1'), undefined);
});

test('a foreign property cannot be attached to a Draft', async () => {
  const db = new FakeDb();
  const records = createProjectRecords({ db });
  const created = await records.save({ project: draft(), expectedVersion: 0, requestId: 'draft-1' }, 'manager-1');
  await assert.rejects(records.save({ project: { ...created.project, siteId: 'FOREIGN' },
    expectedVersion: 1, requestId: 'foreign-1' }, 'manager-1'), /active Service Property belonging to this customer/);
  assert.equal(db.read('projectRecords/PROJECT-1').siteId, '');
});

test('legacy property-free records with operational activity cannot be relinked through planning', async () => {
  const db = new FakeDb();
  const existing = draft({ serverVersion: 1, scheduledFutureHours: 1 });
  db.records.set('projectRecords/PROJECT-1', existing);
  const records = createProjectRecords({ db });
  await assert.rejects(records.save({ project: { ...existing, siteId: 'PROPERTY-1' },
    expectedVersion: 1, requestId: 'late-attach-1' }, 'manager-1'), /identity cannot be changed/);
  assert.equal(db.read('projectRecords/PROJECT-1').siteId, '');
});

test('only an unexecuted Draft may attach its first property', async () => {
  const db = new FakeDb();
  const existing = draft({ status: 'Planned', serverVersion: 1 });
  db.records.set('projectRecords/PROJECT-1', existing);
  const records = createProjectRecords({ db });
  await assert.rejects(records.save({ project: { ...existing, siteId: 'PROPERTY-1' },
    expectedVersion: 1, requestId: 'planned-attach-1' }, 'manager-1'), /identity cannot be changed/);
  assert.equal(db.read('projectRecords/PROJECT-1').siteId, '');
});

test('direct planning API cannot change identity or lifecycle after Project activity', async () => {
  const db = new FakeDb();
  const existing = draft({ siteId: 'PROPERTY-1', status: 'Active', serverVersion: 1,
    type: 'Service Project', location: 'Existing CRM location', scheduledFutureHours: 2 });
  db.records.set('projectRecords/PROJECT-1', existing);
  const records = createProjectRecords({ db });
  for (const [field, value] of [['type', 'Installation Project'], ['location', 'Another location'], ['status', 'Completed']]) {
    await assert.rejects(records.save({ project: { ...existing, [field]: value },
      expectedVersion: 1, requestId: `bypass-${field}` }, 'manager-1'), /cannot change through planning after operational activity/);
  }
  assert.deepEqual(db.read('projectRecords/PROJECT-1'), existing);
});

test('an active Project can still update future-visit instructions without rewriting its booking plan', async () => {
  const db = new FakeDb();
  const existing = draft({ siteId: 'PROPERTY-1', status: 'Active', serverVersion: 1,
    type: 'Service Project', location: 'Existing CRM location', scheduledFutureHours: 2,
    technicianInstructions: 'Old instructions' });
  db.records.set('projectRecords/PROJECT-1', existing);
  const records = createProjectRecords({ db });
  const result = await records.save({ project: { ...existing, name: 'Updated Project Name',
    description: 'Revised scope', technicianInstructions: 'Use the west gate' },
  expectedVersion: 1, requestId: 'edit-instructions-1' }, 'manager-1');
  assert.equal(result.project.name, 'Updated Project Name');
  assert.equal(result.project.description, 'Revised scope');
  assert.equal(result.project.technicianInstructions, 'Use the west gate');
  assert.equal(result.project.scheduledFutureHours, 2);
  assert.equal(result.project.siteId, existing.siteId);
});

test('direct planning API cannot mark an unexecuted Project Completed', async () => {
  const db = new FakeDb();
  const existing = draft({ siteId: 'PROPERTY-1', serverVersion: 1 });
  db.records.set('projectRecords/PROJECT-1', existing);
  const records = createProjectRecords({ db });
  await assert.rejects(records.save({ project: { ...existing, status: 'Completed' },
    expectedVersion: 1, requestId: 'complete-1' }, 'manager-1'), /dedicated completion workflow/);
  assert.deepEqual(db.read('projectRecords/PROJECT-1'), existing);
});

test('direct planning API cannot reduce a published Project slot budget', async () => {
  const db = new FakeDb();
  const existing = draft({ siteId: 'PROPERTY-1', serverVersion: 1, estimatedWorkDays: 2,
    estimatedSlots: 12, estimatedLaborHours: 12 });
  db.records.set('projectRecords/PROJECT-1', existing);
  const records = createProjectRecords({ db });
  await assert.rejects(records.save({ project: { ...existing, estimatedWorkDays: 1,
    estimatedSlots: 6, estimatedLaborHours: 6 }, expectedVersion: 1, requestId: 'reduce-1' }, 'manager-1'), /Reducing a shared Project slot budget/);
  assert.deepEqual(db.read('projectRecords/PROJECT-1'), existing);
});
