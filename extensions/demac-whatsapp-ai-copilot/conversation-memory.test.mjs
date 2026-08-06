import test from "node:test";
import assert from "node:assert/strict";
import {
  extractConversationFacts,
  injectConversationMemory,
  mergeConversationFacts,
} from "./conversation-memory.mjs";

const baseContext = {
  chatTitle: "DIRECTV",
  customerTurn: {
    text: "Pero te estoy diciendo que estoy disponible despues de 10 am",
  },
  messages: [
    { id: "1", direction: "inbound", text: "Quiero servicio para mi aire" },
    { id: "2", direction: "outbound", text: "¿Cuántos aires y cuál es la dirección?" },
    { id: "3", direction: "inbound", text: "La direccion es noord 15" },
    { id: "4", direction: "inbound", text: "4 aires" },
    { id: "5", direction: "inbound", text: "Yo estoy disponible despues de 10 am" },
  ],
};

test("extracts the address, quantity and time restriction from the full chat", () => {
  const facts = extractConversationFacts(baseContext);
  assert.equal(facts.serviceType, "service");
  assert.equal(facts.quantity, "4");
  assert.equal(facts.address.toLowerCase(), "noord 15");
  assert.equal(facts.preferredTime, "after 10:00");
});

test("keeps an earlier confirmed address when the latest turn only changes time", () => {
  const previous = { serviceType: "service", quantity: "4", address: "Noord 15" };
  const current = { preferredTime: "after 10:00" };
  assert.deepEqual(mergeConversationFacts(previous, current), {
    serviceType: "service",
    quantity: "4",
    address: "Noord 15",
    preferredTime: "after 10:00",
  });
});

test("injects internal memory without changing the customer's latest message", () => {
  const enriched = injectConversationMemory(baseContext, {
    serviceType: "service",
    quantity: "4",
    address: "Noord 15",
    preferredTime: "after 10:00",
  });
  assert.equal(enriched.customerTurn.text, baseContext.customerTurn.text);
  assert.match(enriched.messages[0].text, /address=Noord 15/);
  assert.match(enriched.messages[0].text, /preferredTime=after 10:00/);
  assert.match(enriched.messages[0].text, /No vuelvas a pedir estos datos/);
});
