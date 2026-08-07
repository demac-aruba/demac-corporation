const test = require("node:test");
const assert = require("node:assert/strict");
require("./whatsappCopilotFlowV19Fix");
const flow = require("./whatsappCopilotFlowV19");

test("interprets a bare 1 o'clock as 13:00 when the offered context is afternoon", () => {
  const offer = {
    options: [
      { date: "2026-08-10", time: "13:30" },
    ],
  };
  assert.equal(flow.contextualTime("ok pon el servicio a la 1", offer), "13:00");
});

test("inherits the only offered date when customer refines only the time block", () => {
  const analysis = {
    collectedInformation: {
      serviceType: "service",
      quantity: "3",
      address: "Sabana Liber 404",
      requestedDate: "",
      requestedTime: "",
      preferredDate: "",
      preferredTime: "",
    },
    selectedOptionOrdinal: 0,
    customerConfirmedAppointment: false,
  };
  const offer = {
    request: { serviceType: "service", quantity: 3, address: "Sabana Liber 404" },
    options: [
      { date: "2026-08-10", time: "08:30" },
      { date: "2026-08-10", time: "09:30" },
    ],
  };
  const result = flow.inheritOfferContext(analysis, offer, "en la tarde mejor");
  assert.equal(result.collectedInformation.requestedDate, "2026-08-10");
  assert.equal(result.nextAction, "query_erp_availability");
  assert.equal(result.customerConfirmedAppointment, false);
});

test("fuzzy booking command maps 'pon el servicio a la 1' to the offered 13:30 slot", () => {
  const analysis = {
    collectedInformation: {
      serviceType: "service",
      quantity: "3",
      address: "Sabana Liber 404",
      requestedDate: "",
      requestedTime: "",
      preferredDate: "",
      preferredTime: "",
    },
    selectedOptionOrdinal: 0,
    customerConfirmedAppointment: false,
  };
  const offer = {
    request: { serviceType: "service", quantity: 3, address: "Sabana Liber 404" },
    options: [
      { date: "2026-08-10", time: "13:30" },
    ],
  };
  const result = flow.inheritOfferContext(analysis, offer, "ok pon el servicio a la 1");
  assert.equal(result.selectedOptionOrdinal, 1);
  assert.equal(result.customerConfirmedAppointment, true);
  assert.equal(result.nextAction, "reserve_erp_appointment");
  assert.equal(result.collectedInformation.requestedTime, "13:30");
});

test("explains why three one-hour services cannot start after 2 p.m.", () => {
  const result = {
    options: [],
    quantity: 3,
    presentation: {
      latest: "y después de las 2",
      quantity: 3,
      totalMinutes: 180,
      latestAfternoonStart: "13:30",
      constraint: { kind: "after", time: "14:00" },
    },
  };
  assert.equal(flow.timeConstraintConflict(result), true);
  const reply = flow.formatAvailabilityReplyV19("es", result);
  assert.match(reply, /3 horas/i);
  assert.match(reply, /1:30/i);
  assert.doesNotMatch(reply, /ERP|configurad/i);
});

test("date and afternoon follow-ups use short varied intros without repeating Perfecto", () => {
  const monday = flow.naturalIntro("es", {
    quantity: 3,
    options: [{ date: "2026-08-10", time: "08:30" }, { date: "2026-08-10", time: "09:30" }],
    presentation: { latest: "tienes para el lunes", weekday: "lunes", requestedBlock: "" },
  });
  assert.match(monday, /^Sí\. Para el lunes/i);
  assert.doesNotMatch(monday, /Perfecto/i);

  const afternoon = flow.naturalIntro("es", {
    quantity: 3,
    options: [{ date: "2026-08-10", time: "13:30" }],
    presentation: { latest: "en la tarde mejor", weekday: "", requestedBlock: "afternoon" },
  });
  assert.match(afternoon, /^Sí\. Para la tarde/i);
  assert.doesNotMatch(afternoon, /Perfecto/i);
});

test("time refinements and booking commands are scheduling control turns", () => {
  assert.equal(flow.isSchedulingControlTurn("y después de las 2"), true);
  assert.equal(flow.isSchedulingControlTurn("ok pon el servicio a la 1"), true);
  assert.equal(flow.isSchedulingControlTurn("tienes para el lunes"), true);
});
