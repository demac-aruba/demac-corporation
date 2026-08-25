const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DISPATCH_HOLD_CONFIDENCE,
  appendCaseHistory,
  caseHistoryEvent,
  caseTypeForObservation,
  communicationCaseId,
  matchRelevantAppointment,
  shouldApplyDispatchHold,
  upcomingAppointmentCandidates,
} = require("./demacCommunicationCaseService");

const appointments = [
  { id: "APT-1", date: "2026-08-25", startTime: "08:30", status: "scheduled" },
  { id: "APT-2", date: "2026-08-26", startTime: "10:30", status: "scheduled" },
  { id: "APT-C", date: "2026-08-25", startTime: "13:30", status: "cancelled" },
];

test("communication case identity is account and workflow scoped", () => {
  const first = communicationCaseId({ communicationAccountId: "demac-wa-corporate", conversationId: "conv-1", caseType: "appointment_change" });
  const second = communicationCaseId({ communicationAccountId: "demac-wa-test", conversationId: "conv-1", caseType: "appointment_change" });
  const complaint = communicationCaseId({ communicationAccountId: "demac-wa-corporate", conversationId: "conv-1", caseType: "complaint" });
  assert.ok(first.startsWith("COMMCASE-"));
  assert.notEqual(first, second);
  assert.notEqual(first, complaint);
});

test("appointment changes share one workflow case while other material intents do not", () => {
  assert.equal(caseTypeForObservation({ intent: "cancellation" }), "appointment_change");
  assert.equal(caseTypeForObservation({ intent: "reschedule" }), "appointment_change");
  assert.equal(caseTypeForObservation({ intent: "customer_withdrew_change" }), "appointment_change");
  assert.equal(caseTypeForObservation({ intent: "complaint" }), "complaint");
  assert.equal(caseTypeForObservation({ intent: "human_request" }), "human_request");
});

test("case history retries replace the same logical event instead of duplicating it", () => {
  const first = caseHistoryEvent({
    kind: "cancellation_detected",
    messageId: "MSG-1",
    observation: { intent: "cancellation", confidence: 0.95 },
    appointmentId: "APT-1",
    now: new Date("2026-08-25T01:00:00Z"),
  });
  const replay = caseHistoryEvent({
    kind: "cancellation_detected",
    messageId: "MSG-1",
    observation: { intent: "cancellation", confidence: 0.95 },
    appointmentId: "APT-1",
    now: new Date("2026-08-25T01:00:10Z"),
  });
  assert.equal(first.id, replay.id);
  const history = appendCaseHistory([first], replay);
  assert.equal(history.length, 1);
  assert.equal(history[0].at, "2026-08-25T01:00:10.000Z");
});

test("cancelled appointments are not candidates", () => {
  assert.deepEqual(
    upcomingAppointmentCandidates(appointments, "2026-08-25").map((item) => item.id),
    ["APT-1", "APT-2"],
  );
});

test("Maya does not guess when multiple appointments are plausible", () => {
  const match = matchRelevantAppointment({
    appointments,
    observation: { intent: "cancellation", requestedDate: "", requestedTime: "" },
    today: "2026-08-25",
  });
  assert.equal(match.matched, false);
  assert.equal(match.reason, "multiple-plausible-appointments");
});

test("explicit date and time can uniquely correlate an appointment", () => {
  const match = matchRelevantAppointment({
    appointments,
    observation: { requestedDate: "2026-08-26", requestedTime: "10:30" },
    today: "2026-08-25",
  });
  assert.equal(match.matched, true);
  assert.equal(match.appointment.id, "APT-2");
});

test("single upcoming appointment is safe to correlate", () => {
  const match = matchRelevantAppointment({
    appointments: [appointments[0]],
    observation: {},
    today: "2026-08-25",
  });
  assert.equal(match.matched, true);
  assert.equal(match.reason, "single-upcoming-appointment");
});

test("dispatch hold requires high confidence, no critical ambiguity, and exact appointment match", () => {
  const match = { matched: true, appointment: { id: "APT-1" } };
  const base = {
    intent: "cancellation",
    dispatchRisk: true,
    criticalValueAmbiguous: false,
    confidence: DISPATCH_HOLD_CONFIDENCE,
  };
  assert.equal(shouldApplyDispatchHold(base, match), true);
  assert.equal(shouldApplyDispatchHold({ ...base, confidence: DISPATCH_HOLD_CONFIDENCE - 0.01 }, match), false);
  assert.equal(shouldApplyDispatchHold({ ...base, criticalValueAmbiguous: true }, match), false);
  assert.equal(shouldApplyDispatchHold({ ...base, intent: "general" }, match), false);
  assert.equal(shouldApplyDispatchHold(base, { matched: false, appointment: null }), false);
});
