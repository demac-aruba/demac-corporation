const test = require("node:test");
const assert = require("node:assert/strict");

const {
  HOLD_REASON,
  dispatchHoldActive,
  dispatchReadinessDecision,
  holdHistoryEvent,
  workOrderDispatchProjection,
} = require("./bookingAuthorityDispatchSafety");

test("dispatch hold is derived safety, not a second cancellation status", () => {
  const appointment = {
    status: "scheduled",
    dispatchHold: {
      active: true,
      reason: HOLD_REASON,
      caseId: "CASE-1",
    },
  };
  assert.equal(dispatchHoldActive(appointment), true);
  assert.deepEqual(dispatchReadinessDecision(appointment), {
    safeToDispatch: false,
    reason: HOLD_REASON,
    caseId: "CASE-1",
  });
  assert.equal(appointment.status, "scheduled");
});

test("canonical cancellation remains authoritative", () => {
  assert.deepEqual(dispatchReadinessDecision({ status: "cancelled" }), {
    safeToDispatch: false,
    reason: "appointment-cancelled",
  });
  assert.deepEqual(dispatchReadinessDecision({ status: "scheduled" }), {
    safeToDispatch: true,
    reason: "appointment-dispatch-ready",
  });
});

test("work-order projection cannot become ready when canonical appointment is cancelled", () => {
  assert.deepEqual(workOrderDispatchProjection({
    status: "cancelled",
    dispatchHold: { active: false, caseId: "CASE-1" },
  }), {
    dispatchSafety: "do_not_dispatch",
    dispatchHoldActive: false,
    dispatchHoldCaseId: "CASE-1",
    dispatchHoldReason: "appointment-cancelled",
  });
  assert.equal(workOrderDispatchProjection({ status: "scheduled", dispatchHold: { active: false } }).dispatchSafety, "ready");
});

test("work-order projection preserves an active hold as do_not_dispatch", () => {
  assert.deepEqual(workOrderDispatchProjection({
    status: "scheduled",
    dispatchHold: { active: true, caseId: "CASE-1", reason: HOLD_REASON },
  }), {
    dispatchSafety: "do_not_dispatch",
    dispatchHoldActive: true,
    dispatchHoldCaseId: "CASE-1",
    dispatchHoldReason: HOLD_REASON,
  });
});

test("dispatch safety history records material operational provenance", () => {
  const event = holdHistoryEvent({
    kind: "dispatch_hold_applied",
    caseId: "CASE-1",
    requestedAction: "cancellation",
    reasonCategory: "customer_unavailable",
    sourceMessageIds: ["MSG-1", "MSG-1", "MSG-2"],
    actor: { id: "demac-customer-agent", name: "Maya", source: "maya-observer" },
    now: new Date("2026-08-24T21:00:00.000Z"),
  });
  assert.equal(event.kind, "dispatch_hold_applied");
  assert.equal(event.caseId, "CASE-1");
  assert.deepEqual(event.sourceMessageIds, ["MSG-1", "MSG-2"]);
  assert.equal(event.actorName, "Maya");
});
