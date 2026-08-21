const crypto = require("node:crypto");
const { onRequest } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const INVENTORY_API_VERSION = 1;
const INVENTORY_ROLES = Object.freeze(["admin", "office", "supervisor", "inventory"]);
const WAREHOUSE_LOCATION_ID = "WH-MAIN";
const OFFICE_LOCATION_ID = "OFFICE-MAIN";
const LEGACY_UNASSIGNED_LOCATION_ID = "LEGACY-UNASSIGNED";
const FIXED_LOCATIONS = Object.freeze([
  { id: WAREHOUSE_LOCATION_ID, name: "Main Warehouse", type: "warehouse", active: true },
  { id: OFFICE_LOCATION_ID, name: "Main Office", type: "office", active: true },
]);

class InventoryAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InventoryAuthorityError";
    this.code = code;
    this.details = details;
  }
}

function cleanText(value, limit = 500) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
}

function nonNegativeInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.floor(number)) : 0;
}

function normalizeBalance(value = {}) {
  const onHand = nonNegativeInt(value.onHand);
  const reserved = Math.min(onHand, nonNegativeInt(value.reserved));
  const minimum = nonNegativeInt(value.minimum);
  const target = Math.max(minimum, nonNegativeInt(value.target, minimum));
  return { onHand, reserved, minimum, target };
}

function normalizeBalanceMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([locationId, balance]) => [cleanText(locationId, 160), normalizeBalance(balance)])
      .filter(([locationId]) => Boolean(locationId)),
  );
}

function productBalanceMap(stock = {}) {
  const stored = normalizeBalanceMap(stock.balances || stock.stockByLocation);
  if (Object.keys(stored).length) return stored;
  const legacyOnHand = nonNegativeInt(stock.onHand);
  const legacyReserved = Math.min(legacyOnHand, nonNegativeInt(stock.reserved));
  if (!legacyOnHand && !legacyReserved) return {};
  return {
    [LEGACY_UNASSIGNED_LOCATION_ID]: {
      onHand: legacyOnHand,
      reserved: legacyReserved,
      minimum: nonNegativeInt(stock.minimum),
      target: Math.max(nonNegativeInt(stock.minimum), nonNegativeInt(stock.target, stock.minimum)),
    },
  };
}

function materialBalanceMap(item = {}) {
  const stored = normalizeBalanceMap(item.stockByLocation || item.balances);
  if (Object.keys(stored).length) return stored;
  return {
    [WAREHOUSE_LOCATION_ID]: {
      onHand: nonNegativeInt(item.quantity),
      reserved: 0,
      minimum: nonNegativeInt(item.minimum),
      target: Math.max(nonNegativeInt(item.minimum), nonNegativeInt(item.target, item.minimum)),
    },
  };
}

function availableStock(balance) {
  const normalized = normalizeBalance(balance);
  return Math.max(0, normalized.onHand - normalized.reserved);
}

function balanceMapTotals(balances) {
  return Object.values(balances).reduce((totals, raw) => {
    const balance = normalizeBalance(raw);
    totals.onHand += balance.onHand;
    totals.reserved += balance.reserved;
    return totals;
  }, { onHand: 0, reserved: 0 });
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
}

function requestId(value) {
  const normalized = cleanText(value, 240);
  if (normalized.length < 8) {
    throw new InventoryAuthorityError("invalid_request", "A stable requestId of at least 8 characters is required.", { field: "requestId" });
  }
  return normalized;
}

function requiredText(value, field, label, limit = 500) {
  const normalized = cleanText(value, limit);
  if (!normalized) throw new InventoryAuthorityError("invalid_request", `${label} is required.`, { field });
  return normalized;
}

function normalizeItemKind(value) {
  const kind = cleanText(value, 40).toLowerCase();
  if (kind === "product" || kind === "material") return kind;
  throw new InventoryAuthorityError("invalid_request", "Inventory item kind must be product or material.", { field: "itemKind" });
}

function normalizedTransferLines(lines) {
  if (!Array.isArray(lines) || !lines.length) {
    throw new InventoryAuthorityError("invalid_request", "A transfer requires at least one inventory line.", { field: "lines" });
  }
  const merged = new Map();
  for (const raw of lines) {
    const itemKind = normalizeItemKind(raw?.itemKind);
    const itemId = requiredText(raw?.itemId, "lines.itemId", "Item id", 180);
    const quantity = positiveInt(raw?.quantity ?? raw?.requestedQuantity);
    if (!quantity) throw new InventoryAuthorityError("invalid_request", "Every transfer quantity must be greater than zero.", { itemId });
    const key = `${itemKind}:${itemId}`;
    const existing = merged.get(key);
    merged.set(key, {
      lineId: key,
      itemKind,
      itemId,
      requestedQuantity: quantity + (existing?.requestedQuantity || 0),
    });
  }
  return [...merged.values()].slice(0, 100);
}

function suppliedQuantityMap(lines, field) {
  const result = new Map();
  if (!Array.isArray(lines)) return result;
  for (const line of lines) {
    const lineId = cleanText(line?.lineId || `${line?.itemKind || ""}:${line?.itemId || ""}`, 400);
    if (!lineId) continue;
    const quantity = nonNegativeInt(line?.[field] ?? line?.quantity);
    result.set(lineId, quantity);
  }
  return result;
}

function snapshotItems(snapshot) {
  return (snapshot.docs || []).map((doc) => ({ id: doc.id, ...doc.data() }));
}

function profileRole(profile = {}) {
  return cleanText(profile.role, 80).toLowerCase();
}

function apiError(error) {
  if (error instanceof InventoryAuthorityError) {
    return { status: 409, body: { success: false, error: { code: error.code, message: error.message, details: error.details || {} } } };
  }
  if (error?.code === "unauthenticated") {
    return { status: 401, body: { success: false, error: { code: "unauthenticated", message: error.message, details: {} } } };
  }
  if (error?.code === "permission_denied") {
    return { status: 403, body: { success: false, error: { code: "permission_denied", message: error.message, details: {} } } };
  }
  return { status: 500, body: { success: false, error: { code: "internal_error", message: cleanText(error?.message || error, 500) || "Unexpected inventory error.", details: {} } } };
}

function productIsCanonicalProduct(product) {
  return cleanText(product?.itemType, 40) === "Producto";
}

function stockRecordFromSnapshots(kind, itemId, catalogSnapshot, stockSnapshot) {
  if (kind === "product") {
    if (!catalogSnapshot?.exists || !productIsCanonicalProduct(catalogSnapshot.data())) {
      throw new InventoryAuthorityError("item_not_found", "The selected Product does not exist in the canonical services catalog.", { itemKind: kind, itemId });
    }
    const catalog = { id: catalogSnapshot.id || itemId, ...catalogSnapshot.data() };
    const stock = stockSnapshot?.exists ? { id: stockSnapshot.id || itemId, ...stockSnapshot.data() } : { productId: itemId };
    return { kind, itemId, catalog, stock, balances: productBalanceMap(stock), ref: stockSnapshot.ref };
  }
  if (!catalogSnapshot?.exists || catalogSnapshot.data()?.active === false) {
    throw new InventoryAuthorityError("item_not_found", "The selected material / consumable does not exist or is inactive.", { itemKind: kind, itemId });
  }
  const catalog = { id: catalogSnapshot.id || itemId, ...catalogSnapshot.data() };
  return { kind, itemId, catalog, stock: catalog, balances: materialBalanceMap(catalog), ref: catalogSnapshot.ref };
}

async function readStockRecords(transaction, db, lines) {
  const records = [];
  for (const line of lines) {
    if (line.itemKind === "product") {
      const catalogRef = db.collection("services").doc(line.itemId);
      const stockRef = db.collection("commercialProductStock").doc(line.itemId);
      const catalogSnapshot = await transaction.get(catalogRef);
      const stockSnapshot = await transaction.get(stockRef);
      records.push(stockRecordFromSnapshots("product", line.itemId, catalogSnapshot, { ...stockSnapshot, ref: stockRef }));
    } else {
      const materialRef = db.collection("warehouseInventory").doc(line.itemId);
      const materialSnapshot = await transaction.get(materialRef);
      records.push(stockRecordFromSnapshots("material", line.itemId, { ...materialSnapshot, ref: materialRef }, null));
    }
  }
  return records;
}

function stockRecordByLine(records) {
  return new Map(records.map((record) => [`${record.kind}:${record.itemId}`, record]));
}

function writeStockRecord(transaction, record, balances, actor, now) {
  if (record.kind === "product") {
    const totals = balanceMapTotals(balances);
    transaction.set(record.ref, {
      productId: record.itemId,
      version: 2,
      active: record.stock.active !== false,
      balances,
      // Compatibility projection only. Location balances above are canonical.
      onHand: totals.onHand,
      reserved: totals.reserved,
      verifiedAt: now,
      verifiedById: actor.uid,
      updatedAt: now,
      updatedById: actor.uid,
    }, { merge: true });
    return;
  }
  const warehouse = normalizeBalance(balances[WAREHOUSE_LOCATION_ID] || {});
  transaction.set(record.ref, {
    inventoryVersion: 2,
    stockByLocation: balances,
    // Legacy V4 compatibility projection. WH-MAIN stockByLocation is canonical.
    quantity: warehouse.onHand,
    minimum: warehouse.minimum,
    updatedAt: now,
  }, { merge: true });
}

function movementRecord(args) {
  return {
    id: args.id,
    version: 1,
    itemKind: args.itemKind,
    itemId: args.itemId,
    itemName: cleanText(args.itemName, 240),
    quantity: nonNegativeInt(args.quantity),
    type: args.type,
    sourceLocationId: cleanText(args.sourceLocationId, 160),
    destinationLocationId: cleanText(args.destinationLocationId, 160),
    transferId: cleanText(args.transferId, 180),
    workOrderId: cleanText(args.workOrderId, 180),
    reason: cleanText(args.reason, 800),
    occurredAt: args.now,
    performedById: args.actor.uid,
    performedByName: args.actor.name,
  };
}

function setMovement(transaction, db, movement) {
  transaction.create(db.collection("inventoryMovements").doc(movement.id), movement);
}

async function inventoryLocations(db) {
  const vanSnapshot = await db.collection("vans").get();
  const vans = snapshotItems(vanSnapshot)
    .filter((van) => van.active !== false)
    .map((van) => ({ id: van.id, name: cleanText(van.name, 160) || van.id, type: "van", vanId: van.id, active: true }));
  return [...FIXED_LOCATIONS, ...vans];
}

function normalizeToolLocation(asset) {
  const type = cleanText(asset.locationType, 40) || "van";
  if (type === "warehouse") return WAREHOUSE_LOCATION_ID;
  if (type === "office") return OFFICE_LOCATION_ID;
  return cleanText(asset.locationId || asset.vanId, 160);
}

function normalizedStockItems(products, stocks, materials) {
  const stockByProduct = new Map(stocks.map((stock) => [stock.productId || stock.id, stock]));
  const productItems = products
    .filter(productIsCanonicalProduct)
    .map((product) => ({
      id: product.id,
      itemKind: "product",
      name: cleanText(product.name, 240) || product.id,
      sku: cleanText(product.sku, 120),
      category: cleanText(product.category, 160) || "Product",
      unit: "unit",
      sellable: true,
      price: Math.max(0, Number(product.basePrice) || 0),
      active: product.active !== false,
      balances: productBalanceMap(stockByProduct.get(product.id) || {}),
    }));
  const materialItems = materials.map((item) => ({
    id: item.id,
    itemKind: "material",
    name: cleanText(item.name, 240) || item.id,
    sku: cleanText(item.sku, 120),
    category: cleanText(item.category, 160) || "Consumable",
    unit: cleanText(item.unit, 80) || "unit",
    sellable: false,
    cost: Math.max(0, Number(item.cost) || 0),
    active: item.active !== false,
    balances: materialBalanceMap(item),
  }));
  return [...productItems, ...materialItems];
}

function buildReplenishment(items, locations) {
  const vanIds = new Set(locations.filter((location) => location.type === "van").map((location) => location.id));
  const result = [];
  for (const item of items) {
    for (const [locationId, raw] of Object.entries(item.balances || {})) {
      if (!vanIds.has(locationId)) continue;
      const balance = normalizeBalance(raw);
      if (!balance.target) continue;
      const available = availableStock(balance);
      const needed = Math.max(0, balance.target - available);
      if (!needed || available > balance.minimum) continue;
      result.push({
        itemKind: item.itemKind,
        itemId: item.id,
        itemName: item.name,
        locationId,
        onHand: balance.onHand,
        reserved: balance.reserved,
        minimum: balance.minimum,
        target: balance.target,
        needed,
      });
    }
  }
  return result.sort((a, b) => b.needed - a.needed || a.itemName.localeCompare(b.itemName));
}

function createInventoryApi({ db, verifyIdToken } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  if (typeof verifyIdToken !== "function") throw new Error("verifyIdToken is required.");

  async function authenticate(request) {
    const header = String(request?.headers?.authorization || "");
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      const error = new Error("Firebase authentication is required.");
      error.code = "unauthenticated";
      throw error;
    }
    let decoded;
    try {
      decoded = await verifyIdToken(match[1]);
    } catch (cause) {
      const error = new Error("The Firebase session is invalid or expired.");
      error.code = "unauthenticated";
      error.cause = cause;
      throw error;
    }
    const uid = cleanText(decoded?.uid || decoded?.sub, 160);
    const profileSnapshot = await db.collection("users").doc(uid).get();
    const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
    const role = profileRole(profile) || cleanText(decoded?.role, 80).toLowerCase();
    if (!INVENTORY_ROLES.includes(role) || profile.active === false) {
      const error = new Error("This user is not allowed to manage inventory.");
      error.code = "permission_denied";
      throw error;
    }
    return {
      uid,
      role,
      name: cleanText(profile.name || decoded?.name || decoded?.email, 180) || uid,
      email: cleanText(decoded?.email || profile.email, 180),
    };
  }

  async function assertLocation(locationId, locations, field) {
    const normalized = requiredText(locationId, field, "Inventory location", 160);
    const location = locations.find((candidate) => candidate.id === normalized);
    if (!location) throw new InventoryAuthorityError("invalid_location", "The selected inventory location does not exist or is inactive.", { field, locationId: normalized });
    return location;
  }

  async function getSnapshot() {
    const [serviceSnapshot, productStockSnapshot, materialSnapshot, toolCatalogSnapshot, toolAssetSnapshot, transferSnapshot, movementSnapshot, locations] = await Promise.all([
      db.collection("services").get(),
      db.collection("commercialProductStock").get(),
      db.collection("warehouseInventory").get(),
      db.collection("toolCatalog").get(),
      db.collection("vanToolAssets").get(),
      db.collection("inventoryTransfers").get(),
      db.collection("inventoryMovements").orderBy("occurredAt", "desc").limit(100).get().catch(() => ({ docs: [] })),
      inventoryLocations(db),
    ]);
    const items = normalizedStockItems(snapshotItems(serviceSnapshot), snapshotItems(productStockSnapshot), snapshotItems(materialSnapshot));
    const hasLegacyUnassigned = items.some((item) => nonNegativeInt(item.balances?.[LEGACY_UNASSIGNED_LOCATION_ID]?.onHand) > 0);
    const resolvedLocations = hasLegacyUnassigned
      ? [...locations, { id: LEGACY_UNASSIGNED_LOCATION_ID, name: "Legacy stock · location not assigned", type: "legacy", active: true, readOnly: true }]
      : locations;
    const tools = snapshotItems(toolAssetSnapshot).map((asset) => ({ ...asset, inventoryLocationId: normalizeToolLocation(asset) }));
    const transfers = snapshotItems(transferSnapshot).sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || ""))).slice(0, 100);
    return {
      success: true,
      version: INVENTORY_API_VERSION,
      locations: resolvedLocations,
      items,
      toolCatalog: snapshotItems(toolCatalogSnapshot),
      toolAssets: tools,
      transfers,
      movements: snapshotItems(movementSnapshot),
      replenishment: buildReplenishment(items, locations),
    };
  }

  async function setStockLevel(data, actor) {
    const idempotency = requestId(data.requestId);
    const itemKind = normalizeItemKind(data.itemKind);
    const itemId = requiredText(data.itemId, "itemId", "Item id", 180);
    const locationId = requiredText(data.locationId, "locationId", "Location id", 160);
    const onHand = nonNegativeInt(data.onHand);
    const reason = cleanText(data.reason, 800) || "Physical inventory adjustment";
    const locations = await inventoryLocations(db);
    await assertLocation(locationId, locations, "locationId");
    const movementId = deterministicId("IM", `${idempotency}:stock-level`);
    let result;
    await db.runTransaction(async (transaction) => {
      const [record] = await readStockRecords(transaction, db, [{ itemKind, itemId }]);
      const balances = { ...record.balances };
      const before = normalizeBalance(balances[locationId] || {});
      if (onHand < before.reserved) {
        throw new InventoryAuthorityError("stock_reserved", "The physical count cannot be lower than stock already reserved for active transfers.", { locationId, reserved: before.reserved, onHand });
      }
      const after = { ...before, onHand };
      balances[locationId] = after;
      const now = new Date().toISOString();
      writeStockRecord(transaction, record, balances, actor, now);
      const delta = onHand - before.onHand;
      if (delta !== 0) {
        setMovement(transaction, db, movementRecord({
          id: movementId,
          itemKind,
          itemId,
          itemName: record.catalog.name,
          quantity: Math.abs(delta),
          type: delta > 0 ? "adjustment_in" : "adjustment_out",
          sourceLocationId: delta < 0 ? locationId : "",
          destinationLocationId: delta > 0 ? locationId : "",
          reason,
          now,
          actor,
        }));
      }
      result = { itemKind, itemId, locationId, before, after, delta };
    });
    return { success: true, version: INVENTORY_API_VERSION, ...result };
  }

  async function setLocationPolicy(data, actor) {
    requestId(data.requestId);
    const itemKind = normalizeItemKind(data.itemKind);
    const itemId = requiredText(data.itemId, "itemId", "Item id", 180);
    const locationId = requiredText(data.locationId, "locationId", "Location id", 160);
    const minimum = nonNegativeInt(data.minimum);
    const target = Math.max(minimum, nonNegativeInt(data.target, minimum));
    const locations = await inventoryLocations(db);
    await assertLocation(locationId, locations, "locationId");
    let balance;
    await db.runTransaction(async (transaction) => {
      const [record] = await readStockRecords(transaction, db, [{ itemKind, itemId }]);
      const balances = { ...record.balances };
      balance = { ...normalizeBalance(balances[locationId] || {}), minimum, target };
      balances[locationId] = balance;
      writeStockRecord(transaction, record, balances, actor, new Date().toISOString());
    });
    return { success: true, version: INVENTORY_API_VERSION, itemKind, itemId, locationId, balance };
  }

  async function createTransfer(data, actor) {
    const stableRequestId = requestId(data.requestId);
    const sourceLocationId = requiredText(data.sourceLocationId, "sourceLocationId", "Source location", 160);
    const destinationLocationId = requiredText(data.destinationLocationId, "destinationLocationId", "Destination location", 160);
    if (sourceLocationId === destinationLocationId) throw new InventoryAuthorityError("invalid_request", "Source and destination must be different locations.");
    const locations = await inventoryLocations(db);
    const source = await assertLocation(sourceLocationId, locations, "sourceLocationId");
    const destination = await assertLocation(destinationLocationId, locations, "destinationLocationId");
    const lines = normalizedTransferLines(data.lines);
    const transferId = deterministicId("IT", stableRequestId);
    const transferRef = db.collection("inventoryTransfers").doc(transferId);
    let transfer;
    let replayed = false;
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(transferRef);
      if (existing.exists) {
        transfer = { id: existing.id, ...existing.data() };
        replayed = true;
        return;
      }
      const records = await readStockRecords(transaction, db, lines);
      const byLine = stockRecordByLine(records);
      const now = new Date().toISOString();
      const enrichedLines = [];
      for (const line of lines) {
        const record = byLine.get(line.lineId);
        const balances = { ...record.balances };
        const sourceBalance = normalizeBalance(balances[sourceLocationId] || {});
        if (availableStock(sourceBalance) < line.requestedQuantity) {
          throw new InventoryAuthorityError("insufficient_stock", `${record.catalog.name || line.itemId} does not have enough available stock at ${source.name}.`, {
            itemKind: line.itemKind,
            itemId: line.itemId,
            locationId: sourceLocationId,
            available: availableStock(sourceBalance),
            requested: line.requestedQuantity,
          });
        }
        balances[sourceLocationId] = { ...sourceBalance, reserved: sourceBalance.reserved + line.requestedQuantity };
        writeStockRecord(transaction, record, balances, actor, now);
        enrichedLines.push({
          ...line,
          itemName: cleanText(record.catalog.name, 240) || line.itemId,
          unit: cleanText(record.catalog.unit, 80) || "unit",
          pickedQuantity: 0,
          receivedQuantity: 0,
        });
      }
      transfer = {
        id: transferId,
        version: 1,
        sourceLocationId,
        sourceLocationName: source.name,
        destinationLocationId,
        destinationLocationName: destination.name,
        status: "requested",
        lines: enrichedLines,
        requestedById: actor.uid,
        requestedByName: actor.name,
        requestedAt: now,
        assignedPickupStaffId: cleanText(data.assignedPickupStaffId, 180),
        assignedPickupName: cleanText(data.assignedPickupName, 180),
        note: cleanText(data.note, 1000),
        requestId: stableRequestId,
        updatedAt: now,
      };
      transaction.create(transferRef, transfer);
    });
    return { success: true, version: INVENTORY_API_VERSION, replayed, transfer };
  }

  async function pickupTransfer(data, actor) {
    requestId(data.requestId);
    const transferId = requiredText(data.transferId, "transferId", "Transfer id", 180);
    const picked = suppliedQuantityMap(data.lines, "pickedQuantity");
    const transferRef = db.collection("inventoryTransfers").doc(transferId);
    let transfer;
    let replayed = false;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(transferRef);
      if (!snapshot.exists) throw new InventoryAuthorityError("transfer_not_found", "The transfer no longer exists.", { transferId });
      const current = { id: snapshot.id, ...snapshot.data() };
      if (current.status === "in_transit" || current.status === "completed") {
        transfer = current;
        replayed = true;
        return;
      }
      if (current.status !== "requested") throw new InventoryAuthorityError("invalid_transfer_state", "Only a requested transfer can be picked up.", { status: current.status });
      const records = await readStockRecords(transaction, db, current.lines);
      const byLine = stockRecordByLine(records);
      const now = new Date().toISOString();
      const nextLines = [];
      for (const line of current.lines) {
        const record = byLine.get(line.lineId);
        const balances = { ...record.balances };
        const sourceBalance = normalizeBalance(balances[current.sourceLocationId] || {});
        const pickedQuantity = picked.has(line.lineId) ? picked.get(line.lineId) : nonNegativeInt(line.requestedQuantity);
        if (pickedQuantity > nonNegativeInt(line.requestedQuantity)) {
          throw new InventoryAuthorityError("invalid_request", "Picked quantity cannot exceed the requested quantity.", { lineId: line.lineId });
        }
        if (sourceBalance.onHand < pickedQuantity || sourceBalance.reserved < nonNegativeInt(line.requestedQuantity)) {
          throw new InventoryAuthorityError("stock_changed", `${line.itemName} stock changed after this transfer was requested. Reconcile the source inventory before pickup.`, { lineId: line.lineId });
        }
        balances[current.sourceLocationId] = {
          ...sourceBalance,
          onHand: sourceBalance.onHand - pickedQuantity,
          reserved: sourceBalance.reserved - nonNegativeInt(line.requestedQuantity),
        };
        writeStockRecord(transaction, record, balances, actor, now);
        if (pickedQuantity > 0) {
          setMovement(transaction, db, movementRecord({
            id: deterministicId("IM", `${transferId}:out:${line.lineId}`),
            itemKind: line.itemKind,
            itemId: line.itemId,
            itemName: line.itemName,
            quantity: pickedQuantity,
            type: "transfer_out",
            sourceLocationId: current.sourceLocationId,
            transferId,
            now,
            actor,
          }));
        }
        nextLines.push({ ...line, pickedQuantity });
      }
      transfer = {
        ...current,
        lines: nextLines,
        status: "in_transit",
        pickedUpById: actor.uid,
        pickedUpByName: actor.name,
        pickedUpAt: now,
        pickupNote: cleanText(data.note, 1000),
        updatedAt: now,
      };
      transaction.set(transferRef, transfer, { merge: true });
    });
    return { success: true, version: INVENTORY_API_VERSION, replayed, transfer };
  }

  async function receiveTransfer(data, actor) {
    requestId(data.requestId);
    const transferId = requiredText(data.transferId, "transferId", "Transfer id", 180);
    const received = suppliedQuantityMap(data.lines, "receivedQuantity");
    const transferRef = db.collection("inventoryTransfers").doc(transferId);
    let transfer;
    let replayed = false;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(transferRef);
      if (!snapshot.exists) throw new InventoryAuthorityError("transfer_not_found", "The transfer no longer exists.", { transferId });
      const current = { id: snapshot.id, ...snapshot.data() };
      if (current.status === "completed") {
        transfer = current;
        replayed = true;
        return;
      }
      if (current.status !== "in_transit") throw new InventoryAuthorityError("invalid_transfer_state", "Only an in-transit transfer can be received.", { status: current.status });
      const records = await readStockRecords(transaction, db, current.lines);
      const byLine = stockRecordByLine(records);
      const now = new Date().toISOString();
      const nextLines = [];
      let hasDiscrepancy = false;
      for (const line of current.lines) {
        const record = byLine.get(line.lineId);
        const balances = { ...record.balances };
        const pickedQuantity = nonNegativeInt(line.pickedQuantity);
        const receivedQuantity = received.has(line.lineId) ? received.get(line.lineId) : pickedQuantity;
        if (receivedQuantity > pickedQuantity) {
          throw new InventoryAuthorityError("invalid_request", "Received quantity cannot exceed the quantity picked up from the source.", { lineId: line.lineId });
        }
        const destinationBalance = normalizeBalance(balances[current.destinationLocationId] || {});
        balances[current.destinationLocationId] = { ...destinationBalance, onHand: destinationBalance.onHand + receivedQuantity };
        writeStockRecord(transaction, record, balances, actor, now);
        if (receivedQuantity > 0) {
          setMovement(transaction, db, movementRecord({
            id: deterministicId("IM", `${transferId}:in:${line.lineId}`),
            itemKind: line.itemKind,
            itemId: line.itemId,
            itemName: line.itemName,
            quantity: receivedQuantity,
            type: "transfer_in",
            destinationLocationId: current.destinationLocationId,
            transferId,
            now,
            actor,
          }));
        }
        const varianceQuantity = Math.max(0, pickedQuantity - receivedQuantity);
        if (varianceQuantity > 0) {
          hasDiscrepancy = true;
          setMovement(transaction, db, movementRecord({
            id: deterministicId("IM", `${transferId}:variance:${line.lineId}`),
            itemKind: line.itemKind,
            itemId: line.itemId,
            itemName: line.itemName,
            quantity: varianceQuantity,
            type: "transfer_variance",
            transferId,
            reason: cleanText(data.discrepancyNote, 1000) || "Transfer receipt variance",
            now,
            actor,
          }));
        }
        nextLines.push({ ...line, receivedQuantity, varianceQuantity });
      }
      if (hasDiscrepancy && !cleanText(data.discrepancyNote, 1000)) {
        throw new InventoryAuthorityError("discrepancy_note_required", "A discrepancy note is required when received quantities differ from picked quantities.");
      }
      transfer = {
        ...current,
        lines: nextLines,
        status: "completed",
        hasDiscrepancy,
        discrepancyNote: cleanText(data.discrepancyNote, 1000),
        receivedById: actor.uid,
        receivedByName: actor.name,
        receivedAt: now,
        completedAt: now,
        updatedAt: now,
      };
      transaction.set(transferRef, transfer, { merge: true });
    });
    return { success: true, version: INVENTORY_API_VERSION, replayed, transfer };
  }

  async function cancelTransfer(data, actor) {
    requestId(data.requestId);
    const transferId = requiredText(data.transferId, "transferId", "Transfer id", 180);
    const transferRef = db.collection("inventoryTransfers").doc(transferId);
    let transfer;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(transferRef);
      if (!snapshot.exists) throw new InventoryAuthorityError("transfer_not_found", "The transfer no longer exists.", { transferId });
      const current = { id: snapshot.id, ...snapshot.data() };
      if (current.status === "cancelled") {
        transfer = current;
        return;
      }
      if (current.status !== "requested") {
        throw new InventoryAuthorityError("invalid_transfer_state", "A transfer can only be cancelled before stock leaves the source location.", { status: current.status });
      }
      const records = await readStockRecords(transaction, db, current.lines);
      const byLine = stockRecordByLine(records);
      const now = new Date().toISOString();
      for (const line of current.lines) {
        const record = byLine.get(line.lineId);
        const balances = { ...record.balances };
        const sourceBalance = normalizeBalance(balances[current.sourceLocationId] || {});
        balances[current.sourceLocationId] = {
          ...sourceBalance,
          reserved: Math.max(0, sourceBalance.reserved - nonNegativeInt(line.requestedQuantity)),
        };
        writeStockRecord(transaction, record, balances, actor, now);
      }
      transfer = {
        ...current,
        status: "cancelled",
        cancelledAt: now,
        cancelledById: actor.uid,
        cancelledByName: actor.name,
        cancellationReason: cleanText(data.reason, 1000) || "Cancelled before pickup",
        updatedAt: now,
      };
      transaction.set(transferRef, transfer, { merge: true });
    });
    return { success: true, version: INVENTORY_API_VERSION, transfer };
  }

  async function moveToolAsset(data, actor) {
    requestId(data.requestId);
    const assetId = requiredText(data.assetId, "assetId", "Tool asset id", 180);
    const destinationLocationId = requiredText(data.destinationLocationId, "destinationLocationId", "Destination location", 160);
    const locations = await inventoryLocations(db);
    const destination = await assertLocation(destinationLocationId, locations, "destinationLocationId");
    const assetRef = db.collection("vanToolAssets").doc(assetId);
    let asset;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(assetRef);
      if (!snapshot.exists) throw new InventoryAuthorityError("item_not_found", "The tool asset no longer exists.", { assetId });
      const current = { id: snapshot.id, ...snapshot.data() };
      const sourceLocationId = normalizeToolLocation(current);
      if (sourceLocationId === destinationLocationId) {
        asset = current;
        return;
      }
      const now = new Date().toISOString();
      const locationType = destination.type === "warehouse" ? "warehouse" : destination.type === "office" ? "office" : "van";
      const lifecycleHistory = Array.isArray(current.lifecycleHistory) ? current.lifecycleHistory : [];
      asset = {
        ...current,
        ...(destination.type === "van" ? { vanId: destination.id } : {}),
        locationType,
        locationId: destination.id,
        assigned: true,
        present: true,
        operationalStatus: destination.type === "warehouse" ? "En depósito" : destination.type === "office" ? "En oficina" : "Disponible",
        updatedAt: now,
        lifecycleHistory: [...lifecycleHistory, {
          id: deterministicId("TL", `${data.requestId}:${assetId}`),
          action: "transferred",
          occurredAt: now,
          performedByUserId: actor.uid,
          performedByName: actor.name,
          fromLocationId: sourceLocationId,
          toLocationId: destination.id,
          reason: cleanText(data.reason, 800) || "Inventory location transfer",
        }],
      };
      transaction.set(assetRef, asset, { merge: true });
      setMovement(transaction, db, movementRecord({
        id: deterministicId("IM", `${data.requestId}:tool:${assetId}`),
        itemKind: "tool_asset",
        itemId: assetId,
        itemName: current.assetCode || assetId,
        quantity: 1,
        type: "tool_transfer",
        sourceLocationId,
        destinationLocationId,
        reason: cleanText(data.reason, 800),
        now,
        actor,
      }));
    });
    return { success: true, version: INVENTORY_API_VERSION, asset };
  }

  async function issueToWorkOrder(data, actor) {
    const stableRequestId = requestId(data.requestId);
    const itemKind = normalizeItemKind(data.itemKind);
    const itemId = requiredText(data.itemId, "itemId", "Item id", 180);
    const locationId = requiredText(data.locationId, "locationId", "Inventory location", 160);
    const workOrderId = requiredText(data.workOrderId, "workOrderId", "Work Order", 180);
    const quantity = positiveInt(data.quantity);
    if (!quantity) throw new InventoryAuthorityError("invalid_request", "Issued quantity must be greater than zero.");
    const locations = await inventoryLocations(db);
    await assertLocation(locationId, locations, "locationId");
    const movementId = deterministicId("IM", `${stableRequestId}:work-order-issue`);
    let movement;
    await db.runTransaction(async (transaction) => {
      const workOrderRef = db.collection("workOrders").doc(workOrderId);
      const workOrderSnapshot = await transaction.get(workOrderRef);
      if (!workOrderSnapshot.exists) throw new InventoryAuthorityError("work_order_not_found", "The selected Work Order does not exist.", { workOrderId });
      const [record] = await readStockRecords(transaction, db, [{ itemKind, itemId }]);
      const balances = { ...record.balances };
      const balance = normalizeBalance(balances[locationId] || {});
      if (availableStock(balance) < quantity) {
        throw new InventoryAuthorityError("insufficient_stock", `${record.catalog.name} does not have enough available stock at the selected location.`, { available: availableStock(balance), quantity });
      }
      balances[locationId] = { ...balance, onHand: balance.onHand - quantity };
      const now = new Date().toISOString();
      writeStockRecord(transaction, record, balances, actor, now);
      movement = movementRecord({
        id: movementId,
        itemKind,
        itemId,
        itemName: record.catalog.name,
        quantity,
        type: "issue_to_work_order",
        sourceLocationId: locationId,
        workOrderId,
        reason: cleanText(data.reason, 800) || "Issued to Work Order",
        now,
        actor,
      });
      setMovement(transaction, db, movement);
    });
    return { success: true, version: INVENTORY_API_VERSION, movement };
  }

  async function execute({ action, data = {}, actor }) {
    if (action === "get_snapshot") return getSnapshot();
    if (action === "set_stock_level") return setStockLevel(data, actor);
    if (action === "set_location_policy") return setLocationPolicy(data, actor);
    if (action === "create_transfer") return createTransfer(data, actor);
    if (action === "pickup_transfer") return pickupTransfer(data, actor);
    if (action === "receive_transfer") return receiveTransfer(data, actor);
    if (action === "cancel_transfer") return cancelTransfer(data, actor);
    if (action === "move_tool_asset") return moveToolAsset(data, actor);
    if (action === "issue_to_work_order") return issueToWorkOrder(data, actor);
    throw new InventoryAuthorityError("invalid_request", "Unsupported Inventory Authority action.", { action: cleanText(action, 120) });
  }

  async function handle(request) {
    if (request.method === "OPTIONS") return { status: 204, body: null };
    if (request.method !== "POST") return { status: 405, body: { success: false, error: { code: "method_not_allowed", message: "POST is required.", details: {} } } };
    try {
      const actor = await authenticate(request);
      const action = cleanText(request.body?.action, 120);
      const result = await execute({ action, data: request.body?.data || {}, actor });
      return { status: 200, body: result };
    } catch (error) {
      return apiError(error);
    }
  }

  return {
    version: INVENTORY_API_VERSION,
    authenticate,
    execute,
    handle,
    getSnapshot,
    setStockLevel,
    setLocationPolicy,
    createTransfer,
    pickupTransfer,
    receiveTransfer,
    cancelTransfer,
    moveToolAsset,
    issueToWorkOrder,
  };
}

let defaultApi;
function getDefaultApi() {
  if (!defaultApi) {
    const db = getFirestore();
    defaultApi = createInventoryApi({ db, verifyIdToken: (token) => getAuth().verifyIdToken(token) });
  }
  return defaultApi;
}

exports.inventoryAuthority = onRequest(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 60 },
  async (request, response) => {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    const result = await getDefaultApi().handle(request);
    if (result.status === 204) {
      response.status(204).send("");
      return;
    }
    response.status(result.status).json(result.body);
  },
);

module.exports.INVENTORY_API_VERSION = INVENTORY_API_VERSION;
module.exports.INVENTORY_ROLES = INVENTORY_ROLES;
module.exports.FIXED_LOCATIONS = FIXED_LOCATIONS;
module.exports.WAREHOUSE_LOCATION_ID = WAREHOUSE_LOCATION_ID;
module.exports.OFFICE_LOCATION_ID = OFFICE_LOCATION_ID;
module.exports.LEGACY_UNASSIGNED_LOCATION_ID = LEGACY_UNASSIGNED_LOCATION_ID;
module.exports.InventoryAuthorityError = InventoryAuthorityError;
module.exports.availableStock = availableStock;
module.exports.buildReplenishment = buildReplenishment;
module.exports.createInventoryApi = createInventoryApi;
module.exports.materialBalanceMap = materialBalanceMap;
module.exports.normalizeBalance = normalizeBalance;
module.exports.productBalanceMap = productBalanceMap;
module.exports.normalizedTransferLines = normalizedTransferLines;
