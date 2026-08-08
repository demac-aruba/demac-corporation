const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BOOKING_CORE_VERSION,
  applyHardConstraints,
  bookedSessionPatch,
  offeredSessionRecord,
  selectedSessionPatch,
} = require("./whatsappCopilotBookingCoreV1");

test("miércoles en la tarde never leaks a Tuesday alternative when Wednesday has a valid slot", () => {
  const result = {
    quantity: 3,
    preset: { id: "service-standard", label: "Servicio estándar", durationMinutesPerUnit: 60 },
    options: [
      { id: "wed-pm", date: "2026-08-12", time: "13:30" },
      { id: "tue-pm", date: "2026-08-11", time: "13:30" },
    ],
  };
  const analysis = {
    collectedInformation: {
      serviceType: "service",
      quantity: "3",
      address: "Sabana Liber 404",
      requestedDate: "2026-08-12",
      preferredTime: "afternoon",
    },
  };

  const constrained = applyHardConstraints(result, analysis);
  assert.deepEqual(constrained.options.map((option) => option.id), ["wed-pm"]);
});

test("explicit afternoon constraint never falls back to a morning slot", () => {
  const result = {
    options: [
      { id: "wed-am", date: "2026-08-12", time: "08:30" },
      { id: "tue-pm", date: "2026-08-11", time: "13:30" },
    ],
  };
  const analysis = {
    collectedInformation: {
      requestedDate: "2026-08-12",
      preferredTime: "afternoon",
    },
  };

  const constrained = applyHardConstraints(result, analysis);
  assert.equal(constrained.options.length, 0);
  assert.equal(constrained.requestedDateUnavailable, true);
});

test("canonical booking session has explicit offered -> selected -> booked stages", () => {
  const option = { id: "wed-pm", date: "2026-08-12", time: "13:30", address: "Sabana Liber 404" };
  const session = offeredSessionRecord({
    key: "123@lid",
    request: { chatTitle: "My Love", contactJid: "123@lid" },
    analysis: {
      language: "es",
      intent: "service_request",
      collectedInformation: {
        serviceType: "service",
        quantity: "3",
        address: "Sabana Liber 404",
        requestedDate: "2026-08-12",
        preferredTime: "afternoon",
      },
    },
    result: {
      quantity: 3,
      preset: { id: "service-standard", label: "Servicio estándar", durationMinutesPerUnit: 60 },
      options: [option],
    },
    offer: { id: "wa-offer-1", expiresAt: "2026-08-10T00:00:00.000Z" },
    previous: { offerVersion: 4 },
  });

  assert.equal(session.bookingCoreVersion, BOOKING_CORE_VERSION);
  assert.equal(session.stage, "offered");
  assert.equal(session.offerVersion, 5);
  assert.equal(session.activeOffer.options.length, 1);
  assert.equal(session.constraints.requestedDate, "2026-08-12");
  assert.equal(session.constraints.preferredTime, "afternoon");

  const selected = selectedSessionPatch(option);
  assert.equal(selected.stage, "selected");
  assert.equal(selected.selectedOptionId, "wed-pm");

  const booked = bookedSessionPatch(option, "WO-123", ["WO-123"]);
  assert.equal(booked.stage, "booked");
  assert.equal(booked.primaryWorkOrderId, "WO-123");
  assert.deepEqual(booked.workOrderIds, ["WO-123"]);
});

test("booking runtime replaces the scheduler export before the agent loads it", () => {
  const scheduling = require("./whatsappCopilotScheduling");
  const runtime = require("./whatsappCopilotBookingRuntimeV1");
  assert.strictEqual(scheduling.orchestrateScheduling, runtime.canonicalOrchestrateScheduling);
  assert.equal(runtime.BOOKING_CORE_VERSION, 1);
});