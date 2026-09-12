const TASK_TIME_ZONE = "America/Aruba";

const DEFAULT_REMINDER_POLICY = Object.freeze({
  twentyFourHoursBefore: true,
  threeHoursBefore: true,
  oneHourBefore: true,
  deadlineAlert: true,
  overdueReminders: true,
  overdueIntervalHours: 12,
});

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeArubaPhone(value) {
  const digits = digitsOnly(value);
  if (!digits) return "";
  return digits.length === 7 ? `297${digits}` : digits;
}

function isTerminalTask(task) {
  return ["completed", "cancelled"].includes(String(task?.status || ""));
}

function dueMillis(task) {
  const value = Date.parse(String(task?.dueAt || ""));
  return Number.isFinite(value) ? value : null;
}

function effectiveTaskStatus(task, now = new Date()) {
  if (isTerminalTask(task)) return task.status;
  const due = dueMillis(task);
  if (due !== null && due < now.getTime()) return "overdue";
  return String(task?.status || "pending");
}

function taskPriorityWeight(priority) {
  if (priority === "critical") return 4;
  if (priority === "urgent") return 3;
  if (priority === "important") return 2;
  return 1;
}

function sortTasksByAttention(tasks, now = new Date()) {
  return [...(Array.isArray(tasks) ? tasks : [])].sort((left, right) => {
    const overdueDelta = Number(effectiveTaskStatus(right, now) === "overdue") - Number(effectiveTaskStatus(left, now) === "overdue");
    if (overdueDelta) return overdueDelta;
    const priorityDelta = taskPriorityWeight(right?.priority) - taskPriorityWeight(left?.priority);
    if (priorityDelta) return priorityDelta;
    return (dueMillis(left) ?? Number.MAX_SAFE_INTEGER) - (dueMillis(right) ?? Number.MAX_SAFE_INTEGER);
  });
}

function mergedReminderPolicy(task, automation = {}) {
  const taskPolicy = task?.reminderPolicy && typeof task.reminderPolicy === "object" ? task.reminderPolicy : {};
  return {
    ...DEFAULT_REMINDER_POLICY,
    ...taskPolicy,
    twentyFourHoursBefore: automation.twentyFourHoursBefore === false ? false : taskPolicy.twentyFourHoursBefore !== false,
    threeHoursBefore: automation.threeHoursBefore === false ? false : taskPolicy.threeHoursBefore !== false,
    oneHourBefore: automation.oneHourBefore === false ? false : taskPolicy.oneHourBefore !== false,
    deadlineAlert: automation.deadlineAlert === false ? false : taskPolicy.deadlineAlert !== false,
    overdueReminders: automation.overdueReminders === false ? false : taskPolicy.overdueReminders !== false,
    overdueIntervalHours: Math.max(1, Number(taskPolicy.overdueIntervalHours || automation.overdueIntervalHours || 12)),
  };
}

function reminderOpportunityKey(taskId, kind, scheduledMs) {
  return `${String(taskId)}:${String(kind)}:${new Date(scheduledMs).toISOString()}`;
}

function safeDocumentId(value) {
  return String(value || "unknown")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 1200);
}

function plannedReminderOpportunities(task, automation = {}) {
  if (!task?.id || isTerminalTask(task)) return [];
  const due = dueMillis(task);
  if (due === null) return [];
  const policy = mergedReminderPolicy(task, automation);
  const plans = [];
  const add = (kind, offsetMs) => {
    const scheduledMs = due + offsetMs;
    plans.push({
      taskId: task.id,
      kind,
      scheduledMs,
      scheduledFor: new Date(scheduledMs).toISOString(),
      key: reminderOpportunityKey(task.id, kind, scheduledMs),
    });
  };
  if (policy.twentyFourHoursBefore) add("pre_deadline_24h", -24 * 60 * 60 * 1000);
  if (policy.threeHoursBefore) add("pre_deadline_3h", -3 * 60 * 60 * 1000);
  if (policy.oneHourBefore) add("pre_deadline_1h", -60 * 60 * 1000);
  if (policy.deadlineAlert) add("deadline", 0);
  return plans.sort((left, right) => left.scheduledMs - right.scheduledMs);
}

function dueReminderOpportunities(task, { now = new Date(), automation = {}, windowMinutes = 20 } = {}) {
  if (!task?.id || isTerminalTask(task)) return [];
  const nowMs = now.getTime();
  const windowMs = Math.max(1, Number(windowMinutes || 20)) * 60 * 1000;
  const lowerBound = nowMs - windowMs;
  const planned = plannedReminderOpportunities(task, automation).filter((opportunity) => opportunity.scheduledMs > lowerBound && opportunity.scheduledMs <= nowMs);
  const due = dueMillis(task);
  const policy = mergedReminderPolicy(task, automation);
  if (due === null || nowMs <= due || !policy.overdueReminders) return planned;

  const intervalMs = policy.overdueIntervalHours * 60 * 60 * 1000;
  const elapsed = nowMs - due;
  const occurrence = Math.floor(elapsed / intervalMs);
  if (occurrence < 1) return planned;
  const scheduledMs = due + occurrence * intervalMs;
  if (scheduledMs > lowerBound && scheduledMs <= nowMs) {
    planned.push({
      taskId: task.id,
      kind: "overdue",
      scheduledMs,
      scheduledFor: new Date(scheduledMs).toISOString(),
      key: reminderOpportunityKey(task.id, "overdue", scheduledMs),
    });
  }
  return planned.sort((left, right) => left.scheduledMs - right.scheduledMs);
}

function formatArubaDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "No deadline";
  return new Intl.DateTimeFormat("en-AW", {
    timeZone: TASK_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function checkpointStatus(item) {
  if (item?.completed === true) return "completed";
  const status = String(item?.status || "pending");
  return ["pending", "in_progress", "waiting", "blocked", "completed"].includes(status) ? status : "pending";
}

function pendingCheckpoints(task) {
  return (Array.isArray(task?.checklist) ? task.checklist : []).filter((item) => checkpointStatus(item) !== "completed");
}

function compactText(value, maxLength = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function latestCheckpointUpdate(item) {
  const updates = Array.isArray(item?.updates) ? item.updates : [];
  return updates.length ? updates[updates.length - 1] : null;
}

function daysSince(value, now = new Date()) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / (24 * 60 * 60 * 1000)));
}

function checkpointReminderLines(task, now = new Date(), limit = 20) {
  const all = pendingCheckpoints(task);
  if (!(Array.isArray(task?.checklist) && task.checklist.length)) return ["No checklist is configured for this task."];
  if (!all.length) return ["✓ All checklist items are complete. Review and close the task if no further action is required."];

  const lines = ["Pending checkpoints:"];
  for (const item of all.slice(0, Math.max(1, limit))) {
    const status = checkpointStatus(item).replaceAll("_", " ").toUpperCase();
    lines.push(`☐ ${compactText(item?.label, 180)}${status === "PENDING" ? "" : ` [${status}]`}`);
    const latest = latestCheckpointUpdate(item);
    if (latest?.text) lines.push(`   Latest: ${compactText(latest.text, 180)}`);
    if (item?.nextAction) lines.push(`   Next: ${compactText(item.nextAction, 150)}`);
    if (item?.nextFollowUpAt) lines.push(`   Follow-up: ${formatArubaDateTime(item.nextFollowUpAt)}`);
    if (item?.waitingOn) lines.push(`   Waiting on: ${compactText(item.waitingOn, 120)}`);
    if (item?.blockedReason) lines.push(`   Blocked: ${compactText(item.blockedReason, 150)}`);
    if (item?.requiresApproval === true && item?.approvalStatus !== "approved") lines.push("   Approval: manager approval pending");
    const inactivityDays = daysSince(item?.lastUpdateAt || latest?.at || task?.createdAt, now);
    if (inactivityDays !== null && inactivityDays >= 2) lines.push(`   Attention: no progress update for ${inactivityDays} days`);
  }
  if (all.length > limit) lines.push(`…and ${all.length - limit} more pending checkpoint${all.length - limit === 1 ? "" : "s"}.`);
  return lines;
}

function checkpointReminderBlock(task, now = new Date()) {
  return checkpointReminderLines(task, now).join("\n");
}

function reminderMessage(task, opportunity, assigneeName, now = new Date()) {
  const name = String(assigneeName || task?.assigneeNameSnapshot || "team member").trim();
  const taskLabel = `${task?.taskNumber || "Task"} – ${task?.title || "Untitled task"}`;
  const due = formatArubaDateTime(task?.dueAt);
  const checkpointBlock = checkpointReminderBlock(task, now);
  let intro;
  if (opportunity?.kind === "pre_deadline_24h") intro = `Hi ${name}, reminder: ${taskLabel} is due in 24 hours. Deadline: ${due}.`;
  else if (opportunity?.kind === "pre_deadline_3h") intro = `Hi ${name}, ${taskLabel} is due in about 3 hours. Deadline: ${due}.`;
  else if (opportunity?.kind === "pre_deadline_1h") intro = `Hi ${name}, final reminder: ${taskLabel} is due in about 1 hour. Deadline: ${due}.`;
  else if (opportunity?.kind === "overdue") intro = `Hi ${name}, ${taskLabel} is overdue. Original deadline: ${due}.`;
  else intro = `Hi ${name}, ${taskLabel} has reached its deadline (${due}).`;
  return `${intro}\n\n${checkpointBlock}\n\nPlease update the checkpoint progress in DEMAC ERP.`;
}

function dailySummaryMessage(tasks, assigneeName, now = new Date()) {
  const active = sortTasksByAttention((Array.isArray(tasks) ? tasks : []).filter((task) => !isTerminalTask(task)), now);
  const sections = active.map((task, index) => {
    const status = effectiveTaskStatus(task, now).replaceAll("_", " ").toUpperCase();
    return `${index + 1}. ${task.taskNumber || "Task"} – ${task.title || "Untitled task"}\n   ${status} · Due ${formatArubaDateTime(task.dueAt)}\n${checkpointReminderLines(task, now).map((line) => `   ${line}`).join("\n")}`;
  });
  return `Good morning, ${String(assigneeName || "team member").trim()}. Here are your pending DEMAC tasks and checkpoints:\n\n${sections.length ? sections.join("\n\n") : "No pending tasks today."}\n\nPlease add a progress update whenever something changes, even when a checkpoint is not completed yet.\n\n— DEMAC ERP`;
}

function queueDocumentId(prefix, key) {
  return safeDocumentId(`${prefix}-${key}`);
}

module.exports = {
  TASK_TIME_ZONE,
  DEFAULT_REMINDER_POLICY,
  checkpointReminderBlock,
  checkpointReminderLines,
  checkpointStatus,
  dailySummaryMessage,
  dueReminderOpportunities,
  effectiveTaskStatus,
  formatArubaDateTime,
  isTerminalTask,
  latestCheckpointUpdate,
  mergedReminderPolicy,
  normalizeArubaPhone,
  pendingCheckpoints,
  plannedReminderOpportunities,
  queueDocumentId,
  reminderMessage,
  reminderOpportunityKey,
  safeDocumentId,
  sortTasksByAttention,
};
