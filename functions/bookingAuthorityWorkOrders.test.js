const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWorkOrders } = require("./bookingAuthorityWorkOrders");

test("mixed appointment preserves every selected work line in one Work Order", () => {
  const option = {
    date: "2098-12-20",
    time: "08:30",
    endTime: "14:30",
    address: "Wayaca 217",
    zone: "Oranjestad",
    durationMode: "mixed",
    workItems: [
      { id: "service", presetId: "standard_service", serviceId: "s1", label: "Standard Service", quantity: 2, durationMinutes: 120, durationMinutesPerUnit: 60, durationMode: "per_unit", serviceDefinitionVersion: 1 },
      { id: "install", presetId: "standard_installation", serviceId: "s2", label: "Standard Installation", quantity: 1, durationMinutes: 120, durationMinutesPerUnit: 120, durationMode: "per_unit", serviceDefinitionVersion: 1 },
    ],
    assignments: [{ vanId: "VAN-1", technicianIds: ["t1"], quantity: 3, durationMinutes: 240, slots: 4, endTime: "14:30" }],
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
  assert.equal(orders[0].appointmentEndTime, "14:30");
});

test("single-service support Work Orders receive only their assigned quantity and canonical end time", () => {
  const option = {
    date: "2098-12-20",
    time: "08:30",
    endTime: "16:30",
    durationMode: "per_unit",
    workItems: [{ id: "service", presetId: "standard_service", serviceId: "s1", label: "Standard Service", quantity: 8, durationMinutes: 480, durationMinutesPerUnit: 60, durationMode: "per_unit", serviceDefinitionVersion: 1 }],
    assignments: [
      { vanId: "VAN-1", quantity: 7, durationMinutes: 420, slots: 6, fullDay: true, endTime: "16:30" },
      { vanId: "VAN-2", quantity: 1, durationMinutes: 60, slots: 1, role: "support", time: "08:30", endTime: "09:30" },
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
  assert.equal(orders[0].appointmentEndTime, "16:30");
  assert.equal(orders[1].appointmentEndTime, "09:30");
});

test("primary Work Order snapshots canonical communication recipients and support does not duplicate them", () => {
  const option = {
    date: "2098-12-20",
    time: "08:30",
    durationMode: "per_unit",
    workItems: [{ id: "service", presetId: "standard_service", label: "Standard Service", quantity: 8, durationMinutes: 480, durationMinutesPerUnit: 60, durationMode: "per_unit" }],
    assignments: [
      { vanId: "VAN-1", quantity: 7, durationMinutes: 420, slots: 6 },
      { vanId: "VAN-2", quantity: 1, durationMinutes: 60, slots: 1, role: "support" },
    ],
  };
  const recipients = [
    { recipientType: "contact", sourceId: "contact-manager", name: "Property Manager", whatsapp: "+2975641111", email: "manager@example.com", sendConfirmation: true, sendReminder: true, technicianArrival: true, sendInvoice: false, sendServiceReport: true },
    { recipientType: "contact", sourceId: "contact-accounting", name: "Accounting", email: "accounting@example.com", sendConfirmation: false, sendReminder: false, technicianArrival: false, sendInvoice: true, sendServiceReport: true },
  ];
  const orders = buildWorkOrders({
    appointment: { appointmentId: "APT-CONTACTS" },
    option,
    request: { workLines: [] },
    customer: { id: "c1", whatsapp: "+2975640000" },
    property: { id: "p1" },
    context: { notificationRecipients: recipients },
  });

  assert.deepEqual(orders[0].notificationRecipients, recipients);
  assert.equal(orders[0].whatsappNotificationsEnabled, true);
  assert.deepEqual(orders[1].notificationRecipients, []);
  assert.equal(orders[1].whatsappNotificationsEnabled, false);
});

test("custom customer-facing description survives Other work without replacing the operational summary", () => {
  const customDescription = "Inspect the cassette leak and verify the drain line before carrying out any repair.";
  const option = {
    date: "2098-12-20",
    time: "14:30",
    endTime: "16:30",
    durationMode: "manual",
    workItems: [{ id: "other", presetId: "other", label: "Other", quantity: 1, durationMinutes: 120, durationMinutesPerUnit: 120, durationMode: "manual" }],
    assignments: [{ vanId: "VAN-3", quantity: 1, durationMinutes: 120, slots: 2, endTime: "16:30" }],
  };

  const [order] = buildWorkOrders({
    appointment: { appointmentId: "APT-OTHER-CUSTOM" },
    option,
    request: { workLines: [{ id: "other", presetId: "other", quantity: 1, customerFacingDescription: customDescription }] },
    customer: { id: "c1", whatsapp: "+2975640000" },
    property: { id: "p1", address: "Balashi 27-C" },
  });

  assert.equal(order.appointmentWorkLabel, "Other");
  assert.equal(order.problem, "Other × 1.");
  assert.equal(order.customerFacingDescription, customDescription);
  assert.equal(order.customerFacingDescriptionIsDefault, false);
});

test("automatic customer-facing description is marked as default so notification localization remains available", () => {
  const option = {
    date: "2098-12-20",
    time: "08:30",
    durationMode: "per_unit",
    workItems: [{ id: "service", presetId: "standard_service", label: "Standard Service", quantity: 2, durationMinutes: 120, durationMinutesPerUnit: 60, durationMode: "per_unit" }],
    assignments: [{ vanId: "VAN-1", quantity: 2, durationMinutes: 120, slots: 2 }],
  };
  const automaticDescription = "Scheduled work: 2 × Standard Service.";

  const [order] = buildWorkOrders({
    appointment: { appointmentId: "APT-AUTO-DESCRIPTION" },
    option,
    request: { workLines: [{ id: "service", presetId: "standard_service", quantity: 2, customerFacingDescription: automaticDescription }] },
    customer: { id: "c1" },
    property: { id: "p1" },
  });

  assert.equal(order.customerFacingDescription, automaticDescription);
  assert.equal(order.customerFacingDescriptionIsDefault, true);
});
