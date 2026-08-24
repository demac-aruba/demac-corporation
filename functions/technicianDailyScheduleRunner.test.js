const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createTechnicianDailyScheduleRunner,
  scheduledDate,
  summarizeQueueDelivery,
} = require("./technicianDailyScheduleRunner");

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

function createDb({ batch = null, queues = {} } = {}) {
  const collections = {
    technicianDailyScheduleBatches: new Map(batch ? [["2026-08-24", { ...batch }]] : []),
    whatsappOutboundQueue: new Map(Object.entries(queues).map(([id, value]) => [id, { ...value }])),
  };

  function reference(collectionName, id) {
    return {
      collectionName,
      id,
      async get() {
        const value = collections[collectionName].get(id);
        return { exists: value !== undefined, data: () => value === undefined ? undefined : { ...value } };
      },
      async set(payload, options) {
        assert.deepEqual(options, { merge: true });
        const current = collections[collectionName].get(id) || {};
        applyMerge(current, payload);
        collections[collectionName].set(id, current);
      },
    };
  }

  return {
    collections,
    batch() {
      return collections.technicianDailyScheduleBatches.get("2026-08-24") || null;
    },
    setQueue(queueId, value) {
      collections.whatsappOutboundQueue.set(queueId, { ...value });
    },
    collection(name) {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return { doc(id) { return reference(name, id); } };
    },
    async runTransaction(callback) {
      return callback({
        async get(ref) { return ref.get(); },
        set(ref, payload, options) { return ref.set(payload, options); },
      });
    },
  };
}

function quietLog() {
  return { info() {}, error() {} };
}

function scheduleResult({ created = true, includeSecond = true } = {}) {
  const results = [
    { queued: true, created, queueId: "queue-1", vanId: "VAN-1", workOrderId: "WO-1" },
  ];
  if (includeSecond) {
    results.push({ queued: true, created: false, queueId: "queue-2", vanId: "VAN-2", workOrderId: "WO-2" });
  }
  return {
    dateKey: "2026-08-24",
    vanCount: includeSecond ? 2 : 1,
    workOrderCount: includeSecond ? 2 : 1,
    lunchBreakCount: 0,
    messageCount: results.length,
    results,
  };
}

function createRunner({ db, calendarOpen = true, queueDay } = {}) {
  return createTechnicianDailyScheduleRunner({
    db,
    operatingCalendar: { isOpenDate: async () => calendarOpen },
    scheduleService: { queueDay },
    dateKey: () => "2026-08-24",
    fieldValue,
    log: quietLog(),
  });
}

test("scheduled event date is derived from scheduleTime instead of runtime wall clock", () => {
  const dateKey = (date) => date.toISOString().slice(0, 10);
  assert.equal(scheduledDate({ scheduleTime: "2026-08-24T12:00:00Z" }, dateKey), "2026-08-24");
});

test("queue reconciliation distinguishes delivered pending failed and missing items", async () => {
  const db = createDb({
    queues: {
      delivered: { status: "sent", messageId: "wamid-1" },
      pending: { status: "processing" },
      failed: { status: "failed", errorMessage: "bridge error" },
    },
  });
  const summary = await summarizeQueueDelivery(db, ["delivered", "pending", "failed", "missing"]);
  assert.equal(summary.successful.length, 1);
  assert.equal(summary.pending.length, 1);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.unknown.length, 1);
  assert.equal(summary.unknown[0].status, "missing");
});

test("open-day invocation records scheduler identity and completes only after transport success", async () => {
  const db = createDb({ queues: { "queue-1": { status: "sent" }, "queue-2": { status: "sent" } } });
  const calls = [];
  const run = createRunner({
    db,
    queueDay: async (...args) => { calls.push(args); return scheduleResult(); },
  });

  const result = await run({
    jobName: "projects/demac/locations/us-central1/jobs/firebase-schedule-sendDailyTechnicianSchedules-us-central1",
    scheduleTime: "2026-08-24T12:00:00Z",
  });

  assert.equal(result.status, "complete");
  assert.deepEqual(calls, [["2026-08-24", { deliveryKey: "auto", reason: "daily-van-schedule" }]]);
  assert.equal(db.batch().invocationCount, 1);
  assert.equal(db.batch().attemptCount, 1);
  assert.equal(db.batch().status, "complete");
  assert.equal(db.batch().deliveredCount, 2);
  assert.equal(db.batch().pendingCount, 0);
  assert.equal(db.batch().schedulerScheduleTime, "2026-08-24T12:00:00Z");
  assert.match(db.batch().schedulerJobName, /sendDailyTechnicianSchedules/);
});

test("new queue items remain queued until wacli acknowledges them", async () => {
  const db = createDb({ queues: { "queue-1": { status: "queued" } } });
  const run = createRunner({
    db,
    queueDay: async () => scheduleResult({ includeSecond: false }),
  });

  const result = await run();
  assert.equal(result.status, "queued");
  assert.equal(db.batch().status, "queued");
  assert.equal(db.batch().pendingCount, 1);
  assert.equal(db.batch().completedAt, null);
});

test("a later tick reconciles deterministic existing queue items to complete without duplication", async () => {
  const db = createDb({
    batch: { status: "queued", invocationCount: 1, attemptCount: 1, queueIds: ["queue-1"] },
    queues: { "queue-1": { status: "sent" } },
  });
  const run = createRunner({
    db,
    queueDay: async () => scheduleResult({ created: false, includeSecond: false }),
  });

  const result = await run();
  assert.equal(result.status, "complete");
  assert.equal(db.batch().invocationCount, 2);
  assert.equal(db.batch().attemptCount, 2);
  assert.deepEqual(db.batch().queueIds, ["queue-1"]);
  assert.equal(db.batch().deliveredCount, 1);
});

test("closed-day invocation leaves an explicit skipped heartbeat and never queues WhatsApp", async () => {
  const db = createDb();
  let queued = false;
  const run = createRunner({
    db,
    calendarOpen: false,
    queueDay: async () => { queued = true; return scheduleResult(); },
  });

  const result = await run();
  assert.equal(result.status, "skipped");
  assert.equal(queued, false);
  assert.equal(db.batch().invocationCount, 1);
  assert.equal(db.batch().status, "skipped");
  assert.equal(db.batch().skipReason, "closed-business-day");
});

test("a completed batch is never downgraded if the calendar later changes", async () => {
  const db = createDb({ batch: { status: "complete", invocationCount: 1, attemptCount: 1 } });
  let calendarRead = false;
  let queued = false;
  const run = createTechnicianDailyScheduleRunner({
    db,
    operatingCalendar: { isOpenDate: async () => { calendarRead = true; return false; } },
    scheduleService: { queueDay: async () => { queued = true; return scheduleResult(); } },
    dateKey: () => "2026-08-24",
    fieldValue,
    log: quietLog(),
  });

  const result = await run();
  assert.equal(result.idempotent, true);
  assert.equal(calendarRead, false);
  assert.equal(queued, false);
  assert.equal(db.batch().status, "complete");
  assert.equal(db.batch().invocationCount, 2);
});

test("producer rejection is partial even when other queue items were delivered", async () => {
  const db = createDb({ queues: { "queue-1": { status: "sent" } } });
  const run = createRunner({
    db,
    queueDay: async () => ({
      dateKey: "2026-08-24",
      vanCount: 2,
      workOrderCount: 2,
      lunchBreakCount: 0,
      messageCount: 2,
      results: [
        { queued: true, created: true, queueId: "queue-1", vanId: "VAN-1", workOrderId: "WO-1" },
        { queued: false, created: false, reason: "van-whatsapp-group-not-configured", vanId: "VAN-2", workOrderId: "WO-2" },
      ],
    }),
  });

  const result = await run();
  assert.equal(result.status, "partial");
  assert.equal(db.batch().failedCount, 1);
  assert.equal(db.batch().failures[0].phase, "producer");
});

test("an existing failed deterministic queue item can never be misreported as complete", async () => {
  const db = createDb({ queues: { "queue-1": { status: "failed", errorMessage: "network failure" } } });
  const run = createRunner({
    db,
    queueDay: async () => scheduleResult({ created: false, includeSecond: false }),
  });

  const result = await run();
  assert.equal(result.status, "partial");
  assert.equal(db.batch().failedCount, 1);
  assert.equal(db.batch().failures[0].phase, "delivery");
  assert.equal(db.batch().failures[0].status, "failed");
});

test("no active work orders is an explicit successful skip", async () => {
  const db = createDb();
  const run = createRunner({
    db,
    queueDay: async () => ({ dateKey: "2026-08-24", vanCount: 3, workOrderCount: 0, lunchBreakCount: 0, messageCount: 0, results: [] }),
  });

  const result = await run();
  assert.equal(result.status, "skipped");
  assert.equal(db.batch().skipReason, "no-active-work-orders");
});

test("queue service exception is persisted as a failed automatic attempt", async () => {
  const db = createDb();
  const run = createRunner({
    db,
    queueDay: async () => { throw new Error("queue unavailable"); },
  });

  await assert.rejects(run, /queue unavailable/);
  assert.equal(db.batch().status, "failed");
  assert.equal(db.batch().fatalError, "queue unavailable");
});
