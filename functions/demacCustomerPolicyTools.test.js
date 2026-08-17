const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CUSTOMER_POLICY_TOOL_DEFINITIONS,
  CUSTOMER_POLICY_TOPICS,
  createCustomerPolicyTools,
} = require("./demacCustomerPolicyTools");

class FakeDoc {
  constructor(value) { this.value = value; this.exists = value !== undefined; }
  data() { return this.value; }
}
class FakeCollection {
  constructor(items = {}) { this.items = items; }
  doc(id) { return { get: async () => new FakeDoc(this.items[id]) }; }
}
class FakeDb {
  constructor(seed = {}) { this.seed = seed; }
  collection(name) { return new FakeCollection(this.seed[name] || {}); }
}

test("defines one strict semantic company-policy tool", () => {
  assert.deepEqual(CUSTOMER_POLICY_TOOL_DEFINITIONS.map((item) => item.name), ["get_company_policy"]);
  assert.equal(CUSTOMER_POLICY_TOOL_DEFINITIONS[0].strict, true);
  assert.deepEqual(CUSTOMER_POLICY_TOOL_DEFINITIONS[0].parameters.properties.topic.enum, CUSTOMER_POLICY_TOPICS);
});

test("reads approved policy text from canonical businessSettings document", async () => {
  const db = new FakeDb({
    businessSettings: {
      "company-customer-policies": {
        version: 3,
        policies: {
          warranty: {
            active: true,
            textEs: "Garantía aprobada.",
            textEn: "Approved warranty.",
            textPapAw: "Garantia aproba.",
            requiresHumanForExceptions: true,
          },
        },
      },
    },
  });
  const result = await createCustomerPolicyTools({ db }).getCompanyPolicy({ topic: "warranty" });
  assert.equal(result.success, true);
  assert.equal(result.source, "businessSettings/company-customer-policies");
  assert.equal(result.policy.textEs, "Garantía aprobada.");
  assert.equal(result.policy.textEn, "Approved warranty.");
  assert.equal(result.requiresHumanForExceptions, true);
});

test("never falls back to code memory when the policy document is missing", async () => {
  const result = await createCustomerPolicyTools({ db: new FakeDb() }).getCompanyPolicy({ topic: "payments" });
  assert.equal(result.success, false);
  assert.equal(result.configured, false);
  assert.equal(result.requiresHuman, true);
  assert.equal(result.error.code, "company_policies_not_configured");
});

test("inactive or empty policy requires human verification instead of invention", async () => {
  const db = new FakeDb({
    businessSettings: {
      "company-customer-policies": {
        version: 1,
        policies: {
          maintenance: { active: false, textEs: "Texto viejo." },
          service_area: { active: true, textEs: "", textEn: "", textPapAw: "" },
        },
      },
    },
  });
  const tools = createCustomerPolicyTools({ db });
  const inactive = await tools.getCompanyPolicy({ topic: "maintenance" });
  const empty = await tools.getCompanyPolicy({ topic: "service_area" });
  assert.equal(inactive.success, false);
  assert.equal(inactive.error.code, "company_policy_not_configured");
  assert.equal(empty.success, false);
  assert.equal(empty.requiresHuman, true);
});

test("rejects unsupported topics without reading an invented policy", async () => {
  const result = await createCustomerPolicyTools({ db: new FakeDb() }).getCompanyPolicy({ topic: "discounts" });
  assert.equal(result.success, false);
  assert.equal(result.error.code, "unsupported_policy_topic");
  assert.equal(result.requiresHuman, true);
});
