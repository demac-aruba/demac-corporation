const test = require("node:test");
const assert = require("node:assert/strict");

const {
  configuredAllowlist,
  mayaBusinessActionDecision,
  mayaObservationDecision,
  mayaReplyDecision,
  normalizeArubaWhatsAppPhone,
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

const pilotSettings = {
  enabled: true,
  observationEnabled: true,
  autoReplyEnabled: true,
  replyMode: "pilot",
  activeCommunicationAccountId: "demac-wa-corporate",
  autoReplyAllowlist: ["2975600140", "2975606772"],
  newContactAutoReplyEnabled: true,
  cancellationAutoReplyEnabled: true,
  rescheduleAutoReplyEnabled: true,
  autoCancelEnabled: false,
  autoRescheduleEnabled: false,
};

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

test("observation is independent from reply permission", () => {
  assert.equal(mayaObservationDecision({ message: inbound(), settings: pilotSettings }).allowed, true);
  const reply = mayaReplyDecision({ message: inbound(), settings: pilotSettings });
  assert.equal(reply.allowed, false);
  assert.equal(reply.reason, "existing-customer-observe-only");
});

test("pilot mode requires a first-class active communication account", () => {
  const missingIdentity = mayaReplyDecision({
    message: inbound("2975600140", { communicationAccountId: "" }),
    settings: pilotSettings,
  });
  assert.equal(missingIdentity.allowed, false);
  assert.equal(missingIdentity.reason, "missing-communication-account-id");
});

test("approved pilot test numbers receive reply permission without action bypass", () => {
  const reply = mayaReplyDecision({ message: inbound("2975600140"), settings: pilotSettings });
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
    isNewContact: true,
  });
  assert.equal(reply.allowed, true);
  assert.equal(reply.reason, "new-contact-pilot");
});

test("existing customer cancellation workflow can reply without enabling general autonomy", () => {
  const reply = mayaReplyDecision({
    message: inbound(),
    settings: pilotSettings,
    authorizedWorkflow: "cancellation",
  });
  assert.equal(reply.allowed, true);
  assert.equal(reply.reason, "authorized-cancellation-workflow");
  const general = mayaReplyDecision({ message: inbound(), settings: pilotSettings });
  assert.equal(general.allowed, false);
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
