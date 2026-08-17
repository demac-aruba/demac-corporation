const test = require("node:test");
const assert = require("node:assert/strict");
const { BOOKING_ERROR_CODES } = require("./bookingAuthorityCore");
const { CANONICAL_SCHEDULING_ENGINE_VERSION } = require("./bookingAuthoritySchedulingEngine");
const {
  SCHEDULING_PROVIDER_VERSION,
  buildCapacityLocks,
  buildWorkOrders,
  exactCustomerProperty,
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

test("provider exposes canonical provider v2", () => {
  assert.equal(SCHEDULING_PROVIDER_VERSION, "erp-booking-scheduling-provider-v2");
});

test("canonical scheduling engine is versioned independently", () => {
  assert.equal(CANONICAL_SCHEDULING_ENGINE_VERSION, 1);
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
