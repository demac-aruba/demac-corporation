const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LEGACY_UNASSIGNED_LOCATION_ID,
  OFFICE_LOCATION_ID,
  WAREHOUSE_LOCATION_ID,
  buildReplenishment,
  createInventoryApi,
  materialBalanceMap,
  productBalanceMap,
} = require("./inventoryAuthority");

function makeDb(seed = {}) {
  const stores = new Map();
  for (const [collection, values] of Object.entries(seed)) stores.set(collection, new Map(Object.entries(values)));
  const ensureStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const ref = (collection, id) => ({ collection, id, path: `${collection}/${id}` });
  const snapshot = (reference, sourceStores = stores) => {
    const store = sourceStores.get(reference.collection) || new Map();
    const exists = store.has(reference.id);
    return {
      id: reference.id,
      exists,
      ref: reference,
      data: () => exists ? structuredClone(store.get(reference.id)) : undefined,
    };
  };
  const collectionSnapshot = (name, sourceStores = stores) => ({
    docs: [...(sourceStores.get(name) || new Map()).entries()].map(([id]) => snapshot(ref(name, id), sourceStores)),
  });
  const cloneStores = () => new Map([...stores.entries()].map(([name, values]) => [name, new Map([...values.entries()].map(([id, value]) => [id, structuredClone(value)]))]));

  const db = {
    stores,
    collection(name) {
      return {
        doc(id) {
          const reference = ref(name, id);
          return {
            ...reference,
            async get() { return snapshot(reference); },
            async set(value, options = {}) {
              const store = ensureStore(name);
              store.set(id, options.merge ? { ...(store.get(id) || {}), ...structuredClone(value) } : structuredClone(value));
            },
          };
        },
        async get() { return collectionSnapshot(name); },
        orderBy() {
          return {
            limit() { return { async get() { return collectionSnapshot(name); } }; },
            async get() { return collectionSnapshot(name); },
          };
        },
      };
    },
    async runTransaction(callback) {
      const working = cloneStores();
      const tx = {
        async get(reference) { return snapshot(reference, working); },
        set(reference, value, options = {}) {
          if (!working.has(reference.collection)) working.set(reference.collection, new Map());
          const store = working.get(reference.collection);
          store.set(reference.id, options.merge ? { ...(store.get(reference.id) || {}), ...structuredClone(value) } : structuredClone(value));
        },
        create(reference, value) {
          if (!working.has(reference.collection)) working.set(reference.collection, new Map());
          const store = working.get(reference.collection);
          if (store.has(reference.id)) throw new Error(`already exists: ${reference.path}`);
          store.set(reference.id, structuredClone(value));
        },
      };
      const result = await callback(tx);
      stores.clear();
      for (const [name, values] of working.entries()) stores.set(name, values);
      return result;
    },
  };
  return db;
}

const actor = { uid: "office-1", name: "Office Operator", role: "office" };
function productSeed(onHandWarehouse = 80, onHandOffice = 10) {
  return {
    users: { "office-1": { role: "office", active: true, name: "Office Operator" } },
    vans: {
      "VAN-1": { name: "Van 1", active: true },
      "VAN-2": { name: "Van 2", active: true },
      "VAN-3": { name: "Van 3", active: true },
      "VAN-4": { name: "Van 4", active: true },
    },
    services: {
      "prod-12k": { itemType: "Producto", name: "Adina Optima 12K", sku: "AD-12K", basePrice: 699, active: true },
      "service-1": { itemType: "Servicio", name: "Standard Service", active: true },
    },
    commercialProductStock: {
      "prod-12k": {
        productId: "prod-12k",
        version: 2,
        balances: {
          [WAREHOUSE_LOCATION_ID]: { onHand: onHandWarehouse, reserved: 0, minimum: 5, target: 20 },
          [OFFICE_LOCATION_ID]: { onHand: onHandOffice, reserved: 0, minimum: 3, target: 15 },
        },
      },
    },
    warehouseInventory: {},
    toolCatalog: {},
    vanToolAssets: {},
    inventoryTransfers: {},
    inventoryMovements: {},
    workOrders: { "WO-1": { status: "Confirmada", vanId: "VAN-1" } },
  };
}

function apiFor(db) {
  return createInventoryApi({ db, verifyIdToken: async () => ({ uid: "office-1", email: "office@example.com" }) });
}
function stock(db, itemId = "prod-12k") {
  return db.stores.get("commercialProductStock").get(itemId);
}
function balance(db, locationId, itemId = "prod-12k") {
  return stock(db, itemId).balances[locationId];
}

test("legacy warehouse material quantity is interpreted as Main Warehouse stock, not a new catalog", () => {
  const balances = materialBalanceMap({ quantity: 14, minimum: 3, target: 8 });
  assert.equal(balances[WAREHOUSE_LOCATION_ID].onHand, 14);
  assert.equal(balances[WAREHOUSE_LOCATION_ID].minimum, 3);
  assert.equal(balances[WAREHOUSE_LOCATION_ID].target, 8);
});

test("legacy global Product stock remains unassigned instead of being guessed as Warehouse or Office", () => {
  const balances = productBalanceMap({ onHand: 90, reserved: 0 });
  assert.equal(balances[LEGACY_UNASSIGNED_LOCATION_ID].onHand, 90);
  assert.equal(balances[WAREHOUSE_LOCATION_ID], undefined);
  assert.equal(balances[OFFICE_LOCATION_ID], undefined);
});

test("legacy Product stock can be allocated once across Warehouse and Office without changing company total", async () => {
  const db = makeDb({
    ...productSeed(),
    commercialProductStock: { "prod-12k": { productId: "prod-12k", onHand: 90, reserved: 0 } },
  });
  const api = apiFor(db);
  const result = await api.allocateLegacyProductStock({
    requestId: "legacy-stock-12k-001",
    itemId: "prod-12k",
    allocations: [
      { locationId: WAREHOUSE_LOCATION_ID, quantity: 80 },
      { locationId: OFFICE_LOCATION_ID, quantity: 10 },
    ],
  }, actor);
  assert.equal(result.success, true);
  assert.equal(balance(db, WAREHOUSE_LOCATION_ID).onHand, 80);
  assert.equal(balance(db, OFFICE_LOCATION_ID).onHand, 10);
  assert.equal(stock(db).onHand, 90);
  assert.equal(stock(db).balances[LEGACY_UNASSIGNED_LOCATION_ID], undefined);

  const replay = await api.allocateLegacyProductStock({
    requestId: "legacy-stock-12k-001",
    itemId: "prod-12k",
    allocations: [{ locationId: WAREHOUSE_LOCATION_ID, quantity: 90 }],
  }, actor);
  assert.equal(replay.replayed, true);
  assert.equal(balance(db, WAREHOUSE_LOCATION_ID).onHand, 80);
  assert.equal(balance(db, OFFICE_LOCATION_ID).onHand, 10);
});

test("Warehouse to Office transfer reserves, picks up and receives the same physical stock", async () => {
  const db = makeDb(productSeed());
  const api = apiFor(db);
  const created = await api.createTransfer({
    requestId: "warehouse-office-12k-001",
    sourceLocationId: WAREHOUSE_LOCATION_ID,
    destinationLocationId: OFFICE_LOCATION_ID,
    assignedPickupStaffId: "staff-authorized-1",
    assignedPickupName: "Authorized Staff",
    lines: [{ itemKind: "product", itemId: "prod-12k", quantity: 10 }],
  }, actor);
  assert.equal(created.transfer.status, "requested");
  assert.equal(balance(db, WAREHOUSE_LOCATION_ID).onHand, 80);
  assert.equal(balance(db, WAREHOUSE_LOCATION_ID).reserved, 10);
  assert.equal(balance(db, OFFICE_LOCATION_ID).onHand, 10);

  const duplicate = await api.createTransfer({
    requestId: "warehouse-office-12k-001",
    sourceLocationId: WAREHOUSE_LOCATION_ID,
    destinationLocationId: OFFICE_LOCATION_ID,
    lines: [{ itemKind: "product", itemId: "prod-12k", quantity: 10 }],
  }, actor);
  assert.equal(duplicate.replayed, true);
  assert.equal(balance(db, WAREHOUSE_LOCATION_ID).reserved, 10, "replay must not reserve twice");

  const picked = await api.pickupTransfer({
    requestId: "pickup-warehouse-office-001",
    transferId: created.transfer.id,
    lines: [{ lineId: "product:prod-12k", pickedQuantity: 10 }],
  }, actor);
  assert.equal(picked.transfer.status, "in_transit");
  assert.equal(balance(db, WAREHOUSE_LOCATION_ID).onHand, 70);
  assert.equal(balance(db, WAREHOUSE_LOCATION_ID).reserved, 0);
  assert.equal(balance(db, OFFICE_LOCATION_ID).onHand, 10, "Office stock changes only after receipt");

  const received = await api.receiveTransfer({
    requestId: "receive-warehouse-office-001",
    transferId: created.transfer.id,
    lines: [{ lineId: "product:prod-12k", receivedQuantity: 10 }],
  }, actor);
  assert.equal(received.transfer.status, "completed");
  assert.equal(balance(db, WAREHOUSE_LOCATION_ID).onHand, 70);
  assert.equal(balance(db, OFFICE_LOCATION_ID).onHand, 20);
  assert.equal(stock(db).onHand, 90, "internal transfer must conserve total company stock");
});

test("transfer discrepancy requires an operator note and records the missing in-transit quantity", async () => {
  const db = makeDb(productSeed(20, 0));
  const api = apiFor(db);
  const created = await api.createTransfer({
    requestId: "warehouse-office-discrepancy-001",
    sourceLocationId: WAREHOUSE_LOCATION_ID,
    destinationLocationId: OFFICE_LOCATION_ID,
    lines: [{ itemKind: "product", itemId: "prod-12k", quantity: 5 }],
  }, actor);
  await api.pickupTransfer({ requestId: "pickup-discrepancy-001", transferId: created.transfer.id }, actor);
  await assert.rejects(
    () => api.receiveTransfer({ requestId: "receive-discrepancy-001", transferId: created.transfer.id, lines: [{ lineId: "product:prod-12k", receivedQuantity: 4 }] }, actor),
    /discrepancy note is required/i,
  );
  assert.equal(balance(db, OFFICE_LOCATION_ID).onHand, 0, "failed receipt must not partially write inventory");

  const received = await api.receiveTransfer({
    requestId: "receive-discrepancy-002",
    transferId: created.transfer.id,
    lines: [{ lineId: "product:prod-12k", receivedQuantity: 4 }],
    discrepancyNote: "One unit did not arrive at the office; supervisor review required.",
  }, actor);
  assert.equal(received.transfer.hasDiscrepancy, true);
  assert.equal(balance(db, WAREHOUSE_LOCATION_ID).onHand, 15);
  assert.equal(balance(db, OFFICE_LOCATION_ID).onHand, 4);
  assert.equal(stock(db).onHand, 19);
  const variance = [...db.stores.get("inventoryMovements").values()].find((row) => row.type === "transfer_variance");
  assert.equal(variance.quantity, 1);
});

test("van replenishment is derived from the same location balance and target", () => {
  const items = [{
    id: "cable-hold", itemKind: "product", name: "Cable Conduit", balances: {
      "VAN-2": { onHand: 1, reserved: 0, minimum: 1, target: 2 },
      [WAREHOUSE_LOCATION_ID]: { onHand: 40, reserved: 0, minimum: 5, target: 20 },
    },
  }];
  const locations = [{ id: "VAN-2", name: "Van 2", type: "van", active: true }, ...[]];
  const rows = buildReplenishment(items, locations);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].locationId, "VAN-2");
  assert.equal(rows[0].needed, 1);
});

test("Work Order issue reduces only the source location and is idempotent", async () => {
  const seed = productSeed(80, 10);
  seed.commercialProductStock["prod-12k"].balances["VAN-1"] = { onHand: 2, reserved: 0, minimum: 1, target: 2 };
  const db = makeDb(seed);
  const api = apiFor(db);
  const first = await api.issueToWorkOrder({
    requestId: "wo-van-sale-001",
    itemKind: "product",
    itemId: "prod-12k",
    locationId: "VAN-1",
    workOrderId: "WO-1",
    quantity: 1,
    reason: "Technician used van backup stock",
  }, actor);
  assert.equal(first.replayed, false);
  assert.equal(balance(db, "VAN-1").onHand, 1);

  const replay = await api.issueToWorkOrder({
    requestId: "wo-van-sale-001",
    itemKind: "product",
    itemId: "prod-12k",
    locationId: "VAN-1",
    workOrderId: "WO-1",
    quantity: 1,
  }, actor);
  assert.equal(replay.replayed, true);
  assert.equal(balance(db, "VAN-1").onHand, 1, "retry must not consume stock twice");
});

test("measured material quantities preserve decimals through transfer and Work Order issue", async () => {
  const seed = productSeed();
  seed.warehouseInventory.refrigerant = { name: "R410A Refrigerant", category: "Refrigerant", unit: "lb", quantity: 12.5, minimum: 5, target: 15, active: true };
  const db = makeDb(seed);
  const api = apiFor(db);

  const created = await api.createTransfer({
    requestId: "refrigerant-transfer-decimal-001",
    sourceLocationId: WAREHOUSE_LOCATION_ID,
    destinationLocationId: "VAN-1",
    lines: [{ itemKind: "material", itemId: "refrigerant", quantity: 2.75 }],
  }, actor);
  let material = db.stores.get("warehouseInventory").get("refrigerant");
  assert.equal(material.stockByLocation[WAREHOUSE_LOCATION_ID].onHand, 12.5);
  assert.equal(material.stockByLocation[WAREHOUSE_LOCATION_ID].reserved, 2.75);

  await api.pickupTransfer({ requestId: "refrigerant-pickup-decimal-001", transferId: created.transfer.id }, actor);
  material = db.stores.get("warehouseInventory").get("refrigerant");
  assert.equal(material.stockByLocation[WAREHOUSE_LOCATION_ID].onHand, 9.75);

  await api.receiveTransfer({ requestId: "refrigerant-receive-decimal-001", transferId: created.transfer.id }, actor);
  material = db.stores.get("warehouseInventory").get("refrigerant");
  assert.equal(material.stockByLocation["VAN-1"].onHand, 2.75);

  await api.issueToWorkOrder({
    requestId: "refrigerant-workorder-decimal-001",
    itemKind: "material",
    itemId: "refrigerant",
    locationId: "VAN-1",
    workOrderId: "WO-1",
    quantity: 0.5,
    reason: "Measured refrigerant used on job",
  }, actor);
  material = db.stores.get("warehouseInventory").get("refrigerant");
  assert.equal(material.stockByLocation["VAN-1"].onHand, 2.25);
});

test("fractional Product quantities are rejected instead of silently rounded", async () => {
  const db = makeDb(productSeed());
  const api = apiFor(db);
  await assert.rejects(
    () => api.createTransfer({
      requestId: "fractional-product-transfer-001",
      sourceLocationId: WAREHOUSE_LOCATION_ID,
      destinationLocationId: OFFICE_LOCATION_ID,
      lines: [{ itemKind: "product", itemId: "prod-12k", quantity: 1.5 }],
    }, actor),
    /whole units/i,
  );
});

test("Inventory Authority HTTP boundary requires Firebase authentication", async () => {
  const db = makeDb(productSeed());
  const api = apiFor(db);
  const response = await api.handle({ method: "POST", headers: {}, body: { action: "get_snapshot", data: {} } });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "unauthenticated");
});
