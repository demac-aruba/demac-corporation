const test = require("node:test");
const assert = require("node:assert/strict");

const agent = require("./whatsappCopilotAgentV30");

test("V30 sends WhatsApp history to OpenAI as native user and assistant roles", () => {
  const messages = agent.inputMessages({
    customerTurn: { text: "sí" },
    messages: [
      { direction: "inbound", text: "tienes cupo para el lunes?" },
      { direction: "outbound", text: "Para el lunes tengo 8:30 y 9:30." },
      { direction: "inbound", text: "tienes en la tarde?" },
      { direction: "outbound", text: "Para la tarde tengo un cupo a la 1:30 p. m. ¿Le funciona?" },
      { direction: "inbound", text: "sí" },
    ],
  });

  assert.deepEqual(messages.map((item) => item.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.equal(messages.at(-1).content, "sí");
  assert.match(messages.at(-2).content, /1:30/);
});

test("V30 planner explicitly treats a short yes after one offered slot as booking", () => {
  const instructions = agent.plannerInstructions({
    company: "DEMAC",
    operator: "Operaciones",
    languageMode: "auto",
    knownFacts: { serviceType: "service", quantity: "3", address: "Sabana Liber 404" },
    activeOffer: {
      id: "offer-one",
      request: { serviceType: "service", quantity: 3, address: "Sabana Liber 404" },
      options: [{ id: "one", date: "2026-08-10", time: "13:30", address: "Sabana Liber 404" }],
    },
  });

  assert.match(instructions, /short affirmative/i);
  assert.match(instructions, /action=book_appointment/i);
  assert.match(instructions, /Do not re-open availability/i);
  assert.match(instructions, /13:30/);
});

test("V30 carries authoritative facts into an ERP scheduling action", () => {
  const decision = {
    serviceType: "service",
    quantity: 3,
    address: "Sabana Liber 404",
    requestedDate: "2026-08-10",
    requestedTime: "13:30",
    timePreference: "afternoon",
    selectedOptionOrdinal: 1,
    summary: "Customer confirmed the only afternoon slot",
    confidence: 0.99,
    missingInformation: [],
    language: "es",
  };
  const conversation = { confirmedFacts: {} };
  const offer = {
    request: { serviceType: "service", quantity: 3, address: "Sabana Liber 404" },
    options: [{ date: "2026-08-10", time: "13:30" }],
  };
  const facts = agent.mergedDecisionFacts(decision, conversation, offer);
  const analysis = agent.schedulingAnalysis(decision, facts, "book_appointment", offer);

  assert.equal(analysis.customerConfirmedAppointment, true);
  assert.equal(analysis.nextAction, "reserve_erp_appointment");
  assert.equal(analysis.selectedOptionOrdinal, 1);
  assert.equal(analysis.collectedInformation.requestedDate, "2026-08-10");
  assert.equal(analysis.collectedInformation.requestedTime, "13:30");
});

test("V30 preserves ERP facts when the customer's short reply contains no repeated details", () => {
  const decision = {
    serviceType: "",
    quantity: 0,
    address: "",
    requestedDate: "",
    requestedTime: "",
    timePreference: "",
  };
  const conversation = {
    confirmedFacts: { serviceType: "service", quantity: "3", address: "Sabana Liber 404" },
    customerTurn: { text: "sí" },
  };
  const facts = agent.mergedDecisionFacts(decision, conversation, null);
  assert.equal(facts.serviceType, "service");
  assert.equal(facts.quantity, "3");
  assert.equal(facts.address, "Sabana Liber 404");
});

test("V30 declares GPT-5.1 primary and GPT-5 mini only as fallback", () => {
  assert.equal(agent.AGENT_VERSION, 30);
  assert.equal(agent.PRIMARY_MODEL, "gpt-5.1");
  assert.equal(agent.FALLBACK_MODEL, "gpt-5-mini");
  assert.equal(agent.REASONING_EFFORT, "medium");
});
