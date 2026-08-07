const test = require("node:test");
const assert = require("node:assert/strict");
const flow20 = require("./whatsappCopilotFlowV20");

test("treats 'excelente ok' as a concise confirmation", () => {
  assert.equal(flow20.isSimpleAffirmation("excelente ok"), true);
  assert.equal(flow20.isSimpleAffirmation("ok pero mejor en la tarde"), false);
});

test("a concise confirmation selects the only active offer", () => {
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
    options: [{ date: "2026-08-08", time: "13:30" }],
  };
  const result = flow20.inheritOfferContextV20(analysis, offer, "excelente ok");
  assert.equal(result.selectedOptionOrdinal, 1);
  assert.equal(result.customerConfirmedAppointment, true);
  assert.equal(result.nextAction, "reserve_erp_appointment");
  assert.equal(result.collectedInformation.requestedDate, "2026-08-08");
  assert.equal(result.collectedInformation.requestedTime, "13:30");
});

test("'dame la cita de la 1' resolves against the afternoon offer", () => {
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
    options: [{ date: "2026-08-08", time: "13:30" }],
  };
  const result = flow20.inheritOfferContextV20(analysis, offer, "ok dame la cita de la 1");
  assert.equal(result.selectedOptionOrdinal, 1);
  assert.equal(result.customerConfirmedAppointment, true);
  assert.equal(result.collectedInformation.requestedTime, "13:30");
});

test("ordinal selection does not need OpenAI inference", () => {
  const analysis = {
    collectedInformation: { serviceType: "service", quantity: "3", address: "Sabana Liber 404" },
    selectedOptionOrdinal: 0,
    customerConfirmedAppointment: false,
  };
  const offer = {
    options: [
      { date: "2026-08-08", time: "08:30" },
      { date: "2026-08-08", time: "09:30" },
    ],
  };
  const result = flow20.inheritOfferContextV20(analysis, offer, "la segunda");
  assert.equal(result.selectedOptionOrdinal, 2);
  assert.equal(result.customerConfirmedAppointment, true);
  assert.equal(result.collectedInformation.requestedTime, "09:30");
});

test("earliest feasible date wins when the customer gave no date", () => {
  const calls = [];
  const fakeGenerate = (args) => {
    const forcedDate = args.analysis?.collectedInformation?.requestedDate || "";
    calls.push(forcedDate || "initial");
    if (!forcedDate) {
      return {
        options: [
          { date: "2026-08-10", time: "08:30" },
          { date: "2026-08-10", time: "09:30" },
        ],
        requestedDate: "",
        presentation: { latest: "3 aires sabana liber 404" },
      };
    }
    if (forcedDate === "2026-08-08") {
      return {
        options: [{ date: "2026-08-08", time: "13:30" }],
        requestedDate: forcedDate,
        presentation: { latest: "3 aires sabana liber 404" },
      };
    }
    return { options: [], requestedDate: forcedDate, presentation: {} };
  };

  const result = flow20.earliestFeasibleResult(fakeGenerate, {
    today: "2026-08-07",
    request: { latestCustomerTurn: "3 aires sabana liber 404" },
    analysis: { collectedInformation: {} },
  });
  assert.equal(result.options[0].date, "2026-08-08");
  assert.equal(result.earliestDatePolicyApplied, true);
  assert.ok(calls.includes("2026-08-08"));
});
