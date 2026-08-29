const crypto = require("node:crypto");
const { onRequest } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const INVENTORY_API_VERSION = 1;
const INVENTORY_ROLES = Object.freeze([
  "admin", "office", "supervisor", "inventory", "owner",
  "super_admin", "super-admin", "superadmin",
]);
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
function roundQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}
function nonNegativeQuantity(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? roundQuantity(number) : fallback;
}
function quantityForKind(value, itemKind, options = {}) {
  const number = Number(value);
  const positive = options.positive === true;
  const field = cleanText(options.field, 120) || "quantity";
  if (!Number.isFinite(number) || number < 0 || (positive && number <= 0)) {
    throw new InventoryAuthorityError("invalid_request", `${field} must be ${positive ? "greater than zero" : "zero or greater"}.`, { field, itemKind });
  }
  if (itemKind === "product" && !Number.isInteger(number)) {
    throw new InventoryAuthorityError("invalid_request", "Product quantities must be whole units.", { field, itemKind, value: number });
  }
  return itemKind === "product" ? number : roundQuantity(number);
}
function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
}
function requestId(value) {
  const result = cleanText(value, 240);
  if (result.length < 8) throw new InventoryAuthorityError("invalid_request", "A stable requestId of at least 8 characters is required.", { field: "requestId" });
  return result;
}
function requiredText(value, field, label, limit = 500) {
  const result = cleanText(value, limit);
  if (!result) throw new InventoryAuthorityError("invalid_request", `${label} is required.`, { field });
  return result;
}
function normalizeItemKind(value) {
  const kind = cleanText(value, 40).toLowerCase();
  if (kind === "product" || kind === "material") return kind;
  throw new InventoryAuthorityError("invalid_request", "Inventory item kind must be product or material.", { field: "itemKind" });
}
function normalizeBalance(value = {}) {
  const onHand = nonNegativeQuantity(value.onHand);
  const reserved = Math.min(onHand, nonNegativeQuantity(value.reserved));
  const minimum = nonNegativeQuantity(value.minimum);
  const target = Math.max(minimum, nonNegativeQuantity(value.target, minimum));
  return { onHand, reserved, minimum, target };
}
function normalizeBalanceMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([id, balance]) => [cleanText(id, 160), normalizeBalance(balance)])
    .filter(([id]) => Boolean(id)));
}
function productBalanceMap(stock = {}) {
  const stored = normalizeBalanceMap(stock.balances || stock.stockByLocation);
  if (Object.keys(stored).length) return stored;
  const onHand = nonNegativeInt(stock.onHand);
  const reserved = Math.min(onHand, nonNegativeInt(stock.reserved));
  if (!onHand && !reserved) return {};
  return { [LEGACY_UNASSIGNED_LOCATION_ID]: {
    onHand, reserved,
    minimum: nonNegativeInt(stock.minimum),
    target: Math.max(nonNegativeInt(stock.minimum), nonNegativeInt(stock.target, stock.minimum)),
  } };
}
function materialBalanceMap(item = {}) {
  const stored = normalizeBalanceMap(item.stockByLocation || item.balances);
  if (Object.keys(stored).length) return stored;
  const minimum = nonNegativeQuantity(item.minimum);
  return { [WAREHOUSE_LOCATION_ID]: {
    onHand: nonNegativeQuantity(item.quantity), reserved: 0, minimum,
    target: Math.max(minimum, nonNegativeQuantity(item.target, minimum)),
  } };
}
function availableStock(balance) {
  const value = normalizeBalance(balance);
  return roundQuantity(Math.max(0, value.onHand - value.reserved));
}
function balanceMapTotals(balances) {
  return Object.values(balances).reduce((total, raw) => {
    const value = normalizeBalance(raw);
    total.onHand = roundQuantity(total.onHand + value.onHand);
    total.reserved = roundQuantity(total.reserved + value.reserved);
    return total;
  }, { onHand: 0, reserved: 0 });
}
function snapshotItems(snapshot) {
  return (snapshot.docs || []).map((doc) => ({ id: doc.id, ...doc.data() }));
}
function productIsCanonicalProduct(product) {
  return cleanText(product?.itemType, 40) === "Producto";
}
function normalizedTransferLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new InventoryAuthorityError("invalid_request", "A transfer requires at least one inventory line.", { field: "lines" });
  const merged = new Map();
  for (const raw of lines) {
    const itemKind = normalizeItemKind(raw?.itemKind);
    const itemId = requiredText(raw?.itemId, "lines.itemId", "Item id", 180);
    const quantity = quantityForKind(raw?.quantity ?? raw?.requestedQuantity, itemKind, { positive: true, field: "lines.quantity" });
    if (!quantity) throw new InventoryAuthorityError("invalid_request", "Every transfer quantity must be greater than zero.", { itemId });
    const lineId = `${itemKind}:${itemId}`;
    const current = merged.get(lineId);
    merged.set(lineId, { lineId, itemKind, itemId, requestedQuantity: quantity + (current?.requestedQuantity || 0) });
  }
  return [...merged.values()].slice(0, 100);
}
function suppliedQuantityMap(lines, field) {
  const result = new Map();
  if (!Array.isArray(lines)) return result;
  for (const line of lines) {
    const lineId = cleanText(line?.lineId || `${line?.itemKind || ""}:${line?.itemId || ""}`, 400);
    if (lineId) result.set(lineId, nonNegativeQuantity(line?.[field] ?? line?.quantity));
  }
  return result;
}
function apiError(error) {
  if (error instanceof InventoryAuthorityError) return { status: 409, body: { success: false, error: { code: error.code, message: error.message, details: error.details || {} } } };
  if (error?.code === "unauthenticated") return { status: 401, body: { success: false, error: { code: "unauthenticated", message: error.message, details: {} } } };
  if (error?.code === "permission_denied") return { status: 403, body: { success: false, error: { code: "permission_denied", message: error.message, details: {} } } };
  return { status: 500, body: { success: false, error: { code: "internal_error", message: cleanText(error?.message || error, 500) || "Unexpected inventory error.", details: {} } } };
}

async function inventoryLocations(db) {
  const vans = snapshotItems(await db.collection("vans").get())
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
  const productItems = products.filter(productIsCanonicalProduct).map((product) => ({
    id: product.id, itemKind: "product", name: cleanText(product.name, 240) || product.id,
    sku: cleanText(product.sku, 120), category: cleanText(product.category, 160) || "Product",
    unit: "unit", sellable: true, price: Math.max(0, Number(product.basePrice) || 0),
    active: product.active !== false, balances: productBalanceMap(stockByProduct.get(product.id) || {}),
  }));
  const materialItems = materials.map((item) => ({
    id: item.id, itemKind: "material", name: cleanText(item.name, 240) || item.id,
    sku: cleanText(item.sku, 120), category: cleanText(item.category, 160) || "Consumable",
    unit: cleanText(item.unit, 80) || "unit", sellable: false, cost: Math.max(0, Number(item.cost) || 0),
    active: item.active !== false, balances: materialBalanceMap(item),
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
      const needed = roundQuantity(Math.max(0, balance.target - available));
      if (needed > 0 && available <= balance.minimum) result.push({
        itemKind: item.itemKind, itemId: item.id, itemName: item.name, locationId,
        onHand: balance.onHand, reserved: balance.reserved, minimum: balance.minimum, target: balance.target, needed,
      });
    }
  }
  return result.sort((a, b) => b.needed - a.needed || a.itemName.localeCompare(b.itemName));
}

function createInventoryApi({ db, verifyIdToken } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  if (typeof verifyIdToken !== "function") throw new Error("verifyIdToken is required.");

  async function authenticate(request) {
    const match = String(request?.headers?.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) { const error = new Error("Firebase authentication is required."); error.code = "unauthenticated"; throw error; }
    let decoded;
    try { decoded = await verifyIdToken(match[1]); }
    catch (cause) { const error = new Error("The Firebase session is invalid or expired."); error.code = "unauthenticated"; error.cause = cause; throw error; }
    const uid = cleanText(decoded?.uid || decoded?.sub, 160);
    const profileSnapshot = await db.collection("users").doc(uid).get();
    const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
    const role = cleanText(profile.role || decoded?.role, 80).toLowerCase();
    if (!INVENTORY_ROLES.includes(role) || profile.active === false) { const error = new Error("This user is not allowed to manage inventory."); error.code = "permission_denied"; throw error; }
    return { uid, role, name: cleanText(profile.name || decoded?.name || decoded?.email, 180) || uid, email: cleanText(decoded?.email || profile.email, 180) };
  }
  async function assertLocation(locationId, locations, field) {
    const id = requiredText(locationId, field, "Inventory location", 160);
    const location = locations.find((candidate) => candidate.id === id);
    if (!location) throw new InventoryAuthorityError("invalid_location", "The selected inventory location does not exist or is inactive.", { field, locationId: id });
    return location;
  }
  async function readStockRecords(transaction, lines) {
    const records = [];
    for (const line of lines) {
      if (line.itemKind === "product") {
        const catalogRef = db.collection("services").doc(line.itemId);
        const stockRef = db.collection("commercialProductStock").doc(line.itemId);
        const catalogSnapshot = await transaction.get(catalogRef);
        const stockSnapshot = await transaction.get(stockRef);
        if (!catalogSnapshot.exists || !productIsCanonicalProduct(catalogSnapshot.data())) throw new InventoryAuthorityError("item_not_found", "The selected Product does not exist in the canonical services catalog.", { itemId: line.itemId });
        const catalog = { id: line.itemId, ...catalogSnapshot.data() };
        const stock = stockSnapshot.exists ? { id: line.itemId, ...stockSnapshot.data() } : { productId: line.itemId };
        records.push({ kind: "product", itemId: line.itemId, catalog, stock, balances: productBalanceMap(stock), ref: stockRef });
      } else {
        const ref = db.collection("warehouseInventory").doc(line.itemId);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists || snapshot.data()?.active === false) throw new InventoryAuthorityError("item_not_found", "The selected material / consumable does not exist or is inactive.", { itemId: line.itemId });
        const catalog = { id: line.itemId, ...snapshot.data() };
        records.push({ kind: "material", itemId: line.itemId, catalog, stock: catalog, balances: materialBalanceMap(catalog), ref });
      }
    }
    return records;
  }
  function writeStockRecord(transaction, record, balances, actor, now) {
    if (record.kind === "product") {
      const totals = balanceMapTotals(balances);
      transaction.set(record.ref, {
        productId: record.itemId, version: 2, active: record.stock.active !== false, balances,
        onHand: totals.onHand, reserved: totals.reserved,
        verifiedAt: now, verifiedById: actor.uid, updatedAt: now, updatedById: actor.uid,
      }, { merge: true });
      return;
    }
    const warehouse = normalizeBalance(balances[WAREHOUSE_LOCATION_ID] || {});
    transaction.set(record.ref, {
      inventoryVersion: 2, stockByLocation: balances,
      quantity: warehouse.onHand, minimum: warehouse.minimum, updatedAt: now,
    }, { merge: true });
  }
  function movement(args) {
    return {
      id: args.id, version: 1, itemKind: args.itemKind, itemId: args.itemId,
      itemName: cleanText(args.itemName, 240), quantity: nonNegativeQuantity(args.quantity), type: args.type,
      sourceLocationId: cleanText(args.sourceLocationId, 160), destinationLocationId: cleanText(args.destinationLocationId, 160),
      transferId: cleanText(args.transferId, 180), workOrderId: cleanText(args.workOrderId, 180),
      previousOnHand: Number.isFinite(Number(args.previousOnHand)) ? Number(args.previousOnHand) : undefined,
      resultingOnHand: Number.isFinite(Number(args.resultingOnHand)) ? Number(args.resultingOnHand) : undefined,
      reason: cleanText(args.reason, 800), occurredAt: args.now,
      performedById: args.actor.uid, performedByName: args.actor.name,
    };
  }
  function movementRef(id) { return db.collection("inventoryMovements").doc(id); }
  function createMovement(transaction, record) { transaction.create(movementRef(record.id), record); }
  function byLine(records) { return new Map(records.map((record) => [`${record.kind}:${record.itemId}`, record])); }

  async function getSnapshot() {
    const [services, stocks, materials, toolCatalog, toolAssets, transfers, movements, locations] = await Promise.all([
      db.collection("services").get(), db.collection("commercialProductStock").get(), db.collection("warehouseInventory").get(),
      db.collection("toolCatalog").get(), db.collection("vanToolAssets").get(), db.collection("inventoryTransfers").get(),
      db.collection("inventoryMovements").orderBy("occurredAt", "desc").limit(100).get().catch(() => ({ docs: [] })), inventoryLocations(db),
    ]);
    const items = normalizedStockItems(snapshotItems(services), snapshotItems(stocks), snapshotItems(materials));
    const hasLegacy = items.some((item) => nonNegativeInt(item.balances?.[LEGACY_UNASSIGNED_LOCATION_ID]?.onHand) > 0);
    return {
      success: true, version: INVENTORY_API_VERSION,
      locations: hasLegacy ? [...locations, { id: LEGACY_UNASSIGNED_LOCATION_ID, name: "Legacy product stock · location not assigned", type: "legacy", active: true, readOnly: true }] : locations,
      items,
      toolCatalog: snapshotItems(toolCatalog),
      toolAssets: snapshotItems(toolAssets).map((asset) => ({ ...asset, inventoryLocationId: normalizeToolLocation(asset) })),
      transfers: snapshotItems(transfers).sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || ""))).slice(0, 100),
      movements: snapshotItems(movements), replenishment: buildReplenishment(items, locations),
    };
  }

  async function setStockLevel(data, actor) {
    const stable = requestId(data.requestId);
    const itemKind = normalizeItemKind(data.itemKind);
    const itemId = requiredText(data.itemId, "itemId", "Item id", 180);
    const locationId = requiredText(data.locationId, "locationId", "Location id", 160);
    if (locationId === LEGACY_UNASSIGNED_LOCATION_ID) throw new InventoryAuthorityError("invalid_location", "Legacy unassigned stock must be allocated, not edited as a normal location.");
    const onHand = quantityForKind(data.onHand, itemKind, { field: "onHand" });
    await assertLocation(locationId, await inventoryLocations(db), "locationId");
    const eventId = deterministicId("IM", `${stable}:stock-level`);
    let result;
    await db.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(movementRef(eventId));
      if (eventSnapshot.exists) { result = { replayed: true, movement: { id: eventSnapshot.id, ...eventSnapshot.data() } }; return; }
      const [record] = await readStockRecords(transaction, [{ itemKind, itemId }]);
      const balances = { ...record.balances };
      const before = normalizeBalance(balances[locationId] || {});
      if (onHand < before.reserved) throw new InventoryAuthorityError("stock_reserved", "The physical count cannot be lower than stock already reserved for active transfers.", { locationId, reserved: before.reserved, onHand });
      balances[locationId] = { ...before, onHand };
      const now = new Date().toISOString();
      writeStockRecord(transaction, record, balances, actor, now);
      const event = movement({ id: eventId, itemKind, itemId, itemName: record.catalog.name, quantity: Math.abs(onHand - before.onHand), type: "stock_count_adjustment", sourceLocationId: onHand < before.onHand ? locationId : "", destinationLocationId: onHand > before.onHand ? locationId : "", previousOnHand: before.onHand, resultingOnHand: onHand, reason: cleanText(data.reason, 800) || "Physical inventory count", now, actor });
      createMovement(transaction, event);
      result = { replayed: false, movement: event, before, after: balances[locationId] };
    });
    return { success: true, version: INVENTORY_API_VERSION, ...result };
  }

  async function setLocationPolicy(data, actor) {
    requestId(data.requestId);
    const itemKind = normalizeItemKind(data.itemKind);
    const itemId = requiredText(data.itemId, "itemId", "Item id", 180);
    const locationId = requiredText(data.locationId, "locationId", "Location id", 160);
    if (locationId === LEGACY_UNASSIGNED_LOCATION_ID) throw new InventoryAuthorityError("invalid_location", "Legacy unassigned stock cannot have a replenishment policy.");
    await assertLocation(locationId, await inventoryLocations(db), "locationId");
    const minimum = quantityForKind(data.minimum, itemKind, { field: "minimum" });
    const target = Math.max(minimum, quantityForKind(data.target, itemKind, { field: "target" }));
    let balance;
    await db.runTransaction(async (transaction) => {
      const [record] = await readStockRecords(transaction, [{ itemKind, itemId }]);
      const balances = { ...record.balances };
      balance = { ...normalizeBalance(balances[locationId] || {}), minimum, target };
      balances[locationId] = balance;
      writeStockRecord(transaction, record, balances, actor, new Date().toISOString());
    });
    return { success: true, version: INVENTORY_API_VERSION, itemKind, itemId, locationId, balance };
  }

  async function updateLocationInventoryState(data, actor) {
    const stable = requestId(data.requestId);
    const itemKind = normalizeItemKind(data.itemKind);
    const itemId = requiredText(data.itemId, "itemId", "Item id", 180);
    const locationId = requiredText(data.locationId, "locationId", "Location id", 160);
    if (locationId === LEGACY_UNASSIGNED_LOCATION_ID) throw new InventoryAuthorityError("invalid_location", "Legacy unassigned stock must be allocated, not edited as a normal location.");
    const onHand = quantityForKind(data.onHand, itemKind, { field: "onHand" });
    const minimum = quantityForKind(data.minimum, itemKind, { field: "minimum" });
    const target = quantityForKind(data.target, itemKind, { field: "target" });
    if (target < minimum) throw new InventoryAuthorityError("invalid_request", "Target quantity must be greater than or equal to minimum quantity.", { minimum, target });
    await assertLocation(locationId, await inventoryLocations(db), "locationId");
    const eventId = deterministicId("IM", `${stable}:location-inventory-state`);
    let result;
    await db.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(movementRef(eventId));
      if (eventSnapshot.exists) {
        result = { replayed: true, movement: { id: eventSnapshot.id, ...eventSnapshot.data() } };
        return;
      }
      const [record] = await readStockRecords(transaction, [{ itemKind, itemId }]);
      const balances = { ...record.balances };
      const before = normalizeBalance(balances[locationId] || {});
      if (onHand < before.reserved) throw new InventoryAuthorityError("stock_reserved", "The physical count cannot be lower than stock already reserved at this location.", { locationId, reserved: before.reserved, onHand });
      const after = { ...before, onHand, minimum, target };
      balances[locationId] = after;
      const now = new Date().toISOString();
      writeStockRecord(transaction, record, balances, actor, now);
      const event = {
        ...movement({
          id: eventId,
          itemKind,
          itemId,
          itemName: record.catalog.name,
          quantity: Math.abs(onHand - before.onHand),
          type: "stock_count_adjustment",
          sourceLocationId: onHand < before.onHand ? locationId : "",
          destinationLocationId: onHand > before.onHand ? locationId : "",
          previousOnHand: before.onHand,
          resultingOnHand: onHand,
          reason: cleanText(data.reason, 800) || "Physical inventory count and location policy update",
          now,
          actor,
        }),
        requestId: stable,
        locationId,
        previousMinimum: before.minimum,
        resultingMinimum: minimum,
        previousTarget: before.target,
        resultingTarget: target,
      };
      createMovement(transaction, event);
      result = { replayed: false, movement: event, before, after };
    });
    return { success: true, version: INVENTORY_API_VERSION, ...result };
  }

  async function allocateLegacyProductStock(data, actor) {
    const stable = requestId(data.requestId);
    const itemId = requiredText(data.itemId, "itemId", "Product id", 180);
    const allocations = Array.isArray(data.allocations) ? data.allocations.map((row) => ({ locationId: cleanText(row?.locationId, 160), quantity: nonNegativeInt(row?.quantity) })).filter((row) => row.locationId) : [];
    if (!allocations.length) throw new InventoryAuthorityError("invalid_request", "At least one destination allocation is required.");
    const locations = await inventoryLocations(db);
    for (const allocation of allocations) await assertLocation(allocation.locationId, locations, "allocations.locationId");
    if (allocations.some((row) => row.locationId === LEGACY_UNASSIGNED_LOCATION_ID)) throw new InventoryAuthorityError("invalid_location", "Legacy unassigned cannot be an allocation destination.");
    const eventId = deterministicId("IM", `${stable}:legacy-allocation`);
    let result;
    await db.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(movementRef(eventId));
      if (eventSnapshot.exists) { result = { replayed: true }; return; }
      const [record] = await readStockRecords(transaction, [{ itemKind: "product", itemId }]);
      const balances = { ...record.balances };
      const legacy = normalizeBalance(balances[LEGACY_UNASSIGNED_LOCATION_ID] || {});
      if (!legacy.onHand && !legacy.reserved) throw new InventoryAuthorityError("no_legacy_stock", "This product has no legacy unassigned stock to allocate.", { itemId });
      if (legacy.reserved) throw new InventoryAuthorityError("stock_reserved", "Legacy product stock cannot be allocated while it has reservations.", { itemId, reserved: legacy.reserved });
      const total = allocations.reduce((sum, row) => sum + row.quantity, 0);
      if (total !== legacy.onHand) throw new InventoryAuthorityError("allocation_total_mismatch", "Legacy stock allocation must equal the complete unassigned quantity.", { expected: legacy.onHand, provided: total });
      delete balances[LEGACY_UNASSIGNED_LOCATION_ID];
      for (const allocation of allocations) {
        const current = normalizeBalance(balances[allocation.locationId] || {});
        balances[allocation.locationId] = { ...current, onHand: current.onHand + allocation.quantity };
      }
      const now = new Date().toISOString();
      writeStockRecord(transaction, record, balances, actor, now);
      const event = movement({ id: eventId, itemKind: "product", itemId, itemName: record.catalog.name, quantity: legacy.onHand, type: "legacy_location_allocation", sourceLocationId: LEGACY_UNASSIGNED_LOCATION_ID, reason: allocations.map((row) => `${row.locationId}:${row.quantity}`).join(", "), now, actor });
      createMovement(transaction, event);
      result = { replayed: false, allocations, movement: event };
    });
    return { success: true, version: INVENTORY_API_VERSION, ...result };
  }

  async function createTransfer(data, actor) {
    const stable = requestId(data.requestId);
    const sourceLocationId = requiredText(data.sourceLocationId, "sourceLocationId", "Source location", 160);
    const destinationLocationId = requiredText(data.destinationLocationId, "destinationLocationId", "Destination location", 160);
    if (sourceLocationId === destinationLocationId) throw new InventoryAuthorityError("invalid_request", "Source and destination must be different locations.");
    const locations = await inventoryLocations(db);
    const source = await assertLocation(sourceLocationId, locations, "sourceLocationId");
    const destination = await assertLocation(destinationLocationId, locations, "destinationLocationId");
    const lines = normalizedTransferLines(data.lines);
    const transferId = deterministicId("IT", stable);
    const transferRef = db.collection("inventoryTransfers").doc(transferId);
    let transfer; let replayed = false;
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(transferRef);
      if (existing.exists) { transfer = { id: existing.id, ...existing.data() }; replayed = true; return; }
      const records = await readStockRecords(transaction, lines);
      const recordsByLine = byLine(records);
      const now = new Date().toISOString();
      const enriched = [];
      for (const line of lines) {
        const record = recordsByLine.get(line.lineId);
        const balances = { ...record.balances };
        const sourceBalance = normalizeBalance(balances[sourceLocationId] || {});
        if (availableStock(sourceBalance) < line.requestedQuantity) throw new InventoryAuthorityError("insufficient_stock", `${record.catalog.name || line.itemId} does not have enough available stock at ${source.name}.`, { itemId: line.itemId, available: availableStock(sourceBalance), requested: line.requestedQuantity });
        balances[sourceLocationId] = { ...sourceBalance, reserved: roundQuantity(sourceBalance.reserved + line.requestedQuantity) };
        writeStockRecord(transaction, record, balances, actor, now);
        enriched.push({ ...line, itemName: cleanText(record.catalog.name, 240) || line.itemId, unit: cleanText(record.catalog.unit, 80) || "unit", pickedQuantity: 0, receivedQuantity: 0 });
      }
      transfer = {
        id: transferId, version: 1, sourceLocationId, sourceLocationName: source.name,
        destinationLocationId, destinationLocationName: destination.name, status: "requested", lines: enriched,
        requestedById: actor.uid, requestedByName: actor.name, requestedAt: now,
        assignedPickupStaffId: cleanText(data.assignedPickupStaffId, 180), assignedPickupName: cleanText(data.assignedPickupName, 180),
        note: cleanText(data.note, 1000), requestId: stable, updatedAt: now,
      };
      transaction.create(transferRef, transfer);
    });
    return { success: true, version: INVENTORY_API_VERSION, replayed, transfer };
  }

  async function pickupTransfer(data, actor) {
    requestId(data.requestId);
    const transferId = requiredText(data.transferId, "transferId", "Transfer id", 180);
    const quantities = suppliedQuantityMap(data.lines, "pickedQuantity");
    const transferRef = db.collection("inventoryTransfers").doc(transferId);
    let transfer; let replayed = false;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(transferRef);
      if (!snapshot.exists) throw new InventoryAuthorityError("transfer_not_found", "The transfer no longer exists.", { transferId });
      const current = { id: snapshot.id, ...snapshot.data() };
      if (current.status === "in_transit" || current.status === "completed") { transfer = current; replayed = true; return; }
      if (current.status !== "requested") throw new InventoryAuthorityError("invalid_transfer_state", "Only a requested transfer can be picked up.", { status: current.status });
      const records = await readStockRecords(transaction, current.lines);
      const recordsByLine = byLine(records);
      const now = new Date().toISOString();
      const nextLines = [];
      for (const line of current.lines) {
        const record = recordsByLine.get(line.lineId);
        const balances = { ...record.balances };
        const source = normalizeBalance(balances[current.sourceLocationId] || {});
        const requested = quantityForKind(line.requestedQuantity, line.itemKind, { field: "requestedQuantity" });
        const picked = quantities.has(line.lineId) ? quantityForKind(quantities.get(line.lineId), line.itemKind, { field: "pickedQuantity" }) : requested;
        if (picked > requested) throw new InventoryAuthorityError("invalid_request", "Picked quantity cannot exceed requested quantity.", { lineId: line.lineId });
        if (source.onHand < picked || source.reserved < requested) throw new InventoryAuthorityError("stock_changed", `${line.itemName} stock changed after this transfer was requested.`, { lineId: line.lineId });
        balances[current.sourceLocationId] = { ...source, onHand: roundQuantity(source.onHand - picked), reserved: roundQuantity(source.reserved - requested) };
        writeStockRecord(transaction, record, balances, actor, now);
        if (picked > 0) createMovement(transaction, movement({ id: deterministicId("IM", `${transferId}:out:${line.lineId}`), itemKind: line.itemKind, itemId: line.itemId, itemName: line.itemName, quantity: picked, type: "transfer_out", sourceLocationId: current.sourceLocationId, transferId, now, actor }));
        nextLines.push({ ...line, pickedQuantity: picked, pickupShortfall: roundQuantity(Math.max(0, requested - picked)) });
      }
      transfer = { ...current, lines: nextLines, status: "in_transit", pickedUpById: actor.uid, pickedUpByName: actor.name, pickedUpAt: now, pickupNote: cleanText(data.note, 1000), updatedAt: now };
      transaction.set(transferRef, transfer, { merge: true });
    });
    return { success: true, version: INVENTORY_API_VERSION, replayed, transfer };
  }

  async function receiveTransfer(data, actor) {
    requestId(data.requestId);
    const transferId = requiredText(data.transferId, "transferId", "Transfer id", 180);
    const quantities = suppliedQuantityMap(data.lines, "receivedQuantity");
    const transferRef = db.collection("inventoryTransfers").doc(transferId);
    let transfer; let replayed = false;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(transferRef);
      if (!snapshot.exists) throw new InventoryAuthorityError("transfer_not_found", "The transfer no longer exists.", { transferId });
      const current = { id: snapshot.id, ...snapshot.data() };
      if (current.status === "completed") { transfer = current; replayed = true; return; }
      if (current.status !== "in_transit") throw new InventoryAuthorityError("invalid_transfer_state", "Only an in-transit transfer can be received.", { status: current.status });
      const nextQuantities = current.lines.map((line) => {
        const picked = quantityForKind(line.pickedQuantity, line.itemKind, { field: "pickedQuantity" });
        const received = quantities.has(line.lineId) ? quantityForKind(quantities.get(line.lineId), line.itemKind, { field: "receivedQuantity" }) : picked;
        return { line, picked, received };
      });
      if (nextQuantities.some(({ picked, received }) => received > picked)) throw new InventoryAuthorityError("invalid_request", "Received quantity cannot exceed picked quantity.");
      const hasDiscrepancy = nextQuantities.some(({ picked, received }) => picked !== received);
      const discrepancyNote = cleanText(data.discrepancyNote, 1000);
      if (hasDiscrepancy && !discrepancyNote) throw new InventoryAuthorityError("discrepancy_note_required", "A discrepancy note is required when received quantities differ from picked quantities.");
      const records = await readStockRecords(transaction, current.lines);
      const recordsByLine = byLine(records);
      const now = new Date().toISOString();
      const nextLines = [];
      for (const { line, picked, received } of nextQuantities) {
        const record = recordsByLine.get(line.lineId);
        const balances = { ...record.balances };
        const destination = normalizeBalance(balances[current.destinationLocationId] || {});
        balances[current.destinationLocationId] = { ...destination, onHand: roundQuantity(destination.onHand + received) };
        writeStockRecord(transaction, record, balances, actor, now);
        if (received > 0) createMovement(transaction, movement({ id: deterministicId("IM", `${transferId}:in:${line.lineId}`), itemKind: line.itemKind, itemId: line.itemId, itemName: line.itemName, quantity: received, type: "transfer_in", destinationLocationId: current.destinationLocationId, transferId, now, actor }));
        const variance = roundQuantity(Math.max(0, picked - received));
        if (variance > 0) createMovement(transaction, movement({ id: deterministicId("IM", `${transferId}:variance:${line.lineId}`), itemKind: line.itemKind, itemId: line.itemId, itemName: line.itemName, quantity: variance, type: "transfer_variance", transferId, reason: discrepancyNote, now, actor }));
        nextLines.push({ ...line, receivedQuantity: received, varianceQuantity: variance });
      }
      transfer = { ...current, lines: nextLines, status: "completed", hasDiscrepancy, discrepancyNote, receivedById: actor.uid, receivedByName: actor.name, receivedAt: now, completedAt: now, updatedAt: now };
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
      if (current.status === "cancelled") { transfer = current; return; }
      if (current.status !== "requested") throw new InventoryAuthorityError("invalid_transfer_state", "A transfer can only be cancelled before pickup.", { status: current.status });
      const records = await readStockRecords(transaction, current.lines);
      const recordsByLine = byLine(records);
      const now = new Date().toISOString();
      for (const line of current.lines) {
        const record = recordsByLine.get(line.lineId);
        const balances = { ...record.balances };
        const source = normalizeBalance(balances[current.sourceLocationId] || {});
        balances[current.sourceLocationId] = { ...source, reserved: roundQuantity(Math.max(0, source.reserved - quantityForKind(line.requestedQuantity, line.itemKind, { field: "requestedQuantity" }))) };
        writeStockRecord(transaction, record, balances, actor, now);
      }
      transfer = { ...current, status: "cancelled", cancelledAt: now, cancelledById: actor.uid, cancelledByName: actor.name, cancellationReason: cleanText(data.reason, 1000) || "Cancelled before pickup", updatedAt: now };
      transaction.set(transferRef, transfer, { merge: true });
    });
    return { success: true, version: INVENTORY_API_VERSION, transfer };
  }

  async function moveToolAsset(data, actor) {
    const stable = requestId(data.requestId);
    const assetId = requiredText(data.assetId, "assetId", "Tool asset id", 180);
    const destinationLocationId = requiredText(data.destinationLocationId, "destinationLocationId", "Destination location", 160);
    const destination = await assertLocation(destinationLocationId, await inventoryLocations(db), "destinationLocationId");
    const eventId = deterministicId("IM", `${stable}:tool:${assetId}`);
    let result;
    await db.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(movementRef(eventId));
      if (eventSnapshot.exists) { result = { replayed: true, movement: { id: eventSnapshot.id, ...eventSnapshot.data() } }; return; }
      const ref = db.collection("vanToolAssets").doc(assetId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new InventoryAuthorityError("item_not_found", "The tool asset no longer exists.", { assetId });
      const current = { id: snapshot.id, ...snapshot.data() };
      const sourceLocationId = normalizeToolLocation(current);
      const now = new Date().toISOString();
      const locationType = destination.type === "warehouse" ? "warehouse" : destination.type === "office" ? "office" : "van";
      const event = movement({ id: eventId, itemKind: "tool_asset", itemId: assetId, itemName: current.assetCode || assetId, quantity: sourceLocationId === destinationLocationId ? 0 : 1, type: "tool_transfer", sourceLocationId, destinationLocationId, reason: cleanText(data.reason, 800) || "Tool location transfer", now, actor });
      const history = Array.isArray(current.lifecycleHistory) ? current.lifecycleHistory : [];
      const next = {
        ...current, ...(destination.type === "van" ? { vanId: destination.id } : {}),
        locationType, locationId: destination.id, assigned: true, present: true,
        operationalStatus: destination.type === "warehouse" ? "En depósito" : destination.type === "office" ? "En oficina" : "Disponible",
        updatedAt: now,
        lifecycleHistory: sourceLocationId === destinationLocationId ? history : [...history, { id: deterministicId("TL", `${stable}:${assetId}`), action: "transferred", occurredAt: now, performedByUserId: actor.uid, performedByName: actor.name, fromLocationId: sourceLocationId, toLocationId: destination.id, reason: event.reason }],
      };
      transaction.set(ref, next, { merge: true });
      createMovement(transaction, event);
      result = { replayed: false, asset: next, movement: event };
    });
    return { success: true, version: INVENTORY_API_VERSION, ...result };
  }

  async function issueToWorkOrder(data, actor) {
    const stable = requestId(data.requestId);
    const itemKind = normalizeItemKind(data.itemKind);
    const itemId = requiredText(data.itemId, "itemId", "Item id", 180);
    const locationId = requiredText(data.locationId, "locationId", "Inventory location", 160);
    const workOrderId = requiredText(data.workOrderId, "workOrderId", "Work Order", 180);
    const quantity = quantityForKind(data.quantity, itemKind, { positive: true, field: "quantity" });
    await assertLocation(locationId, await inventoryLocations(db), "locationId");
    const eventId = deterministicId("IM", `${stable}:work-order-issue`);
    let result;
    await db.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(movementRef(eventId));
      if (eventSnapshot.exists) { result = { replayed: true, movement: { id: eventSnapshot.id, ...eventSnapshot.data() } }; return; }
      const workOrderSnapshot = await transaction.get(db.collection("workOrders").doc(workOrderId));
      if (!workOrderSnapshot.exists) throw new InventoryAuthorityError("work_order_not_found", "The selected Work Order does not exist.", { workOrderId });
      const [record] = await readStockRecords(transaction, [{ itemKind, itemId }]);
      const balances = { ...record.balances };
      const source = normalizeBalance(balances[locationId] || {});
      if (availableStock(source) < quantity) throw new InventoryAuthorityError("insufficient_stock", `${record.catalog.name} does not have enough available stock at the selected location.`, { available: availableStock(source), quantity });
      balances[locationId] = { ...source, onHand: roundQuantity(source.onHand - quantity) };
      const now = new Date().toISOString();
      writeStockRecord(transaction, record, balances, actor, now);
      const event = movement({ id: eventId, itemKind, itemId, itemName: record.catalog.name, quantity, type: "issue_to_work_order", sourceLocationId: locationId, workOrderId, reason: cleanText(data.reason, 800) || "Issued to Work Order", now, actor });
      createMovement(transaction, event);
      result = { replayed: false, movement: event };
    });
    return { success: true, version: INVENTORY_API_VERSION, ...result };
  }

  async function execute({ action, data = {}, actor }) {
    if (action === "get_snapshot") return getSnapshot();
    if (action === "set_stock_level") return setStockLevel(data, actor);
    if (action === "set_location_policy") return setLocationPolicy(data, actor);
    if (action === "update_location_inventory_state") return updateLocationInventoryState(data, actor);
    if (action === "allocate_legacy_product_stock") return allocateLegacyProductStock(data, actor);
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
      return { status: 200, body: await execute({ action: cleanText(request.body?.action, 120), data: request.body?.data || {}, actor }) };
    } catch (error) { return apiError(error); }
  }
  return { version: INVENTORY_API_VERSION, authenticate, execute, handle, getSnapshot, setStockLevel, setLocationPolicy, updateLocationInventoryState, allocateLegacyProductStock, createTransfer, pickupTransfer, receiveTransfer, cancelTransfer, moveToolAsset, issueToWorkOrder };
}

let defaultApi;
function getDefaultApi() {
  if (!defaultApi) defaultApi = createInventoryApi({ db: getFirestore(), verifyIdToken: (token) => getAuth().verifyIdToken(token) });
  return defaultApi;
}
exports.inventoryAuthority = onRequest({ region: "us-central1", memory: "256MiB", timeoutSeconds: 60 }, async (request, response) => {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  const result = await getDefaultApi().handle(request);
  if (result.status === 204) { response.status(204).send(""); return; }
  response.status(result.status).json(result.body);
});

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
module.exports.normalizedTransferLines = normalizedTransferLines;
module.exports.productBalanceMap = productBalanceMap;
