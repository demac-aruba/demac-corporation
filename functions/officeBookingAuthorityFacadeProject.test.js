const assert = require("node:assert/strict");
const test = require("node:test");
const { createOfficeBookingAuthorityFacade } = require("./officeBookingAuthorityFacade");
const { GENERAL_PHASE } = require("./projectRecords");

// Exercise the production facade, wrapper, provider and transaction together.
// Only Firestore and Firebase token verification are replaced with test doubles.
class FakeSnapshot {
  constructor(id, value, ref = null) {
    this.id = id;
    this._value = value;
    this.exists = value !== undefined;
    this.ref = ref;
  }
  data() { return this._value; }
}

class FakeDocRef {
  constructor(db, collection, id) {
    this.db = db;
    this.collectionName = collection;
    this.id = id;
  }
  key() { return `${this.collectionName}/${this.id}`; }
  async get() { return new FakeSnapshot(this.id, this.db.store.get(this.key()), this); }
  async set(value, options) {
    const current = this.db.store.get(this.key());
    this.db.store.set(this.key(), options?.merge ? { ...(current || {}), ...value } : value);
  }
}

class FakeQuery {
  constructor(db, collection, filters = []) {
    this.db = db;
    this.collectionName = collection;
    this.filters = filters;
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.collectionName, [...this.filters, { field, operator, value }]);
  }
  async get() {
    const prefix = `${this.collectionName}/`;
    const docs = [];
    for (const [path, value] of this.db.store.entries()) {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) continue;
      const matches = this.filters.every((filter) => {
        const actual = value?.[filter.field];
        if (filter.operator === "==") return actual === filter.value;
        if (filter.operator === ">=") return actual >= filter.value;
        if (filter.operator === "<=") return actual <= filter.value;
        throw new Error(`Unsupported fake query operator ${filter.operator}`);
      });
      if (!matches) continue;
      const id = path.slice(prefix.length);
      const ref = new FakeDocRef(this.db, this.collectionName, id);
      docs.push(new FakeSnapshot(id, value, ref));
    }
    return { docs };
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(db, name) {
    super(db, name, []);
    this.name = name;
  }
  doc(id) { return new FakeDocRef(this.db, this.name, id); }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.writes = []; }
  async get(ref) {
    assert.equal(this.writes.length, 0, "Transactions must read before writing");
    return ref.get();
  }
  set(ref, value, options) { this.writes.push({ ref, value, options }); }
  async commit() {
    for (const write of this.writes) await write.ref.set(write.value, write.options);
  }
}

class FakeFirestore {
  constructor(seed = {}) { this.store = new Map(Object.entries(seed)); }
  collection(name) { return new FakeCollectionRef(this, name); }
  async runTransaction(callback) {
    const transaction = new FakeTransaction(this);
    const result = await callback(transaction);
    await transaction.commit();
    return result;
  }
  read(path) { return this.store.get(path); }
}

const DATE = "2098-12-22";

function fixture(role = "office_operator", active = true) {
  const db = new FakeFirestore({
    "users/office-1": { role, active, name: "Test Office User" },
    "clients/client-1": { name: "Test Customer", active: true },
    "properties/property-1": { clientId: "client-1", address: "Test address", operationalZone: "Oranjestad", active: true },
    "vans/VAN-1": { name: "Van 1", active: true, status: "Disponible", responsibleStaffId: "driver-1" },
    "staffProfiles/driver-1": { name: "Test Driver", active: true, availability: "Disponible", canDriveVan: true },
    "businessSettings/business-calendar": { closedWeekdays: [0] },
    "projectRecords/PROJECT-1": {
      id: "PROJECT-1", projectNumber: "PRJ-TEST", name: "Test Service Project",
      customerId: "client-1", siteId: "property-1", status: "Draft", serverVersion: 1,
      phases: [], assignments: [], assignedVans: [], scheduledFutureHours: 0,
      estimatedSlots: 6, estimatedLaborHours: 6, slotDurationMinutes: 60, slotsPerWorkDay: 6,
    },
    // The 13:30 slot is occupied; only 14:30 and 15:30 remain in the afternoon.
    "workOrders/WO-EXISTING": {
      id: "WO-EXISTING", appointmentId: "APT-EXISTING", vanId: "VAN-1", date: DATE,
      time: "13:30", status: "Confirmada", technicianIds: ["driver-1"],
      appointmentDurationMinutes: 60, appointmentEndTime: "14:30", appointmentCapacityEndTime: "14:30",
      scheduledSlots: 1, propertyId: "property-1", clientId: "client-1",
    },
  });
  const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async () => ({ uid: "office-1" }) });
  const call = (action, data) => facade.handle({ method: "POST", headers: { authorization: "Bearer test-token" }, body: { action, data } });
  const data = {
    requestId: "project-facade-availability", customerId: "client-1", propertyId: "property-1",
    project: { id: "PROJECT-1", phaseId: GENERAL_PHASE, version: 1 },
    workLines: [{ presetId: "other", quantity: 1, manualDurationMinutes: 120, customerFacingDescription: "Test Project work" }],
    requestedDate: DATE, requestedTime: "14:30", requiredVanId: "VAN-1",
  };
  return { db, call, data };
}

async function offer(f) {
  const response = await f.call("check_availability", f.data);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.available, true, JSON.stringify(response.body));
  const option = response.body.options.find(item => item.date === DATE && item.time === "14:30"
    && item.assignments.length === 1 && item.assignments[0].vanId === "VAN-1");
  assert.ok(option, "The two remaining afternoon slots must be offered");
  assert.equal(option.assignments[0].slots, 2);
  assert.equal(option.capacityEndTime, "16:30");
  return { requestId: "project-facade-create", offerId: response.body.offer.id,
    offerVersion: response.body.offer.version, optionId: option.id };
}

function assertNoBooking(db) {
  assert.equal([...db.store.keys()].some(key => key.startsWith("appointments/")), false);
  assert.equal([...db.store.keys()].some(key => key.startsWith("bookingCapacityLocks/")), false);
  assert.equal([...db.store.keys()].some(key => key.startsWith("projectBookingClaims/")), false);
  assert.equal(db.read("projectRecords/PROJECT-1").assignments.length, 0);
}

test("production facade offers and books two remaining afternoon slots for a published Draft Project", async () => {
  const f = fixture();
  const input = await offer(f);
  assertNoBooking(f.db);
  const response = await f.call("create_appointment", input);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const { appointmentId, workOrderIds } = response.body;
  const appointment = f.db.read(`appointments/${appointmentId}`);
  assert.equal(appointment.projectId, "PROJECT-1");
  assert.equal(appointment.status, "confirmed");
  assert.equal(workOrderIds.length, 1);
  assert.equal(f.db.read(`workOrders/${workOrderIds[0]}`).projectId, "PROJECT-1");
  assert.equal(f.db.read(`workOrders/${workOrderIds[0]}`).scheduledSlots, 2);
  assert.equal(f.db.read(`projectBookingClaims/${appointmentId}`).projectId, "PROJECT-1");
  assert.deepEqual(appointment.capacityLockIds.map(id => f.db.read(`bookingCapacityLocks/${id}`).slot).sort(), ["14:30", "15:30"]);
  const project = f.db.read("projectRecords/PROJECT-1");
  assert.equal(project.status, "Planned");
  assert.equal(project.serverVersion, 2);
  assert.equal(project.scheduledFutureHours, 2);
  assert.equal(project.assignments.length, 1);
  assert.equal(project.assignments[0].scheduledSlots, 2);
  assert.equal(project.assignments[0].scheduledStart, "14:30");
  assert.equal(project.assignments[0].scheduledEnd, "16:30");
  const replay = await f.call("create_appointment", input);
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.appointmentId, appointmentId);
  assert.equal(f.db.read("projectRecords/PROJECT-1").assignments.length, 1);
  assert.equal(f.db.read("projectRecords/PROJECT-1").scheduledFutureHours, 2);
});

test("production facade reserves a linked Project temporary hold through the same provider", async () => {
  const f = fixture();
  const input = await offer(f);
  const response = await f.call("create_temporary_hold", input);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const appointment = f.db.read(`appointments/${response.body.appointmentId}`);
  assert.equal(appointment.status, "temporary_hold");
  assert.equal(appointment.projectId, "PROJECT-1");
  assert.equal(appointment.capacityLockIds.length, 2);
  assert.equal(f.db.read("projectRecords/PROJECT-1").assignments[0].bookingStatus, "temporary_hold");
});

test("production facade rejects stale Project versions before committing any booking", async () => {
  const f = fixture();
  const input = await offer(f);
  f.db.store.set("projectRecords/PROJECT-1", { ...f.db.read("projectRecords/PROJECT-1"), serverVersion: 2 });
  const response = await f.call("create_appointment", input);
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "conflict");
  assertNoBooking(f.db);
});

test("production facade keeps Project provisioning and CRM identity validation", async () => {
  for (const invalid of ["unprovisioned", "customer-mismatch", "missing-project"]) {
    const f = fixture();
    if (invalid === "unprovisioned") f.db.store.set("users/office-1", { role: "office_operator" });
    if (invalid === "customer-mismatch") f.db.store.set("projectRecords/PROJECT-1", { ...f.db.read("projectRecords/PROJECT-1"), customerId: "other-client" });
    if (invalid === "missing-project") f.data.project.id = "MISSING-PROJECT";
    const response = await f.call("check_availability", f.data);
    assert.equal(response.body.success, false, invalid);
    assert.equal(response.body.error.code, invalid === "unprovisioned" ? "permission_denied" : "invalid_request", invalid);
    assert.equal([...f.db.store.keys()].some(key => key.startsWith("bookingOffers/")), false);
    assertNoBooking(f.db);
  }
});

test("production facade rejects revoked Project scheduling access after an offer", async () => {
  const f = fixture();
  const input = await offer(f);
  f.db.store.set("users/office-1", { role: "office_operator", active: false });
  const response = await f.call("create_appointment", input);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, "permission_denied");
  assertNoBooking(f.db);
});

test("production facade preserves capacity conflicts for Project bookings", async () => {
  const f = fixture();
  const input = await offer(f);
  f.db.store.set("workOrders/WO-CONFLICT", { ...f.db.read("workOrders/WO-EXISTING"),
    id: "WO-CONFLICT", appointmentId: "APT-CONFLICT", time: "15:30",
    appointmentEndTime: "16:30", appointmentCapacityEndTime: "16:30" });
  const response = await f.call("create_appointment", input);
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "availability_changed");
  assertNoBooking(f.db);
});

test("production facade continues to book regular work without a Project link", async () => {
  const f = fixture();
  delete f.data.project;
  const input = await offer(f);
  const response = await f.call("create_appointment", input);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(f.db.read(`appointments/${response.body.appointmentId}`).projectId, undefined);
  assert.equal(f.db.read("projectRecords/PROJECT-1").serverVersion, 1);
  assert.equal(f.db.read("projectRecords/PROJECT-1").assignments.length, 0);
});

function restProjectFixture(role = 'office_operator', active = true) {
  const f = fixture(role, active);
  f.db.store.delete('workOrders/WO-EXISTING');
  f.db.store.set('vanHalfDaySchedules/REST', { vanId: 'VAN-1', weekday: new Date(`${DATE}T12:00:00Z`).getUTCDay(), active: true, workdayStart: '08:00', workdayEnd: '13:00' });
  f.data.requestId = 'project-rest-overtime-create';
  f.data.requestedTime = '13:30';
  return f;
}
async function prepareProjectOvertime(f) {
  const before = structuredClone([...f.db.store.entries()]);
  const response = await f.call('prepare_rest_day_overtime', f.data);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual([...f.db.store.entries()], before, 'Preparation must write nothing');
  return { ...f.data, overtimeConsent: { accepted: true, confirmationToken: response.body.proposal.confirmationToken } };
}

test('weekly-rest Project booking atomically links Project, phase, appointment, work order and all slots; exact replay is unique', async () => {
  for (const slots of [1, 2, 3, 4]) {
    const f = restProjectFixture();
    f.db.store.get('projectRecords/PROJECT-1').phases = [{ id: 'PHASE-1', name: 'Installation', status: 'Planned' }];
    f.data.project.phaseId = 'PHASE-1';
    f.data.workLines[0].manualDurationMinutes = slots * 60;
    const input = await prepareProjectOvertime(f);
    const response = await f.call('create_rest_day_overtime', input);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const { appointmentId, workOrderIds, appointment, workOrder } = response.body;
    assert.equal(appointment.projectId, 'PROJECT-1');
    assert.equal(workOrder.projectPhaseId, 'PHASE-1');
    assert.equal(appointment.scheduledOvertime.accepted, true);
    assert.equal(appointment.scheduledOvertime.kind, 'weekly_rest_overtime');
    assert.equal(appointment.capacityLockIds.length, slots);
    const project = f.db.read('projectRecords/PROJECT-1');
    assert.equal(project.assignments.length, 1);
    assert.equal(project.assignments[0].workOrderId, workOrderIds[0]);
    assert.equal(project.assignments[0].scheduledHours, slots);
    assert.equal(project.assignments[0].scheduledEnd, `${13 + slots}:30`);
    assert.equal(project.scheduledFutureHours, slots);
    assert.equal(f.db.read(`projectBookingClaims/${appointmentId}`).projectId, project.id);
    const retry = await f.call('create_rest_day_overtime', input);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.replayed, true);
    assert.equal(f.db.read('projectRecords/PROJECT-1').serverVersion, 2);
    assert.equal(f.db.read('projectRecords/PROJECT-1').assignments.length, 1);
    assert.equal([...f.db.store.keys()].some(key => /employeeTimesheets|whatsappOutboundQueue/.test(key)), false);
  }
});

test('weekly-rest Project rejects missing consent and changed scope/Project on consent or replay', async () => {
  const f = restProjectFixture();
  const input = await prepareProjectOvertime(f);
  assert.notEqual((await f.call('create_rest_day_overtime', f.data)).status, 200);
  for (const changed of [
    { project: { ...input.project, phaseId: 'GENERAL-PROJECT-WORK-CHANGED' } },
    { project: { ...input.project, version: 2 } },
    { workLines: [{ ...input.workLines[0], manualDurationMinutes: 180 }] },
  ]) {
    assert.notEqual((await f.call('create_rest_day_overtime', { ...input, ...changed })).status, 200);
    assertNoBooking(f.db);
  }
  assert.equal((await f.call('create_rest_day_overtime', input)).status, 200);
  assert.notEqual((await f.call('create_rest_day_overtime', { ...input, project: undefined })).status, 200);
  assert.equal(f.db.read('projectRecords/PROJECT-1').assignments.length, 1);
});

test('weekly-rest Project revalidates authority, version, identity, phase, status and link limits without partial writes', async () => {
  const changes = [
    f => f.db.store.get('users/office-1').active = false,
    f => f.db.store.get('users/office-1').role = 'technician',
    f => f.db.store.get('projectRecords/PROJECT-1').serverVersion++,
    f => f.db.store.get('projectRecords/PROJECT-1').customerId = 'OTHER',
    f => f.db.store.get('projectRecords/PROJECT-1').siteId = 'OTHER',
    f => f.db.store.get('projectRecords/PROJECT-1').status = 'Completed',
    f => f.db.store.get('projectRecords/PROJECT-1').assignments = Array.from({ length: 150 }, () => ({})),
    f => f.db.store.delete('projectRecords/PROJECT-1'),
    f => f.db.store.set('workOrders/CONFLICT', { clientId: 'client-1', propertyId: 'property-1', date: DATE, time: '14:30', vanId: 'VAN-1', status: 'Confirmada', technicianIds: ['driver-1'], appointmentDurationMinutes: 60, scheduledSlots: 1 }),
  ];
  for (const change of changes) {
    const f = restProjectFixture();
    const input = await prepareProjectOvertime(f);
    change(f);
    const before = structuredClone([...f.db.store.entries()]);
    assert.notEqual((await f.call('create_rest_day_overtime', input)).status, 200);
    assert.deepEqual([...f.db.store.entries()], before);
  }
});

test('weekly-rest Project preparation denies unprovisioned scheduler; retry rechecks Project permission', async () => {
  const denied = restProjectFixture('office_operator', undefined);
  delete denied.db.store.get('users/office-1').active;
  assert.notEqual((await denied.call('prepare_rest_day_overtime', denied.data)).status, 200);
  assertNoBooking(denied.db);
  const f = restProjectFixture();
  const input = await prepareProjectOvertime(f);
  assert.equal((await f.call('create_rest_day_overtime', input)).status, 200);
  delete f.db.store.get('users/office-1').active;
  assert.notEqual((await f.call('create_rest_day_overtime', input)).status, 200);
});

test('unsupported special modes reject Project metadata instead of silently creating an unlinked booking', async () => {
  for (const action of ['create_after_hours_emergency', 'prepare_capacity_overtime', 'create_capacity_overtime']) {
    const f = restProjectFixture();
    assert.notEqual((await f.call(action, f.data)).status, 200);
    assertNoBooking(f.db);
  }
});
