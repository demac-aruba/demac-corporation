const test = require("node:test");
const assert = require("node:assert/strict");

const {
  COMMERCIAL_SALES_ERROR_CODES,
  RESERVATION_POLICY_ID,
  createCommercialSalesAuthority,
} = require("./commercialSalesAuthority");

class FakeSnapshot {
  constructor(id, value) {
    this.id = id;
    this.value = value;
    this.exists = value !== undefined;
  }
  data() { return this.value; }
}

class FakeDoc {
  constructor(db, collectionName, id) {
    this.db = db;
    this.collectionName = collectionName;
    this.id = id;
  }
  async get() { return new FakeSnapshot(this.id, this.db.map(this.collectionName).get(this.id)); }
}

class FakeCollection {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }
  doc(id) { return new FakeDoc(this.db, this.name, id); }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.writes = [];
  }
  async get(ref) { return new FakeSnapshot(ref.id, this.db.map(ref.collectionName).get(ref.id)); }
  set(ref, value, options = {}) { this.writes.push({ ref, value, options }); }
  commit() {
    for (const { ref, value, options } of this.writes) {
      const current = this.db.map(ref.collectionName).get(ref.id);
      const next = options.merge && current ? { ...current, ...structuredClone(value) } : structuredClone(value);
      this.db.map(ref.collectionName).set(ref.id, next);
    }
  }
}

class FakeDb {
  constructor(seed = {}) {
    this.collections = new Map();
    for (const [collectionName, items] of Object.entries(seed)) {
      const map = new Map();
      for (const item of items || []) {
        const { id, ...value } = item;
        map.set(id, structuredClone(value));
      }
      this.collections.set(collectionName, map);
    }
  }
  map(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return this.collections.get(name);
  }
  collection(name) { return new FakeCollection(this, name); }
  async runTransaction(callback) {
    const transaction = new FakeTransaction(this);
    const result = await callback(transaction);
    transaction.commit();
    return result;
  }
  read(collectionName, id) { return this.map(collectionName).get(id); }
}

function balance(onHand, reserved = 0) {
  return { onHand, reserved, minimum: 0, target: 0 };
}

function seed({
  policy = true,
  warehouse = balance(5, 1),
  office = balance(2, 0),
  aggregateOnly = false,
  verifiedAt = "2026-08-17T12:00:00.000Z",
} = {}) {
  const stock = {
    id: "p12",
    productId: "p12",
    active: true,
    verifiedAt,
    // Deliberately stale. Location balances are the only source of truth.
    onHand: 999,
    reserved: 998,
  };
  if (!aggregateOnly) stock.balances = { "WH-MAIN": warehouse, "OFFICE-MAIN": office, "VAN-1": balance(3, 0) };
  return {
    businessSettings: policy ? [{ id: RESERVATION_POLICY_ID, active: true, mode: "manual_release", version: 1 }] : [],
    services: [{
      id: "p12", itemType: "Producto", name: "Adina Optima 12,000 BTU",
      category: "Aire acondicionado", sku: "AD-12", basePrice: 699, active: true,
    }],
    clients: [{ id: "c1", name: "Maria", active: true }],
    commercialProductStock: [stock],
    vans: [
      { id: "VAN-1", name: "Van 1", active: true },
      { id: "VAN-OFF", name: "Van Off", active: false },
    ],
  };
}

function authority(db) {
  return createCommercialSalesAuthority({
    db,
    clock: () => new Date("2026-08-17T12:30:00.000Z"),
    serverTimestamp: () => "SERVER_TS",
  });
}

const actor = { source: "demac-customer-agent", id: "agent", name: "DEMAC Customer Agent" };
const context = { conversationId: "conv-1", inboundMessageId: "msg-1" };

function reservationArgs(overrides = {}) {
  return {
    productId: "p12",
    customerId: "c1",
    sourceLocationId: "WH-MAIN",
    quantity: 1,
    idempotencyKey: "stable-message",
    actor,
    context,
    ...overrides,
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test("reservation requires policy and a real source location", async () => {
  const missingSource = new FakeDb(seed());
  await expectCode(
    authority(missingSource).createReservation(reservationArgs({ sourceLocationId: "" })),
    COMMERCIAL_SALES_ERROR_CODES.INVALID_REQUEST,
  );

  const withoutPolicy = new FakeDb(seed({ policy: false }));
  await expectCode(authority(withoutPolicy).createReservation(reservationArgs()), COMMERCIAL_SALES_ERROR_CODES.RESERVATION_POLICY_NOT_CONFIGURED);
  assert.equal(withoutPolicy.map("inventoryMovements").size, 0);

  const inactiveVan = new FakeDb(seed());
  await expectCode(authority(inactiveVan).createReservation(reservationArgs({ sourceLocationId: "VAN-OFF" })), COMMERCIAL_SALES_ERROR_CODES.INVALID_SOURCE_LOCATION);
  assert.equal(inactiveVan.map("commercialProductReservations").size, 0);
});

test("aggregate-only legacy stock fails closed until location balances exist", async () => {
  const db = new FakeDb(seed({ aggregateOnly: true }));
  await expectCode(authority(db).createReservation(reservationArgs()), COMMERCIAL_SALES_ERROR_CODES.PRODUCT_STOCK_LOCATION_BALANCES_REQUIRED);
  assert.equal(db.read("commercialProductStock", "p12").reserved, 998);
  assert.equal(db.map("inventoryMovements").size, 0);
});

test("reservation refuses unverified stock and source-specific shortages", async () => {
  const unverified = new FakeDb(seed({ verifiedAt: "" }));
  await expectCode(authority(unverified).createReservation(reservationArgs()), COMMERCIAL_SALES_ERROR_CODES.PRODUCT_STOCK_NOT_VERIFIED);

  const shortage = new FakeDb(seed({ warehouse: balance(2, 1), office: balance(100, 0) }));
  await expectCode(authority(shortage).createReservation(reservationArgs({ quantity: 2 })), COMMERCIAL_SALES_ERROR_CODES.INSUFFICIENT_STOCK);
  assert.equal(shortage.read("commercialProductStock", "p12").balances["OFFICE-MAIN"].onHand, 100);
});

test("reservation updates the exact location and writes deterministic linked movement", async () => {
  const db = new FakeDb(seed());
  const result = await authority(db).createReservation(reservationArgs({ quantity: 2 }));
  const stock = db.read("commercialProductStock", "p12");
  const movement = db.read("inventoryMovements", result.movement.id);

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.match(result.reservationId, /^RSV-[A-F0-9]{24}$/);
  assert.equal(result.reservation.sourceLocationId, "WH-MAIN");
  assert.equal(stock.balances["WH-MAIN"].reserved, 3);
  assert.equal(stock.balances["OFFICE-MAIN"].reserved, 0);
  assert.equal(stock.onHand, 10);
  assert.equal(stock.reserved, 3);
  assert.equal(result.stock.available, 2);
  assert.equal(result.stock.aggregateAvailable, 7);
  assert.equal(movement.id, result.reservation.inventoryMovementId);
  assert.equal(movement.type, "commercial_reservation_reserved");
  assert.equal(movement.reservationId, result.reservationId);
  assert.equal(movement.customerId, "c1");
  assert.equal(movement.sourceLocationId, "WH-MAIN");
});

test("an active canonical Van can be the exact reservation source", async () => {
  const db = new FakeDb(seed());
  const result = await authority(db).createReservation(reservationArgs({ sourceLocationId: "VAN-1" }));
  assert.equal(result.reservation.sourceLocationName, "Van 1");
  assert.equal(db.read("commercialProductStock", "p12").balances["VAN-1"].reserved, 1);
});

test("idempotency replays once and its fingerprint includes sourceLocationId", async () => {
  const db = new FakeDb(seed());
  const sales = authority(db);
  const first = await sales.createReservation(reservationArgs());
  const replay = await sales.createReservation(reservationArgs());
  assert.equal(replay.replayed, true);
  assert.equal(replay.reservationId, first.reservationId);
  assert.equal(db.read("commercialProductStock", "p12").balances["WH-MAIN"].reserved, 2);
  assert.equal(db.map("inventoryMovements").size, 1);

  await expectCode(sales.createReservation(reservationArgs({ sourceLocationId: "OFFICE-MAIN" })), COMMERCIAL_SALES_ERROR_CODES.IDEMPOTENCY_CONFLICT);
});

test("release restores the exact location once and is replay-safe", async () => {
  const db = new FakeDb(seed());
  const sales = authority(db);
  const created = await sales.createReservation(reservationArgs({ quantity: 2, idempotencyKey: "release-me" }));
  const released = await sales.releaseReservation({ reservationId: created.reservationId, actor, reason: "Customer cancelled" });
  assert.equal(released.replayed, false);
  assert.equal(released.reservation.status, "released");
  assert.equal(db.read("commercialProductStock", "p12").balances["WH-MAIN"].reserved, 1);
  assert.equal(released.movement.sourceLocationId, "WH-MAIN");
  assert.equal(released.movement.reservationId, created.reservationId);
  assert.equal(db.map("inventoryMovements").size, 2);

  const replay = await sales.releaseReservation({ reservationId: created.reservationId, actor, reason: "Repeated" });
  assert.equal(replay.replayed, true);
  assert.equal(db.read("commercialProductStock", "p12").balances["WH-MAIN"].reserved, 1);
  assert.equal(db.map("inventoryMovements").size, 2);
});

test("release cannot borrow a reservation from another location", async () => {
  const db = new FakeDb(seed());
  const sales = authority(db);
  const created = await sales.createReservation(reservationArgs({ idempotencyKey: "location-mismatch" }));
  const stock = db.read("commercialProductStock", "p12");
  stock.balances["WH-MAIN"].reserved = 0;
  stock.balances["OFFICE-MAIN"].reserved = 2;
  await expectCode(sales.releaseReservation({ reservationId: created.reservationId, actor }), COMMERCIAL_SALES_ERROR_CODES.STOCK_RESERVATION_MISMATCH);
});

test("commit consumes exact reserved stock once and binds it to one canonical sale", async () => {
  const db = new FakeDb(seed());
  const sales = authority(db);
  const created = await sales.createReservation(reservationArgs({ quantity: 2, idempotencyKey: "commit-me" }));
  const committed = await sales.commitReservation({ reservationId: created.reservationId, saleId: "SALE-100", actor });
  const stock = db.read("commercialProductStock", "p12");

  assert.equal(committed.replayed, false);
  assert.equal(committed.reservation.status, "committed");
  assert.equal(committed.reservation.committedSaleId, "SALE-100");
  assert.equal(stock.balances["WH-MAIN"].onHand, 3);
  assert.equal(stock.balances["WH-MAIN"].reserved, 1);
  assert.equal(stock.onHand, 8);
  assert.equal(stock.reserved, 1);
  assert.equal(committed.movement.saleId, "SALE-100");
  assert.equal(committed.movement.customerId, "c1");
  assert.equal(db.map("inventoryMovements").size, 2);

  const replay = await sales.commitReservation({ reservationId: created.reservationId, saleId: "SALE-100", actor });
  assert.equal(replay.replayed, true);
  assert.equal(db.read("commercialProductStock", "p12").balances["WH-MAIN"].onHand, 3);
  assert.equal(db.map("inventoryMovements").size, 2);

  await expectCode(sales.commitReservation({ reservationId: created.reservationId, saleId: "SALE-OTHER", actor }), COMMERCIAL_SALES_ERROR_CODES.SALE_COMMIT_CONFLICT);
});
