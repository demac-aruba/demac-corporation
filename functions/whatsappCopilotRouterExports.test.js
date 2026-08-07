const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("./whatsappCopilotRouter");
const bootstrap = require("./bootstrap");

test("exports one public whatsappCopilotDraft endpoint from the V18 orchestrator with V22 appointment flow", () => {
  assert.equal(typeof router.whatsappCopilotDraft, "function");
  assert.equal(router.RUNTIME.version, 18);
  assert.equal(router.RUNTIME.flowVersion, 22);
  assert.equal(router.RUNTIME.functionName, "whatsappCopilotDraft");
  assert.strictEqual(bootstrap.whatsappCopilotDraft, router.whatsappCopilotDraft);
  assert.equal(router.whatsappCopilotDraftV17, undefined);
});
