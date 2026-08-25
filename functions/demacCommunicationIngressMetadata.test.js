const test = require("node:test");
const assert = require("node:assert/strict");

const {
  conversationVerificationDecision,
  ingressIdentityFromMessage,
} = require("./demacCommunicationIngressMetadata");

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

test("metadata verifier never treats a missing conversation as a repair target", () => {
  const identity = ingressIdentityFromMessage({
    provider: "wacli",
    channel: "whatsapp",
    communicationAccountId: "demac-wa-corporate",
    remoteConversationId: "2975600000@s.whatsapp.net",
  });
  assert.deepEqual(
    conversationVerificationDecision({ identity, conversationExists: false }),
    { valid: false, reason: "canonical-conversation-missing" },
  );
});

test("metadata verifier detects account and remote conversation conflicts", () => {
  const identity = ingressIdentityFromMessage({
    provider: "wacli",
    channel: "whatsapp",
    communicationAccountId: "demac-wa-corporate",
    remoteConversationId: "2975600000@s.whatsapp.net",
  });
  assert.equal(conversationVerificationDecision({
    identity,
    conversationExists: true,
    conversation: { communicationAccountId: "demac-wa-other", remoteConversationId: identity.remoteConversationId },
  }).reason, "communication-account-conflict");
  assert.equal(conversationVerificationDecision({
    identity,
    conversationExists: true,
    conversation: { communicationAccountId: identity.communicationAccountId, remoteConversationId: "2975999999@s.whatsapp.net" },
  }).reason, "remote-conversation-conflict");
});
