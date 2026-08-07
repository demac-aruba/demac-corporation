const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatNaturalCustomerReply,
  fuzzyTimeOption,
  immediateReply,
  isAvailabilityTurn,
  isGreetingOnly,
  isKnowledgeRejectionTurn,
  looksLikeAffirmativeSelection,
} = require("./whatsappCopilotConversationPolicy");

test("a simple buenos días gets the staged DEMAC welcome and never inherits an old intent", () => {
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
  assert.equal(
    reply.draft,
    "Buenos días.\n\n¿Cómo podemos ayudarle hoy?\n\n• Servicio y mantenimiento\n• Instalación\n• Reparación",
  );
  assert.doesNotMatch(reply.draft, /duraci|ERP|precio/i);
  assert.equal(reply.metadata.nextAction, "wait_for_customer");
});

test("service selection is progressive instead of asking the whole intake at once", () => {
  const reply = immediateReply({
    conversation: {
      customerTurn: { text: "servicio" },
      messages: [{ direction: "inbound", text: "servicio" }],
    },
    languageMode: "auto",
  });
  assert.equal(reply.draft, "Perfecto.\n\n¿Cuántos aires son y cuál es la dirección donde debemos ir?");
  assert.equal(reply.metadata.collectedInformation.serviceType, "service");
  assert.doesNotMatch(reply.draft, /instalaci|reparaci|tipo de trabajo/i);
});

test("availability questions are routed to scheduling rather than old knowledge context", () => {
  assert.equal(isAvailabilityTurn("¿Tienes cupo para el martes?"), true);
  assert.equal(isAvailabilityTurn("¿Tienes para el lunes?"), true);
  assert.equal(isAvailabilityTurn("hay disponibilidad el miércoles?"), true);
  assert.equal(isAvailabilityTurn("¿Y tienes cupo en la tarde?"), true);
  assert.equal(isAvailabilityTurn("cuánto dura el servicio"), false);
});

test("customer correction about duration is not treated as a new duration question", () => {
  const text = "no te pregunté nada de la duración ni el ERP";
  assert.equal(isKnowledgeRejectionTurn(text), true);
  const reply = immediateReply({
    conversation: { customerTurn: { text }, messages: [{ direction: "inbound", text }] },
    languageMode: "auto",
  });
  assert.match(reply.draft, /Disculpe la confusión/i);
  assert.doesNotMatch(reply.draft, /1 hora|duración estimada|ERP/i);
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

test("old robotic ERP duration wording is converted to a natural customer answer", () => {
  const reply = formatNaturalCustomerReply(
    "La duración estimada configurada en nuestro ERP es de aproximadamente 1 hora por cada aire.",
    "es",
  );
  assert.equal(reply, "Un servicio estándar dura aproximadamente 1 hora por cada aire.");
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