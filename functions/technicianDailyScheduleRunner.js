const { FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const {
  VAN_SCHEDULE_AUTOMATIC_DELIVERY_KEY,
  VAN_SCHEDULE_AUTOMATIC_REASON,
  VAN_SCHEDULE_DELIVERY_MODEL,
} = require("./vanScheduleDeliveryConfig");

const SUCCESS_QUEUE_STATUSES = new Set(["sent", "delivered", "read"]);
const PENDING_QUEUE_STATUSES = new Set(["queued", "processing"]);
const FAILURE_QUEUE_STATUSES = new Set(["failed", "cancelled"]);

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizedStatus(value) {
  return String(value || "unknown").trim().toLowerCase() || "unknown";
}

function uniqueQueueIds(...collections) {
  return [...new Set(collections.flat().map((value) => String(value || "").trim()).filter(Boolean))];
}

async function summarizeQueueDelivery(db, queueIds = []) {
  const ids = uniqueQueueIds(queueIds);
  const items = await Promise.all(ids.map(async (queueId) => {
    const snapshot = await db.collection("whatsappOutboundQueue").doc(queueId).get();
    if (!snapshot.exists) return { queueId, status: "missing", errorMessage: "Queue item is missing." };
    const data = snapshot.data() || {};
    return {
      queueId,
      status: normalizedStatus(data.status),
      messageId: String(data.messageId || ""),
      errorMessage: String(data.errorMessage || ""),
    };
  }));

  const successful = items.filter((item) => SUCCESS_QUEUE_STATUSES.has(item.status));
  const pending = items.filter((item) => PENDING_QUEUE_STATUSES.has(item.status));
  const failed = items.filter((item) => FAILURE_QUEUE_STATUSES.has(item.status));
  const unknown = items.filter((item) => (
    !SUCCESS_QUEUE_STATUSES.has(item.status)
      && !PENDING_QUEUE_STATUSES.has(item.status)
      && !FAILURE_QUEUE_STATUSES.has(item.status)
  ));

  return {
    total: items.length,
    successful,
    pending,
    failed,
    unknown,
  };
}

function producerFailures(results = []) {
  return results
    .filter((item) => item?.queued !== true)
    .map((item) => ({
      phase: "producer",
      vanId: item?.vanId || null,
      groupName: item?.groupName || null,
      workOrderId: item?.workOrderId || null,
      reason: item?.reason || "not-queued",
    }));
}

function deliveryFailures(summary) {
  return [...summary.failed, ...summary.unknown].map((item) => ({
    phase: "delivery",
    queueId: item.queueId,
    status: item.status,
    reason: item.errorMessage || `queue-${item.status}`,
  }));
}

async function writeBatchOutcome(db, batchRef, payload, { preserveComplete = true } = {}) {
  let preservedComplete = false;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(batchRef);
    const current = snapshot.exists ? (snapshot.data() || {}) : {};
    if (preserveComplete && current.status === "complete" && payload.status !== "complete") {
      preservedComplete = true;
      return;
    }
    transaction.set(batchRef, payload, { merge: true });
  });
  return { preservedComplete };
}

function scheduledDate(event, dateKey) {
  const value = String(event?.scheduleTime || "").trim();
  if (!value) return dateKey(new Date());
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? dateKey(new Date()) : dateKey(parsed);
}

function createTechnicianDailyScheduleRunner({
  db,
  operatingCalendar,
  scheduleService,
  dateKey,
  fieldValue = FieldValue,
  log = logger,
} = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db with transaction support is required.");
  }
  if (!operatingCalendar || typeof operatingCalendar.isOpenDate !== "function") throw new Error("An operating calendar is required.");
  if (!scheduleService || typeof scheduleService.queueDay !== "function") throw new Error("A Van schedule service is required.");
  if (typeof dateKey !== "function") throw new Error("A dateKey function is required.");

  return async function runTechnicianDailySchedule(event = {}) {
    const runDate = scheduledDate(event, dateKey);
    const batchRef = db.collection("technicianDailyScheduleBatches").doc(runDate);

    // This heartbeat is intentionally written before business-day logic. Its
    // existence proves that the scheduled function was invoked even when the
    // function later skips, fails, or finds an already-completed batch.
    await batchRef.set({
      runDate,
      deliveryModel: VAN_SCHEDULE_DELIVERY_MODEL,
      lastInvocationAt: fieldValue.serverTimestamp(),
      invocationCount: fieldValue.increment(1),
      schedulerJobName: String(event?.jobName || "").trim() || null,
      schedulerScheduleTime: String(event?.scheduleTime || "").trim() || null,
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });

    try {
      let snapshot = await batchRef.get();
      let existing = snapshot.exists ? (snapshot.data() || {}) : {};
      if (existing.status === "complete") {
        log.info("Van group daily schedules were already delivered for this workday.", { runDate });
        return { runDate, status: "complete", idempotent: true };
      }

      const isOpen = await operatingCalendar.isOpenDate(runDate);
      if (!isOpen) {
        const outcome = await writeBatchOutcome(db, batchRef, {
          status: "skipped",
          skipReason: "closed-business-day",
          completedAt: fieldValue.serverTimestamp(),
          updatedAt: fieldValue.serverTimestamp(),
        });
        if (outcome.preservedComplete) return { runDate, status: "complete", idempotent: true };
        log.info("Van group daily schedules skipped because DEMAC is closed.", { runDate });
        return { runDate, status: "skipped", reason: "closed-business-day" };
      }

      let processingStarted = false;
      await db.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(batchRef);
        const current = currentSnapshot.exists ? (currentSnapshot.data() || {}) : {};
        existing = current;
        if (current.status === "complete") return;
        processingStarted = true;
        transaction.set(batchRef, {
          status: "processing",
          skipReason: null,
          fatalError: null,
          startedAt: current.startedAt || fieldValue.serverTimestamp(),
          lastAttemptAt: fieldValue.serverTimestamp(),
          attemptCount: fieldValue.increment(1),
          updatedAt: fieldValue.serverTimestamp(),
        }, { merge: true });
      });
      if (!processingStarted) return { runDate, status: "complete", idempotent: true };

      const result = await scheduleService.queueDay(runDate, {
        deliveryKey: VAN_SCHEDULE_AUTOMATIC_DELIVERY_KEY,
        reason: VAN_SCHEDULE_AUTOMATIC_REASON,
      });
      const productionFailures = producerFailures(result.results);
      const currentQueueIds = (result.results || [])
        .filter((item) => item?.queued === true)
        .map((item) => item.queueId);
      const queueIds = uniqueQueueIds(existing.queueIds || [], currentQueueIds);
      const delivery = await summarizeQueueDelivery(db, queueIds);
      const failures = [...productionFailures, ...deliveryFailures(delivery)];
      const createdQueueCount = (result.results || []).filter((item) => item?.created === true).length;
      const existingQueueCount = (result.results || []).filter((item) => item?.queued === true && item?.created === false).length;

      let status = "complete";
      let skipReason = null;
      if (!queueIds.length && Number(result.workOrderCount || 0) === 0) {
        status = "skipped";
        skipReason = "no-active-work-orders";
      } else if (failures.length) {
        status = "partial";
      } else if (delivery.pending.length) {
        status = "queued";
      }

      const terminal = status === "complete" || status === "skipped";
      const outcome = await writeBatchOutcome(db, batchRef, {
        status,
        skipReason,
        vanCount: result.vanCount,
        workOrderCount: result.workOrderCount,
        messageCount: result.messageCount,
        queueIds,
        createdQueueCount,
        existingQueueCount,
        deliveredCount: delivery.successful.length,
        pendingCount: delivery.pending.length,
        failedCount: failures.length,
        failures,
        fatalError: null,
        lastReconciledAt: fieldValue.serverTimestamp(),
        completedAt: terminal ? fieldValue.serverTimestamp() : null,
        updatedAt: fieldValue.serverTimestamp(),
      });
      if (outcome.preservedComplete) return { runDate, status: "complete", idempotent: true };

      log.info("Van group daily schedule batch reconciled.", {
        runDate,
        vanCount: result.vanCount,
        workOrderCount: result.workOrderCount,
        messageCount: result.messageCount,
        deliveredCount: delivery.successful.length,
        pendingCount: delivery.pending.length,
        failedCount: failures.length,
        status,
      });
      return {
        runDate,
        status,
        ...result,
        queueIds,
        failures,
        deliveredCount: delivery.successful.length,
        pendingCount: delivery.pending.length,
        createdQueueCount,
        existingQueueCount,
      };
    } catch (error) {
      const outcome = await writeBatchOutcome(db, batchRef, {
        status: "failed",
        fatalError: errorText(error),
        failedAt: fieldValue.serverTimestamp(),
        updatedAt: fieldValue.serverTimestamp(),
      });
      if (!outcome.preservedComplete) log.error("Van group daily schedule batch failed.", { runDate, error });
      throw error;
    }
  };
}

module.exports.FAILURE_QUEUE_STATUSES = FAILURE_QUEUE_STATUSES;
module.exports.PENDING_QUEUE_STATUSES = PENDING_QUEUE_STATUSES;
module.exports.SUCCESS_QUEUE_STATUSES = SUCCESS_QUEUE_STATUSES;
module.exports.createTechnicianDailyScheduleRunner = createTechnicianDailyScheduleRunner;
module.exports.deliveryFailures = deliveryFailures;
module.exports.errorText = errorText;
module.exports.producerFailures = producerFailures;
module.exports.scheduledDate = scheduledDate;
module.exports.summarizeQueueDelivery = summarizeQueueDelivery;
module.exports.uniqueQueueIds = uniqueQueueIds;
module.exports.writeBatchOutcome = writeBatchOutcome;
