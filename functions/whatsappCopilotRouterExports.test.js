const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("./whatsappCopilotRouter");
const bootstrap = require("./bootstrap");

test("exports one public whatsappCopilotDraft endpoint from the AI-first V31 agent with V32 confirmation guard", () => {
  assert.equal(typeof router.whatsappCopilotDraft, "function");
  assert.equal(router.RUNTIME.version, 18);
  assert.equal(router.RUNTIME.flowVersion, 31);
  assert.equal(router.RUNTIME.agentVersion, 31);
  assert.equal(router.RUNTIME.confirmationGuardVersion, 32);
  assert.equal(router.RUNTIME.architecture, "ai-first-native-messages+deterministic-offer-commit+erp-tools");
  assert.equal(router.RUNTIME.functionName, "whatsappCopilotDraft");
  assert.strictEqual(bootstrap.whatsappCopilotDraft, router.whatsappCopilotDraft);
  assert.equal(router.whatsappCopilotDraftV17, undefined);
});
