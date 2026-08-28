const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  CUSTOMER_VISIBLE_FIELDS,
  REMINDER_SEARCH_DAYS,
  TIME_ZONE,
  confirmationEligible,
  createAppointmentNotificationService,
  customerVisibleChanges,
  dateKeyInTimeZone,
  reminderEligible,
} = require("./appointmentNotificationService");
const { createOperatingCalendarService } = require("./operatingCalendarService");
const {
  createTechnicianScheduleChangeService,
  sameDayScheduleChangeRequired,
} = require("./technicianScheduleChangeService");

const db = getFirestore();
const notificationService = createAppointmentNotificationService({ db });
const technicianScheduleChanges = createTechnicianScheduleChangeService({ db });
const operatingCalendar = createOperatingCalendarService({ db });

const REGION = "us-central1";

exports.queueAppointmentConfirmation = onDocumentWritten(
  {
    document: "workOrders/{workOrderId}",
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    const beforeSnapshot = event.data?.before;
    const afterSnapshot = event.data?.after;
    if (!afterSnapshot?.exists) return;

    const before = beforeSnapshot?.exists ? { id: beforeSnapshot.id, ...beforeSnapshot.data() } : null;
    const order = { id: afterSnapshot.id, ...afterSnapshot.data() };
    const created = !beforeSnapshot?.exists;

    // The existing Work Order trigger remains the one write boundary for both
    // customer confirmations and internal Van schedule-change alerts. Internal
    // alerts use the transactional WhatsApp authority but never inherit customer
    // recipients, so support assignments cannot create duplicate customer messages.
    if (sameDayScheduleChangeRequired(before, order)) {
      try {
        const result = await technicianScheduleChanges.queueSameDayChange({
          order,
          eventId: event.id,
          reason: created ? "same-day-work-created" : "same-day-schedule-updated",
        });
        if (!result.queued) {
          logger.info("Same-day Van schedule change was not queued.", {
            workOrderId: order.id,
            reason: result.reason,
          });
        }
      } catch (error) {
        logger.error("Could not queue a same-day Van schedule change.", {
          workOrderId: order.id,
          error,
        });
        throw error;
      }
    }

    const changedFields = created ? [...CUSTOMER_VISIBLE_FIELDS] : customerVisibleChanges(before, order);
    const becameConfirmed = !confirmationEligible(before) && confirmationEligible(order);
    if (!confirmationEligible(order)) return;
    if (!created && !becameConfirmed && changedFields.length === 0) return;

    const reason = created ? "appointment-created" : becameConfirmed ? "appointment-confirmed" : "appointment-updated";
    try {
      const result = await notificationService.queueConfirmationForOrder({
        order,
        eventId: event.id,
        reason,
        changedFields,
      });
      if (!result.queued) {
        logger.info("Appointment confirmation was not queued.", {
          workOrderId: order.id,
          reason: result.reason,
        });
      }
    } catch (error) {
      logger.error("Could not queue an appointment confirmation.", {
        workOrderId: order.id,
        error,
      });
      throw error;
    }
  },
);

exports.sendDailyAppointmentReminders = onSchedule(
  {
    schedule: "0 10 * * *",
    timeZone: TIME_ZONE,
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 300,
  },
  async () => {
    const runDate = dateKeyInTimeZone();
    const targetDate = await operatingCalendar.nextOpenDate(runDate, REMINDER_SEARCH_DAYS);

    if (!targetDate) {
      logger.warn("No future open business date was found for the appointment reminder run.", { runDate });
      return;
    }

    const reminderBatch = db.collection("reminderBatches").doc(targetDate);
    const existingBatch = await reminderBatch.get();
    if (existingBatch.exists && existingBatch.data()?.status === "complete") {
      logger.info("Appointment reminders for the next business day were already processed.", {
        runDate,
        targetDate,
      });
      return;
    }

    const ordersSnapshot = await db.collection("workOrders").where("date", "==", targetDate).get();
    const targetOrders = ordersSnapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter(reminderEligible);

    await reminderBatch.set({
      runDate,
      targetDate,
      status: "processing",
      appointmentCount: targetOrders.length,
      startedAt: existingBatch.data()?.startedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    let queuedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const order of targetOrders) {
      try {
        const result = await notificationService.queueReminderForOrder({
          order,
          eventId: `scheduled-${targetDate}`,
          reason: "daily-next-business-day-reminder",
          targetDate,
          manual: false,
        });
        if (!result.queued) {
          skippedCount += 1;
          errors.push({ workOrderId: order.id, reason: result.reason });
          continue;
        }
        queuedCount += result.notifications.filter((notification) => notification.created).length;
      } catch (error) {
        skippedCount += 1;
        errors.push({
          workOrderId: order.id,
          reason: error instanceof Error ? error.message : String(error),
        });
        logger.error("Could not queue an appointment reminder.", {
          workOrderId: order.id,
          error,
        });
      }
    }

    await reminderBatch.set({
      status: errors.length ? "partial" : "complete",
      queuedCount,
      skippedCount,
      errors,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    logger.info("Daily appointment reminder batch completed.", {
      runDate,
      targetDate,
      appointmentCount: targetOrders.length,
      queuedCount,
      skippedCount,
      status: errors.length ? "partial" : "complete",
    });
  },
);
