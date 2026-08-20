const test = require("node:test");
const assert = require("node:assert/strict");
const { BOOKING_ERROR_CODES } = require("./bookingAuthorityCore");
const { CANONICAL_SCHEDULING_ENGINE_VERSION } = require("./bookingAuthoritySchedulingEngine");
const {
  SCHEDULING_PROVIDER_VERSION,
  buildCapacityLocks,
  buildWorkOrders,
  exactCustomerProperty,
  operationalMoveDateAllowed,
  operationalMoveResult,
  routeConfigFromSettings,
} = require("./bookingAuthoritySchedulingProvider");

function request() {
  return {
    customerId: "c1",
    propertyId: "p1",
    workLines: [{ id: "w1", presetId: "standard_service", serviceId: "s1", quantity: 2 }],
    constraints: { preferredTime: "afternoon" },
  };
}

function option() {
  return {
    id: "o1",
    date: "2098-12-20",
    time: "13:30",
    endTime: "15:30",
    address: "Wayaca 217",
    zone: "Oranjestad",
    presetId: "standard_service",
    presetLabel: "Servicio estándar",
    serviceId: "s1",
    durationMinutesPerUnit: 60,
    assignments: [{
      vanId: "V2",
      technicianIds: ["t1", "t2"],
      quantity: 2,
      slots: 2,
      fullDay: false,
    }],
  };
}

function operationalData(overrides = {}) {
  return {
    workOrders: [],
    services: [{ id: "s1", name: "Servicio estándar", durationMinutes: 60 }],
    properties: [{ id: "p1", clientId: "c1", address: "Wayaca 217", operationalZone: "Oranjestad" }],
    clients: [{ id: "c1", name: "Test Customer" }],
    vans: [{ id: "VAN-2", name: "Van 2", active: true }],
    staffProfiles: [],
    dailyVanAssignments: [],
    staffAbsences: [],
    calendarClosures: [],
    vanHalfDaySchedules: [],
    businessSettings: [{
      id: "appointment-work-presets",
      presets: [{ id: "standard_service", label: "Servicio estándar", durationMinutesPerUnit: 60, active: true }],
    }],
    ...overrides,
  };
}

const currentSchedule = { date: "2098-12-20", time: "08:30" };

test("provider exposes canonical provider v8", () => {
  assert.equal(SCHEDULING_PROVIDER_VERSION, "erp-booking-scheduling-provider-v8");
});

test("canonical scheduling engine is versioned independently", () => {
  assert.equal(CANONICAL_SCHEDULING_ENGINE_VERSION, 5);
});

test("provider verifies the exact ERP customer/property relationship", () => {
  const pair = exactCustomerProperty({
    clients: [{ id: "c1" }],
    properties: [{ id: "p1", clientId: "c1" }],
  }, request());
  assert.equal(pair.property.id, "p1");

  assert.throws(
    () => exactCustomerProperty({
      clients: [{ id: "c1" }],
      properties: [{ id: "p1", clientId: "other" }],
    }, request()),
    (error) => error.code === BOOKING_ERROR_CODES.PROPERTY_CUSTOMER_MISMATCH,
  );
});

test("capacity locks cover every occupied van slot", () => {
  const locks = buildCapacityLocks(option(), []);
  assert.equal(locks.length, 2);
  assert.deepEqual(locks.map((item) => item.slot), ["13:30", "14:30"]);
  assert.equal(new Set(locks.map((item) => item.id)).size, 2);
});

test("work orders link to canonical appointment and only the primary order notifies client", () => {
  const selected = {
    ...option(),
    assignments: [
      ...option().assignments,
      { vanId: "V3", technicianIds: ["t3"], quantity: 1, slots: 1, fullDay: false },
    ],
  };
  const orders = buildWorkOrders({
    appointment: { appointmentId: "APT-1" },
    option: selected,
    request: request(),
    customer: { id: "c1", name: "Richard", whatsapp: "+2975600000" },
    property: { id: "p1", address: "Wayaca 217" },
    now: new Date("2098-12-01T12:00:00Z"),
  });
  assert.equal(orders.length, 2);
  assert.equal(orders[0].appointmentId, "APT-1");
  assert.equal(orders[0].appointmentAssignmentRole, "primary");
  assert.equal(orders[0].whatsappNotificationsEnabled, true);
  assert.equal(orders[1].appointmentAssignmentRole, "support");
  assert.equal(orders[1].whatsappNotificationsEnabled, false);
  assert.equal(orders[1].parentWorkOrderId, "WO-APT-1-1");
});

test("manual operator drag can place work on an active van before a driver is assigned", () => {
  const data = operationalData();
  const result = operationalMoveResult({
    request: request(),
    property: data.properties[0],
    data,
    routeConfig: routeConfigFromSettings(data.businessSettings),
    date: "2098-12-20",
    time: "13:30",
    vanId: "VAN-2",
    currentSchedule,
  });
  assert.equal(result.reason, "available");
  assert.equal(result.option.assignments[0].vanId, "VAN-2");
  assert.equal(result.option.assignments[0].technicianIds.length, 0);
  assert.equal(result.option.time, "13:30");
});

test("manual operational drag may change to any physically valid time on the canonical appointment date", () => {
  assert.equal(operationalMoveDateAllowed({ date: "2098-12-20", currentSchedule }), true);

  const data = operationalData();
  const result = operationalMoveResult({
    request: request(),
    property: data.properties[0],
    data,
    routeConfig: routeConfigFromSettings(data.businessSettings),
    date: "2098-12-20",
    time: "09:30",
    vanId: "VAN-2",
    currentSchedule,
  });
  assert.equal(result.reason, "available");
  assert.equal(result.option.time, "09:30");
  assert.equal(result.option.assignments[0].vanId, "VAN-2");
});

test("manual operational drag cannot silently move an appointment to a different date", () => {
  assert.equal(operationalMoveDateAllowed({ date: "2098-12-21", currentSchedule }), false);
  assert.equal(operationalMoveDateAllowed({ date: "2098-12-20", currentSchedule: null }), false);

  const data = operationalData();
  const result = operationalMoveResult({
    request: request(),
    property: data.properties[0],
    data,
    routeConfig: routeConfigFromSettings(data.businessSettings),
    date: "2098-12-21",
    time: "09:30",
    vanId: "VAN-2",
    currentSchedule,
  });
  assert.equal(result.option, null);
  assert.equal(result.reason, "operational-move-date-mismatch");
});

test("manual operator drag ignores legacy unlinked work orders that are not visible in LIVE Booking Authority schedule", () => {
  const data = operationalData({
    workOrders: [{
      id: "WO-LEGACY",
      date: "2098-12-20",
      time: "13:30",
      status: "Pendiente",
      vanId: "VAN-2",
      scheduledSlots: 2,
      propertyId: "p1",
      zone: "Oranjestad",
    }],
  });
  const result = operationalMoveResult({
    request: request(),
    property: data.properties[0],
    data,
    routeConfig: routeConfigFromSettings(data.businessSettings),
    date: "2098-12-20",
    time: "13:30",
    vanId: "VAN-2",
    currentSchedule,
  });
  assert.equal(result.reason, "available");
  assert.equal(result.option.assignments[0].vanId, "VAN-2");
});

test("manual operator drag still refuses a real canonical occupied-capacity conflict", () => {
  const data = operationalData({
    workOrders: [{
      id: "WO-OTHER",
      appointmentId: "APT-OTHER",
      date: "2098-12-20",
      time: "13:30",
      status: "Confirmada",
      vanId: "VAN-2",
      scheduledSlots: 2,
      propertyId: "p1",
      zone: "Oranjestad",
    }],
  });
  const result = operationalMoveResult({
    request: request(),
    property: data.properties[0],
    data,
    routeConfig: routeConfigFromSettings(data.businessSettings),
    date: "2098-12-20",
    time: "13:30",
    vanId: "VAN-2",
    currentSchedule,
  });
  assert.equal(result.option, null);
  assert.equal(result.reason, "operational-target-unavailable");
});

test("manual operator drag refuses a van that is actually out of service or in maintenance", () => {
  const data = operationalData({
    vans: [{ id: "VAN-2", name: "Van 2", active: true, status: "Mantenimiento" }],
  });
  const result = operationalMoveResult({
    request: request(),
    property: data.properties[0],
    data,
    routeConfig: routeConfigFromSettings(data.businessSettings),
    date: "2098-12-20",
    time: "13:30",
    vanId: "VAN-2",
    currentSchedule,
  });
  assert.equal(result.option, null);
  assert.equal(result.reason, "operational-target-unavailable");
});
