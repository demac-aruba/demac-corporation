const test = require("node:test");
const assert = require("node:assert/strict");
const { _taskTrackerTest } = require("./taskTrackerApi");

const {
  allowedTransition,
  completionBlocked,
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

test("checklist input is normalized and bounded before persistence", () => {
  const taskId = "task-1";
  const result = normalizeChecklist([" Draft report ", "", { id: "custom", label: " Review " }], taskId);
  assert.deepEqual(result.map((item) => ({ id: item.id, label: item.label, completed: item.completed })), [
    { id: "task-1-item-1", label: "Draft report", completed: false },
    { id: "custom", label: "Review", completed: false },
  ]);
});
