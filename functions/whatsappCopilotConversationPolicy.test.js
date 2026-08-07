const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatNaturalCustomerReply,
  fuzzyTimeOption,
  immediateReply,
  isAvailabilityTurn,
  isGreetingOnly,
  looksLikeAffirmativeSelection,
} = require("./whatsappCopilotConversationPolicy");

test("a simple buenos días stays a greeting and does not inherit an old intent", () => {
  assert.equal(isGreetingOnly("Buenos días"), true);
  const reply = immediateReply({
    conversation: {
      customerTurn: { text: "Buenos días" },
      messages: [
        { direction: "inbound", text: "cuanto dura el servicio" },
        { direction: "outbound", text: "un servicio dura una hora" },
        { direction: "inbound", text: "Buenos días" },
      ],
    },
    languageMode: "auto",
  });
  assert.equal(reply.draft, "Buenos días. ¿Cómo puedo ayudarle?");
});

test("availability questions are routed to scheduling rather than knowledge", () => {
  assert.equal(isAvailabilityTurn("¿Tienes cupo para el martes?"), true);
  assert.equal(isAvailabilityTurn("hay disponibilidad el miércoles?"), true);
});

test("multi-question replies are separated into natural paragraphs", () => {
  const reply = formatNaturalCustomerReply(
    "Perfecto. ¿Me pasa la dirección donde serán los 3 aires? Además, ¿se refiere al miércoles 12 o al miércoles 19? ¿Es servicio o instalación?",
    "es",
  );
  assert.match(reply, /Perfecto\.\n\n¿Me pasa/);
  assert.match(reply, /aires\?\n\nAdemás/);
  assert.match(reply, /19\?\n\n¿Es servicio/);
});

test("internal ERP wording is removed from customer-facing duration text", () => {
  const reply = formatNaturalCustomerReply(
    "La duración estimada configurada en nuestro ERP es de aproximadamente 1 hora por cada aire.",
    "es",
  );
  assert.doesNotMatch(reply, /ERP|configur/i);
});

test("8:00 resolves to the unique offered option at 8:30", () => {
  const option = fuzzyTimeOption([
    { id: "one", time: "08:30" },
    { id: "two", time: "09:30" },
  ], "08:00");
  assert.equal(option.id, "one");
  assert.equal(looksLikeAffirmativeSelection("a las 8 está bien"), true);
});
