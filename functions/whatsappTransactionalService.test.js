const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_TRANSACTIONAL_PROVIDER,
  buildLegacyMetaToWacliMigration,
  createWhatsAppTransactionalService,
  normalizeTransactionalProvider,
  normalizeWhatsAppPhone,
  renderTransactionalText,
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

test("legacy renderer converts appointment reminder template parameters to wacli text", () => {
  const text = renderTransactionalText({
    templateName: "appointment_reminder_24_hours",
    languageCode: "es",
    bodyParameters: ["Stefany", "22 de agosto de 2026", "8:30 a. m.", "Piedra Plat 1C", "Standard Service"],
  });
  assert.match(text, /^Hola Stefany,/);
  assert.match(text, /recordatorio de tu cita/);
  assert.match(text, /Fecha: 22 de agosto de 2026/);
  assert.match(text, /Dirección: Piedra Plat 1C/);
});

test("legacy renderer converts technician schedule template parameters to wacli text", () => {
  const text = renderTransactionalText({
    templateName: "technician_daily_schedule",
    languageCode: "es",
    bodyParameters: ["Miguel", "viernes, 21 de agosto de 2026", "1. 08:30-09:30 | Cliente | Santa Cruz | Service"],
  });
  assert.match(text, /^Hola Miguel,/);
  assert.match(text, /Esta es tu agenda de trabajo de DEMAC/);
  assert.match(text, /08:30-09:30/);
});

test("legacy queued Meta reminder is safely adoptable when wacli is active", () => {
  const migration = buildLegacyMetaToWacliMigration({
    provider: "meta",
    status: "queued",
    to: "2975606772",
    templateName: "appointment_reminder_24_hours",
    languageCode: "en",
    bodyParameters: ["Stefany", "August 22, 2026", "8:30 AM", "Piedra Plat 1C", "Standard Service"],
  }, "wacli");

  assert.equal(migration.provider, "wacli");
  assert.equal(migration.type, "text");
  assert.equal(migration.to, "2975606772");
  assert.equal(migration.migratedFromProvider, "meta");
  assert.equal(migration.migratedFromTemplateName, "appointment_reminder_24_hours");
  assert.match(migration.text, /This is a reminder for your appointment/);
});

test("legacy Meta adoption is blocked when Meta is explicitly active", () => {
  const migration = buildLegacyMetaToWacliMigration({
    provider: "meta",
    status: "queued",
    to: "2975606772",
    templateName: "appointment_reminder_24_hours",
    languageCode: "en",
    bodyParameters: ["Stefany", "August 22, 2026", "8:30 AM", "Piedra Plat 1C", "Standard Service"],
  }, "meta");
  assert.equal(migration, null);
});

test("legacy Meta adoption rejects failed, processing, unknown, or malformed messages", () => {
  const base = {
    provider: "meta",
    status: "queued",
    to: "2975606772",
    templateName: "appointment_reminder_24_hours",
    languageCode: "en",
    bodyParameters: ["Stefany", "August 22, 2026", "8:30 AM", "Piedra Plat 1C", "Standard Service"],
  };
  assert.equal(buildLegacyMetaToWacliMigration({ ...base, status: "failed" }, "wacli"), null);
  assert.equal(buildLegacyMetaToWacliMigration({ ...base, status: "processing" }, "wacli"), null);
  assert.equal(buildLegacyMetaToWacliMigration({ ...base, templateName: "unrelated_template" }, "wacli"), null);
  assert.equal(buildLegacyMetaToWacliMigration({ ...base, bodyParameters: ["Stefany"] }, "wacli"), null);
  assert.equal(buildLegacyMetaToWacliMigration({ ...base, to: "123" }, "wacli"), null);
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

test("explicit domain-rendered text wins for known wacli appointment templates", async () => {
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
  const papiamentoText = [
    "Bon tardi Stefany,",
    "",
    "Esaki ta un recordatorio pa bo cita cu *DEMAC Professional Cooling Solutions*.",
    "",
    "*Fecha:* diasabra, 22 di augustus 2026",
  ].join("\n");
  await service.queueTransactionalMessage({
    queueId: "reminder-domain-rendered",
    to: "560-6772",
    text: papiamentoText,
    templateName: "appointment_reminder_24_hours",
    languageCode: "pap",
    bodyParameters: ["Stefany", "diasabra, 22 di augustus 2026", "8:30 AM", "Piedra Plat 1C", "Instalacion standard × 1"],
  });

  assert.equal(writes.get("reminder-domain-rendered").text, papiamentoText);
  assert.doesNotMatch(writes.get("reminder-domain-rendered").text, /^Hello /);
});

test("legacy renderer remains a fallback when an older wacli caller supplies no text", async () => {
  const writes = new Map();
  const db = {
    collection(name) {
      if (name === "businessSettings") {
        return { doc() { return { async get() { return { exists: false, data: () => ({}) }; } }; } };
      }
      if (name === "whatsappOutboundQueue") {
        return { doc(id) { return { async create(payload) { writes.set(id, payload); } }; } };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
  };
  const service = createWhatsAppTransactionalService({ db });
  await service.queueTransactionalMessage({
    queueId: "legacy-reminder-fallback",
    to: "560-6772",
    templateName: "appointment_reminder_24_hours",
    languageCode: "es",
    bodyParameters: ["Stefany", "22 de agosto de 2026", "8:30 a. m.", "Piedra Plat 1C", "Standard Service"],
  });
  assert.match(writes.get("legacy-reminder-fallback").text, /^Hola Stefany,/);
});
