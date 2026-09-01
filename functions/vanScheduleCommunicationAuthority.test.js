const assert = require("node:assert/strict");
const test = require("node:test");
const { createVanScheduleCommunicationAuthority, normalizeGroupInput } = require("./vanScheduleCommunicationAuthority");

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function fakeDb(initialVans = []) {
  const vans = new Map(initialVans.map((van) => [van.id, { ...van }]));
  return {
    vans,
    collection(name) {
      if (name !== "vans") throw new Error(`Unexpected collection ${name}`);
      return {
        async get() {
          return { docs: [...vans.entries()].map(([id, value]) => snapshot(id, value)) };
        },
        doc(id) {
          return {
            async set(value, options = {}) {
              const current = vans.get(id) || {};
              vans.set(id, options.merge ? { ...current, ...value } : { ...value });
            },
          };
        },
      };
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

test("configuration is stored on the canonical source van records", async () => {
  const db = fakeDb([
    { id: "legacy-van-1", number: 1, active: true },
    { id: "VAN-2", active: true },
    { id: "VAN-3", active: true },
    { id: "VAN-4", active: true },
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
