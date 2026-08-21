const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_TRANSACTIONAL_PROVIDER,
  createWhatsAppTransactionalService,
  normalizeTransactionalProvider,
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

test("wacli is the default transactional provider until Meta is explicitly selected", () => {
  assert.equal(DEFAULT_TRANSACTIONAL_PROVIDER, "wacli");
  assert.equal(normalizeTransactionalProvider(undefined), "wacli");
  assert.equal(normalizeTransactionalProvider(""), "wacli");
  assert.equal(normalizeTransactionalProvider("meta"), "meta");
});

test("transactional messages queue wacli text without requiring Meta sender settings", async () => {
  const writes = new Map();
  const db = {
    collection(name) {
      if (name === "businessSettings") {
        return {
          doc() {
            return {
              async get() {
                return { exists: false, data: () => ({}) };
              },
            };
          },
        };
      }
      if (name === "whatsappOutboundQueue") {
        return {
          doc(id) {
            return {
              async create(payload) {
                if (writes.has(id)) {
                  const error = new Error("already exists");
                  error.code = 6;
                  throw error;
                }
                writes.set(id, payload);
              },
            };
          },
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
  };
  const service = createWhatsAppTransactionalService({ db });
  const result = await service.queueTransactionalMessage({
    queueId: "reminder-1",
    to: "560-6772",
    text: "Reminder test",
    templateName: "appointment_reminder_24_hours",
  });
  const queued = writes.get("reminder-1");

  assert.equal(result.provider, "wacli");
  assert.equal(result.to, "2975606772");
  assert.equal(queued.provider, "wacli");
  assert.equal(queued.type, "text");
  assert.equal(queued.text, "Reminder test");
  assert.equal(queued.phoneNumberId, undefined);
  assert.equal(queued.templateName, undefined);
});
