const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeConversationSession,
} = require("./whatsappCopilotSessionContextV20");

test("fresh greeting removes stale appointment memory from a previous test", () => {
  const conversation = {
    chatTitle: "My Love",
    confirmedFacts: {
      serviceType: "service",
      quantity: "2",
      address: "Old Address 10",
      requestedDate: "2026-08-10",
      preferredTime: "afternoon",
    },
    customerTurn: { text: "3 aires sabana liber 404" },
    messages: [
      {
        id: "__demac_copilot_memory__",
        direction: "outbound",
        text: "NOTA INTERNA DEMAC requestedDate=2026-08-10 preferredTime=afternoon",
      },
      { id: "old1", direction: "inbound", text: "tienes para el lunes" },
      { id: "old2", direction: "outbound", text: "Sí. Para el lunes tengo estas opciones" },
      { id: "new1", direction: "inbound", text: "buenas tardes" },
      { id: "new2", direction: "outbound", text: "Buenas tardes. ¿Cómo podemos ayudarle hoy?" },
      { id: "new3", direction: "inbound", text: "servicio" },
      { id: "new4", direction: "outbound", text: "¿Cuántos aires son y cuál es la dirección?" },
      { id: "new5", direction: "inbound", text: "3 aires sabana liber 404" },
    ],
  };

  const sanitized = sanitizeConversationSession(conversation, "2026-08-07");
  assert.equal(sanitized.messages[0].text, "buenas tardes");
  assert.equal(sanitized.messages.some((message) => message.id === "__demac_copilot_memory__"), false);
  assert.deepEqual(sanitized.confirmedFacts, {
    serviceType: "service",
    quantity: "3",
    address: "sabana liber 404",
  });
});

test("a date mentioned after the new greeting is preserved", () => {
  const conversation = {
    customerTurn: { text: "tienes para mañana" },
    messages: [
      { id: "1", direction: "inbound", text: "buenos días" },
      { id: "2", direction: "inbound", text: "servicio" },
      { id: "3", direction: "inbound", text: "3 aires sabana liber 404" },
      { id: "4", direction: "inbound", text: "tienes para mañana" },
    ],
  };
  const sanitized = sanitizeConversationSession(conversation, "2026-08-07");
  assert.equal(sanitized.confirmedFacts.requestedDate, "2026-08-08");
  assert.equal(sanitized.confirmedFacts.quantity, "3");
  assert.equal(sanitized.confirmedFacts.address, "sabana liber 404");
});
