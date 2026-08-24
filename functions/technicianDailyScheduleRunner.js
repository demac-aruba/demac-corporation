const { FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const {
  VAN_SCHEDULE_AUTOMATIC_DELIVERY_KEY,
  VAN_SCHEDULE_AUTOMATIC_REASON,
  VAN_SCHEDULE_DELIVERY_MODEL,
} = require("./vanScheduleDeliveryConfig");

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function createTechnicianDailyScheduleRunner({
  db,
  operatingCalendar,
  scheduleService,
  dateKey,
  fieldValue = FieldValue,
  log = logger,
} = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  if (!operatingCalendar || typeof operatingCalendar.isOpenDate !== "function") throw new Error("An operating calendar is required.");
  if (!scheduleService || typeof scheduleService.queueDay !== "function") throw new Error("A Van schedule service is required.");
  if (typeof dateKey !== "function") throw new Error("A dateKey function is required.");

  return async function runTechnicianDailySchedule() {
    const runDate = dateKey();
    const batchRef = db.collection("technicianDailyScheduleBatches").doc(runDate);
    const existingBatch = await batchRef.get();
    const existing = existingBatch.exists ? (existingBatch.data() || {}) : {};

    // Record every function invocation before any business-day decision. This is
    // the heartbeat that distinguishes "Scheduler never invoked the function"
    // from "the function ran and intentionally skipped the date".
    await batchRef.set({
      runDate,
      deliveryModel: VAN_SCHEDULE_DELIVERY_MODEL,
      schedulerObserved: true,
      lastInvocationAt: fieldValue.serverTimestamp(),
      invocationCount: fieldValue.increment(1),
      lastDecision: "invoked",
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });

    try {
      const isOpen = await operatingCalendar.isOpenDate(runDate);
      if (!isOpen) {
        await batchRef.set({
          status: "skipped",
          skipReason: "closed-business-day",
          lastDecision: "closed-business-day",
          completedAt: fieldValue.serverTimestamp(),
          updatedAt: fieldValue.serverTimestamp(),
        }, { merge: true });
        log.info("Van group daily schedules skipped because DEMAC is closed.", { runDate });
        return { runDate, status: "skipped", reason: "closed-business-day" };
      }

      if (existing.status === "complete") {
        await batchRef.set({
          lastDecision: "already-complete",
          updatedAt: fieldValue.serverTimestamp(),
        }, { merge: true });
        log.info("Van group daily schedules were already processed for this workday.", { runDate });
        return { runDate, status: "complete", idempotent: true };
      }

      await batchRef.set({
        status: "processing",
        skipReason: null,
        fatalError: null,
        failures: [],
        startedAt: existing.startedAt || fieldValue.serverTimestamp(),
        lastAttemptAt: fieldValue.serverTimestamp(),
        attemptCount: fieldValue.increment(1),
        lastDecision: "queueing",
        updatedAt: fieldValue.serverTimestamp(),
      }, { merge: true });

      const result = await scheduleService.queueDay(runDate, {
        deliveryKey: VAN_SCHEDULE_AUTOMATIC_DELIVERY_KEY,
        reason: VAN_SCHEDULE_AUTOMATIC_REASON,
      });
      const failures = result.results
        .filter((item) => item.queued !== true)
        .map((item) => ({
          vanId: item.vanId,
          groupName: item.groupName,
          workOrderId: item.workOrderId,
          reason: item.reason || "not-queued",
        }));
      const queuedCount = result.results.filter((item) => item.created === true).length;
      const idempotentCount = result.results.filter((item) => item.queued === true && item.created === false).length;
      const status = failures.length ? "partial" : "complete";

      await batchRef.set({
        status,
        vanCount: result.vanCount,
        workOrderCount: result.workOrderCount,
        messageCount: result.messageCount,
        queuedCount,
        idempotentCount,
        failedCount: failures.length,
        failures,
        fatalError: null,
        lastDecision: status,
        completedAt: fieldValue.serverTimestamp(),
        updatedAt: fieldValue.serverTimestamp(),
      }, { merge: true });

      log.info("Van group daily schedule batch completed.", {
        runDate,
        vanCount: result.vanCount,
        workOrderCount: result.workOrderCount,
        messageCount: result.messageCount,
        queuedCount,
        idempotentCount,
        failedCount: failures.length,
        status,
      });
      return { runDate, status, ...result, failures, queuedCount, idempotentCount };
    } catch (error) {
      await batchRef.set({
        status: "partial",
        fatalError: errorText(error),
        lastDecision: "failed",
        failedAt: fieldValue.serverTimestamp(),
        updatedAt: fieldValue.serverTimestamp(),
      }, { merge: true });
      log.error("Van group daily schedule batch failed.", { runDate, error });
      throw error;
    }
  };
}

module.exports.createTechnicianDailyScheduleRunner = createTechnicianDailyScheduleRunner;
module.exports.errorText = errorText;
