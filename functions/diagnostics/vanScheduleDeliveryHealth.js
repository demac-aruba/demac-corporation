const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const {
  TIME_ZONE,
  createOperatingCalendarService,
  dateKeyInTimeZone,
} = require("../operatingCalendarService");
const {
  SUCCESS_QUEUE_STATUSES,
  summarizeQueueDelivery,
  uniqueQueueIds,
} = require("../technicianDailyScheduleRunner");

const HEALTH_WINDOW_START_MINUTES = 8 * 60 + 15;
const HEALTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function text(value) {
  return String(value ?? "").trim();
}

function assertDateKey(value) {
  const dateKey = text(value);
  if (!HEALTH_DATE_PATTERN.test(dateKey)) {
    throw new Error(`Invalid health date ${dateKey || "<empty>"}; expected YYYY-MM-DD.`);
  }
  const parsed = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateKey) {
    throw new Error(`Invalid health date ${dateKey}.`);
  }
  return dateKey;
}

function minutesInTimeZone(date = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function healthDueForDate({ targetDate, today, nowMinutes, windowStartMinutes = HEALTH_WINDOW_START_MINUTES } = {}) {
  const target = assertDateKey(targetDate);
  const current = assertDateKey(today);
  if (target < current) return true;
  if (target > current) return false;
  return Number(nowMinutes) >= Number(windowStartMinutes);
}

function compactDelivery(delivery = {}) {
  const source = delivery || {};
  return {
    total: Number(source.total || 0),
    successful: Array.isArray(source.successful) ? source.successful.length : 0,
    pending: Array.isArray(source.pending) ? source.pending.length : 0,
    failed: Array.isArray(source.failed) ? source.failed.length : 0,
    unknown: Array.isArray(source.unknown) ? source.unknown.length : 0,
  };
}

function healthResult({ runDate, healthy, status, reason, batch = null, delivery = null, details = {} }) {
  const queue = compactDelivery(delivery);
  return {
    runDate,
    healthy,
    status,
    reason,
    batch: batch ? {
      status: text(batch.status) || "unknown",
      skipReason: text(batch.skipReason) || null,
      invocationCount: Number(batch.invocationCount || 0),
      attemptCount: Number(batch.attemptCount || 0),
      workOrderCount: Number(batch.workOrderCount || 0),
      messageCount: Number(batch.messageCount || 0),
      expectedQueueCount: uniqueQueueIds(batch.queueIds || []).length,
      failureCount: Number(batch.failedCount || 0),
    } : null,
    delivery: queue,
    details,
  };
}

function evaluateVanScheduleDeliveryHealth({
  runDate,
  isOpen,
  healthDue,
  batch = null,
  delivery = null,
} = {}) {
  const dateKey = assertDateKey(runDate);
  if (!isOpen) {
    return healthResult({
      runDate: dateKey,
      healthy: true,
      status: "closed-day",
      reason: "closed-business-day",
      batch,
      delivery,
    });
  }
  if (!healthDue) {
    return healthResult({
      runDate: dateKey,
      healthy: true,
      status: "not-due",
      reason: "health-window-not-reached",
      batch,
      delivery,
    });
  }
  if (!batch || Number(batch.invocationCount || 0) < 1) {
    return healthResult({
      runDate: dateKey,
      healthy: false,
      status: "unhealthy",
      reason: "missing-scheduler-heartbeat",
      batch,
      delivery,
    });
  }

  const batchStatus = text(batch.status).toLowerCase();
  const skipReason = text(batch.skipReason).toLowerCase();
  if (batchStatus === "skipped" && skipReason === "no-active-work-orders") {
    return healthResult({
      runDate: dateKey,
      healthy: true,
      status: "no-work",
      reason: "no-active-work-orders",
      batch,
      delivery,
    });
  }
  if (batchStatus === "skipped") {
    return healthResult({
      runDate: dateKey,
      healthy: false,
      status: "unhealthy",
      reason: `unexpected-open-day-skip:${skipReason || "unknown"}`,
      batch,
      delivery,
    });
  }
  if (batchStatus === "failed" || batchStatus === "partial") {
    return healthResult({
      runDate: dateKey,
      healthy: false,
      status: "unhealthy",
      reason: `producer-${batchStatus}`,
      batch,
      delivery,
    });
  }

  const expectedQueueIds = uniqueQueueIds(batch.queueIds || []);
  if (!expectedQueueIds.length) {
    return healthResult({
      runDate: dateKey,
      healthy: false,
      status: "unhealthy",
      reason: "missing-expected-queue-evidence",
      batch,
      delivery,
    });
  }

  const queue = compactDelivery(delivery);
  if (queue.failed > 0 || queue.unknown > 0) {
    return healthResult({
      runDate: dateKey,
      healthy: false,
      status: "unhealthy",
      reason: queue.failed > 0 ? "delivery-failed" : "delivery-missing-or-unknown",
      batch,
      delivery,
    });
  }
  if (queue.pending > 0) {
    return healthResult({
      runDate: dateKey,
      healthy: false,
      status: "unhealthy",
      reason: "delivery-late-pending",
      batch,
      delivery,
    });
  }
  if (queue.total !== expectedQueueIds.length || queue.successful !== expectedQueueIds.length) {
    return healthResult({
      runDate: dateKey,
      healthy: false,
      status: "unhealthy",
      reason: "delivery-count-mismatch",
      batch,
      delivery,
      details: { expectedQueueCount: expectedQueueIds.length },
    });
  }

  return healthResult({
    runDate: dateKey,
    healthy: true,
    status: "healthy",
    reason: "all-expected-messages-delivered",
    batch,
    delivery,
    details: {
      authoritativeSuccessStatuses: [...SUCCESS_QUEUE_STATUSES],
      batchSnapshotMayBeStale: batchStatus !== "complete",
    },
  });
}

async function readVanScheduleDeliveryHealth({ db, runDate, now = new Date() } = {}) {
  if (!db || typeof db.collection !== "function") {
    throw new Error("A Firestore-compatible db is required for Van schedule health reads.");
  }
  const dateKey = assertDateKey(runDate || dateKeyInTimeZone(now));
  const today = dateKeyInTimeZone(now);
  const healthDue = healthDueForDate({
    targetDate: dateKey,
    today,
    nowMinutes: minutesInTimeZone(now),
  });
  const calendar = createOperatingCalendarService({ db });
  const isOpen = await calendar.isOpenDate(dateKey);
  if (!isOpen || !healthDue) {
    return evaluateVanScheduleDeliveryHealth({ runDate: dateKey, isOpen, healthDue });
  }

  const batchSnapshot = await db.collection("technicianDailyScheduleBatches").doc(dateKey).get();
  const batch = batchSnapshot.exists ? (batchSnapshot.data() || {}) : null;
  const queueIds = uniqueQueueIds(batch?.queueIds || []);
  const delivery = queueIds.length
    ? await summarizeQueueDelivery(db, queueIds)
    : { total: 0, successful: [], pending: [], failed: [], unknown: [] };
  return evaluateVanScheduleDeliveryHealth({ runDate: dateKey, isOpen, healthDue, batch, delivery });
}

async function main() {
  if (!getApps().length) initializeApp({ projectId: "demac-corporation" });
  const now = new Date();
  const runDate = text(process.env.HEALTH_DATE) || dateKeyInTimeZone(now);
  const result = await readVanScheduleDeliveryHealth({ db: getFirestore(), runDate, now });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports.HEALTH_DATE_PATTERN = HEALTH_DATE_PATTERN;
module.exports.HEALTH_WINDOW_START_MINUTES = HEALTH_WINDOW_START_MINUTES;
module.exports.assertDateKey = assertDateKey;
module.exports.compactDelivery = compactDelivery;
module.exports.evaluateVanScheduleDeliveryHealth = evaluateVanScheduleDeliveryHealth;
module.exports.healthDueForDate = healthDueForDate;
module.exports.healthResult = healthResult;
module.exports.minutesInTimeZone = minutesInTimeZone;
module.exports.readVanScheduleDeliveryHealth = readVanScheduleDeliveryHealth;
