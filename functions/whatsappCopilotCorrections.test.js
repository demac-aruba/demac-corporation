const test = require("node:test");
const assert = require("node:assert/strict");
const {
  generateOptionsWithHardCustomerTime,
  parseTimeConstraint,
  timeAllowed,
} = require("./whatsappCopilotCorrections");
const { normalizeRouteConfig } = require("./whatsappCopilotSchedulingCore");

function analysis(preferredTime) {
  return {
    intent: "service_request",
    summary: "Servicio estándar para 4 aires",
    collectedInformation: {
      serviceType: "service",
      quantity: "4",
      address: "Noord 15",
      requestedDate: "",
      requestedTime: "",
      preferredDate: "",
      preferredTime,
      customerName: "",
      extraDetails: "",
    },
  };
}

function schedulingData() {
  return {
    workOrders: [],
    services: [{ id: "service-standard", name: "Servicio estándar", category: "Servicio" }],
    properties: [],
    clients: [],
    vans: [{
      id: "van-1",
      name: "Van 1",
      active: true,
      status: "Disponible",
      responsibleStaffId: "driver-1",
      regularHelperId: "helper-1",
    }],
    staffProfiles: [
      { id: "driver-1", active: true, availability: "Disponible", canDriveVan: true },
      { id: "helper-1", active: true, availability: "Disponible", canDriveVan: false },
    ],
    dailyVanAssignments: [],
    staffAbsences: [],
    calendarClosures: [],
    businessSettings: [{ id: "business-calendar", closedWeekdays: [0] }],
    vanHalfDaySchedules: [],
  };
}

test("interprets Spanish availability after 10 as a hard lower bound", () => {
  const constraint = parseTimeConstraint(analysis("after 10:00"), "Pero estoy disponible después de 10 am");
  assert.deepEqual(constraint.kind, "after");
  assert.deepEqual(constraint.time, "10:00");
  assert.equal(timeAllowed("08:30", constraint), false);
  assert.equal(timeAllowed("09:30", constraint), false);
  assert.equal(timeAllowed("10:30", constraint), true);
  assert.equal(timeAllowed("13:30", constraint), true);
});

test("interprets from 10 as inclusive", () => {
  const constraint = parseTimeConstraint(analysis("from 10:00"), "Estoy disponible a partir de las 10");
  assert.equal(constraint.kind, "from");
  assert.equal(timeAllowed("09:30", constraint), false);
  assert.equal(timeAllowed("10:30", constraint), true);
});

test("generated ERP options never violate the customer's after-10 restriction", () => {
  const result = generateOptionsWithHardCustomerTime({
    analysis: analysis("after 10:00"),
    request: {
      chatTitle: "DIRECTV",
      contactPhone: "2975600000",
      latestCustomerTurn: "Pero te estoy diciendo que estoy disponible después de 10 am",
    },
    data: schedulingData(),
    routeConfig: normalizeRouteConfig(),
    today: "2026-08-07",
    currentTime: "07:00",
  });

  assert.ok(result.options.length > 0);
  assert.ok(result.options.every((option) => option.time > "10:00"));
  assert.ok(result.options.every((option) => !["08:30", "09:30"].includes(option.time)));
});
