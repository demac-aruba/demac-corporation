const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("./whatsappCopilotRouter");

test("exports the legacy and V17 endpoints as distinct Cloud Function objects", () => {
  assert.equal(typeof router.whatsappCopilotDraft, "function");
  assert.equal(typeof router.whatsappCopilotDraftV17, "function");
  assert.notStrictEqual(router.whatsappCopilotDraft, router.whatsappCopilotDraftV17);
});
