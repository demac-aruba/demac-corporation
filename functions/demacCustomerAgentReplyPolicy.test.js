const test = require("node:test");
const assert = require("node:assert/strict");

const {
  configuredAllowlist,
  mayaReplyDecision,
  normalizeArubaWhatsAppPhone,
  resolveConversationPhone,
} = require("./demacCustomerAgentReplyPolicy");

test("normalizes Aruba local and WhatsApp JID phone formats", () => {
  assert.equal(normalizeArubaWhatsAppPhone("560-6772"), "2975606772");
  assert.equal(normalizeArubaWhatsAppPhone("+297 560 6772"), "2975606772");
  assert.equal(normalizeArubaWhatsAppPhone("2975606772@s.whatsapp.net"), "2975606772");
});

test("allowlist accepts strings and labeled entries without duplicates", () => {
  assert.deepEqual(configuredAllowlist({
    autoReplyAllowlist: [
      "560-6772",
      { label: "Maribel", phone: "+297 560 6772" },
      { label: "Tester", whatsapp: "2975820000" },
    ],
  }), ["2975606772", "2975820000"]);
});

test("conversation phone prefers canonical message or conversation phone", () => {
  assert.equal(resolveConversationPhone({
    message: { phone: "2975606772", chat: "2979999999@s.whatsapp.net" },
    conversation: { phone: "2978888888" },
  }), "2975606772");
});

test("Maya is fail-closed when settings are missing", () => {
  assert.deepEqual(mayaReplyDecision({ message: { phone: "2975606772" } }), {
    allowed: false,
    mode: "allowlist",
    phone: "2975606772",
    reason: "phone-not-allowlisted",
  });
});

test("Maya replies only to explicitly allowlisted phones", () => {
  const settings = {
    autoReplyEnabled: true,
    autoReplyMode: "allowlist",
    autoReplyAllowlist: ["560-6772"],
  };
  assert.equal(mayaReplyDecision({ message: { phone: "2975606772" }, settings }).allowed, true);
  assert.deepEqual(mayaReplyDecision({ message: { phone: "2975820000" }, settings }), {
    allowed: false,
    mode: "allowlist",
    phone: "2975820000",
    reason: "phone-not-allowlisted",
  });
});

test("explicit off switch always overrides the allowlist", () => {
  const decision = mayaReplyDecision({
    message: { phone: "2975606772" },
    settings: {
      autoReplyEnabled: false,
      autoReplyMode: "allowlist",
      autoReplyAllowlist: ["2975606772"],
    },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "auto-reply-disabled");
});
