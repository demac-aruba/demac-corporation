const test = require("node:test");
const assert = require("node:assert/strict");
const cases = require("./evals/customerAgentBookingSelectionCases.json");

test("preserves the booking-selection semantic regression catalog", () => {
  assert.equal(cases.length, 12);
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);

  const byId = new Map(cases.map((item) => [item.id, item]));
  assert.equal(byId.get("bare-yes-two-options-remains-ambiguous")?.expected.mayCreateAppointment, false);
  assert.equal(byId.get("bare-yes-one-option-can-confirm")?.expected.optionId, "opt-1");
  assert.equal(byId.get("exact-one-does-not-silently-become-one-thirty")?.expected.mayCreateAppointment, false);
  assert.equal(byId.get("bare-eight-selects-offered-eight-thirty")?.expected.optionId, "opt-1");
  assert.equal(byId.get("eight-am-selects-offered-eight-thirty")?.expected.optionId, "opt-1");
  assert.equal(byId.get("the-eight-one-selects-offered-eight-thirty")?.expected.optionId, "opt-1");
  assert.equal(byId.get("explicit-eight-zero-zero-does-not-select-eight-thirty")?.expected.mayCreateAppointment, false);
  assert.equal(byId.get("availability-question-afternoon-is-not-confirmation")?.expected.intent, "availability_question");
  assert.equal(byId.get("availability-question-monday-one-is-not-confirmation")?.expected.intent, "availability_question");

  for (const item of cases) {
    assert.equal(typeof item.customerMessage, "string");
    assert.ok(item.customerMessage.length > 0);
    assert.ok(Array.isArray(item.options) && item.options.length > 0);
    assert.equal(typeof item.expected?.intent, "string");
    assert.equal(typeof item.expected?.optionId, "string");
    assert.equal(typeof item.expected?.mayCreateAppointment, "boolean");
    assert.equal(typeof item.regression, "string");
    assert.ok(item.regression.length > 0);
  }
});

test("eval catalog distinguishes semantic acceptance from questions and exact-time mismatch", () => {
  const selectable = cases.filter((item) => item.expected.mayCreateAppointment);
  const nonSelectable = cases.filter((item) => !item.expected.mayCreateAppointment);
  assert.ok(selectable.length > 0);
  assert.ok(nonSelectable.length > 0);
  assert.ok(nonSelectable.some((item) => item.expected.intent === "availability_question"));
  assert.ok(nonSelectable.some((item) => item.expected.intent === "clarify_selection"));
  assert.ok(nonSelectable.some((item) => item.expected.intent === "no_exact_match"));
});
