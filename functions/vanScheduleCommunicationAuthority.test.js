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

test('reference delivery recovery preserves sent cursor and ignores sent, other Van and stale group records', async () => {
  const { ReferenceDb } = require('./test-support/referenceDb.cjs');
  const base = { provider: 'wacli', type: 'booking-reference-bundle', status: 'failed', scheduleDate: '2026-10-05', vanId: 'VAN-1', to: groups[0].groupJid, messageIndex: 2, sentMessageIds: ['one','two'], partAttempts: 3,
    workOrderId: 'WO-1', appointmentId: 'APT-1', referencesVersion: 2 };
  const db = new ReferenceDb({
    'vans/VAN-1': { active: true, whatsappScheduleGroupJid: groups[0].groupJid },
    'vans/VAN-2': { active: true, whatsappScheduleGroupJid: groups[1].groupJid },
    'workOrders/WO-1': { appointmentId: 'APT-1', vanId: 'VAN-1', date: '2026-10-05', status: 'Confirmada' },
    'appointments/APT-1': { status: 'confirmed', visitReferences: { version: 2 } },
    'whatsappOutboundQueue/retry': base,
    'whatsappOutboundQueue/plain': { ...base, type: 'text', notificationType: 'van-daily-work-order', messageIndex: undefined },
    'whatsappOutboundQueue/sent': { ...base, status: 'sent' },
    'whatsappOutboundQueue/stale': { ...base, to: '120000000000000099@g.us' },
    'whatsappOutboundQueue/other': { ...base, vanId: 'VAN-2', to: groups[1].groupJid },
  });
  const authority = createVanScheduleCommunicationAuthority({ db });
  const command = { action: 'retry_van_schedule_delivery', data: { dateKey: '2026-10-05', vanId: 'VAN-1' }, identity: { uid: 'office-test' } };
  assert.equal((await authority.execute(command)).resumed, 2);
  const row = db.records.get('whatsappOutboundQueue/retry');
  assert.equal(row.status, 'queued'); assert.equal(row.messageIndex, 2); assert.deepEqual(row.sentMessageIds, ['one','two']); assert.equal(row.resumedBy, 'office-test');
  assert.equal((await authority.execute(command)).resumed, 0);
  db.records.set('businessSettings/whatsapp', { transactionalOutboundEnabled: false });
  await assert.rejects(() => authority.execute(command), /disabled/);
  db.records.set('businessSettings/whatsapp', { transactionalProvider: 'meta' });
  await assert.rejects(() => authority.execute(command), /active wacli/);
  db.records.delete('businessSettings/whatsapp');
  for (const patch of [{ vanId: 'VAN-2' }, { status: 'Cancelada' }, { date: '2026-10-06' }]) {
    db.records.set('whatsappOutboundQueue/retry', { ...base });
    db.records.set('workOrders/WO-1', { appointmentId: 'APT-1', vanId: 'VAN-1', date: '2026-10-05', status: 'Confirmada', ...patch });
    assert.equal((await authority.execute(command)).resumed, 0);
    assert.equal(db.records.get('whatsappOutboundQueue/retry').status, 'failed');
  }
  db.records.set('workOrders/WO-1', { appointmentId: 'APT-1', vanId: 'VAN-1', date: '2026-10-05', status: 'Confirmada' });
  db.records.set('appointments/APT-1', { status: 'confirmed', visitReferences: { version: 3 } });
  assert.equal((await authority.execute(command)).resumed, 0);
});

test('recovery rejects unversioned bundles and stale text work messages without rewriting them', async () => {
  const { ReferenceDb } = require('./test-support/referenceDb.cjs');
  const order = { appointmentId: 'APT-AUDIT', vanId: 'VAN-1', date: '2026-10-07', time: '13:00', status: 'Confirmada' };
  const appointment = { status: 'confirmed', visitReferences: { version: 2 } };
  const failed = { provider: 'wacli', type: 'text', notificationType: 'van-daily-work-order', status: 'failed',
    workOrderId: 'WO-AUDIT', appointmentId: 'APT-AUDIT', scheduleDate: order.date, scheduleTime: order.time,
    vanId: 'VAN-1', to: groups[0].groupJid, referencesVersion: 2 };
  for (const changes of [
    { queue: { type: 'booking-reference-bundle', referencesVersion: undefined } },
    { order: { status: 'Cancelada' } }, { order: { vanId: 'VAN-2' } },
    { order: { date: '2026-10-08' } }, { order: { time: '15:00' } },
    { appointment: { status: 'cancelled' } }, { appointment: { visitReferences: { version: 3 } } },
  ]) {
    const queued = { ...failed, ...changes.queue };
    const db = new ReferenceDb({
      'vans/VAN-1': { active: true, whatsappScheduleGroupJid: groups[0].groupJid },
      'workOrders/WO-AUDIT': { ...order, ...changes.order },
      'appointments/APT-AUDIT': { ...appointment, ...changes.appointment },
      'whatsappOutboundQueue/synthetic-failed': queued,
    });
    const result = await createVanScheduleCommunicationAuthority({ db }).execute({ action: 'retry_van_schedule_delivery',
      data: { dateKey: order.date, vanId: 'VAN-1' }, identity: { uid: 'synthetic-office' } });
    assert.equal(result.resumed, 0, JSON.stringify(changes));
    assert.deepEqual(db.records.get('whatsappOutboundQueue/synthetic-failed'), queued);
  }
});
