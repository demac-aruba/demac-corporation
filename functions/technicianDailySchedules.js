const { getFirestore } = require("firebase-admin/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { createOperatingCalendarService, dateKeyInTimeZone } = require("./operatingCalendarService");
const { createTechnicianDailyScheduleRunner } = require("./technicianDailyScheduleRunner");
const { createTechnicianDailyScheduleService } = require("./technicianDailyScheduleService");
const {
  VAN_SCHEDULE_CRON,
  VAN_SCHEDULE_REGION,
  VAN_SCHEDULE_TIME_ZONE,
} = require("./vanScheduleDeliveryConfig");

const db = getFirestore();
const runTechnicianDailySchedule = createTechnicianDailyScheduleRunner({
  db,
  operatingCalendar: createOperatingCalendarService({ db }),
  scheduleService: createTechnicianDailyScheduleService({ db }),
  dateKey: dateKeyInTimeZone,
});

exports.sendDailyTechnicianSchedules = onSchedule(
  {
    // 8:00 AM is canonical delivery. 8:05 and 8:10 are retries inside the same
    // Cloud Scheduler job, so independent health monitoring is still required.
    schedule: VAN_SCHEDULE_CRON,
    timeZone: VAN_SCHEDULE_TIME_ZONE,
    region: VAN_SCHEDULE_REGION,
    memory: "256MiB",
    timeoutSeconds: 300,
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
    maxRetrySeconds: 900,
  },
  runTechnicianDailySchedule,
);
