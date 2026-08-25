const test = require("node:test");
const assert = require("node:assert/strict");

const { ingressIdentityFromMessage } = require("./demacCommunicationIngressMetadata");

test("ingress identity accepts provider-carried communication account provenance", () => {
  const identity = ingressIdentityFromMessage({
    provider: "wacli",
    channel: "whatsapp",
    chat: "2975600000@s.whatsapp.net",
    raw: { CommunicationAccountId: "DEMAC-WA-CORPORATE" },
  });
  assert.equal(identity.communicationAccountId, "demac-wa-corporate");
  assert.equal(identity.remoteConversationId, "2975600000@s.whatsapp.net");
  assert.equal(identity.decision.valid, true);
});

test("missing account provenance remains unverified instead of being guessed from settings", () => {
  const identity = ingressIdentityFromMessage({
    provider: "wacli",
    channel: "whatsapp",
    chat: "2975600000@s.whatsapp.net",
    raw: {},
  });
  assert.equal(identity.communicationAccountId, "");
  assert.equal(identity.decision.valid, false);
  assert.equal(identity.decision.reason, "missing-communication-account-id");
});
