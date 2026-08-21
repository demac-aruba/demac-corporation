const assert = require("node:assert/strict");
const test = require("node:test");

const {
  arrivalContact,
  createTechnicianDailyScheduleService,
  deterministicQueueId,
  groupConfigForVan,
  renderVanWorkOrderText,
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
  address: "Piedra Plat 1C",
  zone: "Paradera / Hooiberg",
  technicianIds: ["tech-a", "tech-b"],
  appointmentWorkItems: [
    { label: "Standard Service", quantity: 2 },
  ],
  customerFacingDescription: "Deep service of the two living-room units",
  appointmentAssignmentRole: "primary",
  notificationRecipients: [
    { name: "Owner", role: "Owner", whatsapp: "+2975600000", technicianArrival: false },
    { name: "Site contact", role: "On-site contact", whatsapp: "+2975611111", technicianArrival: true },
  ],
};

function doc(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createScheduleDb({ vans = [], workOrders = [], clients = [], properties = [], appointments = [], staff = [] } = {}) {
  const collections = {
    vans: new Map(vans.map((item) => [item.id, { ...item }])),
    workOrders: new Map(workOrders.map((item) => [item.id, { ...item }])),
    clients: new Map(clients.map((item) => [item.id, { ...item }])),
    properties: new Map(properties.map((item) => [item.id, { ...item }])),
    appointments: new Map(appointments.map((item) => [item.id, { ...item }])),
    staffProfiles: new Map(staff.map((item) => [item.id, { ...item }])),
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

test("technician arrival recipient is preferred over the generic customer contact", () => {
  const contact = arrivalContact(order, { name: "Customer", whatsapp: "+2975622222" });
  assert.equal(contact.name, "Site contact");
  assert.equal(contact.phone, "+2975611111");
});

test("unrelated notification recipients never replace the primary customer contact", () => {
  const contact = arrivalContact({
    ...order,
    notificationRecipients: [
      { name: "Accounting", role: "Accounting", whatsapp: "+2975699999", technicianArrival: false, sendInvoice: true },
    ],
  }, { name: "Primary Customer", whatsapp: "+2975622222" });
  assert.equal(contact.name, "Primary Customer");
  assert.equal(contact.phone, "+2975622222");
  assert.equal(contact.role, "");
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

test("work summary keeps all work items in the same appointment message", () => {
  assert.equal(workSummary({
    appointmentWorkItems: [
      { label: "Standard Service", quantity: 2 },
      { label: "Leak Repair", quantity: 1 },
    ],
  }), "Standard Service × 2; Leak Repair × 1");
});

test("one work order renders one complete WhatsApp group message", () => {
  const text = renderVanWorkOrderText({
    van: groupVan,
    order,
    client: { name: "Customer One", whatsapp: "+2975622222" },
    property: { accessInstructions: "Use side gate" },
    appointment: { workLines: [{ technicianInstructions: "Bring coil cleaner" }] },
    staffById: new Map([
      ["tech-a", { name: "Technician A" }],
      ["tech-b", { name: "Technician B" }],
    ]),
    sequence: 1,
  });

  assert.match(text, /\*DEMAC · Van 2\*/);
  assert.match(text, /\*Hora:\* 8:30 AM – 10:30 AM/);
  assert.match(text, /\*Cliente:\* Customer One/);
  assert.match(text, /\*Contacto:\* Site contact · On-site contact/);
  assert.match(text, /\*Tel\/WhatsApp:\* \+2975611111/);
  assert.match(text, /\*Dirección:\* Piedra Plat 1C/);
  assert.match(text, /\*Equipo:\* Technician A \+ Technician B/);
  assert.match(text, /\*Trabajo:\* Standard Service × 2/);
  assert.match(text, /\*Descripción:\* Deep service of the two living-room units/);
  assert.match(text, /\*Instrucciones técnico:\* Bring coil cleaner/);
  assert.match(text, /\*Acceso:\* Use side gate/);
});

test("support work order is explicitly labeled and remains a message for the support van", () => {
  const text = renderVanWorkOrderText({
    van: { ...groupVan, id: "VAN-4", name: "Van 4" },
    order: { ...order, vanId: "VAN-4", appointmentAssignmentRole: "support" },
    client: { name: "Customer" },
    property: {},
    appointment: {},
    staffById: new Map(),
    sequence: 1,
  });
  assert.match(text, /\*DEMAC · Van 4\*/);
  assert.match(text, /\*Asignación:\* Apoyo/);
});

test("queue IDs are deterministic per date, van, work order and delivery run", () => {
  const first = deterministicQueueId({ dateKey: "2026-08-21", vanId: "VAN-2", order, deliveryKey: "auto" });
  const repeated = deterministicQueueId({ dateKey: "2026-08-21", vanId: "VAN-2", order, deliveryKey: "auto" });
  const manual = deterministicQueueId({ dateKey: "2026-08-21", vanId: "VAN-2", order, deliveryKey: "manual-test-1" });
  assert.equal(first, repeated);
  assert.notEqual(first, manual);
  assert.match(first, /van-daily-work-2026-08-21-VAN-2-0830-WO-APT-1-1-auto/);
});

test("queueDay sends one independent group message per work order in chronological order", async () => {
  const secondOrder = {
    ...order,
    id: "WO-APT-2-1",
    appointmentId: "APT-2",
    clientId: "client-2",
    propertyId: "property-2",
    time: "10:30",
    appointmentEndTime: "11:30",
    customerFacingDescription: "Check bedroom air conditioner",
    appointmentWorkItems: [{ label: "Check Up", quantity: 1 }],
  };
  const db = createScheduleDb({
    vans: [{ id: "VAN-2", active: true, whatsappScheduleGroupName: "Van 2 Group", whatsappScheduleGroupJid: GROUP_JID }],
    workOrders: [secondOrder, order],
    clients: [{ id: "client-1", name: "Customer One" }, { id: "client-2", name: "Customer Two" }],
    properties: [{ id: "property-1", accessInstructions: "Side gate" }, { id: "property-2" }],
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
  assert.equal(result.messageCount, 2);
  assert.equal(result.results.every((item) => item.queued), true);
  assert.equal(result.results[0].workOrderId, "WO-APT-1-1");
  assert.equal(result.results[1].workOrderId, "WO-APT-2-1");
  const queued = [...db.collections.whatsappOutboundQueue.values()];
  assert.equal(queued.length, 2);
  assert.equal(queued.every((item) => item.to === GROUP_JID), true);
  assert.match(queued[0].text, /\*Trabajo 1/);
  assert.match(queued[1].text, /\*Trabajo 2/);
  assert.match(queued[1].text, /Customer Two/);
});

test("a van with zero work orders queues zero messages", async () => {
  const db = createScheduleDb({
    vans: [{ id: "VAN-4", active: true, whatsappScheduleGroupName: "Van 4 Group", whatsappScheduleGroupJid: "120000000000000004@g.us" }],
  });
  const service = createTechnicianDailyScheduleService({ db });
  const result = await service.queueDay("2026-08-21", { targetVanId: "VAN-4" });
  assert.equal(result.workOrderCount, 0);
  assert.equal(result.messageCount, 0);
  assert.equal(db.collections.whatsappOutboundQueue.size, 0);
});

test("missing group configuration fails closed with no technician phone fallback", async () => {
  const db = createScheduleDb({
    vans: [{ id: "VAN-2", active: true, whatsappScheduleGroupName: "Van 2 Group" }],
    workOrders: [order],
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
