const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("./whatsappCopilotRouter");
const bootstrap = require("./bootstrap");

test("exports one public whatsappCopilotDraft endpoint from AI-first agent with canonical booking core", () => {
  assert.equal(typeof router.whatsappCopilotDraft, "function");
  assert.equal(router.RUNTIME.version, 18);
  assert.equal(router.RUNTIME.flowVersion, 31);
  assert.equal(router.RUNTIME.agentVersion, 31);
  assert.equal(router.RUNTIME.confirmationGuardVersion, 32);
  assert.equal(router.RUNTIME.bookingCoreVersion, 1);
  assert.equal(router.RUNTIME.architecture, "ai-first-native-messages+canonical-booking-session+erp-tools");
  assert.equal(router.RUNTIME.functionName, "whatsappCopilotDraft");
  assert.strictEqual(bootstrap.whatsappCopilotDraft, router.whatsappCopilotDraft);
  assert.equal(router.whatsappCopilotDraftV17, undefined);
});