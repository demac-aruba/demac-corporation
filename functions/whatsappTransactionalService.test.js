const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeWhatsAppPhone,
  safeDocumentId,
  validWhatsAppPhone,
} = require("./whatsappTransactionalService");

test("Aruba local seven-digit numbers are normalized to country code 297", () => {
  assert.equal(normalizeWhatsAppPhone("560-6772"), "2975606772");
  assert.equal(normalizeWhatsAppPhone("+297 560 6772"), "2975606772");
});

test("normalized Aruba numbers are valid WhatsApp destinations", () => {
  assert.equal(validWhatsAppPhone(normalizeWhatsAppPhone("5606772")), true);
  assert.equal(validWhatsAppPhone("123"), false);
});

test("queue document IDs are deterministic and Firestore-safe", () => {
  assert.equal(safeDocumentId("technician/2026-08-21#tech-1"), "technician_2026-08-21_tech-1");
});
