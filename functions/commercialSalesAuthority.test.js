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
  async get() {
    return new FakeSnapshot(this.id, this.db.map(this.collectionName).get(this.id));
  }
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
  async get(ref) {
    return new FakeSnapshot(ref.id, this.db.map(ref.collectionName).get(ref.id));
  }
  set(ref, value) {
    this.writes.push({ ref, value });
  }
  commit() {
    for (const { ref, value } of this.writes) {
      this.db.map(ref.collectionName).set(ref.id, structuredClone(value));
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
  read(collectionName, id) {
    return this.map(collectionName).get(id);
  }
}

function seed({ policy = true, onHand = 5, reserved = 1, verifiedAt = "2026-08-17T12:00:00.000Z" } = {}) {
  return {
    businessSettings: policy ? [{
      id: RESERVATION_POLICY_ID,
      active: true,
      mode: "manual_release",
      version: 1,
    }] : [],
    services: [{
      id: "p12",
      itemType: "Producto",
      name: "Adina Optima 12,000 BTU",
      category: "Aire acondicionado",
      sku: "AD-12",
      basePrice: 699,
      active: true,
    }],
    clients: [{ id: "c1", name: "Maria", active: true }],
    commercialProductStock: [{
      id: "p12",
      productId: "p12",
      onHand,
      reserved,
      active: true,
      verifiedAt,
    }],
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

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test("reservation fails closed when ERP reservation policy is missing", async () => {
  const db = new FakeDb(seed({ policy: false }));
  await expectCode(authority(db).createReservation({
    productId: "p12",
    customerId: "c1",
    quantity: 1,
    idempotencyKey: "conv-1|msg-1|p12|1",
    actor,
    context,
  }), COMMERCIAL_SALES_ERROR_CODES.RESERVATION_POLICY_NOT_CONFIGURED);
  assert.equal(db.read("commercialProductStock", "p12").reserved, 1);
  assert.equal(db.map("commercialProductReservations").size, 0);
});

test("reservation refuses stock that has not been verified", async () => {
  const db = new FakeDb(seed({ verifiedAt: "" }));
  await expectCode(authority(db).createReservation({
    productId: "p12",
    customerId: "c1",
    quantity: 1,
    idempotencyKey: "unverified",
    actor,
    context,
  }), COMMERCIAL_SALES_ERROR_CODES.PRODUCT_STOCK_NOT_VERIFIED);
  assert.equal(db.read("commercialProductStock", "p12").reserved, 1);
});

test("reservation refuses quantity above verified available stock", async () => {
  const db = new FakeDb(seed({ onHand: 3, reserved: 2 }));
  await expectCode(authority(db).createReservation({
    productId: "p12",
    customerId: "c1",
    quantity: 2,
    idempotencyKey: "insufficient",
    actor,
    context,
  }), COMMERCIAL_SALES_ERROR_CODES.INSUFFICIENT_STOCK);
  assert.equal(db.read("commercialProductStock", "p12").reserved, 2);
});

test("reservation atomically increments reserved stock and creates canonical proof", async () => {
  const db = new FakeDb(seed());
  const result = await authority(db).createReservation({
    productId: "p12",
    customerId: "c1",
    quantity: 2,
    idempotencyKey: "conv-1|msg-1|p12|2",
    actor,
    context,
  });

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.match(result.reservationId, /^RSV-[A-F0-9]{24}$/);
  assert.equal(result.reservation.status, "active");
  assert.equal(result.reservation.customerId, "c1");
  assert.equal(result.reservation.productId, "p12");
  assert.equal(result.reservation.quantity, 2);
  assert.equal(result.reservation.policyMode, "manual_release");
  assert.equal(result.stock.reserved, 3);
  assert.equal(result.stock.available, 2);
  assert.equal(db.read("commercialProductStock", "p12").reserved, 3);
  assert.equal(db.read("commercialProductReservations", result.reservationId).reservationId, result.reservationId);
  assert.equal(db.map("commercialProductReservationIdempotency").size, 1);
});

test("same idempotency key replays without double-reserving stock", async () => {
  const db = new FakeDb(seed());
  const sales = authority(db);
  const args = {
    productId: "p12",
    customerId: "c1",
    quantity: 1,
    idempotencyKey: "stable-message",
    actor,
    context,
  };
  const first = await sales.createReservation(args);
  const second = await sales.createReservation(args);

  assert.equal(second.success, true);
  assert.equal(second.replayed, true);
  assert.equal(second.reservationId, first.reservationId);
  assert.equal(db.read("commercialProductStock", "p12").reserved, 2);
  assert.equal(db.map("commercialProductReservations").size, 1);
});

test("same idempotency key cannot be reused for a different reservation request", async () => {
  const db = new FakeDb(seed());
  const sales = authority(db);
  await sales.createReservation({
    productId: "p12",
    customerId: "c1",
    quantity: 1,
    idempotencyKey: "same-key",
    actor,
    context,
  });
  await expectCode(sales.createReservation({
    productId: "p12",
    customerId: "c1",
    quantity: 2,
    idempotencyKey: "same-key",
    actor,
    context,
  }), COMMERCIAL_SALES_ERROR_CODES.IDEMPOTENCY_CONFLICT);
  assert.equal(db.read("commercialProductStock", "p12").reserved, 2);
});

test("release is transactional and replay-safe", async () => {
  const db = new FakeDb(seed());
  const sales = authority(db);
  const created = await sales.createReservation({
    productId: "p12",
    customerId: "c1",
    quantity: 2,
    idempotencyKey: "release-me",
    actor,
    context,
  });
  assert.equal(db.read("commercialProductStock", "p12").reserved, 3);

  const released = await sales.releaseReservation({
    reservationId: created.reservationId,
    actor,
    reason: "Customer cancelled the product hold.",
  });
  assert.equal(released.success, true);
  assert.equal(released.replayed, false);
  assert.equal(released.reservation.status, "released");
  assert.equal(db.read("commercialProductStock", "p12").reserved, 1);

  const replay = await sales.releaseReservation({
    reservationId: created.reservationId,
    actor,
    reason: "Repeated release",
  });
  assert.equal(replay.replayed, true);
  assert.equal(db.read("commercialProductStock", "p12").reserved, 1);
});
