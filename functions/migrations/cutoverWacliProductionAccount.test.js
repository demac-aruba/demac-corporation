const assert = require("node:assert/strict");
const test = require("node:test");
const {
  alreadyApplied,
  cutoverWacliProductionAccount,
  normalizePhone,
} = require("./cutoverWacliProductionAccount");

function createFakeDb({ settings = {}, conversations = [] } = {}) {
  const state = {
    settings: { ...settings },
    conversations: new Map(conversations.map((item) => [item.id, { ...item }])),
    deleted: [],
  };
  const settingsRef = {
    async get() { return { exists: Object.keys(state.settings).length > 0, data: () => ({ ...state.settings }) }; },
    async set(value) { state.settings = { ...state.settings, ...value }; },
  };
  const db = {
    state,
    collection(name) {
      if (name === "businessSettings") return { doc() { return settingsRef; } };
      if (name === "communicationConversations") {
        return {
          limit(limit) {
            return {
              async get() {
                const docs = [...state.conversations.keys()].slice(0, limit).map((id) => ({ id, ref: { id } }));
                return { empty: docs.length === 0, docs };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
    batch() {
      const refs = [];
      return {
        delete(ref) { refs.push(ref); },
        async commit() {
          for (const ref of refs) {
            state.conversations.delete(ref.id);
            state.deleted.push(ref.id);
          }
        },
      };
    },
  };
  return db;
}

test("normalizes Aruba local company phone to international form", () => {
  assert.equal(normalizePhone("564-2625"), "2975642625");
});

test("detects an already-applied projection generation", () => {
  assert.equal(alreadyApplied({
    wacliActiveAccountPhone: "2975642625",
    communicationProjectionGeneration: "company-v1",
  }, { targetPhone: "2975642625", generation: "company-v1" }), true);
});

test("cutover clears only the live conversation projection and records active company account", async () => {
  const db = createFakeDb({ conversations: [{ id: "legacy-1" }, { id: "legacy-2" }] });
  const result = await cutoverWacliProductionAccount({
    db,
    targetPhone: "5642625",
    generation: "company-v1",
    now: new Date("2026-08-21T20:25:00.000Z"),
  });

  assert.equal(result.applied, true);
  assert.equal(result.deletedConversations, 2);
  assert.deepEqual(db.state.deleted.sort(), ["legacy-1", "legacy-2"]);
  assert.equal(db.state.conversations.size, 0);
  assert.equal(db.state.settings.wacliActiveAccountPhone, "2975642625");
  assert.equal(db.state.settings.communicationProjectionGeneration, "company-v1");
  assert.equal(db.state.settings.communicationProjectionCutoverAt, "2026-08-21T20:25:00.000Z");
  assert.equal(db.state.settings.legacyConversationProjectionRetired, true);
  assert.equal(db.state.settings.transactionalProvider, "wacli");
});

test("cutover is idempotent and never clears a second time for the same generation", async () => {
  const db = createFakeDb({
    settings: {
      wacliActiveAccountPhone: "2975642625",
      communicationProjectionGeneration: "company-v1",
    },
    conversations: [{ id: "current-company-chat" }],
  });
  const result = await cutoverWacliProductionAccount({ db, targetPhone: "2975642625", generation: "company-v1" });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "already-applied");
  assert.equal(db.state.conversations.has("current-company-chat"), true);
});
