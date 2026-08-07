const test = require("node:test");
const assert = require("node:assert/strict");

const state21 = require("./whatsappCopilotStateMachineV21");
const state22 = require("./whatsappCopilotStateMachineV22");

test("V22 builds a confirmed appointment analysis directly from a single active offer", () => {
  const offer = {
    id: "wa-offer-test",
    chatTitle: "My Love",
    contactPhone: "2975600000",
    request: {
      serviceType: "service",
      quantity: 3,
      address: "Sabana Liber 404",
    },
    options: [
      { id: "slot-1", date: "2026-08-08", time: "13:30", address: "Sabana Liber 404" },
    ],
  };
  const conversation = {
    chatTitle: "My Love",
    confirmedFacts: { serviceType: "service", quantity: "3", address: "Sabana Liber 404" },
  };
  const selection = state21.selectOptionFromTurn("sí", offer);
  assert.equal(selection.ordinal, 1);

  const analysis = state22.confirmedAnalysisFromOffer(conversation, offer, selection, "sí");
  assert.equal(analysis.selectedOptionOrdinal, 1);
  assert.equal(analysis.customerConfirmedAppointment, true);
  assert.equal(analysis.nextAction, "reserve_erp_appointment");
  assert.equal(analysis.collectedInformation.requestedDate, "2026-08-08");
  assert.equal(analysis.collectedInformation.requestedTime, "13:30");
  assert.equal(analysis.collectedInformation.quantity, "3");
  assert.equal(analysis.collectedInformation.address, "Sabana Liber 404");
});

test("V22 maps ERP pending approval to the auto panel reserve action", () => {
  const payload = state22.payloadFromScheduling({
    action: "appointment_pending_approval",
    reply: "Cita seleccionada",
    metadata: { selectedOption: { date: "2026-08-08", time: "13:30" } },
  }, {
    intent: "appointment_question",
    language: "es",
    summary: "selection",
    selectedOptionOrdinal: 1,
    customerConfirmedAppointment: true,
    collectedInformation: { requestedDate: "2026-08-08", requestedTime: "13:30" },
  });
  assert.equal(payload.metadata.nextAction, "reserve_erp_appointment");
  assert.equal(payload.metadata.conversationStage, "appointment_option_selected");
  assert.equal(payload.metadata.flowVersion, 22);
});

test("V22 maps ERP booked result to a completed appointment state", () => {
  const payload = state22.payloadFromScheduling({
    action: "appointment_booked",
    reply: "Listo. Su cita quedó confirmada.",
    metadata: { appointmentCreated: true, primaryWorkOrderId: "WO-WA-TEST" },
  }, {
    intent: "appointment_question",
    language: "es",
    summary: "selection",
    selectedOptionOrdinal: 1,
    customerConfirmedAppointment: true,
    collectedInformation: { requestedDate: "2026-08-08", requestedTime: "13:30" },
  });
  assert.equal(payload.metadata.nextAction, "wait_for_customer");
  assert.equal(payload.metadata.conversationStage, "appointment_confirmed");
  assert.equal(payload.metadata.scheduling.appointmentCreated, true);
  assert.equal(payload.metadata.flowVersion, 22);
});
