const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createWhatsAppTransactionalService,
  normalizeWacliRecipient,
  validWacliRecipient,
} = require("./whatsappTransactionalService");

const GROUP_JID = "120000000000000099@g.us";

test("wacli preserves WhatsApp group JIDs as canonical recipients", () => {
  assert.equal(normalizeWacliRecipient(GROUP_JID), GROUP_JID);
  assert.equal(validWacliRecipient(GROUP_JID), true);
  assert.equal(validWacliRecipient("not-a-group@g.example"), false);
});

test("transactional wacli queue accepts a group JID without phone normalization", async () => {
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
  const result = await service.queueTransactionalMessage({
    queueId: "van-2-job-1",
    to: GROUP_JID,
    text: "Schedule test",
    metadata: { notificationType: "van-daily-work-order" },
  });

  assert.equal(result.queued, true);
  assert.equal(result.to, GROUP_JID);
  assert.equal(writes.get("van-2-job-1").to, GROUP_JID);
  assert.equal(writes.get("van-2-job-1").provider, "wacli");
  assert.equal(writes.get("van-2-job-1").type, "text");
});
