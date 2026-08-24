const assert = require("node:assert/strict");
const test = require("node:test");
const { createTechnicianDailyScheduleRunner } = require("./technicianDailyScheduleRunner");

const fieldValue = {
  serverTimestamp: () => "SERVER_TS",
  increment: (amount) => ({ __increment: amount }),
};

function applyMerge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && value.__increment) {
      target[key] = Number(target[key] || 0) + value.__increment;
    } else {
      target[key] = value;
    }
  }
}

function createBatchDb(initial = null) {
  const state = initial ? { ...initial } : null;
  const holder = { value: state };
  return {
    holder,
    collection(name) {
      assert.equal(name, "technicianDailyScheduleBatches");
      return {
        doc(id) {
          assert.equal(id, "2026-08-24");
          return {
            async get() {
              return { exists: Boolean(holder.value), data: () => holder.value ? { ...holder.value } : undefined };
            },
            async set(payload, options) {
              assert.deepEqual(options, { merge: true });
              if (!holder.value) holder.value = {};
              applyMerge(holder.value, payload);
            },
          };
        },
      };
    },
  };
}

function quietLog() {
  return { info() {}, error() {} };
}

function scheduleResult() {
  return {
    dateKey: "2026-08-24",
    vanCount: 4,
    workOrderCount: 2,
    lunchBreakCount: 0,
    messageCount: 2,
    results: [
      { queued: true, created: true, vanId: "VAN-1", workOrderId: "WO-1" },
      { queued: true, created: false, vanId: "VAN-2", workOrderId: "WO-2" },
    ],
  };
}

test("open-day invocation is observable before queueing and completes idempotently", async () => {
  const db = createBatchDb();
  const calls = [];
  const run = createTechnicianDailyScheduleRunner({
    db,
    operatingCalendar: { isOpenDate: async () => true },
    scheduleService: { queueDay: async (...args) => { calls.push(args); return scheduleResult(); } },
    dateKey: () => "2026-08-24",
    fieldValue,
    log: quietLog(),
  });

  const result = await run();
  assert.equal(result.status, "complete");
  assert.deepEqual(calls, [["2026-08-24", { deliveryKey: "auto", reason: "daily-van-schedule" }]]);
  assert.equal(db.holder.value.schedulerObserved, true);
  assert.equal(db.holder.value.invocationCount, 1);
  assert.equal(db.holder.value.attemptCount, 1);
  assert.equal(db.holder.value.status, "complete");
  assert.equal(db.holder.value.lastDecision, "complete");
  assert.equal(db.holder.value.queuedCount, 1);
  assert.equal(db.holder.value.idempotentCount, 1);
});

test("closed-day invocation leaves an explicit skipped heartbeat and never queues WhatsApp", async () => {
  const db = createBatchDb();
  let queued = false;
  const run = createTechnicianDailyScheduleRunner({
    db,
    operatingCalendar: { isOpenDate: async () => false },
    scheduleService: { queueDay: async () => { queued = true; return scheduleResult(); } },
    dateKey: () => "2026-08-24",
    fieldValue,
    log: quietLog(),
  });

  const result = await run();
  assert.equal(result.status, "skipped");
  assert.equal(queued, false);
  assert.equal(db.holder.value.schedulerObserved, true);
  assert.equal(db.holder.value.invocationCount, 1);
  assert.equal(db.holder.value.status, "skipped");
  assert.equal(db.holder.value.skipReason, "closed-business-day");
});

test("a repeated tick records the invocation but does not duplicate a completed batch", async () => {
  const db = createBatchDb({ status: "complete", invocationCount: 1, attemptCount: 1 });
  let queued = false;
  const run = createTechnicianDailyScheduleRunner({
    db,
    operatingCalendar: { isOpenDate: async () => true },
    scheduleService: { queueDay: async () => { queued = true; return scheduleResult(); } },
    dateKey: () => "2026-08-24",
    fieldValue,
    log: quietLog(),
  });

  const result = await run();
  assert.equal(result.idempotent, true);
  assert.equal(queued, false);
  assert.equal(db.holder.value.invocationCount, 2);
  assert.equal(db.holder.value.attemptCount, 1);
  assert.equal(db.holder.value.lastDecision, "already-complete");
});

test("queue failure is persisted as a failed automatic attempt", async () => {
  const db = createBatchDb();
  const run = createTechnicianDailyScheduleRunner({
    db,
    operatingCalendar: { isOpenDate: async () => true },
    scheduleService: { queueDay: async () => { throw new Error("queue unavailable"); } },
    dateKey: () => "2026-08-24",
    fieldValue,
    log: quietLog(),
  });

  await assert.rejects(run, /queue unavailable/);
  assert.equal(db.holder.value.schedulerObserved, true);
  assert.equal(db.holder.value.status, "partial");
  assert.equal(db.holder.value.lastDecision, "failed");
  assert.equal(db.holder.value.fatalError, "queue unavailable");
});
