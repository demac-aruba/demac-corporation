const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  checkpointReminderLines,
  dailySummaryMessage,
  dueReminderOpportunities,
  effectiveTaskStatus,
  normalizeArubaPhone,
  pendingCheckpoints,
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
    createdAt: "2026-09-10T12:00:00.000Z",
    dueAt: "2026-09-12T14:00:00.000Z",
    checklist: [
      { id: "a", label: "Contact customer A", completed: true, status: "completed" },
      {
        id: "b",
        label: "Confirm customer C payment",
        completed: false,
        status: "waiting",
        waitingOn: "Customer C",
        nextAction: "Call again tomorrow",
        nextFollowUpAt: "2026-09-12T13:00:00.000Z",
        lastUpdateAt: "2026-09-11T12:00:00.000Z",
        updates: [{ id: "u1", text: "Called today; customer said payment will be made tomorrow.", at: "2026-09-11T12:00:00.000Z", actorName: "Scarlett", status: "waiting" }],
      },
      { id: "c", label: "Send final report", completed: false, status: "pending" },
    ],
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

test("pending checkpoints exclude completed work and preserve open checkpoint context", () => {
  const record = task();
  assert.deepEqual(pendingCheckpoints(record).map((item) => item.id), ["b", "c"]);
  const text = checkpointReminderLines(record, new Date("2026-09-12T12:00:00.000Z")).join("\n");
  assert.doesNotMatch(text, /Contact customer A/);
  assert.match(text, /Confirm customer C payment/);
  assert.match(text, /Latest: Called today/);
  assert.match(text, /Next: Call again tomorrow/);
  assert.match(text, /Waiting on: Customer C/);
  assert.match(text, /Follow-up:/);
});

test("daily summary sends one digest grouped by task with only pending checkpoints", () => {
  const text = dailySummaryMessage([
    task({ id: "one", taskNumber: "TSK-1", title: "Delta Blue Report" }),
    task({ id: "two", taskNumber: "TSK-2", title: "Invoice Follow-up" }),
  ], "Scarlett", new Date("2026-09-11T12:00:00.000Z"));
  assert.match(text, /Good morning, Scarlett/);
  assert.match(text, /1\. TSK-1/);
  assert.match(text, /2\. TSK-2/);
  assert.match(text, /Pending checkpoints:/);
  assert.match(text, /Confirm customer C payment/);
  assert.doesNotMatch(text, /Contact customer A/);
});

test("scheduled reminder wording includes pending checkpoint context", () => {
  const record = task();
  const oneHour = reminderMessage(record, { kind: "pre_deadline_1h" }, "Scarlett", new Date("2026-09-12T13:00:00.000Z"));
  assert.match(oneHour, /final reminder/i);
  assert.match(oneHour, /Pending checkpoints:/);
  assert.match(oneHour, /Confirm customer C payment/);
  assert.doesNotMatch(oneHour, /Contact customer A/);
  assert.match(reminderMessage(record, { kind: "overdue" }, "Scarlett"), /overdue/i);
});

test("reminder reports when all checklist items are complete but task remains open", () => {
  const record = task({ checklist: [{ id: "a", label: "Done", completed: true, status: "completed" }] });
  assert.match(reminderMessage(record, { kind: "pre_deadline_24h" }, "Scarlett"), /All checklist items are complete/i);
});

test("queue ids are deterministic and Firestore-safe", () => {
  assert.equal(queueDocumentId("task-reminder", "task:one/24h"), "task-reminder-task_one_24h");
});

test("scheduled reminder workers require both backend activation and automation enablement", () => {
  const source = fs.readFileSync(path.join(__dirname, "taskReminders.js"), "utf8");
  assert.match(source, /backendEnabled:\s*data\.backendEnabled === true/);
  assert.match(source, /settings\?\.backendEnabled === true && settings\?\.enabled === true/);
  assert.match(source, /if \(!automationRuntimeEnabled\(settings\)\)/);
  assert.match(source, /if \(!automationRuntimeEnabled\(settings\) \|\| !settings\.dailySummaryEnabled\)/);
});
