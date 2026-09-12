const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _taskTrackerTest } = require("./taskTrackerApi");

const {
  allowedTransition,
  completionBlocked,
  deterministicId,
  normalizeChecklist,
  normalizeRole,
} = _taskTrackerTest;

test("normalizes provisioned ERP roles to the Task Tracker authority model", () => {
  assert.equal(normalizeRole("admin"), "super_admin");
  assert.equal(normalizeRole("supervisor"), "operations");
  assert.equal(normalizeRole("office"), "office_operator");
  assert.equal(normalizeRole("project_manager"), "project_manager");
  assert.equal(normalizeRole("accounting"), "finance");
  assert.equal(normalizeRole("unknown-role"), null);
});

test("terminal tasks cannot be reopened by lifecycle mutation", () => {
  assert.equal(allowedTransition("pending", "in_progress"), true);
  assert.equal(allowedTransition("in_progress", "waiting"), true);
  assert.equal(allowedTransition("waiting", "completed"), true);
  assert.equal(allowedTransition("completed", "in_progress"), false);
  assert.equal(allowedTransition("cancelled", "pending"), false);
});

test("server completion policy enforces checklist and attachment requirements", () => {
  assert.match(completionBlocked({
    completionRequirement: "checklist_required",
    checklist: [{ completed: false }],
    attachments: [],
  }) || "", /checklist/i);
  assert.equal(completionBlocked({
    completionRequirement: "checklist_required",
    checklist: [{ completed: true }],
    attachments: [],
  }), null);
  assert.match(completionBlocked({
    completionRequirement: "attachment_required",
    checklist: [],
    attachments: [],
  }) || "", /attach/i);
});

test("checklist input is bounded and omits undefined Firestore fields", () => {
  const taskId = "task-1";
  const result = normalizeChecklist([
    " Draft report ",
    "",
    { id: "custom", label: " Review ", completed: false },
    { id: "done", label: " Sent ", completed: true, completedAt: "2026-09-11T12:00:00.000Z", completedByUserId: "u-1" },
  ], taskId);
  assert.deepEqual(result.map((item) => ({ id: item.id, label: item.label, completed: item.completed })), [
    { id: "task-1-item-1", label: "Draft report", completed: false },
    { id: "custom", label: "Review", completed: false },
    { id: "done", label: "Sent", completed: true },
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(result[1], "completedAt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result[1], "completedByUserId"), false);
  assert.equal(result[2].completedAt, "2026-09-11T12:00:00.000Z");
  assert.equal(result[2].completedByUserId, "u-1");
});

test("deterministic ids are stable for retry-safe task side effects", () => {
  const first = deterministicId("task-update", "actor|task|3", 32);
  const retry = deterministicId("task-update", "actor|task|3", 32);
  const nextRevision = deterministicId("task-update", "actor|task|4", 32);
  assert.equal(first, retry);
  assert.notEqual(first, nextRevision);
  assert.match(first, /^task-update-[a-f0-9]{32}$/);
});

test("state mutations require an explicit expected version and manual WhatsApp requests are deduplicated", () => {
  const source = fs.readFileSync(path.join(__dirname, "taskTrackerApi.js"), "utf8");
  assert.match(source, /const expectedVersion = Number\(payload\.expectedVersion\)/);
  assert.match(source, /version-required/);
  assert.match(source, /deterministicId\("task-update", `\$\{actor\.uid\}\|\$\{task\.id\}\|\$\{task\.version\}`/);
  assert.match(source, /transaction\.get\(queueRef\)/);
});
