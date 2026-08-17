const test = require("node:test");
const assert = require("node:assert/strict");

const { cleanCustomerFacingMessage } = require("./demacCustomerMessageFormatting");

test("preserves readable WhatsApp paragraphs and option lines", () => {
  const input = "Buenas tardes.\n\nTengo estos horarios disponibles:\n\n*1:30 PM*\n*2:30 PM*\n\n¿Cuál prefieres?";
  assert.equal(cleanCustomerFacingMessage(input), input);
});

test("normalizes horizontal whitespace without flattening paragraphs", () => {
  const input = "  Perfecto.   Gracias.  \r\n\r\n   *Afl. 375*   \r\n\r\n\r\n ¿Deseas agendar?  ";
  assert.equal(
    cleanCustomerFacingMessage(input),
    "Perfecto. Gracias.\n\n*Afl. 375*\n\n¿Deseas agendar?",
  );
});

test("honors the customer-facing message length limit", () => {
  assert.equal(cleanCustomerFacingMessage("abcdef", 4), "abcd");
});
