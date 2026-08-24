const assert = require("node:assert/strict");
const test = require("node:test");
const {
  HEALTH_WINDOW_START_MINUTES,
  assertDateKey,
  evaluateVanScheduleDeliveryHealth,
  healthDueForDate,
  minutesInTimeZone,
} = require("./vanScheduleDeliveryHealth");

function delivery({ successful = 0, pending = 0, failed = 0, unknown = 0 } = {}) {
  const make = (count, status) => Array.from({ length: count }, (_, index) => ({ queueId: `${status}-${index}`, status }));
  return {
    total: successful + pending + failed + unknown,
    successful: make(successful, "sent"),
    pending: make(pending, "queued"),
    failed: make(failed, "failed"),
    unknown: make(unknown, "missing"),
  };
}

function batch(overrides = {}) {
  return {
    status: "complete",
    invocationCount: 1,
    attemptCount: 1,
    workOrderCount: 2,
    messageCount: 2,
    queueIds: ["queue-1", "queue-2"],
    failedCount: 0,
    failures: [],
    ...overrides,
  };
}

test("date validation rejects impossible calendar dates", () => {
  assert.equal(assertDateKey("2026-08-24"), "2026-08-24");
  assert.throws(() => assertDateKey("2026-02-31"), /Invalid health date/);
  assert.throws(() => assertDateKey("24-08-2026"), /YYYY-MM-DD/);
});

test("Aruba health window starts at 08:15 local time", () => {
  assert.equal(HEALTH_WINDOW_START_MINUTES, 495);
  assert.equal(minutesInTimeZone(new Date("2026-08-24T12:14:00Z")), 494);
  assert.equal(minutesInTimeZone(new Date("2026-08-24T12:15:00Z")), 495);
  assert.equal(healthDueForDate({ targetDate: "2026-08-24", today: "2026-08-24", nowMinutes: 494 }), false);
  assert.equal(healthDueForDate({ targetDate: "2026-08-24", today: "2026-08-24", nowMinutes: 495 }), true);
  assert.equal(healthDueForDate({ targetDate: "2026-08-23", today: "2026-08-24", nowMinutes: 100 }), true);
  assert.equal(healthDueForDate({ targetDate: "2026-08-25", today: "2026-08-24", nowMinutes: 1000 }), false);
});

test("closed business day is healthy and does not require a batch", () => {
  const result = evaluateVanScheduleDeliveryHealth({
    runDate: "2026-08-23",
    isOpen: false,
    healthDue: true,
  });
  assert.equal(result.healthy, true);
  assert.equal(result.status, "closed-day");
  assert.equal(result.reason, "closed-business-day");
});

test("current open day before the health window is not due", () => {
  const result = evaluateVanScheduleDeliveryHealth({
    runDate: "2026-08-24",
    isOpen: true,
    healthDue: false,
  });
  assert.equal(result.healthy, true);
  assert.equal(result.status, "not-due");
});

test("open day after the health window without heartbeat is unhealthy", () => {
  const result = evaluateVanScheduleDeliveryHealth({
    runDate: "2026-08-24",
    isOpen: true,
    healthDue: true,
    batch: null,
  });
  assert.equal(result.healthy, false);
  assert.equal(result.reason, "missing-scheduler-heartbeat");
});

test("batch without invocation evidence is unhealthy", () => {
  const result = evaluateVanScheduleDeliveryHealth({
    runDate: "2026-08-24",
    isOpen: true,
    healthDue: true,
    batch: batch({ invocationCount: 0 }),
    delivery: delivery({ successful: 2 }),
  });
  assert.equal(result.healthy, false);
  assert.equal(result.reason, "missing-scheduler-heartbeat");
});

test("no active work orders is an explicit healthy skip", () => {
  const result = evaluateVanScheduleDeliveryHealth({
    runDate: "2026-08-24",
    isOpen: true,
    healthDue: true,
    batch: batch({ status: "skipped", skipReason: "no-active-work-orders", workOrderCount: 0, messageCount: 0, queueIds: [] }),
  });
  assert.equal(result.healthy, true);
  assert.equal(result.status, "no-work");
  assert.equal(result.reason, "no-active-work-orders");
});

test("unexpected closed-day skip on a currently open date is unhealthy", () => {
  const result = evaluateVanScheduleDeliveryHealth({
    runDate: "2026-08-24",
    isOpen: true,
    healthDue: true,
    batch: batch({ status: "skipped", skipReason: "closed-business-day", queueIds: [] }),
  });
  assert.equal(result.healthy, false);
  assert.match(result.reason, /unexpected-open-day-skip/);
});

test("failed and partial producer batches remain unhealthy", () => {
  for (const status of ["failed", "partial"]) {
    const result = evaluateVanScheduleDeliveryHealth({
      runDate: "2026-08-24",
      isOpen: true,
      healthDue: true,
      batch: batch({ status, failures: [{ phase: "producer", reason: "van-whatsapp-group-not-configured", workOrderId: "sensitive-wo" }] }),
      delivery: delivery({ successful: 2 }),
    });
    assert.equal(result.healthy, false);
    assert.equal(result.reason, `producer-${status}`);
    assert.equal(JSON.stringify(result).includes("sensitive-wo"), false);
  }
});

test("open-day batch with work but no queue evidence is unhealthy", () => {
  const result = evaluateVanScheduleDeliveryHealth({
    runDate: "2026-08-24",
    isOpen: true,
    healthDue: true,
    batch: batch({ status: "processing", queueIds: [] }),
    delivery: delivery(),
  });
  assert.equal(result.healthy, false);
  assert.equal(result.reason, "missing-expected-queue-evidence");
});

test("failed queue delivery is unhealthy even if batch says complete", () => {
  const result = evaluateVanScheduleDeliveryHealth({
    runDate: "2026-08-24",
    isOpen: true,
    healthDue: true,
    batch: batch({ status: "complete" }),
    delivery: delivery({ successful: 1, failed: 1 }),
  });
  assert.equal(result.healthy, false);
  assert.equal(result.reason, "delivery-failed");
});

test("missing or unknown queue delivery is unhealthy even if batch says complete", () => {
  const result = evaluateVanScheduleDeliveryHealth({
    runDate: "2026-08-24",
    isOpen: true,
    healthDue: true,
    batch: batch({ status: "complete" }),
    delivery: delivery({ successful: 1, unknown: 1 }),
  });
  assert.equal(result.healthy, false);
  assert.equal(result.reason, "delivery-missing-or-unknown");
});

test("pending delivery after the health window is unhealthy", () => {
  const result = evaluateVanScheduleDeliveryHealth({
    runDate: "2026-08-24",
    isOpen: true,
    healthDue: true,
    batch: batch({ status: "queued" }),
    delivery: delivery({ successful: 1, pending: 1 }),
  });
  assert.equal(result.healthy, false);
  assert.equal(result.reason, "delivery-late-pending");
});

test("queue delivery authority can prove success even when batch snapshot is still queued", () => {
  const result = evaluateVanScheduleDeliveryHealth({
    runDate: "2026-08-24",
    isOpen: true,
    healthDue: true,
    batch: batch({ status: "queued" }),
    delivery: delivery({ successful: 2 }),
  });
  assert.equal(result.healthy, true);
  assert.equal(result.status, "healthy");
  assert.equal(result.reason, "all-expected-messages-delivered");
  assert.equal(result.details.batchSnapshotMayBeStale, true);
});

test("successful queue count must match the batch expected queue IDs", () => {
  const result = evaluateVanScheduleDeliveryHealth({
    runDate: "2026-08-24",
    isOpen: true,
    healthDue: true,
    batch: batch({ queueIds: ["queue-1", "queue-2", "queue-3"] }),
    delivery: delivery({ successful: 2 }),
  });
  assert.equal(result.healthy, false);
  assert.equal(result.reason, "delivery-count-mismatch");
});
