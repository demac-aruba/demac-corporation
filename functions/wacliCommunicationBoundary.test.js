const test = require("node:test");
const assert = require("node:assert/strict");

const {
  WACLI_COMMUNICATION_ACCOUNT_HEADER,
  assignedCustomerInputVersion,
  wacliCanonicalIdentity,
  wacliCanonicalStatusId,
  wacliCommunicationAccountDecision,
} = require("./wacliCommunicationBoundary");

function request(accountId) {
  return {
    get(name) {
      return name.toLowerCase() === WACLI_COMMUNICATION_ACCOUNT_HEADER ? accountId : "";
    },
  };
}

test("bridge account boundary fails closed without canonical transport configuration", () => {
  const decision = wacliCommunicationAccountDecision({ request: request("demac-wa-corporate"), settings: {} });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "communication-account-not-configured");
});

test("bridge account boundary fails closed without asserted account header", () => {
  const decision = wacliCommunicationAccountDecision({
    request: request(""),
    settings: { communicationAccountId: "demac-wa-corporate" },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "communication-account-header-missing");
});

test("bridge account boundary rejects authenticated request for another communication account", () => {
  const decision = wacliCommunicationAccountDecision({
    request: request("demac-wa-test"),
    settings: { communicationAccountId: "demac-wa-corporate" },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "communication-account-mismatch");
});

test("bridge account boundary accepts exact normalized account binding", () => {
  const decision = wacliCommunicationAccountDecision({
    request: request("DEMAC-WA-CORPORATE"),
    settings: { communicationAccountId: "demac-wa-corporate" },
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.assertedAccountId, "demac-wa-corporate");
});

test("canonical Wacli conversation and message ids are stable and account scoped", () => {
  const first = wacliCanonicalIdentity({
    communicationAccountId: "demac-wa-corporate",
    chat: "2975600000@s.whatsapp.net",
    providerMessageId: "REMOTE-123",
  });
  const replay = wacliCanonicalIdentity({
    communicationAccountId: "demac-wa-corporate",
    chat: "2975600000@s.whatsapp.net",
    providerMessageId: "REMOTE-123",
  });
  const otherAccount = wacliCanonicalIdentity({
    communicationAccountId: "demac-wa-test",
    chat: "2975600000@s.whatsapp.net",
    providerMessageId: "REMOTE-123",
  });
  assert.equal(first.conversationId, replay.conversationId);
  assert.equal(first.messageId, replay.messageId);
  assert.notEqual(first.conversationId, otherAccount.conversationId);
  assert.notEqual(first.messageId, otherAccount.messageId);
});

test("receipt/status identity is replay stable and account scoped", () => {
  const input = {
    communicationAccountId: "demac-wa-corporate",
    chat: "2975600000@s.whatsapp.net",
    providerMessageId: "REMOTE-123",
    status: "read",
    providerTimestamp: "2026-08-24T20:00:00Z",
  };
  const first = wacliCanonicalStatusId(input);
  const replay = wacliCanonicalStatusId(input);
  const otherAccount = wacliCanonicalStatusId({ ...input, communicationAccountId: "demac-wa-test" });
  assert.equal(first, replay);
  assert.notEqual(first, otherAccount);
});

test("only a newly committed unique inbound message advances customerInputVersion", () => {
  assert.equal(assignedCustomerInputVersion({ currentConversation: { customerInputVersion: 7 }, inbound: true, messageExists: false }), 8);
  assert.equal(assignedCustomerInputVersion({
    currentConversation: { customerInputVersion: 8 },
    existingMessage: { customerInputVersion: 8 },
    inbound: true,
    messageExists: true,
  }), 8);
  assert.equal(assignedCustomerInputVersion({ currentConversation: { customerInputVersion: 8 }, inbound: false, messageExists: false }), null);
});
