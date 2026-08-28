const assert = require("node:assert/strict");
const test = require("node:test");

const {
  arrivalContact,
  createTechnicianDailyScheduleService,
  deterministicLunchQueueId,
  deterministicPendingQueueId,
  deterministicQueueId,
  displayedOrderEndTime,
  geographicDistrict,
  geographicZone,
  groupConfigForVan,
  planLunchBreak,
  propertyLocationName,
  renderLunchBreakText,
  renderPendingSlotText,
  renderVanWorkOrderText,
  staffFirstNamesForOrder,
  technicianInstructions,
  workSummary,
} = require("./technicianDailyScheduleService");

const GROUP_JID = "120000000000000002@g.us";
const groupVan = {
  id: "VAN-2",
  name: "Van 2",
  whatsappScheduleGroupName: "Van 2 Group",
  whatsappScheduleGroupJid: GROUP_JID,
  scheduleDeliveryEnabled: true,
};

const order = {
  id: "WO-APT-1-1",
  appointmentId: "APT-1",
  clientId: "client-1",
  propertyId: "property-1",
  status: "Confirmada",
  date: "2026-08-21",
  time: "08:30",
  appointmentEndTime: "10:30",
  vanId: "VAN-2",
  address: "Caya G. F. Betico Croes 42",
  zone: "Oranjestad / Airport",
  technicianIds: ["tech-a", "tech-b"],
  appointmentWorkItems: [
    { label: "Standard Service", quantity: 2 },
  ],
  customerFacingDescription: "Deep service of the two living-room units",
  appointmentAssignmentRole: "primary",
  notificationRecipients: [
    { name: "Owner", role: "Owner", whatsapp: "+2975600000", technicianArrival: false },
    { name: "Site contact", role: "Manager", whatsapp: "+2975611111", technicianArrival: true },
  ],
};

function doc(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createScheduleDb({
  vans = [],
  workOrders = [],
  clients = [],
  properties = [],
  appointments = [],
  staff = [],
  services = [],
  assignments = [],
  absences = [],
  halfDays = [],
} = {}) {
  const collections = {
    vans: new Map(vans.map((item) => [item.id, { ...item }])),
    workOrders: new Map(workOrders.map((item) => [item.id, { ...item }])),
    clients: new Map(clients.map((item) => [item.id, { ...item }])),
    properties: new Map(properties.map((item) => [item.id, { ...item }])),
    appointments: new Map(appointments.map((item) => [item.id, { ...item }])),
    staffProfiles: new Map(staff.map((item) => [item.id, { ...item }])),
    services: new Map(services.map((item) => [item.id, { ...item }])),
    dailyVanAssignments: new Map(assignments.map((item) => [item.id, { ...item }])),
    staffAbsences: new Map(absences.map((item) => [item.id, { ...item }])),
    vanHalfDaySchedules: new Map(halfDays.map((item) => [item.id, { ...item }])),
    businessSettings: new Map(),
    whatsappOutboundQueue: new Map(),
  };
  return {
    collections,
    collection(name) {
      const values = collections[name];
      if (!values) throw new Error(`Unexpected collection ${name}`);
      return {
        async get() {
          return { docs: [...values.entries()].map(([id, value]) => doc(id, value)) };
        },
        where(field, operator, expected) {
          assert.equal(operator, "==");
          return {
            async get() {
              return { docs: [...values.entries()].filter(([, value]) => value[field] === expected).map(([id, value]) => doc(id, value)) };
            },
          };
        },
        doc(id) {
          return {
            async get() {
              return doc(id, values.get(id));
            },
            async create(payload) {
              if (values.has(id)) {
                const error = new Error("already exists");
                error.code = 6;
                throw error;
              }
              values.set(id, payload);
            },
          };
        },
      };
    },
  };
}

test("van group config requires a valid WhatsApp group JID", () => {
  assert.deepEqual(groupConfigForVan(groupVan), {
    enabled: true,
    groupJid: GROUP_JID,
    groupName: "Van 2 Group",
    valid: true,
  });
  assert.equal(groupConfigForVan({ id: "VAN-2", whatsappScheduleGroupName: "Van 2 Group" }).valid, false);
});

test("a real additional property contact is shown without exposing its internal role", () => {
  const contact = arrivalContact(order, { id: "client-1", name: "Customer", whatsapp: "+2975622222" });
  assert.deepEqual(contact, { name: "Site contact", source: "additional-property-contact" });
});

test("the primary customer is never repeated as an additional contact", () => {
  const client = { id: "client-1", name: "Erick Luidens", whatsapp: "+2975622222" };
  const contact = arrivalContact({
    ...order,
    notificationRecipients: [
      {
        recipientType: "client",
        sourceId: "client-1",
        name: "Erick Luidens",
        role: "Customer / owner",
        whatsapp: "+2975622222",
        technicianArrival: true,
      },
    ],
  }, client);
  assert.equal(contact, null);
});

test("unrelated recipients that are not arrival contacts are omitted", () => {
  const contact = arrivalContact({
    ...order,
    notificationRecipients: [
      { name: "Accounting", role: "Accounting", whatsapp: "+2975699999", technicianArrival: false, sendInvoice: true },
    ],
  }, { id: "client-1", name: "Primary Customer", whatsapp: "+2975622222" });
  assert.equal(contact, null);
});

test("staff names are shortened for the van group header", () => {
  const names = staffFirstNamesForOrder(order, new Map([
    ["tech-a", { name: "Miguel Reyes" }],
    ["tech-b", { name: "Alan Baquero" }],
  ]));
  assert.deepEqual(names, ["Miguel", "Alan"]);
});

test("geographic labels come from the property and never from the Work Order routing bucket", () => {
  const property = { operationalZone: "Oranjestad Centro", neighborhood: "Playa" };
  assert.equal(geographicDistrict(property), "Oranjestad");
  assert.equal(geographicZone(property), "Playa");
  assert.notEqual(geographicZone(property), order.zone);
});

test("property location name only exposes a real user-defined property name", () => {
  assert.equal(propertyLocationName({ name: "Pastechi House Building" }), "Pastechi House Building");
  assert.equal(propertyLocationName({ name: "" }), "");
  assert.equal(propertyLocationName({ name: "Primary Property" }), "");
  assert.equal(propertyLocationName({ name: "Property" }), "");
  assert.equal(propertyLocationName({ name: "Property 2" }), "");
});

test("technician instructions come from the canonical appointment work lines", () => {
  const text = technicianInstructions({
    workLines: [
      { technicianInstructions: "Bring tall ladder" },
      { technicianInstructions: "Check condensate line" },
      { technicianInstructions: "Bring tall ladder" },
    ],
  }, order);
  assert.equal(text, "Bring tall ladder\nCheck condensate line");
});

test("work summary remains available as a description fallback", () => {
  assert.equal(workSummary({
    appointmentWorkItems: [
      { label: "Standard Service", quantity: 2 },
      { label: "Leak Repair", quantity: 1 },
    ],
  }), "Standard Service × 2; Leak Repair × 1");
});

test("one work order renders without redundant client/contact or work/description lines", () => {
  const text = renderVanWorkOrderText({
    van: { ...groupVan, id: "VAN-1", name: "Van 1" },
    order: { ...order, vanId: "VAN-1" },
    client: { id: "client-1", name: "Izaira Mansur", whatsapp: "+2975622222" },
    property: {
      name: "Pastechi House Building",
      operationalZone: "Oranjestad Centro",
      neighborhood: "Playa",
      accessInstructions: "Use side gate",
    },
    appointment: { workLines: [{ technicianInstructions: "Bring coil cleaner" }] },
    staffById: new Map([
      ["tech-a", { name: "Miguel Reyes" }],
      ["tech-b", { name: "Alan Baquero" }],
    ]),
    sequence: 1,
  });

  assert.match(text, /^\*DEMAC · Van 1 · Miguel y Alan\*\n\*Trabajo 1 ·/);
  assert.match(text, /\n\n\*Hora:\* 8:30 AM – 10:30 AM\n\*Cliente:\* Izaira Mansur\n\*Contacto:\* Site contact/);
  assert.doesNotMatch(text, /Site contact · Manager/);
  assert.match(text, /\n\n\*Location:\* Pastechi House Building\n\*Dirección:\* Caya G\. F\. Betico Croes 42\n\*Distrito:\* Oranjestad\n\*Zona:\* Playa\n\*Acceso:\* Use side gate/);
  assert.match(text, /\n\n\*Descripción:\* Deep service of the two living-room units/);
  assert.doesNotMatch(text, /\n\*Trabajo:\*/);
  assert.match(text, /\n\n\*Instrucciones técnico:\* Bring coil cleaner$/);
  assert.doesNotMatch(text, /Tel\/WhatsApp|\+29756/);
  assert.doesNotMatch(text, /\*Equipo:\*/);
  assert.doesNotMatch(text, /\*Asignación:\*/);
  assert.doesNotMatch(text, /Oranjestad \/ Airport/);
});

test("same customer marked for technician arrival does not create a Contacto line", () => {
  const client = { id: "client-1", name: "Erick Luidens", whatsapp: "+2975622222" };
  const text = renderVanWorkOrderText({
    van: groupVan,
    order: {
      ...order,
      appointmentWorkItems: [{ label: "Standard Service", quantity: 1 }],
      customerFacingDescription: "Scheduled work: 1 × Standard Service.",
      notificationRecipients: [{
        recipientType: "client",
        sourceId: "client-1",
        name: "Erick Luidens",
        role: "Customer / owner",
        whatsapp: "+2975622222",
        technicianArrival: true,
      }],
    },
    client,
    property: { operationalZone: "Paradera", neighborhood: "Paradera" },
    appointment: {},
    staffById: new Map(),
    sequence: 1,
  });
  assert.match(text, /\*Cliente:\* Erick Luidens/);
  assert.doesNotMatch(text, /\*Contacto:\*/);
  assert.doesNotMatch(text, /Customer \/ owner/);
  assert.match(text, /\*Descripción:\* Scheduled work: 1 × Standard Service\./);
  assert.doesNotMatch(text, /\n\*Trabajo:\*/);
});

test("blank or legacy generated property names do not create a Location line", () => {
  for (const name of ["", "Primary Property", "Property", "Property 3"]) {
    const text = renderVanWorkOrderText({
      van: groupVan,
      order,
      client: { id: "client-1", name: "Customer" },
      property: { name, operationalZone: "Oranjestad Centro", neighborhood: "Playa" },
      appointment: {},
      staffById: new Map(),
      sequence: 1,
    });
    assert.doesNotMatch(text, /\*Location:\*/);
    assert.match(text, /\*Dirección:\* Caya G\. F\. Betico Croes 42/);
  }
});

test("a support Work Order does not expose internal assignment labels", () => {
  const text = renderVanWorkOrderText({
    van: { ...groupVan, id: "VAN-4", name: "Van 4" },
    order: { ...order, vanId: "VAN-4", appointmentAssignmentRole: "support" },
    client: { id: "client-1", name: "Customer" },
    property: { operationalZone: "Santa Cruz", neighborhood: "Balashi" },
    appointment: {},
    staffById: new Map(),
    sequence: 1,
  });
  assert.match(text, /\*DEMAC · Van 4\*/);
  assert.doesNotMatch(text, /Asignación|Apoyo|Principal/);
});

test("technician work times use real duration instead of stretching through the lunch gap", () => {
  assert.equal(displayedOrderEndTime({
    time: "10:30",
    appointmentDurationMinutes: 120,
    appointmentEndTime: "14:30",
  }), "12:30");
});

test("standard lunch is inserted after the morning route and before the afternoon route", () => {
  const lunch = planLunchBreak([
    { id: "WO-1", time: "08:30", appointmentDurationMinutes: 60 },
    { id: "WO-2", time: "09:30", appointmentDurationMinutes: 60 },
    { id: "WO-3", time: "10:30", appointmentDurationMinutes: 60 },
    { id: "WO-4", time: "13:30", appointmentDurationMinutes: 60 },
  ]);
  assert.deepEqual(lunch, {
    startMinutes: 720,
    endMinutes: 780,
    insertAfterCount: 3,
    onSite: false,
    reason: "standard-lunch-window",
  });
});

test("two two-hour morning installations push lunch until both jobs are complete", () => {
  const lunch = planLunchBreak([
    { id: "INSTALL-1", time: "08:30", appointmentDurationMinutes: 120 },
    { id: "INSTALL-2", time: "10:30", appointmentDurationMinutes: 120 },
    { id: "INSTALL-3", time: "14:30", appointmentDurationMinutes: 120 },
  ]);
  assert.deepEqual(lunch, {
    startMinutes: 750,
    endMinutes: 810,
    insertAfterCount: 2,
    onSite: false,
    reason: "lunch-shifted-after-work",
  });
});

test("one all-day project keeps the lunch placement on site but renders only the minimal lunch message", () => {
  const lunch = planLunchBreak([
    { id: "PROJECT-1", time: "08:30", appointmentDurationMinutes: 360, scheduledSlots: 6, fullDaySingleProperty: true },
  ]);
  assert.deepEqual(lunch, {
    startMinutes: 720,
    endMinutes: 780,
    insertAfterCount: 1,
    onSite: true,
    reason: "single-project-all-day",
  });
  const text = renderLunchBreakText({
    van: { ...groupVan, name: "Van 1" },
    dateKey: "2026-08-22",
    lunch,
    orders: [{ technicianIds: ["tech-a"] }],
    staffById: new Map([["tech-a", { name: "Miguel Reyes" }]]),
  });
  assert.equal(text, "*LUNCH BREAK*");
});

test("a short morning-only route does not receive a pointless lunch message after the work is over", () => {
  assert.equal(planLunchBreak([
    { id: "WO-1", time: "08:30", appointmentDurationMinutes: 60 },
  ]), null);
});

test("pending period text exposes the exact free hour without creating a fake customer job", () => {
  assert.equal(renderPendingSlotText("13:30"), "*PENDIENTE*\n*Hora:* 1:30 PM – 2:30 PM");
});

test("work, lunch and pending queue IDs are deterministic per delivery run", () => {
  const first = deterministicQueueId({ dateKey: "2026-08-21", vanId: "VAN-2", order, deliveryKey: "auto" });
  const repeated = deterministicQueueId({ dateKey: "2026-08-21", vanId: "VAN-2", order, deliveryKey: "auto" });
  const manual = deterministicQueueId({ dateKey: "2026-08-21", vanId: "VAN-2", order, deliveryKey: "manual-test-1" });
  const lunch = deterministicLunchQueueId({ dateKey: "2026-08-21", vanId: "VAN-2", deliveryKey: "auto" });
  const pending = deterministicPendingQueueId({ dateKey: "2026-08-21", vanId: "VAN-2", slot: "13:30", deliveryKey: "auto" });
  assert.equal(first, repeated);
  assert.notEqual(first, manual);
  assert.match(first, /van-daily-work-2026-08-21-VAN-2-0830-WO-APT-1-1-auto/);
  assert.match(lunch, /van-daily-lunch-2026-08-21-VAN-2-auto/);
  assert.match(pending, /van-daily-pending-2026-08-21-VAN-2-1330-auto/);
});

test("queueDay sends a minimal lunch message between morning and afternoon work orders", async () => {
  const morningOrder = {
    ...order,
    appointmentDurationMinutes: 60,
    appointmentEndTime: "09:30",
  };
  const afternoonOrder = {
    ...order,
    id: "WO-APT-2-1",
    appointmentId: "APT-2",
    clientId: "client-2",
    propertyId: "property-2",
    time: "13:30",
    appointmentDurationMinutes: 60,
    appointmentEndTime: "14:30",
    customerFacingDescription: "Check bedroom air conditioner",
    appointmentWorkItems: [{ label: "Check Up", quantity: 1 }],
  };
  const db = createScheduleDb({
    vans: [{ id: "VAN-2", active: true, whatsappScheduleGroupName: "Van 2 Group", whatsappScheduleGroupJid: GROUP_JID }],
    workOrders: [afternoonOrder, morningOrder],
    clients: [{ id: "client-1", name: "Customer One" }, { id: "client-2", name: "Customer Two" }],
    properties: [
      { id: "property-1", name: "Pastechi House Building", operationalZone: "Oranjestad Centro", neighborhood: "Playa", accessInstructions: "Side gate" },
      { id: "property-2", operationalZone: "Noord", neighborhood: "Washington" },
    ],
    appointments: [
      { id: "APT-1", workLines: [{ technicianInstructions: "Bring cleaner" }] },
      { id: "APT-2", workLines: [{ technicianInstructions: "Call office if compressor is locked" }] },
    ],
    staff: [{ id: "tech-a", name: "Technician A" }, { id: "tech-b", name: "Technician B" }],
  });
  const service = createTechnicianDailyScheduleService({ db });
  const result = await service.queueDay("2026-08-21", { targetVanId: "VAN-2", deliveryKey: "manual-test", reason: "manual-office-van-schedule" });

  assert.equal(result.vanCount, 1);
  assert.equal(result.workOrderCount, 2);
  assert.equal(result.pendingPeriodCount, 0);
  assert.equal(result.lunchBreakCount, 1);
  assert.equal(result.messageCount, 3);
  assert.equal(result.results.every((item) => item.queued), true);
  assert.equal(result.results[0].workOrderId, "WO-APT-1-1");
  assert.equal(result.results[1].lunchBreak, true);
  assert.equal(result.results[2].workOrderId, "WO-APT-2-1");
  const queued = [...db.collections.whatsappOutboundQueue.values()];
  assert.equal(queued.length, 3);
  assert.equal(queued.every((item) => item.to === GROUP_JID), true);
  assert.match(queued[0].text, /\*Trabajo 1/);
  assert.match(queued[0].text, /\*Location:\* Pastechi House Building/);
  assert.equal(queued[1].text, "*LUNCH BREAK*");
  assert.match(queued[2].text, /\*Trabajo 2/);
  assert.match(queued[2].text, /Customer Two/);
});

test("an operationally available empty regular day queues only the six sellable periods as PENDIENTE", async () => {
  const db = createScheduleDb({
    vans: [{
      id: "VAN-2",
      active: true,
      responsibleStaffId: "driver-1",
      whatsappScheduleGroupName: "Van 2 Group",
      whatsappScheduleGroupJid: GROUP_JID,
    }],
    staff: [{ id: "driver-1", name: "Driver One", active: true, availability: "Disponible", canDriveVan: true }],
  });
  const service = createTechnicianDailyScheduleService({ db });
  const result = await service.queueDay("2026-08-21", { targetVanId: "VAN-2", deliveryKey: "pending-test" });

  assert.equal(result.workOrderCount, 0);
  assert.equal(result.lunchBreakCount, 0);
  assert.equal(result.pendingPeriodCount, 6);
  assert.equal(result.messageCount, 6);
  assert.deepEqual(result.results.map((item) => item.pendingSlot), ["08:30", "09:30", "10:30", "13:30", "14:30", "15:30"]);
  const texts = [...db.collections.whatsappOutboundQueue.values()].map((item) => item.text);
  assert.equal(texts.every((value) => value.startsWith("*PENDIENTE*")), true);
  assert.equal(texts.some((value) => value.includes("11:30 AM")), false);
  assert.equal(texts.some((value) => value.includes("12:30 PM")), false);
});

test("a van with zero work orders but no operational driver queues zero messages", async () => {
  const db = createScheduleDb({
    vans: [{ id: "VAN-4", active: true, whatsappScheduleGroupName: "Van 4 Group", whatsappScheduleGroupJid: "120000000000000004@g.us" }],
  });
  const service = createTechnicianDailyScheduleService({ db });
  const result = await service.queueDay("2026-08-21", { targetVanId: "VAN-4" });
  assert.equal(result.workOrderCount, 0);
  assert.equal(result.pendingPeriodCount, 0);
  assert.equal(result.lunchBreakCount, 0);
  assert.equal(result.messageCount, 0);
  assert.equal(db.collections.whatsappOutboundQueue.size, 0);
});

test("missing group configuration fails closed with no technician phone fallback", async () => {
  const db = createScheduleDb({
    vans: [{ id: "VAN-2", active: true, whatsappScheduleGroupName: "Van 2 Group" }],
    workOrders: [{ ...order, appointmentDurationMinutes: 60, appointmentEndTime: "09:30" }],
    clients: [{ id: "client-1", name: "Customer One" }],
    properties: [{ id: "property-1" }],
    appointments: [{ id: "APT-1" }],
    staff: [{ id: "tech-a", name: "Technician A", phone: "+2975600000" }],
  });
  const service = createTechnicianDailyScheduleService({ db });
  const result = await service.queueDay("2026-08-21", { targetVanId: "VAN-2" });
  assert.equal(result.messageCount, 1);
  assert.equal(result.results[0].queued, false);
  assert.equal(result.results[0].reason, "van-whatsapp-group-not-configured");
  assert.equal(db.collections.whatsappOutboundQueue.size, 0);
});
