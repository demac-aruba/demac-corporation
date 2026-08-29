const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createWorkOrderApplicationService,
} = require("./workOrderApplicationService");

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

class FakeCollectionRef {
  constructor(db, name) { this.db = db; this.name = name; }
  doc(id) { return new FakeDocRef(this.db, this.name, id); }
  async get() {
    const prefix = `${this.name}/`;
    const docs = [];
    for (const [path, value] of this.db.store.entries()) {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) continue;
      const id = path.slice(prefix.length);
      docs.push(new FakeSnapshot(id, value, new FakeDocRef(this.db, this.name, id)));
    }
    return { docs };
  }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.writes = []; }
  async get(ref) { return ref.get(); }
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

const WORK_DATE = "2026-08-27";
const WORK_ORDER_ID = "WO-APT-AH-TEST-1";
const APPOINTMENT_ID = "APT-AH-TEST-1";
const GUARD_ID = "BAH-GUARD-1";
const CREW = ["driver-1", "helper-1", "helper-2"];

function seed(extra = {}) {
  return {
    [`workOrders/${WORK_ORDER_ID}`]: {
      id: WORK_ORDER_ID,
      appointmentId: APPOINTMENT_ID,
      date: WORK_DATE,
      time: "17:30",
      afterHoursStartTime: "17:30",
      afterHoursKind: "after_hours_emergency",
      afterHoursOpenEnded: true,
      afterHoursGuardId: GUARD_ID,
      actualCompletedAt: null,
      vanId: "VAN-1",
      technicianIds: CREW,
      status: "Confirmada",
    },
    [`appointments/${APPOINTMENT_ID}`]: {
      id: APPOINTMENT_ID,
      appointmentId: APPOINTMENT_ID,
      date: WORK_DATE,
      startTime: "17:30",
      afterHoursKind: "after_hours_emergency",
      afterHoursOpenEnded: true,
      actualCompletedAt: null,
      status: "confirmed",
    },
    [`bookingCapacityLocks/${GUARD_ID}`]: {
      id: GUARD_ID,
      appointmentId: APPOINTMENT_ID,
      workOrderId: WORK_ORDER_ID,
      active: true,
      openEnded: true,
    },
    "staffProfiles/driver-1": { id: "driver-1", name: "Miguel Reyes", active: true },
    "staffProfiles/helper-1": { id: "helper-1", name: "Alan Baquero", active: true },
    "staffProfiles/helper-2": { id: "helper-2", name: "Third Helper", active: true },
    ...extra,
  };
}

function fixture(extra = {}, clock = "2026-08-27T23:15:00.000Z") {
  const db = new FakeFirestore(seed(extra));
  const service = createWorkOrderApplicationService({ db, clock: () => new Date(clock) });
  return { db, service };
}

function input(actor = { uid: "tech-user-1", role: "technician", staffId: "driver-1", name: "Miguel" }) {
  return { requestId: "complete-after-hours-0001", workOrderId: WORK_ORDER_ID, actor };
}

function existingAttendance(overrides = {}) {
  return {
    id: `driver-1_${WORK_DATE}`,
    employeeId: "driver-1",
    employeeName: "Miguel Reyes",
    date: WORK_DATE,
    payrollPeriodId: "2026-07-27_2026-08-26",
    scheduledWorkHours: 8,
    paidFreeHours: 0,
    regularHours: 8,
    overtimeMinutes: 0,
    overtimeHours: 0,
    aoHours: 0,
    vacationHours: 0,
    noWorkNoPayHours: 0,
    status: "Regular",
    attendanceStatus: "Present",
    clockInTime: "08:00",
    clockOutTime: "17:00",
    breakMinutes: 60,
    updatedAt: "2026-08-27T21:00:00.000Z",
    ...overrides,
  };
}

test("canonical after-hours completion closes the Work Order, releases capacity and writes attendance evidence", async () => {
  const { db, service } = fixture();
  const result = await service.completeAfterHours(input());

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.afterHoursWorkedMinutes, 105);
  assert.deepEqual(result.technicianIds, CREW);
  assert.deepEqual(result.timesheets.map((entry) => entry.id), CREW.map((staffId) => `${staffId}_${WORK_DATE}`));

  const workOrder = db.read(`workOrders/${WORK_ORDER_ID}`);
  assert.equal(workOrder.status, "Completada");
  assert.equal(workOrder.lifecycle, "technician_complete");
  assert.equal(workOrder.afterHoursWorkedMinutes, 105);
  assert.equal(workOrder.actualCompletedAt, "2026-08-27T23:15:00.000Z");

  const appointment = db.read(`appointments/${APPOINTMENT_ID}`);
  assert.equal(appointment.lifecycleStatus, "technician_complete");
  assert.equal(appointment.afterHoursWorkedMinutes, 105);
  assert.equal(appointment.actualCompletedAt, "2026-08-27T23:15:00.000Z");

  const guard = db.read(`bookingCapacityLocks/${GUARD_ID}`);
  assert.equal(guard.active, false);
  assert.equal(guard.releaseReason, "after-hours-work-order-completed");

  for (const staffId of CREW) {
    const entry = db.read(`employeeTimesheets/${staffId}_${WORK_DATE}`);
    assert.equal(entry.employeeId, staffId);
    assert.equal(entry.scheduledWorkHours, 8);
    assert.equal(entry.regularHours, 0, "Work Order completion must not fabricate regular attendance hours.");
    assert.equal(entry.overtimeMinutes, 105);
    assert.equal(entry.overtimeHours, 1.75);
    assert.equal(entry.clockOutTime, undefined, "Work Order evidence must not extend Clock Out across an unproven gap.");
    assert.equal(entry.scheduledStartTime, "08:00");
    assert.equal(entry.scheduledEndTime, "17:00");
    assert.equal(entry.scheduledBreakMinutes, 60);
    assert.equal(entry.overtimeCalculationSource, "attendance_authority_with_work_segments");
    assert.equal(entry.overtimeReconciliationRequired, false);
    assert.equal(entry.workOrderAttendanceSegments.length, 1);
    assert.deepEqual(entry.workOrderAttendanceSegments[0], {
      workOrderId: WORK_ORDER_ID,
      appointmentId: APPOINTMENT_ID,
      kind: "after_hours_emergency",
      startDate: WORK_DATE,
      startTime: "17:30",
      endDate: WORK_DATE,
      endTime: "19:15",
      completedAt: "2026-08-27T23:15:00.000Z",
    });
  }
});

test("completion uses the Van/team partial-day schedule snapshot without converting the gap into overtime", async () => {
  const { db, service } = fixture({
    "vanHalfDaySchedules/van1-thursday": {
      id: "van1-thursday",
      vanId: "VAN-1",
      weekday: 4,
      workdayStart: "08:00",
      workdayEnd: "13:00",
      active: true,
    },
  });
  const result = await service.completeAfterHours(input());
  assert.equal(result.afterHoursWorkedMinutes, 105);
  const entry = db.read(`employeeTimesheets/driver-1_${WORK_DATE}`);
  assert.equal(entry.scheduledWorkHours, 5);
  assert.equal(entry.regularHours, 0);
  assert.equal(entry.overtimeMinutes, 105, "Only the evidenced 17:30–19:15 segment is overtime; 13:00–17:30 is not fabricated work.");
  assert.equal(entry.scheduledStartTime, "08:00");
  assert.equal(entry.scheduledEndTime, "13:00");
  assert.equal(entry.scheduleSnapshotSource, "van_team_partial_day");
});

test("existing attendance and after-hours evidence are unioned without double counting overlap", async () => {
  const existingId = `driver-1_${WORK_DATE}`;
  const { db, service } = fixture({
    [`employeeTimesheets/${existingId}`]: existingAttendance({
      clockOutTime: "18:00",
      overtimeMinutes: 60,
      overtimeHours: 1,
      workedMinutes: 540,
      overtimeCalculationSource: "attendance_authority",
    }),
  });
  await service.completeAfterHours(input());
  const entry = db.read(`employeeTimesheets/${existingId}`);
  assert.equal(entry.overtimeMinutes, 135, "08:00–18:00 contributes 60 minutes and only 18:00–19:15 adds another 75 minutes.");
  assert.equal(entry.overtimeHours, 2.25);
  assert.equal(entry.clockOutTime, "18:00", "Completion must preserve the separately recorded attendance Clock Out.");
  assert.equal(entry.workOrderAttendanceSegments.length, 1);
  assert.equal(entry.overtimeReconciliationRequired, false);
});

test("work-order evidence fully covered by the attendance interval is not added twice", async () => {
  const existingId = `driver-1_${WORK_DATE}`;
  const { db, service } = fixture({
    [`employeeTimesheets/${existingId}`]: existingAttendance({
      clockOutTime: "19:15",
      overtimeMinutes: 135,
      overtimeHours: 2.25,
      workedMinutes: 615,
      overtimeCalculationSource: "attendance_authority",
    }),
  });
  await service.completeAfterHours(input());
  const entry = db.read(`employeeTimesheets/${existingId}`);
  assert.equal(entry.overtimeMinutes, 135);
  assert.equal(entry.overtimeHours, 2.25);
});

test("legacy overtime without a valid Clock In/Out is preserved conservatively and flagged for reconciliation", async () => {
  const existingId = `driver-1_${WORK_DATE}`;
  const { db, service } = fixture({
    [`employeeTimesheets/${existingId}`]: existingAttendance({
      clockInTime: undefined,
      clockOutTime: undefined,
      overtimeMinutes: 30,
      overtimeHours: 0.5,
      overtimeCalculationSource: undefined,
    }),
  });
  await service.completeAfterHours(input());
  const entry = db.read(`employeeTimesheets/${existingId}`);
  assert.equal(entry.overtimeMinutes, 105, "Unknown legacy overtime must not be blindly added to the 105-minute Work Order segment.");
  assert.equal(entry.overtimeReconciliationRequired, true);
});

test("technician cannot complete an after-hours Work Order assigned to another crew", async () => {
  const { service } = fixture();
  await assert.rejects(
    service.completeAfterHours(input({ uid: "tech-user-x", role: "technician", staffId: "other-staff", name: "Other" })),
    (error) => error.code === "permission_denied" && error.status === 403,
  );
});

test("replaying completion does not duplicate attendance evidence", async () => {
  const { db, service } = fixture();
  const first = await service.completeAfterHours(input());
  const second = await service.completeAfterHours(input());
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  const entry = db.read(`employeeTimesheets/driver-1_${WORK_DATE}`);
  assert.equal(entry.overtimeMinutes, 105);
  assert.equal(entry.workOrderAttendanceSegments.length, 1);
});

test("after-hours evidence and payroll overtime remain correct when work finishes after midnight", async () => {
  const { db, service } = fixture({}, "2026-08-28T04:30:00.000Z");
  const result = await service.completeAfterHours(input());
  assert.equal(result.afterHoursWorkedMinutes, 420);
  const entry = db.read(`employeeTimesheets/driver-1_${WORK_DATE}`);
  assert.equal(entry.overtimeMinutes, 420);
  assert.equal(entry.overtimeHours, 7);
  assert.equal(entry.clockOutTime, undefined);
  assert.equal(entry.workOrderAttendanceSegments[0].endDate, "2026-08-28");
  assert.equal(entry.workOrderAttendanceSegments[0].endTime, "00:30");
  assert.equal(entry.workOrderAttendanceSegments[0].completedAt, "2026-08-28T04:30:00.000Z");
});
