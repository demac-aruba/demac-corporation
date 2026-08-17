const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TOOL_ORDER,
  createDemacCustomerToolRegistry,
} = require("./demacCustomerToolRegistry");

const fakeDb = { collection() { return { doc() { return { get: async () => ({ exists: false }) }; }, get: async () => ({ docs: [] }) }; } };

function capability(source, definitions) {
  return {
    definitions,
    invoke: async (name) => ({ success: true, source, name }),
  };
}

test("single Customer Agent registry exposes eleven capabilities including product stock and company policy", async () => {
  const customer = capability("customer", [
    { name: "resolve_customer" },
    { name: "resolve_property" },
    { name: "check_availability" },
    { name: "create_appointment" },
    { name: "get_appointment" },
  ]);
  const business = capability("business", [
    { name: "create_or_update_lead" },
    { name: "get_service_catalog" },
    { name: "get_service_price" },
  ]);
  const sales = capability("sales", [
    { name: "get_product_catalog" },
    { name: "get_product_stock" },
  ]);
  const policies = capability("policy", [{ name: "get_company_policy" }]);
  const registry = createDemacCustomerToolRegistry({
    db: fakeDb,
    customerTools: customer,
    businessTools: business,
    salesTools: sales,
    policyTools: policies,
  });

  assert.equal(TOOL_ORDER.length, 11);
  assert.equal(registry.definitions.length, 11);
  assert.equal(TOOL_ORDER[6], "get_product_stock");
  assert.equal(TOOL_ORDER[7], "get_company_policy");
  assert.equal((await registry.invoke("get_company_policy", { topic: "warranty" })).source, "policy");
  assert.equal((await registry.invoke("get_product_catalog", { query: "Adina" })).source, "sales");
  assert.equal((await registry.invoke("get_product_stock", { productId: "p12" })).source, "sales");
  assert.equal((await registry.invoke("create_appointment", {})).source, "customer");
});
