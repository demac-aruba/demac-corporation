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

test("single Customer Agent registry exposes seventeen governed capabilities including exact appointment-change context", async () => {
  const customer = capability("customer", [
    { name: "resolve_customer" },
    { name: "resolve_property" },
    { name: "check_availability" },
    { name: "create_appointment" },
    { name: "get_appointment" },
  ]);
  const appointmentLifecycle = capability("appointment-lifecycle", [
    { name: "get_appointment_change_context" },
    { name: "cancel_appointment" },
    { name: "reschedule_appointment" },
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
  const reservations = capability("reservation", [
    { name: "create_product_reservation" },
    { name: "get_product_reservation" },
    { name: "release_product_reservation" },
  ]);
  const policies = capability("policy", [{ name: "get_company_policy" }]);
  const registry = createDemacCustomerToolRegistry({
    db: fakeDb,
    customerTools: customer,
    appointmentLifecycleTools: appointmentLifecycle,
    businessTools: business,
    salesTools: sales,
    reservationTools: reservations,
    policyTools: policies,
  });

  assert.equal(TOOL_ORDER.length, 17);
  assert.equal(registry.definitions.length, 17);
  assert.equal(TOOL_ORDER[6], "get_product_stock");
  assert.equal(TOOL_ORDER[7], "create_product_reservation");
  assert.equal(TOOL_ORDER[10], "get_company_policy");
  assert.equal(TOOL_ORDER[14], "get_appointment_change_context");
  assert.equal(TOOL_ORDER[15], "cancel_appointment");
  assert.equal(TOOL_ORDER[16], "reschedule_appointment");
  assert.equal((await registry.invoke("get_company_policy", { topic: "warranty" })).source, "policy");
  assert.equal((await registry.invoke("get_product_catalog", { query: "Adina" })).source, "sales");
  assert.equal((await registry.invoke("get_product_stock", { productId: "p12" })).source, "sales");
  assert.equal((await registry.invoke("create_product_reservation", { productId: "p12", customerId: "c1", quantity: 1 })).source, "reservation");
  assert.equal((await registry.invoke("release_product_reservation", { reservationId: "RSV-1", reason: "cancelled" })).source, "reservation");
  assert.equal((await registry.invoke("create_appointment", {})).source, "customer");
  assert.equal((await registry.invoke("get_appointment_change_context", {})).source, "appointment-lifecycle");
  assert.equal((await registry.invoke("cancel_appointment", { appointmentId: "APT-1" })).source, "appointment-lifecycle");
  assert.equal((await registry.invoke("reschedule_appointment", { appointmentId: "APT-1" })).source, "appointment-lifecycle");
});
