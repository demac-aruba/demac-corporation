const test = require("node:test");
const assert = require("node:assert/strict");

const {
  activeAccountDecision,
  canonicalConversationDocumentId,
  canonicalConversationKey,
  canonicalMessageStatusDocumentId,
  canonicalProviderMessageDocumentId,
  canonicalProviderMessageKey,
  communicationIdentityDecision,
  configuredCommunicationAccountId,
} = require("./demacCommunicationIdentity");

const settings = { communicationAccountId: "DEMAC-WA-CORPORATE" };

function message(overrides = {}) {
  return {
    communicationAccountId: "demac-wa-corporate",
    provider: "wacli",
    channel: "whatsapp",
    chat: "2975600000@s.whatsapp.net",
    ...overrides,
  };
}

test("communication identity requires a first-class account", () => {
  const decision = communicationIdentityDecision({ message: message({ communicationAccountId: "" }) });
  assert.equal(decision.valid, false);
  assert.equal(decision.reason, "missing-communication-account-id");
});

test("canonical whatsapp transport setting is preferred while legacy Maya setting names remain compatible", () => {
  assert.equal(configuredCommunicationAccountId(settings), "demac-wa-corporate");
  assert.equal(configuredCommunicationAccountId({ activeCommunicationAccountId: "DEMAC-WA-LEGACY" }), "demac-wa-legacy");
  assert.equal(configuredCommunicationAccountId({ wacliCommunicationAccountId: "DEMAC-WA-OLDER" }), "demac-wa-older");
});

test("same customer on two communication accounts produces different canonical identities", () => {
  const first = canonicalConversationKey({ message: message({ communicationAccountId: "demac-wa-corporate" }) });
  const second = canonicalConversationKey({ message: message({ communicationAccountId: "demac-wa-test" }) });
  assert.notEqual(first, second);
  assert.notEqual(
    canonicalConversationDocumentId({ message: message({ communicationAccountId: "demac-wa-corporate" }) }),
    canonicalConversationDocumentId({ message: message({ communicationAccountId: "demac-wa-test" }) }),
  );
});

test("active communication account policy fails closed when configuration is missing", () => {
  const decision = activeAccountDecision({ message: message(), settings: {} });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "active-communication-account-not-configured");
});

test("Maya account policy permits only the configured active account", () => {
  assert.equal(activeAccountDecision({ message: message(), settings }).allowed, true);
  const blocked = activeAccountDecision({
    message: message({ communicationAccountId: "demac-wa-other" }),
    settings,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "communication-account-not-active");
});

test("provider message idempotency identity and document id include communication account", () => {
  const first = canonicalProviderMessageKey({
    message: message({ communicationAccountId: "demac-wa-corporate" }),
    providerMessageId: "MSG-123",
  });
  const duplicate = canonicalProviderMessageKey({
    message: message({ communicationAccountId: "demac-wa-corporate" }),
    providerMessageId: "MSG-123",
  });
  const otherAccount = canonicalProviderMessageKey({
    message: message({ communicationAccountId: "demac-wa-test" }),
    providerMessageId: "MSG-123",
  });
  assert.equal(first, duplicate);
  assert.notEqual(first, otherAccount);
  assert.equal(
    canonicalProviderMessageDocumentId({ message: message(), providerMessageId: "MSG-123" }),
    canonicalProviderMessageDocumentId({ message: message(), providerMessageId: "MSG-123" }),
  );
  assert.notEqual(
    canonicalProviderMessageDocumentId({ message: message({ communicationAccountId: "demac-wa-corporate" }), providerMessageId: "MSG-123" }),
    canonicalProviderMessageDocumentId({ message: message({ communicationAccountId: "demac-wa-test" }), providerMessageId: "MSG-123" }),
  );
});

test("message status identity is account scoped and stable for provider replay", () => {
  const first = canonicalMessageStatusDocumentId({
    message: message(),
    providerMessageId: "MSG-123",
    status: "delivered",
    providerTimestamp: "2026-08-24T20:00:00Z",
  });
  const replay = canonicalMessageStatusDocumentId({
    message: message(),
    providerMessageId: "MSG-123",
    status: "delivered",
    providerTimestamp: "2026-08-24T20:00:00Z",
  });
  const otherAccount = canonicalMessageStatusDocumentId({
    message: message({ communicationAccountId: "demac-wa-test" }),
    providerMessageId: "MSG-123",
    status: "delivered",
    providerTimestamp: "2026-08-24T20:00:00Z",
  });
  assert.equal(first, replay);
  assert.notEqual(first, otherAccount);
});
