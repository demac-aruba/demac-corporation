const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_SERVICE_PRICING_RULES,
  extractBtu,
  formatDurationReply,
  formatPriceReply,
  priceQuestionMode,
  resolvePricingContext,
} = require("./demacServicePricingRules");

test("parses common BTU writing styles", () => {
  assert.equal(extractBtu("split de 12.000 BTU"), 12000);
  assert.equal(extractBtu("18k"), 18000);
  assert.equal(extractBtu("24 mil"), 24000);
  assert.equal(extractBtu("36000 btu"), 36000);
});

test("standard split service prices match DEMAC rules", () => {
  const cases = new Map([[9000, 100], [12000, 125], [18000, 135], [24000, 145], [36000, 175]]);
  for (const [btu, price] of cases) {
    const row = DEFAULT_SERVICE_PRICING_RULES.standardServiceSplit.find((item) => item.btu === btu);
    assert.equal(row.price, price);
    assert.equal(row.durationMinutes, 60);
  }
  assert.equal(DEFAULT_SERVICE_PRICING_RULES.standardServiceSplit.find((item) => item.btu === 36000).priceType, "regular");
});

test("deep cleaning is 195 through 24k and 225 at 36k", () => {
  for (const btu of [9000, 12000, 18000, 24000]) {
    assert.equal(DEFAULT_SERVICE_PRICING_RULES.deepCleaningSplit.find((item) => item.btu === btu).price, 195);
  }
  assert.equal(DEFAULT_SERVICE_PRICING_RULES.deepCleaningSplit.find((item) => item.btu === 36000).price, 225);
});

test("Adina standard installation prices and durations match the approved matrix", () => {
  const expected = new Map([
    [12000, [200, 120]],
    [18000, [225, 120]],
    [24000, [250, 120]],
    [36000, [300, 180]],
  ]);
  for (const [btu, [price, duration]] of expected) {
    const row = DEFAULT_SERVICE_PRICING_RULES.standardInstallationAdinaDemac.find((item) => item.btu === btu);
    assert.equal(row.price, price);
    assert.equal(row.durationMinutes, duration);
  }
});

test("customer price wording is natural and does not mention ERP", () => {
  const context = resolvePricingContext({
    pricingRules: DEFAULT_SERVICE_PRICING_RULES,
    conversation: { messages: [{ direction: "inbound", text: "cuanto cuesta servicio para split de 12,000 btu" }] },
    latestText: "cuanto cuesta",
    facts: { serviceType: "service" },
  });
  const reply = formatPriceReply(context, "es");
  assert.match(reply, /Afl\. 125/);
  assert.match(reply, /servicio estándar/i);
  assert.doesNotMatch(reply, /ERP|configur/i);
});

test("latest BTU overrides an older BTU mentioned earlier in the conversation", () => {
  const context = resolvePricingContext({
    pricingRules: DEFAULT_SERVICE_PRICING_RULES,
    conversation: {
      messages: [
        { direction: "inbound", text: "cuanto cuesta un servicio de 18k" },
        { direction: "outbound", text: "Para 18,000 BTU son Afl. 135." },
        { direction: "inbound", text: "y uno de 24k?" },
      ],
    },
    latestText: "y uno de 24k?",
    facts: { serviceType: "service" },
  });
  assert.equal(context.btu, 24000);
  assert.match(formatPriceReply(context, "es"), /Afl\. 145/);
});

test("all-BTU comparison does not inherit the old 18k price", () => {
  const latestText = "¿todos los aires variando de sus BTU tienen el mismo precio?";
  assert.equal(priceQuestionMode(latestText), "comparison");
  const context = resolvePricingContext({
    pricingRules: DEFAULT_SERVICE_PRICING_RULES,
    conversation: {
      messages: [
        { direction: "inbound", text: "cuanto cuesta servicio para 18k" },
        { direction: "outbound", text: "Afl. 135" },
        { direction: "inbound", text: latestText },
      ],
    },
    latestText,
    facts: { serviceType: "service" },
  });
  assert.equal(context.btu, 0);
  const reply = formatPriceReply(context, "es");
  for (const amount of [100, 125, 135, 145, 175]) assert.match(reply, new RegExp(`Afl\\. ${amount}`));
  assert.match(reply, /varía según los BTU/i);
});

test("generic price question returns the configured BTU matrix instead of a generic service price", () => {
  const context = resolvePricingContext({
    pricingRules: DEFAULT_SERVICE_PRICING_RULES,
    conversation: { messages: [{ direction: "inbound", text: "¿cuánto cuesta el servicio?" }] },
    latestText: "¿cuánto cuesta el servicio?",
    facts: { serviceType: "service" },
  });
  assert.equal(context.btu, 0);
  const reply = formatPriceReply(context, "es");
  assert.match(reply, /9,000 BTU — Afl\. 100/);
  assert.match(reply, /36,000 BTU — Afl\. 175/);
});

test("standard service duration sounds human", () => {
  const context = resolvePricingContext({
    pricingRules: DEFAULT_SERVICE_PRICING_RULES,
    conversation: { messages: [{ direction: "inbound", text: "servicio standard" }] },
    latestText: "cuanto dura el servicio",
    facts: { serviceType: "service" },
  });
  assert.equal(formatDurationReply(context, "es", 1), "Un servicio estándar dura aproximadamente 1 hora por aire.");
});