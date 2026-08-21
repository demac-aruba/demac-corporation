const test = require("node:test");
const assert = require("node:assert/strict");

const {
  configuredAllowlist,
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

test("Maya replies only to explicitly allowlisted phones", () => {
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
