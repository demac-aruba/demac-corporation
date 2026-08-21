const assert = require("node:assert/strict");
const test = require("node:test");

const { migrateLegacyMetaTransactionalQueueToWacli } = require("./migrateLegacyMetaTransactionalQueueToWacli");

function fakeDb({ settings = {}, queue = [] } = {}) {
  const records = new Map(queue.map((item) => [item.id, { ...item.data }]));
  const refs = new Map([...records.keys()].map((id) => [id, { id }]));

  return {
    records,
    collection(name) {
      if (name === "businessSettings") {
        return {
          doc() {
            return {
              async get() {
                return { exists: true, data: () => ({ ...settings }) };
              },
            };
          },
        };
      }
      if (name === "whatsappOutboundQueue") {
        return {
          where(field, operator, value) {
            assert.equal(field, "status");
            assert.equal(operator, "==");
            assert.equal(value, "queued");
            return {
              async get() {
                const docs = [...records.entries()]
                  .filter(([, data]) => data.status === "queued")
                  .map(([id, data]) => ({
                    id,
                    ref: refs.get(id),
                    data: () => ({ ...data }),
                  }));
                return { docs, size: docs.length };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
    async runTransaction(callback) {
      const transaction = {
        async get(ref) {
          const data = records.get(ref.id);
          return data
            ? { exists: true, data: () => ({ ...data }) }
            : { exists: false, data: () => ({}) };
        },
        set(ref, patch) {
          records.set(ref.id, { ...(records.get(ref.id) || {}), ...patch });
        },
      };
      return callback(transaction);
    },
  };
}

const legacyReminder = {
  id: "legacy-reminder",
  data: {
    provider: "meta",
    status: "queued",
    to: "2975606772",
    templateName: "appointment_reminder_24_hours",
    languageCode: "en",
    bodyParameters: ["Stefany", "August 22, 2026", "8:30 AM", "Piedra Plat 1C", "Standard Service"],
  },
};

test("migration converts only eligible queued Meta transactional messages to wacli", async () => {
  const db = fakeDb({
    queue: [
      legacyReminder,
      { id: "normal-wacli", data: { provider: "wacli", status: "queued", to: "2975611111", text: "Normal message" } },
      { id: "failed-meta", data: { ...legacyReminder.data, status: "failed" } },
    ],
  });

  const result = await migrateLegacyMetaTransactionalQueueToWacli({ db });
  const migrated = db.records.get("legacy-reminder");

  assert.equal(result.activeProvider, "wacli");
  assert.equal(result.scanned, 2);
  assert.equal(result.migrated, 1);
  assert.equal(result.skipped, 1);
  assert.equal(migrated.provider, "wacli");
  assert.equal(migrated.type, "text");
  assert.equal(migrated.migratedFromProvider, "meta");
  assert.equal(migrated.migratedFromTemplateName, "appointment_reminder_24_hours");
  assert.match(migrated.text, /This is a reminder for your appointment/);
  assert.equal(db.records.get("normal-wacli").text, "Normal message");
  assert.equal(db.records.get("failed-meta").provider, "meta");
});

test("migration does nothing when Meta is explicitly active", async () => {
  const db = fakeDb({ settings: { transactionalProvider: "meta" }, queue: [legacyReminder] });
  const result = await migrateLegacyMetaTransactionalQueueToWacli({ db });
  assert.equal(result.activeProvider, "meta");
  assert.equal(result.scanned, 0);
  assert.equal(result.migrated, 0);
  assert.equal(db.records.get("legacy-reminder").provider, "meta");
});

test("migration does nothing when transactional outbound messaging is disabled", async () => {
  const db = fakeDb({ settings: { transactionalOutboundEnabled: false }, queue: [legacyReminder] });
  const result = await migrateLegacyMetaTransactionalQueueToWacli({ db });
  assert.equal(result.disabled, true);
  assert.equal(result.migrated, 0);
  assert.equal(db.records.get("legacy-reminder").provider, "meta");
});
