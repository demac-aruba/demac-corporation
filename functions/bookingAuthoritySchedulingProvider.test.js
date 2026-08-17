const test = require("node:test");
const assert = require("node:assert/strict");
const { BOOKING_ERROR_CODES } = require("./bookingAuthorityCore");
const {
  SCHEDULING_PROVIDER_VERSION,
  analysisForRequest,
  buildCapacityLocks,
  buildWorkOrders,
  singlePresetWork,
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
    assignments: [{ vanId: "V2", technicianIds: ["t1", "t2"], quantity: 2, slots: 2, fullDay: false }],
  };
}

test("provider has explicit migration version", () => {
  assert.match(SCHEDULING_PROVIDER_VERSION, /erp-scheduling-adapter-v1/);
});

test("analysis is derived from canonical request rather than raw customer language", () => {
  const analysis = analysisForRequest(request(), { address: "Wayaca 217" });
  assert.equal(analysis.collectedInformation.serviceType, "standard_service");
  assert.equal(analysis.collectedInformation.quantity, "2");
  assert.equal(analysis.collectedInformation.address, "Wayaca 217");
  assert.equal(analysis.collectedInformation.preferredTime, "afternoon");
});

test("current adapter rejects mixed presets instead of guessing", () => {
  assert.throws(
    () => singlePresetWork({
      ...request(),
      workLines: [...request().workLines, { presetId: "deep_cleaning", quantity: 1 }],
    }),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST,
  );
});

test("capacity locks cover every occupied van slot", () => {
  const locks = buildCapacityLocks(option(), []);
  assert.equal(locks.length, 2);
  assert.deepEqual(locks.map((item) => item.slot), ["13:30", "14:30"]);
  assert.equal(new Set(locks.map((item) => item.id)).size, 2);
});

test("work orders link to canonical appointment and only primary order notifies client", () => {
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
