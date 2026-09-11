const test = require("node:test");
const assert = require("node:assert/strict");
const {
  dailySummaryMessage,
  dueReminderOpportunities,
  effectiveTaskStatus,
  normalizeArubaPhone,
  plannedReminderOpportunities,
  queueDocumentId,
  reminderMessage,
  sortTasksByAttention,
} = require("./taskReminderService");

function task(overrides = {}) {
  return {
    id: "task-1",
    taskNumber: "TSK-000001",
    title: "Delta Blue Report",
    priority: "important",
    status: "pending",
    assigneeStaffId: "staff-1",
    assigneeNameSnapshot: "Scarlett",
    assigneePhoneSnapshot: "5600000",
    dueAt: "2026-09-12T14:00:00.000Z",
    reminderPolicy: {
      dailySummary: true,
      twentyFourHoursBefore: true,
      threeHoursBefore: true,
      oneHourBefore: true,
      deadlineAlert: true,
      overdueReminders: true,
      overdueIntervalHours: 12,
    },
    ...overrides,
  };
}

test("normalizes Aruba local phone numbers", () => {
  assert.equal(normalizeArubaPhone("560-0000"), "2975600000");
  assert.equal(normalizeArubaPhone("+297 560 0000"), "2975600000");
  assert.equal(normalizeArubaPhone(""), "");
});

test("derives overdue without mutating lifecycle status", () => {
  const record = task({ status: "in_progress", dueAt: "2026-09-11T12:00:00.000Z" });
  assert.equal(effectiveTaskStatus(record, new Date("2026-09-11T13:00:00.000Z")), "overdue");
  assert.equal(record.status, "in_progress");
});

test("plans deterministic 24h, 3h, 1h and deadline reminders", () => {
  const plans = plannedReminderOpportunities(task());
  assert.deepEqual(plans.map((item) => item.kind), ["pre_deadline_24h", "pre_deadline_3h", "pre_deadline_1h", "deadline"]);
  assert.equal(plans[0].scheduledFor, "2026-09-11T14:00:00.000Z");
  assert.equal(plans[3].scheduledFor, "2026-09-12T14:00:00.000Z");
  assert.equal(new Set(plans.map((item) => item.key)).size, plans.length);
});

test("global automation may turn a reminder type off without changing task data", () => {
  const plans = plannedReminderOpportunities(task(), { threeHoursBefore: false });
  assert.equal(plans.some((item) => item.kind === "pre_deadline_3h"), false);
  assert.equal(plans.some((item) => item.kind === "pre_deadline_24h"), true);
});

test("emits an overdue cadence only while task remains open", () => {
  const record = task({ dueAt: "2026-09-11T00:00:00.000Z" });
  const due = dueReminderOpportunities(record, { now: new Date("2026-09-11T12:05:00.000Z"), windowMinutes: 20 });
  assert.equal(due.some((item) => item.kind === "overdue"), true);
  const closed = dueReminderOpportunities({ ...record, status: "completed" }, { now: new Date("2026-09-11T12:05:00.000Z"), windowMinutes: 20 });
  assert.equal(closed.length, 0);
});

test("priority and overdue state control digest attention order", () => {
  const now = new Date("2026-09-11T12:00:00.000Z");
  const tasks = [
    task({ id: "normal", taskNumber: "TSK-3", priority: "normal", dueAt: "2026-09-13T12:00:00.000Z" }),
    task({ id: "critical", taskNumber: "TSK-2", priority: "critical", dueAt: "2026-09-13T12:00:00.000Z" }),
    task({ id: "overdue", taskNumber: "TSK-1", priority: "normal", dueAt: "2026-09-10T12:00:00.000Z" }),
  ];
  assert.deepEqual(sortTasksByAttention(tasks, now).map((item) => item.id), ["overdue", "critical", "normal"]);
});

test("daily summary sends one numbered digest instead of one morning message per task", () => {
  const text = dailySummaryMessage([
    task({ id: "one", taskNumber: "TSK-1", title: "Delta Blue Report" }),
    task({ id: "two", taskNumber: "TSK-2", title: "Invoice Follow-up" }),
  ], "Scarlett", new Date("2026-09-11T12:00:00.000Z"));
  assert.match(text, /Good morning, Scarlett/);
  assert.match(text, /1\. TSK-1/);
  assert.match(text, /2\. TSK-2/);
});

test("reminder wording becomes stronger as deadline pressure increases", () => {
  const record = task();
  assert.match(reminderMessage(record, { kind: "pre_deadline_24h" }, "Scarlett"), /24 hours/i);
  assert.match(reminderMessage(record, { kind: "pre_deadline_1h" }, "Scarlett"), /final reminder/i);
  assert.match(reminderMessage(record, { kind: "overdue" }, "Scarlett"), /overdue/i);
});

test("queue ids are deterministic and Firestore-safe", () => {
  assert.equal(queueDocumentId("task-reminder", "task:one/24h"), "task-reminder-task_one_24h");
});
