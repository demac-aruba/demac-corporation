const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("./whatsappCopilotRouter");
const bootstrap = require("./bootstrap");

test("exports one public WhatsApp customer endpoint backed only by Customer Runtime V1", () => {
  assert.equal(typeof router.whatsappCopilotDraft, "function");
  assert.equal(router.RUNTIME.version, 1);
  assert.equal(router.RUNTIME.source, "demac-customer-agent-runtime-v1+booking-authority");
  assert.equal(router.RUNTIME.architecture, "single-agent-tool-loop+erp-tools+booking-authority");
  assert.equal(router.RUNTIME.bookingAuthority, true);
  assert.equal(router.RUNTIME.toolCount, 9);
  assert.equal(router.RUNTIME.functionName, "whatsappCopilotDraft");
  assert.strictEqual(bootstrap.whatsappCopilotDraft, router.whatsappCopilotDraft);
  assert.doesNotMatch(router.RUNTIME.source, /confirmation-guard|booking-core|agent-v31/i);
  assert.equal(router.whatsappCopilotDraftV17, undefined);
  assert.equal(bootstrap.whatsappCopilotKnowledge, undefined);
});
