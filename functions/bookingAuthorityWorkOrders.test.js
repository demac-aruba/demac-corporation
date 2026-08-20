const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWorkOrders } = require("./bookingAuthorityWorkOrders");

test("mixed appointment preserves every selected work line in one Work Order", () => {
  const option = {
    date: "2098-12-20",
    time: "08:30",
    address: "Wayaca 217",
    zone: "Oranjestad",
    durationMode: "mixed",
    workItems: [
      { id: "service", presetId: "standard_service", serviceId: "s1", label: "Standard Service", quantity: 2, durationMinutes: 120, durationMinutesPerUnit: 60, durationMode: "per_unit", serviceDefinitionVersion: 1 },
      { id: "install", presetId: "standard_installation", serviceId: "s2", label: "Standard Installation", quantity: 1, durationMinutes: 120, durationMinutesPerUnit: 120, durationMode: "per_unit", serviceDefinitionVersion: 1 },
    ],
    assignments: [{ vanId: "VAN-1", technicianIds: ["t1"], quantity: 3, durationMinutes: 240, slots: 4 }],
  };
  const orders = buildWorkOrders({
    appointment: { appointmentId: "APT-MIX" },
    option,
    request: { workLines: [] },
    customer: { id: "c1", whatsapp: "+2975600000" },
    property: { id: "p1", address: "Wayaca 217" },
    now: new Date("2098-12-01T12:00:00Z"),
  });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].appointmentWorkItems.length, 2);
  assert.equal(orders[0].appointmentWorkType, "multiple_services");
  assert.equal(orders[0].appointmentDurationMinutes, 240);
});

test("single-service support Work Orders receive only their assigned quantity", () => {
  const option = {
    date: "2098-12-20",
    time: "08:30",
    durationMode: "per_unit",
    workItems: [{ id: "service", presetId: "standard_service", serviceId: "s1", label: "Standard Service", quantity: 8, durationMinutes: 480, durationMinutesPerUnit: 60, durationMode: "per_unit", serviceDefinitionVersion: 1 }],
    assignments: [
      { vanId: "VAN-1", quantity: 7, durationMinutes: 420, slots: 6, fullDay: true },
      { vanId: "VAN-2", quantity: 1, durationMinutes: 60, slots: 1, role: "support" },
    ],
  };
  const orders = buildWorkOrders({
    appointment: { appointmentId: "APT-SUPPORT" },
    option,
    request: { workLines: [] },
    customer: { id: "c1" },
    property: { id: "p1" },
  });
  assert.equal(orders.length, 2);
  assert.equal(orders[0].appointmentWorkItems[0].quantity, 7);
  assert.equal(orders[1].appointmentWorkItems[0].quantity, 1);
  assert.equal(orders[1].appointmentAssignmentRole, "support");
});
