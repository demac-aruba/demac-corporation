const test = require("node:test");
const assert = require("node:assert/strict");
const { partialOutcomeRecorded } = require("./officeBookingAuthorityPartialWrapper");

test("partial outcome detection only locks appointments with recorded partial execution", () => {
  assert.equal(partialOutcomeRecorded({ executionOutcome: { status: "partial" } }), true);
  assert.equal(partialOutcomeRecorded({ executionOutcome: { status: "completed" } }), false);
  assert.equal(partialOutcomeRecorded({}), false);
  assert.equal(partialOutcomeRecorded(null), false);
});
