const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  TASK_TIME_ZONE,
  dailySummaryMessage,
  dueReminderOpportunities,
  isTerminalTask,
  normalizeArubaPhone,
  queueDocumentId,
  reminderMessage,
} = require("./taskReminderService");

const db = getFirestore();
const REGION = "us-central1";
const AUTOMATION_SETTINGS_PATH = "businessSettings/task-tracker";
const ACTIVE_STATUSES = ["pending", "in_progress", "waiting"];

async function loadAutomationSettings() {
  const snapshot = await db.doc(AUTOMATION_SETTINGS_PATH).get();
  if (!snapshot.exists) return { enabled: false };
  const data = snapshot.data() || {};
  return {
    enabled: data.enabled === true,
    dailySummaryEnabled: data.dailySummaryEnabled === true,
    dailySummaryTime: String(data.dailySummaryTime || "08:00"),
    twentyFourHoursBefore: data.twentyFourHoursBefore !== false,
    threeHoursBefore: data.threeHoursBefore !== false,
    oneHourBefore: data.oneHourBefore !== false,
    deadlineAlert: data.deadlineAlert !== false,
    overdueReminders: data.overdueReminders !== false,
    overdueIntervalHours: Math.max(1, Number(data.overdueIntervalHours || 12)),
    escalateOverdue: data.escalateOverdue === true,
    escalateAfterHours: Math.max(1, Number(data.escalateAfterHours || 24)),
  };
}

async function loadActiveTasks() {
  const snapshot = await db.collection("taskRecords")
    .where("status", "in", ACTIVE_STATUSES)
    .limit(1000)
    .get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() })).filter((task) => !isTerminalTask(task));
}

function createContactResolver() {
  const cache = new Map();
  return async (task) => {
    const staffId = String(task?.assigneeStaffId || "").trim();
    if (!staffId) {
      return {
        staffId: "",
        name: String(task?.assigneeNameSnapshot || "team member").trim(),
        phone: normalizeArubaPhone(task?.assigneePhoneSnapshot),
      };
    }
    if (!cache.has(staffId)) {
      cache.set(staffId, db.collection("staffProfiles").doc(staffId).get().then((snapshot) => {
        const profile = snapshot.exists ? snapshot.data() || {} : {};
        return {
          staffId,
          name: String(profile.name || profile.displayName || task?.assigneeNameSnapshot || "team member").trim(),
          phone: normalizeArubaPhone(profile.phone || profile.mobile || task?.assigneePhoneSnapshot),
          active: snapshot.exists ? profile.active !== false : true,
        };
      }));
    }
    return cache.get(staffId);
  };
}

async function queueTextOnce({ queueId, to, text, task = null, kind, scheduledFor, taskIds = null }) {
  if (!to || !text) return { queued: false, reason: !to ? "missing-phone" : "empty-message" };
  const queueRef = db.collection("whatsappOutboundQueue").doc(queueId);
  const eventRef = task?.id ? db.collection("taskEvents").doc(queueDocumentId("task-event", queueId)) : null;
  let created = false;
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(queueRef);
    if (existing.exists) return;
    created = true;
    transaction.set(queueRef, {
      id: queueId,
      provider: "wacli",
      status: "queued",
      type: "text",
      to,
      text,
      reason: kind,
      source: "task-tracker-automation",
      taskId: task?.id || null,
      taskNumber: task?.taskNumber || null,
      taskIds: Array.isArray(taskIds) ? taskIds : null,
      scheduledFor: scheduledFor || null,
      createdByUserId: "task-reminder-automation",
      createdByName: "Task Reminder Automation",
      createdAt: FieldValue.serverTimestamp(),
    });
    if (eventRef) {
      transaction.set(eventRef, {
        id: eventRef.id,
        taskId: task.id,
        type: "reminder_queued",
        at: new Date().toISOString(),
        actorUserId: "task-reminder-automation",
        actorName: "Task Reminder Automation",
        message: text,
        metadata: { queueId, reason: kind, scheduledFor: scheduledFor || null },
      });
    }
  });
  return { queued: created, reason: created ? "queued" : "already-queued" };
}

async function processDeadlineReminderBatch({ now = new Date() } = {}) {
  const settings = await loadAutomationSettings();
  if (!settings.enabled) return { status: "disabled", queued: 0, skipped: 0 };

  const tasks = await loadActiveTasks();
  const resolveContact = createContactResolver();
  let queued = 0;
  let skipped = 0;
  const errors = [];

  for (const task of tasks) {
    const opportunities = dueReminderOpportunities(task, { now, automation: settings, windowMinutes: 20 });
    if (!opportunities.length) continue;
    const contact = await resolveContact(task);
    if (contact.active === false || !contact.phone) {
      skipped += opportunities.length;
      continue;
    }
    for (const opportunity of opportunities) {
      try {
        const queueId = queueDocumentId("task-reminder", opportunity.key);
        const result = await queueTextOnce({
          queueId,
          to: contact.phone,
          text: reminderMessage(task, opportunity, contact.name),
          task,
          kind: opportunity.kind,
          scheduledFor: opportunity.scheduledFor,
        });
        if (result.queued) queued += 1;
        else skipped += 1;
      } catch (error) {
        skipped += 1;
        errors.push({ taskId: task.id, kind: opportunity.kind, error: error?.message || String(error) });
      }
    }
  }

  return { status: errors.length ? "partial" : "complete", taskCount: tasks.length, queued, skipped, errors };
}

function arubaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TASK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function arubaClockMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TASK_TIME_ZONE,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(map.hour) * 60 + Number(map.minute);
}

function configuredClockMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || "08:00"));
  if (!match) return 8 * 60;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return 8 * 60;
  return hour * 60 + minute;
}

function dailySummaryWindowOpen(settings, now = new Date(), windowMinutes = 15) {
  const current = arubaClockMinutes(now);
  const target = configuredClockMinutes(settings?.dailySummaryTime);
  const elapsed = (current - target + (24 * 60)) % (24 * 60);
  return elapsed >= 0 && elapsed < Math.max(1, Number(windowMinutes || 15));
}

async function processDailySummaryBatch({ now = new Date() } = {}) {
  const settings = await loadAutomationSettings();
  if (!settings.enabled || !settings.dailySummaryEnabled) return { status: "disabled", queued: 0, skipped: 0 };
  if (!dailySummaryWindowOpen(settings, now, 15)) return { status: "outside-window", queued: 0, skipped: 0 };

  const tasks = (await loadActiveTasks()).filter((task) => task?.reminderPolicy?.dailySummary !== false);
  const byStaff = new Map();
  for (const task of tasks) {
    const staffId = String(task.assigneeStaffId || "").trim();
    if (!staffId) continue;
    if (!byStaff.has(staffId)) byStaff.set(staffId, []);
    byStaff.get(staffId).push(task);
  }

  const resolveContact = createContactResolver();
  const dateKey = arubaDateKey(now);
  let queued = 0;
  let skipped = 0;
  const errors = [];

  for (const [staffId, assignedTasks] of byStaff.entries()) {
    const contact = await resolveContact(assignedTasks[0]);
    if (contact.active === false || !contact.phone || !assignedTasks.length) {
      skipped += 1;
      continue;
    }
    const queueId = queueDocumentId("task-digest", `${dateKey}-${staffId}`);
    try {
      const result = await queueTextOnce({
        queueId,
        to: contact.phone,
        text: dailySummaryMessage(assignedTasks, contact.name, now),
        kind: "daily_task_summary",
        scheduledFor: `${dateKey}T${settings.dailySummaryTime || "08:00"}:00-04:00`,
        taskIds: assignedTasks.map((task) => task.id),
      });
      if (result.queued) queued += 1;
      else skipped += 1;
    } catch (error) {
      skipped += 1;
      errors.push({ staffId, error: error?.message || String(error) });
    }
  }

  return { status: errors.length ? "partial" : "complete", operatorCount: byStaff.size, queued, skipped, errors };
}

exports.processTaskDeadlineReminders = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: TASK_TIME_ZONE,
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 300,
  },
  async () => {
    const result = await processDeadlineReminderBatch();
    logger.info("Task deadline reminder batch finished.", result);
  },
);

exports.sendDailyTaskSummaries = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: TASK_TIME_ZONE,
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 300,
  },
  async () => {
    const result = await processDailySummaryBatch();
    logger.info("Daily task summary batch finished.", result);
  },
);

module.exports.arubaClockMinutes = arubaClockMinutes;
module.exports.configuredClockMinutes = configuredClockMinutes;
module.exports.dailySummaryWindowOpen = dailySummaryWindowOpen;
module.exports.processDeadlineReminderBatch = processDeadlineReminderBatch;
module.exports.processDailySummaryBatch = processDailySummaryBatch;
module.exports.loadAutomationSettings = loadAutomationSettings;
module.exports.queueTextOnce = queueTextOnce;
