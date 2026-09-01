const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalVanIdFromValue,
  canonicalizeSchedulingData,
  canonicalizeVanCatalog,
  resolveCanonicalVanId,
} = require("./bookingVanIdentity");

test("normalizes only canonical IDs and the closed legacy alias registry", () => {
  assert.equal(canonicalVanIdFromValue("VAN-1"), "VAN-1");
  assert.equal(canonicalVanIdFromValue("v4"), "VAN-4");
  assert.equal(canonicalVanIdFromValue("Van 3"), "VAN-3");
  assert.equal(canonicalVanIdFromValue("van_2"), "VAN-2");
  assert.equal(canonicalVanIdFromValue("VAN-5"), "VAN-5");
  assert.equal(canonicalVanIdFromValue("VAN-12"), "VAN-12");
  assert.equal(canonicalVanIdFromValue("Van 12"), "");
});

test("deduplicates multiple Firestore records that represent the same physical van", () => {
  const catalog = canonicalizeVanCatalog([
    { id: "VAN-1", name: "Van 1", active: true },
    { id: "v4", name: "Van 4", active: true },
    { id: "van-1783800405341", name: "Van 4", active: true },
  ]);
  assert.deepEqual(catalog.vans.map((van) => van.id), ["VAN-1", "VAN-4"]);
  assert.equal(catalog.aliases.get("v4"), "VAN-4");
  assert.equal(catalog.aliases.get("van-1783800405341"), "VAN-4");
});

test("legacy physical document IDs resolve only through the explicit migration registry", () => {
  const catalog = canonicalizeVanCatalog([
    { id: "VAN-1783801335935", name: "Van 2", active: true },
    { id: "VAN-5", name: "Van 5", active: true },
  ]);

  assert.deepEqual(catalog.vans.map((van) => van.id), ["VAN-2", "VAN-5"]);
  assert.equal(catalog.aliases.get("VAN-1783801335935"), "VAN-2");
  assert.equal(resolveCanonicalVanId("VAN-1783801335935", catalog.aliases), "VAN-2");
  assert.equal(resolveCanonicalVanId("VAN-5", catalog.aliases), "VAN-5");
});

test("deduplicates the full raw fleet and keeps future canonical Vans in natural numeric order", () => {
  const catalog = canonicalizeVanCatalog([
    { id: "VAN-12", name: "Van 12", active: true },
    { id: "v4", name: "Van 4", active: true },
    { id: "van-1783800405341", name: "Van 4", active: true },
    { id: "v1", name: "Van 1", active: true },
    { id: "VAN-1783801335937", name: "Renamed legacy Van 1 duplicate", active: true },
    { id: "VAN-2", name: "Van 2", active: true },
    { id: "VAN-5", name: "Van 5", active: true },
    { id: "VAN-3", name: "Van 3", active: true },
  ]);
  assert.deepEqual(catalog.vans.map((van) => van.id), ["VAN-1", "VAN-2", "VAN-3", "VAN-4", "VAN-5", "VAN-12"]);
});

test("canonicalizes scheduling references for legacy and future Vans before availability math", () => {
  const data = canonicalizeSchedulingData({
    vans: [
      { id: "v4", name: "Van 4", active: true },
      { id: "van-1783800405341", name: "Van 4", active: true },
      { id: "VAN-5", name: "Van 5", active: true, status: "Fuera de servicio" },
    ],
    workOrders: [
      { id: "wo-1", vanId: "van-1783800405341", appointmentId: "apt-1" },
      { id: "wo-5", vanId: "VAN-5", appointmentId: "apt-5" },
    ],
    dailyVanAssignments: [{ id: "assign-5", vanId: "VAN-5" }],
    vanHalfDaySchedules: [{ id: "half-5", vanId: "VAN-5" }],
  });
  assert.deepEqual(data.vans.map((van) => van.id), ["VAN-4", "VAN-5"]);
  assert.equal(data.workOrders[0].vanId, "VAN-4");
  assert.equal(data.workOrders[1].vanId, "VAN-5");
  assert.equal(data.dailyVanAssignments[0].vanId, "VAN-5");
  assert.equal(data.vanHalfDaySchedules[0].vanId, "VAN-5");
  assert.equal(data.vans.find((van) => van.id === "VAN-5").status, "Fuera de servicio");
});

test("preserves an opaque master-data Van ID, display name, and every scheduling reference", () => {
  const futureVanId = "VAN-FUTURE-TEST-947";
  const data = canonicalizeSchedulingData({
    vans: [{ id: futureVanId, name: "Future Test Field Van", active: true, status: "Disponible" }],
    workOrders: [{ id: "wo-future", vanId: futureVanId, appointmentId: "apt-future" }],
    dailyVanAssignments: [{ id: "assign-future", vanId: futureVanId }],
    vanHalfDaySchedules: [{ id: "half-future", vanId: futureVanId }],
    capacityLocks: [{ id: "lock-future", vanId: futureVanId, slot: "08:30" }],
  });

  assert.deepEqual(data.vans.map((van) => van.id), [futureVanId]);
  assert.equal(data.vans[0].name, "Future Test Field Van");
  assert.equal(data.workOrders[0].vanId, futureVanId);
  assert.equal(data.dailyVanAssignments[0].vanId, futureVanId);
  assert.equal(data.vanHalfDaySchedules[0].vanId, futureVanId);
  assert.equal(data.capacityLocks[0].vanId, futureVanId);
  assert.equal(resolveCanonicalVanId(futureVanId, data.vanAliases), futureVanId);
});

test("opaque identity, historical Work Orders, and capacity locks are invariant under display rename", () => {
  function canonicalizedReferences(name) {
    const vanId = "RESOURCE-ALPHA";
    const data = canonicalizeSchedulingData({
      vans: [{ id: vanId, name, active: true }],
      workOrders: [{ id: "wo-future", vanId }],
      capacityLocks: [{ id: "lock-future", vanId, slot: "08:30" }],
    });
    return { ids: [data.vans[0].id, data.workOrders[0].vanId, data.capacityLocks[0].vanId], name: data.vans[0].name };
  }

  assert.deepEqual(canonicalizedReferences("Van 5"), { ids: Array(3).fill("RESOURCE-ALPHA"), name: "Van 5" });
  assert.deepEqual(canonicalizedReferences("West Team"), { ids: Array(3).fill("RESOURCE-ALPHA"), name: "West Team" });
});

test("an opaque Van named Van 5 cannot collide with the real VAN-5 master record", () => {
  const catalog = canonicalizeVanCatalog([
    { id: "RESOURCE-ALPHA", name: "Van 5", active: true },
    { id: "VAN-5", name: "West Team", active: true },
  ]);

  assert.deepEqual(catalog.vans.map((van) => van.id), ["VAN-5", "RESOURCE-ALPHA"]);
  assert.equal(catalog.vans.find((van) => van.id === "RESOURCE-ALPHA").name, "Van 5");
  assert.equal(catalog.vans.find((van) => van.id === "VAN-5").name, "West Team");
});

test("canonical Van catalog realigns the original WhatsApp groups while leaving future Vans unconfigured", () => {
  const catalog = canonicalizeVanCatalog([
    { id: "VAN-1", name: "Van 1", active: true, whatsappScheduleGroupName: "TEC - Miguel", whatsappScheduleGroupJid: "120000000000000001@g.us", scheduleDeliveryEnabled: true },
    { id: "VAN-2", name: "Van 2", active: true, whatsappScheduleGroupName: "Gollo y Walter", whatsappScheduleGroupJid: "120000000000000002@g.us", scheduleDeliveryEnabled: true },
    { id: "VAN-3", name: "Van 3", active: true, whatsappScheduleGroupName: "TEC - Mario y Ronald", whatsappScheduleGroupJid: "120000000000000003@g.us", scheduleDeliveryEnabled: true },
    { id: "VAN-4", name: "Van 4", active: true, whatsappScheduleGroupName: "TEC - Alejandro y Edwin", whatsappScheduleGroupJid: "120000000000000004@g.us", scheduleDeliveryEnabled: true },
    { id: "VAN-5", name: "Van 5", active: true, status: "Fuera de servicio" },
  ]);
  const byId = new Map(catalog.vans.map((van) => [van.id, van]));

  assert.equal(byId.get("VAN-1").name, "Van 1");
  assert.equal(byId.get("VAN-2").name, "Van 2");
  assert.equal(byId.get("VAN-3").name, "Van 3");
  assert.equal(byId.get("VAN-4").name, "Van 4");
  assert.equal(byId.get("VAN-1").whatsappScheduleGroupName, "Miguel Reyes / Alan Baquero");
  assert.equal(byId.get("VAN-2").whatsappScheduleGroupName, "Mario Cornejo / Ronald Maury");
  assert.equal(byId.get("VAN-2").whatsappScheduleGroupJid, "120000000000000003@g.us");
  assert.equal(byId.get("VAN-3").whatsappScheduleGroupName, "Alejandro Marquez / Edwin Calvo");
  assert.equal(byId.get("VAN-3").whatsappScheduleGroupJid, "120000000000000004@g.us");
  assert.equal(byId.get("VAN-4").whatsappScheduleGroupName, "Jose Gregorio / Walter Rangel");
  assert.equal(byId.get("VAN-4").whatsappScheduleGroupJid, "120000000000000002@g.us");
  assert.equal(byId.get("VAN-5").whatsappScheduleGroupName, undefined);
  assert.equal(byId.get("VAN-5").whatsappScheduleGroupJid, undefined);
});
