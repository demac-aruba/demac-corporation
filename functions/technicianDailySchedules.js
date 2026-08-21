const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { createOperatingCalendarService, dateKeyInTimeZone, TIME_ZONE } = require("./operatingCalendarService");
const { createTechnicianDailyScheduleService } = require("./technicianDailyScheduleService");

const REGION = "us-central1";
const db = getFirestore();
const operatingCalendar = createOperatingCalendarService({ db });
const scheduleService = createTechnicianDailyScheduleService({ db });

exports.sendDailyTechnicianSchedules = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: TIME_ZONE,
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 300,
  },
  async () => {
    const runDate = dateKeyInTimeZone();
    const isOpen = await operatingCalendar.isOpenDate(runDate);
    if (!isOpen) {
      logger.info("Technician daily schedules skipped because DEMAC is closed.", { runDate });
      return;
    }

    const batchRef = db.collection("technicianDailyScheduleBatches").doc(runDate);
    const existingBatch = await batchRef.get();
    if (existingBatch.exists && existingBatch.data()?.status === "complete") {
      logger.info("Technician daily schedules were already processed for this workday.", { runDate });
      return;
    }

    await batchRef.set({
      runDate,
      status: "processing",
      startedAt: existingBatch.data()?.startedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    try {
      const result = await scheduleService.queueDay(runDate);
      const failures = result.results
        .filter((item) => item.queued !== true)
        .map((item) => ({
          technicianId: item.technicianId,
          technicianName: item.technicianName,
          reason: item.reason || "not-queued",
        }));
      const queuedCount = result.results.filter((item) => item.created === true).length;
      const idempotentCount = result.results.filter((item) => item.queued === true && item.created === false).length;

      await batchRef.set({
        status: failures.length ? "partial" : "complete",
        technicianCount: result.technicianCount,
        queuedCount,
        idempotentCount,
        failedCount: failures.length,
        failures,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      logger.info("Technician daily schedule batch completed.", {
        runDate,
        technicianCount: result.technicianCount,
        queuedCount,
        idempotentCount,
        failedCount: failures.length,
        status: failures.length ? "partial" : "complete",
      });
    } catch (error) {
      await batchRef.set({
        status: "partial",
        fatalError: error instanceof Error ? error.message : String(error),
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.error("Technician daily schedule batch failed.", { runDate, error });
      throw error;
    }
  },
);
