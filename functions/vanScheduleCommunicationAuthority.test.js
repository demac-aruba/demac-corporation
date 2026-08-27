const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertUniqueEnabledGroupJids,
  createVanScheduleCommunicationAuthority,
  normalizeGroupInput,
} = require("./vanScheduleCommunicationAuthority");

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value === undefined ? undefined : { ...value } };
}

function fakeDb(initialVans = [], { beforeTransaction = null } = {}) {
  const vans = new Map(initialVans.map((van) => [van.id, { ...van }]));
  function reference(id) {
    return {
      id,
      async get() { return snapshot(id, vans.get(id)); },
      async set(value, options = {}) {
        const current = vans.get(id) || {};
        vans.set(id, options.merge ? { ...current, ...value } : { ...value });
      },
    };
  }
  return {
    vans,
    collection(name) {
      if (name !== "vans") throw new Error(`Unexpected collection ${name}`);
      return {
        async get() {
          return { docs: [...vans.entries()].map(([id, value]) => snapshot(id, value)) };
        },
        doc(id) { return reference(id); },
      };
    },
    async runTransaction(callback) {
      if (typeof beforeTransaction === "function") await beforeTransaction(vans);
      return callback({
        async get(ref) { return ref.get(); },
        set(ref, value, options) { return ref.set(value, options); },
      });
    },
  };
}

const groups = [
  { vanId: "VAN-1", groupName: "Van 1 Group", groupJid: "120000000000000001@g.us", enabled: true },
  { vanId: "VAN-2", groupName: "Van 2 Group", groupJid: "120000000000000002@g.us", enabled: true },
  { vanId: "VAN-3", groupName: "Van 3 Group", groupJid: "120000000000000003@g.us", enabled: true },
  { vanId: "VAN-4", groupName: "Van 4 Group", groupJid: "120000000000000004@g.us", enabled: true },
];

test("van schedule group input requires a group JID when enabled", () => {
  assert.throws(() => normalizeGroupInput({ vanId: "VAN-1", groupName: "Van 1 Group", enabled: true }), /@g\.us/);
  assert.equal(normalizeGroupInput(groups[0]).groupJid, groups[0].groupJid);
});

test("group display name is optional and is not synthesized from a crew mapping", () => {
  const normalized = normalizeGroupInput({ vanId: "VAN-1", groupJid: groups[0].groupJid, enabled: true });
  assert.equal(normalized.groupName, "");
});

test("the same enabled WhatsApp group cannot belong to two Vans", () => {
  assert.throws(() => assertUniqueEnabledGroupJids([
    groups[0],
    { ...groups[1], groupJid: groups[0].groupJid },
  ]), /cannot be assigned to more than one enabled Van/);
});

test("configuration is stored atomically on canonical source Van records", async () => {
  const db = fakeDb([
    { id: "legacy-van-1", number: 1, active: true, name: "Van 1" },
    { id: "VAN-2", active: true, name: "Van 2" },
    { id: "VAN-3", active: true, name: "Van 3" },
    { id: "VAN-4", active: true, name: "Van 4" },
  ]);
  const authority = createVanScheduleCommunicationAuthority({
    db,
    scheduleService: { async queueDay() { throw new Error("not expected"); } },
    operatingCalendar: { async isOpenDate() { return true; } },
  });

  const result = await authority.saveConfiguration({ groups }, { uid: "office-1", name: "Office User" });
  assert.equal(result.groups.length, 4);
  assert.equal(db.vans.get("legacy-van-1").whatsappScheduleGroupJid, groups[0].groupJid);
  assert.equal(db.vans.get("VAN-2").whatsappScheduleGroupName, "Van 2 Group");
  assert.equal(result.groups.every((item) => item.configured), true);
});

test("blank display name preserves the persisted Van group name instead of inventing a crew label", async () => {
  const db = fakeDb([
    { id: "VAN-1", active: true, name: "Van 1", whatsappScheduleGroupName: "Operations Group One", whatsappScheduleGroupJid: groups[0].groupJid, scheduleDeliveryEnabled: true },
  ]);
  const authority = createVanScheduleCommunicationAuthority({
    db,
    scheduleService: { async queueDay() { throw new Error("not expected"); } },
    operatingCalendar: { async isOpenDate() { return true; } },
  });

  await authority.saveConfiguration({
    groups: [{ vanId: "VAN-1", groupName: "", groupJid: groups[0].groupJid, enabled: true }],
  }, {});
  assert.equal(db.vans.get("VAN-1").whatsappScheduleGroupName, "Operations Group One");
});

test("save rejects a duplicate JID against an existing Van not included in the partial update", async () => {
  const db = fakeDb([
    { id: "VAN-1", active: true, whatsappScheduleGroupJid: groups[0].groupJid, scheduleDeliveryEnabled: true },
    { id: "VAN-2", active: true, whatsappScheduleGroupJid: groups[1].groupJid, scheduleDeliveryEnabled: true },
  ]);
  const authority = createVanScheduleCommunicationAuthority({
    db,
    scheduleService: { async queueDay() { throw new Error("not expected"); } },
    operatingCalendar: { async isOpenDate() { return true; } },
  });

  await assert.rejects(
    () => authority.saveConfiguration({ groups: [{ ...groups[1], groupJid: groups[0].groupJid }] }, {}),
    /cannot be assigned to more than one enabled Van/,
  );
});

test("save aborts if a target Van disappears before the transaction and does not recreate it", async () => {
  const db = fakeDb(
    [{ id: "VAN-1", active: true, name: "Van 1", whatsappScheduleGroupJid: groups[0].groupJid, scheduleDeliveryEnabled: true }],
    { beforeTransaction(vans) { vans.delete("VAN-1"); } },
  );
  const authority = createVanScheduleCommunicationAuthority({
    db,
    scheduleService: { async queueDay() { throw new Error("not expected"); } },
    operatingCalendar: { async isOpenDate() { return true; } },
  });

  await assert.rejects(
    () => authority.saveConfiguration({ groups: [groups[0]] }, {}),
    /changed or is no longer active/,
  );
  assert.equal(db.vans.has("VAN-1"), false);
});

test("save aborts if a target Van becomes inactive before the transaction", async () => {
  const db = fakeDb(
    [{ id: "VAN-1", active: true, name: "Van 1", whatsappScheduleGroupJid: groups[0].groupJid, scheduleDeliveryEnabled: true }],
    { beforeTransaction(vans) { vans.set("VAN-1", { ...vans.get("VAN-1"), active: false }); } },
  );
  const authority = createVanScheduleCommunicationAuthority({
    db,
    scheduleService: { async queueDay() { throw new Error("not expected"); } },
    operatingCalendar: { async isOpenDate() { return true; } },
  });

  await assert.rejects(
    () => authority.saveConfiguration({ groups: [groups[0]] }, {}),
    /changed or is no longer active/,
  );
  assert.equal(db.vans.get("VAN-1").active, false);
  assert.equal(db.vans.get("VAN-1").whatsappScheduleGroupName, undefined);
});

test("manual schedule send reuses queueDay and scopes idempotency to the request id", async () => {
  const db = fakeDb([{ id: "VAN-1", active: true }]);
  let received = null;
  const authority = createVanScheduleCommunicationAuthority({
    db,
    scheduleService: {
      async queueDay(dateKey, options) {
        received = { dateKey, options };
        return { dateKey, vanCount: 1, workOrderCount: 2, messageCount: 2, results: [{ queued: true }, { queued: true }] };
      },
    },
    operatingCalendar: { async isOpenDate(dateKey) { return dateKey === "2026-08-21"; } },
  });

  const result = await authority.sendNow({
    dateKey: "2026-08-21",
    vanId: "VAN-1",
    requestId: "schedule-test-123",
  }, { uid: "office-1", name: "Office User" });

  assert.equal(received.dateKey, "2026-08-21");
  assert.equal(received.options.targetVanId, "VAN-1");
  assert.equal(received.options.deliveryKey, "manual-schedule-test-123");
  assert.equal(received.options.reason, "manual-office-van-schedule");
  assert.equal(result.messageCount, 2);
});

test("manual schedule send rejects a Van that is not in the active catalog", async () => {
  const db = fakeDb([{ id: "VAN-1", active: true }]);
  const authority = createVanScheduleCommunicationAuthority({
    db,
    scheduleService: { async queueDay() { throw new Error("should not run"); } },
    operatingCalendar: { async isOpenDate() { return true; } },
  });

  await assert.rejects(
    () => authority.sendNow({ dateKey: "2026-08-21", vanId: "VAN-2", requestId: "schedule-test-123" }, {}),
    /not present in the active Van catalog/,
  );
});

test("manual schedule send refuses closed business dates", async () => {
  const db = fakeDb([{ id: "VAN-1", active: true }]);
  const authority = createVanScheduleCommunicationAuthority({
    db,
    scheduleService: { async queueDay() { throw new Error("should not run"); } },
    operatingCalendar: { async isOpenDate() { return false; } },
  });
  await assert.rejects(
    () => authority.sendNow({ dateKey: "2026-08-23", requestId: "schedule-test-closed" }, {}),
    /closed DEMAC business date/,
  );
});
