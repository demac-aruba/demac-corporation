const test = require("node:test");
const assert = require("node:assert/strict");

const {
  configuredAllowlist,
  mayaBusinessActionDecision,
  mayaObservationDecision,
  mayaReplyDecision,
  normalizeArubaWhatsAppPhone,
  projectedReplyPolicyContext,
  resolveConversationPhone,
} = require("./demacCustomerAgentReplyPolicy");

test("normalizes Aruba local and WhatsApp JID phone formats", () => {
  assert.equal(normalizeArubaWhatsAppPhone("560-0000"), "2975600000");
  assert.equal(normalizeArubaWhatsAppPhone("+297 560 0000"), "2975600000");
  assert.equal(normalizeArubaWhatsAppPhone("2975600000@s.whatsapp.net"), "2975600000");
});

test("allowlist accepts strings and labeled entries without duplicates", () => {
  assert.deepEqual(configuredAllowlist({
    autoReplyAllowlist: [
      "560-0000",
      { label: "Tester One", phone: "+297 560 0000" },
      { label: "Tester Two", whatsapp: "2975820000" },
    ],
  }), ["2975600000", "2975820000"]);
});

test("conversation phone prefers canonical message or conversation phone", () => {
  assert.equal(resolveConversationPhone({
    message: { phone: "2975600000", chat: "2975999999@s.whatsapp.net" },
    conversation: { phone: "2975888888" },
  }), "2975600000");
});

test("Maya is fail-closed when settings are missing", () => {
  assert.deepEqual(mayaReplyDecision({ message: { phone: "2975600000" } }), {
    allowed: false,
    mode: "allowlist",
    phone: "2975600000",
    reason: "auto-reply-disabled",
  });
});

test("legacy allowlist mode remains backward compatible", () => {
  const settings = {
    autoReplyEnabled: true,
    autoReplyMode: "allowlist",
    autoReplyAllowlist: ["560-0000"],
  };
  assert.equal(mayaReplyDecision({ message: { phone: "2975600000" }, settings }).allowed, true);
  assert.deepEqual(mayaReplyDecision({ message: { phone: "2975820000" }, settings }), {
    allowed: false,
    mode: "allowlist",
    phone: "2975820000",
    reason: "phone-not-allowlisted",
  });
});

test("explicit off switch always overrides the allowlist", () => {
  const decision = mayaReplyDecision({
    message: { phone: "2975600000" },
    settings: {
      autoReplyEnabled: false,
      autoReplyMode: "allowlist",
      autoReplyAllowlist: ["2975600000"],
    },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "auto-reply-disabled");
});

test("global Maya disable overrides reply allowlist and autonomy flags", () => {
  const settings = {
    enabled: false,
    autoReplyEnabled: true,
    autoReplyMode: "allowlist",
    autoReplyAllowlist: ["2975600000"],
    autoCancelEnabled: true,
  };
  const reply = mayaReplyDecision({ message: { phone: "2975600000" }, settings });
  assert.equal(reply.allowed, false);
  assert.equal(reply.reason, "maya-disabled");
  assert.deepEqual(
    mayaBusinessActionDecision({ action: "cancel_appointment", settings, ownershipAllowed: true }),
    { allowed: false, reason: "maya-disabled" },
  );
});

const pilotSettings = {
  enabled: true,
  observationEnabled: true,
  autoReplyEnabled: true,
  replyMode: "pilot",
  autoReplyAllowlist: ["2975600140", "2975606772"],
  newContactAutoReplyEnabled: true,
  cancellationAutoReplyEnabled: true,
  rescheduleAutoReplyEnabled: true,
  autoCancelEnabled: false,
  autoRescheduleEnabled: false,
};
const communicationSettings = { communicationAccountId: "demac-wa-corporate" };

function inbound(phone = "2975820000", overrides = {}) {
  return {
    direction: "inbound",
    phone,
    communicationAccountId: "demac-wa-corporate",
    provider: "wacli",
    channel: "whatsapp",
    chat: `${phone}@s.whatsapp.net`,
    ...overrides,
  };
}

function canonicalConversation(phone = "2975820000", overrides = {}) {
  return {
    phone,
    communicationAccountId: "demac-wa-corporate",
    provider: "wacli",
    channel: "whatsapp",
    remoteConversationId: `${phone}@s.whatsapp.net`,
    ...overrides,
  };
}

test("observation is independent from reply permission", () => {
  assert.equal(mayaObservationDecision({
    message: inbound(),
    settings: pilotSettings,
    communicationSettings,
  }).allowed, true);
  const reply = mayaReplyDecision({ message: inbound(), settings: pilotSettings, communicationSettings });
  assert.equal(reply.allowed, false);
  assert.equal(reply.reason, "existing-customer-observe-only");
});

test("pilot mode requires canonical WhatsApp account configuration instead of Maya-local account duplication", () => {
  const missingCanonicalSettings = mayaReplyDecision({
    message: inbound("2975600140"),
    settings: { ...pilotSettings, activeCommunicationAccountId: "demac-wa-corporate" },
  });
  assert.equal(missingCanonicalSettings.allowed, false);
  assert.equal(missingCanonicalSettings.reason, "active-communication-account-not-configured");

  const missingIdentity = mayaReplyDecision({
    message: inbound("2975600140", { communicationAccountId: "" }),
    settings: pilotSettings,
    communicationSettings,
  });
  assert.equal(missingIdentity.allowed, false);
  assert.equal(missingIdentity.reason, "missing-communication-account-id");
});

test("pilot mode rejects a message from another communication account", () => {
  const decision = mayaReplyDecision({
    message: inbound("2975600140", { communicationAccountId: "demac-wa-other" }),
    settings: pilotSettings,
    communicationSettings,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "communication-account-not-active");
});

test("approved pilot test numbers receive reply permission without action bypass", () => {
  const reply = mayaReplyDecision({ message: inbound("2975600140"), settings: pilotSettings, communicationSettings });
  assert.equal(reply.allowed, true);
  assert.equal(reply.reason, "allowlisted");
  assert.deepEqual(
    mayaBusinessActionDecision({ action: "cancel_appointment", settings: pilotSettings, ownershipAllowed: true }),
    { allowed: false, reason: "auto-cancel-disabled" },
  );
});

test("genuinely new contact can reply only when the dedicated pilot switch is enabled", () => {
  const reply = mayaReplyDecision({
    message: inbound(),
    settings: pilotSettings,
    communicationSettings,
    isNewContact: true,
  });
  assert.equal(reply.allowed, true);
  assert.equal(reply.reason, "new-contact-pilot");
});

test("existing customer cancellation workflow can reply without enabling general autonomy", () => {
  const reply = mayaReplyDecision({
    message: inbound(),
    settings: pilotSettings,
    communicationSettings,
    authorizedWorkflow: "cancellation",
  });
  assert.equal(reply.allowed, true);
  assert.equal(reply.reason, "authorized-cancellation-workflow");
  const general = mayaReplyDecision({ message: inbound(), settings: pilotSettings, communicationSettings });
  assert.equal(general.allowed, false);
});

test("outbound commit can reuse the orchestrator-projected new-contact policy decision", () => {
  const conversation = canonicalConversation("2975820000", { mayaAutoReplyDecisionReason: "new-contact-pilot" });
  assert.deepEqual(projectedReplyPolicyContext(conversation), {
    isNewContact: true,
    authorizedWorkflow: "",
    reason: "new-contact-pilot",
  });
  const decision = mayaReplyDecision({ conversation, settings: pilotSettings, communicationSettings });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "new-contact-pilot");
});

test("outbound commit can reuse an authorized cancellation or reschedule projection", () => {
  const cancellation = mayaReplyDecision({
    conversation: canonicalConversation("2975820000", { mayaAutoReplyDecisionReason: "authorized-cancellation-workflow" }),
    settings: pilotSettings,
    communicationSettings,
  });
  assert.equal(cancellation.allowed, true);
  assert.equal(cancellation.reason, "authorized-cancellation-workflow");

  const reschedule = mayaReplyDecision({
    conversation: canonicalConversation("2975820000", { mayaAutoReplyDecisionReason: "authorized-reschedule-workflow" }),
    settings: pilotSettings,
    communicationSettings,
  });
  assert.equal(reschedule.allowed, true);
  assert.equal(reschedule.reason, "authorized-reschedule-workflow");
});

test("explicit policy context from the orchestrator overrides any older conversation projection", () => {
  const conversation = canonicalConversation("2975820000", { mayaAutoReplyDecisionReason: "new-contact-pilot" });
  const decision = mayaReplyDecision({
    conversation,
    settings: pilotSettings,
    communicationSettings,
    isNewContact: false,
    authorizedWorkflow: "",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "existing-customer-observe-only");
});

test("business mutation permission remains separate from reply permission and ownership", () => {
  assert.equal(
    mayaBusinessActionDecision({ action: "reschedule_appointment", settings: pilotSettings, ownershipAllowed: true }).allowed,
    false,
  );
  assert.equal(
    mayaBusinessActionDecision({
      action: "reschedule_appointment",
      settings: { ...pilotSettings, autoRescheduleEnabled: true },
      ownershipAllowed: false,
    }).reason,
    "sender-ownership-not-valid",
  );
});
