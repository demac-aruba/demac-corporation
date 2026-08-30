const crypto = require("node:crypto");

const INVENTORY_PRODUCT_STOCK_VERSION = 1;
const INVENTORY_PRODUCT_STOCK_COLLECTIONS = Object.freeze({
  vans: "vans",
  movements: "inventoryMovements",
});
const INVENTORY_PRODUCT_STOCK_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "invalid_request",
  INVALID_SOURCE_LOCATION: "invalid_source_location",
  LOCATION_BALANCES_REQUIRED: "product_stock_location_balances_required",
  PRODUCT_STOCK_INVALID: "product_stock_invalid",
  INSUFFICIENT_STOCK: "insufficient_stock",
  RESERVATION_MISMATCH: "stock_reservation_mismatch",
  MOVEMENT_CONFLICT: "inventory_movement_conflict",
});
const FIXED_INVENTORY_LOCATIONS = Object.freeze({
  "WH-MAIN": Object.freeze({ id: "WH-MAIN", name: "Main Warehouse", type: "warehouse", active: true }),
  "OFFICE-MAIN": Object.freeze({ id: "OFFICE-MAIN", name: "Main Office", type: "office", active: true }),
});
const PRODUCT_STOCK_OPERATIONS = Object.freeze({
  RESERVE: "reserve",
  RELEASE: "release",
  COMMIT: "commit",
});

class InventoryProductStockAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InventoryProductStockAuthorityError";
    this.code = code;
    this.details = details;
  }
}

function cleanText(value, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

function hashKey(value, size = 40) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, size);
}

function strictCount(value, field, details = {}, fallback = undefined) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.PRODUCT_STOCK_INVALID,
      "Location-aware commercial stock contains an invalid quantity.",
      { ...details, field },
    );
  }
  return count;
}

function normalizeLocationBalance(raw, locationId) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.PRODUCT_STOCK_INVALID,
      "Location-aware commercial stock contains an invalid location balance.",
      { locationId },
    );
  }
  const onHand = strictCount(raw.onHand, "onHand", { locationId });
  const reserved = strictCount(raw.reserved, "reserved", { locationId }, 0);
  const minimum = strictCount(raw.minimum, "minimum", { locationId }, 0);
  const target = strictCount(raw.target, "target", { locationId }, minimum);
  if (reserved > onHand || target < minimum) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.PRODUCT_STOCK_INVALID,
      "Location-aware commercial stock contains inconsistent quantities.",
      { locationId, onHand, reserved, minimum, target },
    );
  }
  return { ...raw, onHand, reserved, minimum, target };
}

function locationBalances(stock = {}) {
  const raw = stock.balances;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Object.keys(raw).length) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.LOCATION_BALANCES_REQUIRED,
      "Commercial stock must be allocated to physical locations before it can be reserved or sold.",
      { migrationRequired: true },
    );
  }
  const balances = {};
  for (const [rawId, balance] of Object.entries(raw)) {
    const locationId = cleanText(rawId, 160);
    if (!locationId) {
      throw new InventoryProductStockAuthorityError(
        INVENTORY_PRODUCT_STOCK_ERROR_CODES.PRODUCT_STOCK_INVALID,
        "Location-aware commercial stock contains an empty location identity.",
      );
    }
    balances[locationId] = normalizeLocationBalance(balance, locationId);
  }
  return balances;
}

function deriveProductStock(stock = {}) {
  const balances = locationBalances(stock);
  const totals = Object.values(balances).reduce((sum, balance) => ({
    onHand: sum.onHand + balance.onHand,
    reserved: sum.reserved + balance.reserved,
  }), { onHand: 0, reserved: 0 });
  return {
    balances,
    onHand: totals.onHand,
    reserved: totals.reserved,
    available: totals.onHand - totals.reserved,
  };
}

function sourceLocationStock(stock = {}, sourceLocationId = "") {
  const id = cleanText(sourceLocationId, 160);
  if (!id) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.INVALID_REQUEST,
      "sourceLocationId is required for commercial stock operations.",
      { field: "sourceLocationId" },
    );
  }
  const projection = deriveProductStock(stock);
  const balance = projection.balances[id];
  if (!balance) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.INSUFFICIENT_STOCK,
      "The selected physical source location has no configured stock for this product.",
      { sourceLocationId: id, available: 0 },
    );
  }
  return {
    sourceLocationId: id,
    onHand: balance.onHand,
    reserved: balance.reserved,
    available: balance.onHand - balance.reserved,
    aggregate: {
      onHand: projection.onHand,
      reserved: projection.reserved,
      available: projection.available,
    },
  };
}

async function resolveInventorySourceLocation({ db, reader, sourceLocationId, collections = INVENTORY_PRODUCT_STOCK_COLLECTIONS } = {}) {
  const id = cleanText(sourceLocationId, 160);
  if (!id) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.INVALID_REQUEST,
      "sourceLocationId is required for commercial stock operations.",
      { field: "sourceLocationId" },
    );
  }
  if (FIXED_INVENTORY_LOCATIONS[id]) return FIXED_INVENTORY_LOCATIONS[id];
  if (!db || typeof db.collection !== "function" || !reader || typeof reader.get !== "function") {
    throw new Error("A Firestore-compatible db and reader are required to resolve inventory locations.");
  }
  const vanSnapshot = await reader.get(db.collection(collections.vans).doc(id));
  if (!vanSnapshot.exists || vanSnapshot.data()?.active === false) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.INVALID_SOURCE_LOCATION,
      "The selected source location is not Warehouse, Office, or an active canonical Van.",
      { sourceLocationId: id },
    );
  }
  const van = vanSnapshot.data() || {};
  return { id, name: cleanText(van.name, 160) || id, type: "van", active: true };
}

function inventoryMovementIdentity(reservationId, operation) {
  return `IM-${hashKey(`commercial-product|${reservationId}|${operation}`, 24).toUpperCase()}`;
}

function nextLocationBalance(balance, quantity, operation, details) {
  const available = balance.onHand - balance.reserved;
  if (operation === PRODUCT_STOCK_OPERATIONS.RESERVE) {
    if (available < quantity) {
      throw new InventoryProductStockAuthorityError(
        INVENTORY_PRODUCT_STOCK_ERROR_CODES.INSUFFICIENT_STOCK,
        "There is not enough stock at the selected physical source location.",
        { ...details, requested: quantity, available },
      );
    }
    return { ...balance, reserved: balance.reserved + quantity };
  }
  if (balance.reserved < quantity) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.RESERVATION_MISMATCH,
      "The selected physical source location no longer contains the reserved quantity.",
      { ...details, requested: quantity, reserved: balance.reserved },
    );
  }
  if (operation === PRODUCT_STOCK_OPERATIONS.RELEASE) {
    return { ...balance, reserved: balance.reserved - quantity };
  }
  if (operation === PRODUCT_STOCK_OPERATIONS.COMMIT) {
    if (balance.onHand < quantity) {
      throw new InventoryProductStockAuthorityError(
        INVENTORY_PRODUCT_STOCK_ERROR_CODES.RESERVATION_MISMATCH,
        "The selected physical source location no longer contains the reserved stock.",
        { ...details, requested: quantity, onHand: balance.onHand },
      );
    }
    return { ...balance, onHand: balance.onHand - quantity, reserved: balance.reserved - quantity };
  }
  throw new InventoryProductStockAuthorityError(
    INVENTORY_PRODUCT_STOCK_ERROR_CODES.INVALID_REQUEST,
    "Unsupported commercial inventory stock operation.",
    { operation },
  );
}

async function applyLocationAwareProductStockMutation({
  db,
  transaction,
  stockRef,
  stockSnapshot,
  productId,
  productName = "",
  sourceLocationId,
  quantity,
  operation,
  reservationId,
  customerId,
  saleId = "",
  actor = {},
  reason = "",
  nowIso,
  serverTimestampValue,
  collections = INVENTORY_PRODUCT_STOCK_COLLECTIONS,
} = {}) {
  if (!db || !transaction || !stockRef || !stockSnapshot?.exists) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.PRODUCT_STOCK_INVALID,
      "Commercial product stock is unavailable for a location-aware mutation.",
      { productId: cleanText(productId, 160) },
    );
  }
  const itemId = cleanText(productId, 160);
  const locationId = cleanText(sourceLocationId, 160);
  const reservation = cleanText(reservationId, 180);
  const units = Number(quantity);
  if (!itemId || !reservation || !Number.isSafeInteger(units) || units <= 0) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.INVALID_REQUEST,
      "A product, reservation, and positive whole-number quantity are required.",
    );
  }
  const sourceLocation = await resolveInventorySourceLocation({ db, reader: transaction, sourceLocationId: locationId, collections });
  const stock = stockSnapshot.data() || {};
  const linkedProductId = cleanText(stock.productId, 160);
  if (stock.active === false || (linkedProductId && linkedProductId !== itemId)) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.PRODUCT_STOCK_INVALID,
      "Commercial product stock does not match the requested product.",
      { productId: itemId },
    );
  }
  const projection = deriveProductStock(stock);
  const before = projection.balances[locationId];
  if (!before) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.INSUFFICIENT_STOCK,
      "The selected physical source location has no configured stock for this product.",
      { productId: itemId, sourceLocationId: locationId, available: 0 },
    );
  }
  const after = nextLocationBalance(before, units, operation, { productId: itemId, sourceLocationId: locationId });
  const balances = { ...projection.balances, [locationId]: after };
  const totals = Object.values(balances).reduce((sum, balance) => ({
    onHand: sum.onHand + balance.onHand,
    reserved: sum.reserved + balance.reserved,
  }), { onHand: 0, reserved: 0 });
  const movementId = inventoryMovementIdentity(reservation, operation);
  const movementRef = db.collection(collections.movements).doc(movementId);
  const movementSnapshot = await transaction.get(movementRef);
  if (movementSnapshot.exists) {
    throw new InventoryProductStockAuthorityError(
      INVENTORY_PRODUCT_STOCK_ERROR_CODES.MOVEMENT_CONFLICT,
      "The deterministic inventory movement already exists without a matching reservation replay.",
      { movementId, reservationId: reservation },
    );
  }
  const actorId = cleanText(actor.id || actor.userId || actor.uid, 160);
  const actorName = cleanText(actor.name || actor.displayName, 160);
  const occurredAt = cleanText(nowIso, 120);
  const movement = {
    id: movementId,
    version: 1,
    itemKind: "product",
    itemId,
    itemName: cleanText(productName, 240) || itemId,
    quantity: units,
    type: `commercial_reservation_${operation === PRODUCT_STOCK_OPERATIONS.RESERVE ? "reserved" : operation === PRODUCT_STOCK_OPERATIONS.RELEASE ? "released" : "committed"}`,
    sourceLocationId: locationId,
    sourceLocationName: sourceLocation.name,
    reservationId: reservation,
    customerId: cleanText(customerId, 160),
    saleId: cleanText(saleId, 180),
    previousOnHand: before.onHand,
    resultingOnHand: after.onHand,
    previousReserved: before.reserved,
    resultingReserved: after.reserved,
    reason: cleanText(reason, 800),
    occurredAt,
    performedById: actorId,
    performedByName: actorName,
  };
  transaction.set(stockRef, {
    productId: itemId,
    version: 2,
    active: stock.active !== false,
    balances,
    onHand: totals.onHand,
    reserved: totals.reserved,
    updatedAtIso: occurredAt,
    updatedAt: serverTimestampValue,
    updatedById: actorId,
    updatedByName: actorName,
  }, { merge: true });
  transaction.set(movementRef, movement);
  return {
    sourceLocation,
    movement,
    stock: {
      sourceLocationId: locationId,
      onHand: after.onHand,
      reserved: after.reserved,
      available: after.onHand - after.reserved,
      aggregateOnHand: totals.onHand,
      aggregateReserved: totals.reserved,
      aggregateAvailable: totals.onHand - totals.reserved,
    },
  };
}

module.exports = {
  FIXED_INVENTORY_LOCATIONS,
  INVENTORY_PRODUCT_STOCK_COLLECTIONS,
  INVENTORY_PRODUCT_STOCK_ERROR_CODES,
  INVENTORY_PRODUCT_STOCK_VERSION,
  PRODUCT_STOCK_OPERATIONS,
  InventoryProductStockAuthorityError,
  applyLocationAwareProductStockMutation,
  deriveProductStock,
  inventoryMovementIdentity,
  locationBalances,
  resolveInventorySourceLocation,
  sourceLocationStock,
};
