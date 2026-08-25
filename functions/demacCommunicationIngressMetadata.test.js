const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalConversationDocumentId } = require("./demacCommunicationIdentity");

const {
  conversationVerificationDecision,
  expectedCanonicalConversationId,
  ingressIdentityFromMessage,
} = require("./demacCommunicationIngressMetadata");

function canonicalConversationId(identity) {
  return canonicalConversationDocumentId({
    message: {
      communicationAccountId: identity.communicationAccountId,
      remoteConversationId: identity.remoteConversationId,
      provider: identity.provider,
      channel: identity.channel,
    },
  });
}

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
  assert.equal(expectedCanonicalConversationId(identity), canonicalConversationId(identity));
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
  assert.equal(expectedCanonicalConversationId(identity), "");
});

test("metadata verifier never treats a missing conversation as a repair target", () => {
  const identity = ingressIdentityFromMessage({
    provider: "wacli",
    channel: "whatsapp",
    communicationAccountId: "demac-wa-corporate",
    remoteConversationId: "2975600000@s.whatsapp.net",
  });
  assert.deepEqual(
    conversationVerificationDecision({ identity, conversationId: canonicalConversationId(identity), conversationExists: false }),
    { valid: false, reason: "canonical-conversation-missing" },
  );
});

test("metadata verifier rejects a conversation document id that is not derived from canonical identity", () => {
  const identity = ingressIdentityFromMessage({
    provider: "wacli",
    channel: "whatsapp",
    communicationAccountId: "demac-wa-corporate",
    remoteConversationId: "2975600000@s.whatsapp.net",
  });
  const result = conversationVerificationDecision({
    identity,
    conversationId: "COMM-LEGACY-WRONG-ID",
    conversationExists: true,
    conversation: {
      communicationAccountId: identity.communicationAccountId,
      remoteConversationId: identity.remoteConversationId,
    },
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "canonical-conversation-id-mismatch");
});

test("metadata verifier detects account and remote conversation conflicts", () => {
  const identity = ingressIdentityFromMessage({
    provider: "wacli",
    channel: "whatsapp",
    communicationAccountId: "demac-wa-corporate",
    remoteConversationId: "2975600000@s.whatsapp.net",
  });
  const conversationId = canonicalConversationId(identity);
  assert.equal(conversationVerificationDecision({
    identity,
    conversationId,
    conversationExists: true,
    conversation: { communicationAccountId: "demac-wa-other", remoteConversationId: identity.remoteConversationId },
  }).reason, "communication-account-conflict");
  assert.equal(conversationVerificationDecision({
    identity,
    conversationId,
    conversationExists: true,
    conversation: { communicationAccountId: identity.communicationAccountId, remoteConversationId: "2975999999@s.whatsapp.net" },
  }).reason, "remote-conversation-conflict");
});

test("metadata verifier accepts only the exact canonical conversation identity", () => {
  const identity = ingressIdentityFromMessage({
    provider: "wacli",
    channel: "whatsapp",
    communicationAccountId: "demac-wa-corporate",
    remoteConversationId: "2975600000@s.whatsapp.net",
  });
  const result = conversationVerificationDecision({
    identity,
    conversationId: canonicalConversationId(identity),
    conversationExists: true,
    conversation: {
      communicationAccountId: identity.communicationAccountId,
      remoteConversationId: identity.remoteConversationId,
    },
  });
  assert.deepEqual(result, { valid: true, reason: "verified" });
});
