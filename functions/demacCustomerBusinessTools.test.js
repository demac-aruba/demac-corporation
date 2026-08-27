const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CUSTOMER_BUSINESS_TOOL_DEFINITIONS,
  createCustomerBusinessTools,
  stableLeadIdentity,
} = require("./demacCustomerBusinessTools");
const {
  CUSTOMER_SALES_TOOL_DEFINITIONS,
  createCustomerSalesTools,
} = require("./demacCustomerSalesTools");
const { TOOL_ORDER, createDemacCustomerToolRegistry } = require("./demacCustomerToolRegistry");

class FakeSnapshot {
  constructor(id, value) { this.id = id; this.value = value; this.exists = value !== undefined; }
  data() { return this.value; }
}
class FakeDoc {
  constructor(db, collection, id) { this.db = db; this.collectionName = collection; this.id = id; }
  async get() { return new FakeSnapshot(this.id, this.db.map(this.collectionName).get(this.id)); }
  async set(value, options) {
    const map = this.db.map(this.collectionName);
    map.set(this.id, options?.merge ? { ...(map.get(this.id) || {}), ...value } : value);
  }
}
class FakeQuery {
  constructor(db, collection, filters = []) { this.db = db; this.collectionName = collection; this.filters = filters; }
  where(field, operation, value) {
    assert.equal(operation, "==");
    return new FakeQuery(this.db, this.collectionName, [...this.filters, [field, value]]);
  }
  async get() {
    const docs = [...this.db.map(this.collectionName).entries()]
      .map(([id, value]) => ({ id, ...value }))
      .filter((item) => this.filters.every(([field, value]) => item[field] === value))
      .map((item) => ({ id: item.id, data: () => { const { id, ...rest } = item; return rest; } }));
    return { docs };
  }
}
class FakeCollection extends FakeQuery {
  constructor(db, collection) { super(db, collection); }
  doc(id) { return new FakeDoc(this.db, this.collectionName, id); }
}
class FakeDb {
  constructor(seed = {}) {
    this.collections = new Map();
    for (const [collection, items] of Object.entries(seed)) {
      const map = new Map();
      for (const item of items || []) { const { id, ...rest } = item; map.set(id, rest); }
      this.collections.set(collection, map);
    }
  }
  map(collection) {
    if (!this.collections.has(collection)) this.collections.set(collection, new Map());
    return this.collections.get(collection);
  }
  collection(collection) { return new FakeCollection(this, collection); }
  read(collection, id) { return this.map(collection).get(id); }
}

function baseTools({ customerResult = null, propertyResult = null } = {}) {
  return {
    resolveCustomer: async () => customerResult || { success: true, resolved: false, ambiguous: false, customerId: "", candidates: [] },
    resolveProperty: async () => propertyResult || { success: true, resolved: false, ambiguous: false, propertyId: "", candidates: [], needsNewProperty: true },
    invoke: async (name, args, context) => ({ success: true, source: "customer", name, args, context }),
  };
}

function activeProduct(id = "p12") {
  return { id, itemType: "Producto", name: "Adina Optima 12,000 BTU", category: "Aire acondicionado", sku: "AD-12", basePrice: 699, description: "SEER 21", active: true };
}

test("defines lead, catalog and price as strict business tools", () => {
  assert.deepEqual(CUSTOMER_BUSINESS_TOOL_DEFINITIONS.map((item) => item.name), [
    "create_or_update_lead", "get_service_catalog", "get_service_price",
  ]);
  assert.ok(CUSTOMER_BUSINESS_TOOL_DEFINITIONS.every((item) => item.strict));
});

test("defines ERP product catalog and stock as strict sales tools", () => {
  assert.deepEqual(CUSTOMER_SALES_TOOL_DEFINITIONS.map((item) => item.name), ["get_product_catalog", "get_product_stock"]);
  assert.ok(CUSTOMER_SALES_TOOL_DEFINITIONS.every((item) => item.strict));
});

test("catalog returns configured presets with ERP service ids", async () => {
  const db = new FakeDb({
    businessSettings: [{ id: "appointment-work-presets", version: 2, presets: [
      { id: "standard_service", label: "Servicio estándar", kind: "service", durationMinutesPerUnit: 60 },
      { id: "standard_installation", label: "Instalación estándar", kind: "installation", durationMinutesPerUnit: 120 },
    ] }],
    services: [
      { id: "s1", name: "Servicio estándar", category: "Servicio", active: true },
      { id: "s2", name: "Instalación", category: "Instalación", active: true },
    ],
  });
  const result = await createCustomerBusinessTools({ db, customerTools: baseTools() }).getServiceCatalog();
  assert.equal(result.success, true);
  assert.equal(result.presets[0].serviceId, "s1");
  assert.equal(result.presets[1].serviceId, "s2");
});

test("catalog does not fall back to code defaults when ERP preset doc is missing", async () => {
  const db = new FakeDb({ services: [{ id: "s1", name: "Servicio estándar" }] });
  const result = await createCustomerBusinessTools({ db, customerTools: baseTools() }).getServiceCatalog();
  assert.equal(result.success, false);
  assert.equal(result.error.code, "service_catalog_not_configured");
});

test("price reads exact configured rows and installation scope", async () => {
  const db = new FakeDb({ businessSettings: [{
    id: "company-service-pricing-rules",
    currency: "Afl.",
    standardServiceSplit: [{ btu: 12000, price: 125, durationMinutes: 60 }],
    standardInstallationAdinaDemac: [{ btu: 18000, price: 225, durationMinutes: 120 }],
  }] });
  const tools = createCustomerBusinessTools({ db, customerTools: baseTools() });
  const service = await tools.getServicePrice({ kind: "standard_service", btu: 12000 });
  assert.equal(service.price.price, 125);
  const installation = await tools.getServicePrice({ kind: "standard_installation", btu: 18000 });
  assert.equal(installation.price.price, 225);
  assert.match(installation.scope, /Adina/);
});

test("price refuses silent hardcoded fallback when ERP pricing doc is missing", async () => {
  const result = await createCustomerBusinessTools({ db: new FakeDb(), customerTools: baseTools() })
    .getServicePrice({ kind: "standard_service", btu: 12000 });
  assert.equal(result.success, false);
  assert.equal(result.error.code, "service_pricing_not_configured");
});

test("product catalog reads only active ERP Producto rows and requires separate stock verification", async () => {
  const db = new FakeDb({ services: [
    activeProduct("p12"),
    { id: "p18", itemType: "Producto", name: "Adina Optima 18,000 BTU", category: "Aire acondicionado", sku: "AD-18", basePrice: 1199, active: false },
    { id: "s1", itemType: "Servicio", name: "Servicio estándar", basePrice: 125, active: true },
  ] });
  const tools = createCustomerSalesTools({ db });
  const result = await tools.getProductCatalog({ query: "12000" });
  assert.equal(result.success, true);
  assert.equal(result.found, true);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].id, "p12");
  assert.equal(result.products[0].basePrice, 699);
  assert.equal(result.products[0].currency, "Afl.");
  assert.equal(result.products[0].stockTrackedByCatalog, false);
  assert.equal(result.products[0].stockVerificationRequired, true);
  assert.equal(result.stockVerificationRequired, true);
  assert.equal(result.stockVerificationTool, "get_product_stock");
});

test("product catalog refuses a fabricated fallback when no active products exist", async () => {
  const db = new FakeDb({ services: [
    { id: "s1", itemType: "Servicio", name: "Servicio estándar", basePrice: 125, active: true },
    { id: "p1", itemType: "Producto", name: "Producto inactivo", basePrice: 10, active: false },
  ] });
  const result = await createCustomerSalesTools({ db }).getProductCatalog({ query: "" });
  assert.equal(result.success, false);
  assert.equal(result.configured, false);
  assert.equal(result.error.code, "product_catalog_not_configured");
});

test("product stock returns only verified available quantity and never claims a reservation", async () => {
  const db = new FakeDb({
    services: [activeProduct("p12")],
    commercialProductStock: [{ id: "p12", productId: "p12", onHand: 5, reserved: 2, active: true, verifiedAt: "2026-08-17T11:00:00Z" }],
  });
  const result = await createCustomerSalesTools({ db }).getProductStock({ productId: "p12" });
  assert.equal(result.success, true);
  assert.equal(result.configured, true);
  assert.equal(result.stockVerified, true);
  assert.equal(result.onHand, 5);
  assert.equal(result.reserved, 2);
  assert.equal(result.available, 3);
  assert.equal(result.inStock, true);
  assert.equal(result.reservationRequired, true);
  assert.equal(result.stockReservedForCustomer, false);
  assert.equal(result.verifiedAt, "2026-08-17T11:00:00.000Z");
});

test("product stock refuses a fabricated fallback when no stock record exists", async () => {
  const db = new FakeDb({ services: [activeProduct("p12")] });
  const result = await createCustomerSalesTools({ db }).getProductStock({ productId: "p12" });
  assert.equal(result.success, false);
  assert.equal(result.configured, false);
  assert.equal(result.stockVerified, false);
  assert.equal(result.error.code, "product_stock_not_configured");
});

test("product stock fails closed when quantities are inconsistent", async () => {
  const db = new FakeDb({
    services: [activeProduct("p12")],
    commercialProductStock: [{ id: "p12", productId: "p12", onHand: 2, reserved: 3, active: true, verifiedAt: "2026-08-17T11:00:00Z" }],
  });
  const result = await createCustomerSalesTools({ db }).getProductStock({ productId: "p12" });
  assert.equal(result.success, false);
  assert.equal(result.configured, true);
  assert.equal(result.stockVerified, false);
  assert.equal(result.error.code, "product_stock_invalid");
});

test("product stock requires an explicit verification timestamp", async () => {
  const db = new FakeDb({
    services: [activeProduct("p12")],
    commercialProductStock: [{ id: "p12", productId: "p12", onHand: 2, reserved: 0, active: true }],
  });
  const result = await createCustomerSalesTools({ db }).getProductStock({ productId: "p12" });
  assert.equal(result.success, false);
  assert.equal(result.configured, true);
  assert.equal(result.stockVerified, false);
  assert.equal(result.error.code, "product_stock_not_verified");
});

test("stable lead identity prefers phone then technical conversation identity", () => {
  assert.equal(stableLeadIdentity({ contactJid: "123@lid" }, "5600000"), "phone:2975600000");
  assert.equal(stableLeadIdentity({ contactJid: "123@lid" }, ""), "conversation:123@lid");
});

test("create lead is deterministic and links provisional property to customer", async () => {
  const db = new FakeDb();
  const tools = createCustomerBusinessTools({ db, customerTools: baseTools() });
  const context = { conversationId: "conv-1", contactJid: "123@lid", chatTitle: "Maria" };
  const first = await tools.createOrUpdateLead({ customerName: "Maria", contactPhone: "", address: "Wayaca 55", preferredLanguage: "es" }, context);
  const second = await tools.createOrUpdateLead({ customerName: "Maria", contactPhone: "", address: "Wayaca 55", preferredLanguage: "es" }, context);
  assert.equal(first.success, true);
  assert.equal(first.customerId, second.customerId);
  assert.equal(first.propertyId, second.propertyId);
  assert.equal(db.read("properties", first.propertyId).clientId, first.customerId);
});

test("ambiguous existing customer is never merged", async () => {
  const db = new FakeDb();
  const tools = createCustomerBusinessTools({
    db,
    customerTools: baseTools({
      customerResult: { success: true, resolved: false, ambiguous: true, candidates: [{ id: "a" }, { id: "b" }] },
    }),
  });
  const result = await tools.createOrUpdateLead(
    { customerName: "", contactPhone: "5600000", address: "Wayaca 1", preferredLanguage: "es" },
    { conversationId: "c" },
  );
  assert.equal(result.success, false);
  assert.equal(result.error.code, "ambiguous_customer");
});

test("single registry exposes all seventeen tools in intended order and dispatches by capability", async () => {
  const customer = { invoke: async (name) => ({ success: true, source: "customer", name }) };
  const appointmentLifecycle = { invoke: async (name) => ({ success: true, source: "appointment-lifecycle", name }) };
  const business = { invoke: async (name) => ({ success: true, source: "business", name }) };
  const sales = { invoke: async (name) => ({ success: true, source: "sales", name }) };
  const reservations = { invoke: async (name) => ({ success: true, source: "reservation", name }) };
  const policies = { invoke: async (name) => ({ success: true, source: "policy", name }) };
  const registry = createDemacCustomerToolRegistry({
    db: new FakeDb(),
    customerTools: customer,
    appointmentLifecycleTools: appointmentLifecycle,
    businessTools: business,
    salesTools: sales,
    reservationTools: reservations,
    policyTools: policies,
  });
  assert.deepEqual(TOOL_ORDER, [
    "resolve_customer", "resolve_property", "create_or_update_lead", "get_service_catalog",
    "get_service_price", "get_product_catalog", "get_product_stock", "create_product_reservation",
    "get_product_reservation", "release_product_reservation", "get_company_policy",
    "check_availability", "create_appointment", "get_appointment", "get_appointment_change_context", "cancel_appointment", "reschedule_appointment",
  ]);
  assert.equal(registry.definitions.length, 17);
  assert.equal((await registry.invoke("resolve_customer")).source, "customer");
  assert.equal((await registry.invoke("get_service_price")).source, "business");
  assert.equal((await registry.invoke("get_product_catalog")).source, "sales");
  assert.equal((await registry.invoke("get_product_stock")).source, "sales");
  assert.equal((await registry.invoke("create_product_reservation")).source, "reservation");
  assert.equal((await registry.invoke("release_product_reservation")).source, "reservation");
  assert.equal((await registry.invoke("get_company_policy")).source, "policy");
  assert.equal((await registry.invoke("get_appointment_change_context")).source, "appointment-lifecycle");
  assert.equal((await registry.invoke("cancel_appointment")).source, "appointment-lifecycle");
  assert.equal((await registry.invoke("reschedule_appointment")).source, "appointment-lifecycle");
});