const crypto = require("node:crypto");
const {
  INVENTORY_PRODUCT_STOCK_ERROR_CODES,
  PRODUCT_STOCK_OPERATIONS,
  applyLocationAwareProductStockMutation,
  deriveProductStock,
} = require("./inventoryProductStockAuthority");

const COMMERCIAL_SALES_AUTHORITY_VERSION = 2;
const COMMERCIAL_SALES_COLLECTIONS = Object.freeze({
  products: "services",
  stock: "commercialProductStock",
  reservations: "commercialProductReservations",
  idempotency: "commercialProductReservationIdempotency",
  customers: "clients",
  settings: "businessSettings",
  vans: "vans",
  movements: "inventoryMovements",
});
const RESERVATION_POLICY_ID = "commercial-sales-reservation-policy";
const RESERVATION_POLICY_MODE = "manual_release";

const COMMERCIAL_SALES_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "invalid_request",
  IDEMPOTENCY_CONFLICT: "idempotency_conflict",
  RESERVATION_POLICY_NOT_CONFIGURED: "reservation_policy_not_configured",
  PRODUCT_NOT_SELLABLE: "product_not_sellable",
  CUSTOMER_NOT_FOUND: "customer_not_found",
  PRODUCT_STOCK_NOT_CONFIGURED: "product_stock_not_configured",
  PRODUCT_STOCK_INVALID: "product_stock_invalid",
  PRODUCT_STOCK_LOCATION_BALANCES_REQUIRED: INVENTORY_PRODUCT_STOCK_ERROR_CODES.LOCATION_BALANCES_REQUIRED,
  PRODUCT_STOCK_NOT_VERIFIED: "product_stock_not_verified",
  INSUFFICIENT_STOCK: "insufficient_stock",
  INVALID_SOURCE_LOCATION: INVENTORY_PRODUCT_STOCK_ERROR_CODES.INVALID_SOURCE_LOCATION,
  STOCK_RESERVATION_MISMATCH: INVENTORY_PRODUCT_STOCK_ERROR_CODES.RESERVATION_MISMATCH,
  INVENTORY_MOVEMENT_CONFLICT: INVENTORY_PRODUCT_STOCK_ERROR_CODES.MOVEMENT_CONFLICT,
  RESERVATION_NOT_FOUND: "reservation_not_found",
  RESERVATION_NOT_ACTIVE: "reservation_not_active",
  SALE_ID_REQUIRED: "sale_id_required",
  SALE_COMMIT_CONFLICT: "sale_commit_conflict",
});

class CommercialSalesAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CommercialSalesAuthorityError";
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

function defaultServerTimestamp() {
  const { FieldValue } = require("firebase-admin/firestore");
  return FieldValue.serverTimestamp();
}

function asDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function timestampText(value) {
  if (!value) return "";
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  const text = cleanText(value, 120);
  const parsed = Date.parse(text);
  return text && Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function isSellableProduct(product = {}) {
  return product.active !== false && cleanText(product.itemType, 40).toLowerCase() === "producto";
}

function stockCounts(stock = {}) {
  try {
    const projection = deriveProductStock(stock);
    return { valid: true, onHand: projection.onHand, reserved: projection.reserved, available: projection.available };
  } catch {
    return { valid: false, onHand: null, reserved: null, available: null };
  }
}

function normalizeCreateRequest({ productId, customerId, sourceLocationId, quantity } = {}) {
  const request = {
    productId: cleanText(productId, 160),
    customerId: cleanText(customerId, 160),
    sourceLocationId: cleanText(sourceLocationId, 160),
    quantity: Number(quantity),
  };
  if (!request.productId) {
    throw new CommercialSalesAuthorityError(
      COMMERCIAL_SALES_ERROR_CODES.INVALID_REQUEST,
      "productId is required.",
      { field: "productId" },
    );
  }
  if (!request.customerId) {
    throw new CommercialSalesAuthorityError(
      COMMERCIAL_SALES_ERROR_CODES.INVALID_REQUEST,
      "customerId is required.",
      { field: "customerId" },
    );
  }
  if (!request.sourceLocationId) {
    throw new CommercialSalesAuthorityError(
      COMMERCIAL_SALES_ERROR_CODES.INVALID_REQUEST,
      "sourceLocationId is required.",
      { field: "sourceLocationId" },
    );
  }
  if (!Number.isSafeInteger(request.quantity) || request.quantity <= 0) {
    throw new CommercialSalesAuthorityError(
      COMMERCIAL_SALES_ERROR_CODES.INVALID_REQUEST,
      "quantity must be a positive integer.",
      { field: "quantity" },
    );
  }
  return request;
}

function requestFingerprint(request) {
  return hashKey(JSON.stringify(request), 40);
}

function reservationIdentity(idempotencyKey) {
  const key = cleanText(idempotencyKey, 500);
  if (!key) {
    throw new CommercialSalesAuthorityError(
      COMMERCIAL_SALES_ERROR_CODES.INVALID_REQUEST,
      "A stable idempotency key is required.",
      { field: "idempotencyKey" },
    );
  }
  const idempotencyKeyHash = hashKey(key, 40);
  return {
    idempotencyKeyHash,
    reservationId: `RSV-${hashKey(`reservation|${key}`, 24).toUpperCase()}`,
  };
}

function actorFields(actor = {}) {
  return {
    source: cleanText(actor.source, 80) || "commercial-sales-authority",
    actorId: cleanText(actor.id || actor.userId, 160),
    actorName: cleanText(actor.name || actor.displayName, 160),
  };
}

function productSnapshot(product = {}, id = "") {
  const basePrice = Number(product.basePrice);
  return {
    id: cleanText(id || product.id, 160),
    name: cleanText(product.name, 220),
    category: cleanText(product.category, 160),
    sku: cleanText(product.sku, 120),
    basePrice: Number.isFinite(basePrice) && basePrice >= 0 ? basePrice : null,
    currency: "Afl.",
  };
}

function assertPolicy(policySnapshot) {
  if (!policySnapshot.exists) {
    throw new CommercialSalesAuthorityError(
      COMMERCIAL_SALES_ERROR_CODES.RESERVATION_POLICY_NOT_CONFIGURED,
      "Commercial reservation policy is not configured in the ERP.",
    );
  }
  const policy = policySnapshot.data() || {};
  if (policy.active !== true || cleanText(policy.mode, 80) !== RESERVATION_POLICY_MODE) {
    throw new CommercialSalesAuthorityError(
      COMMERCIAL_SALES_ERROR_CODES.RESERVATION_POLICY_NOT_CONFIGURED,
      "Commercial reservation policy is inactive or unsupported.",
      { requiredMode: RESERVATION_POLICY_MODE },
    );
  }
  return policy;
}

function assertReservationInputs({ productSnapshot: productSnap, customerSnapshot, stockSnapshot, request }) {
  if (!productSnap.exists || !isSellableProduct(productSnap.data())) {
    throw new CommercialSalesAuthorityError(
      COMMERCIAL_SALES_ERROR_CODES.PRODUCT_NOT_SELLABLE,
      "The requested ERP product is not an active sellable product.",
      { productId: request.productId },
    );
  }
  if (!customerSnapshot.exists || customerSnapshot.data()?.active === false) {
    throw new CommercialSalesAuthorityError(
      COMMERCIAL_SALES_ERROR_CODES.CUSTOMER_NOT_FOUND,
      "The customer no longer exists as an active ERP customer.",
      { customerId: request.customerId },
    );
  }
  if (!stockSnapshot.exists || stockSnapshot.data()?.active === false) {
    throw new CommercialSalesAuthorityError(
      COMMERCIAL_SALES_ERROR_CODES.PRODUCT_STOCK_NOT_CONFIGURED,
      "Commercial stock is not configured for this product.",
      { productId: request.productId },
    );
  }
  const stock = stockSnapshot.data() || {};
  const linkedProductId = cleanText(stock.productId, 160);
  if (linkedProductId && linkedProductId !== request.productId) {
    throw new CommercialSalesAuthorityError(
      COMMERCIAL_SALES_ERROR_CODES.PRODUCT_STOCK_INVALID,
      "Commercial stock data is inconsistent and cannot be reserved.",
      { productId: request.productId },
    );
  }
  const verifiedAt = timestampText(stock.verifiedAt);
  if (!verifiedAt) {
    throw new CommercialSalesAuthorityError(
      COMMERCIAL_SALES_ERROR_CODES.PRODUCT_STOCK_NOT_VERIFIED,
      "Commercial stock has not been verified and cannot be reserved.",
      { productId: request.productId },
    );
  }
  return { verifiedAt };
}

function createCommercialSalesAuthority({
  db,
  clock = () => new Date(),
  serverTimestamp = defaultServerTimestamp,
  collections = COMMERCIAL_SALES_COLLECTIONS,
} = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db with transactions is required.");
  }

  async function getReservation(reservationId) {
    const id = cleanText(reservationId, 180);
    if (!id) {
      throw new CommercialSalesAuthorityError(
        COMMERCIAL_SALES_ERROR_CODES.INVALID_REQUEST,
        "reservationId is required.",
        { field: "reservationId" },
      );
    }
    const snapshot = await db.collection(collections.reservations).doc(id).get();
    if (!snapshot.exists) {
      throw new CommercialSalesAuthorityError(
        COMMERCIAL_SALES_ERROR_CODES.RESERVATION_NOT_FOUND,
        "The commercial reservation does not exist.",
        { reservationId: id },
      );
    }
    return { id: snapshot.id, ...snapshot.data() };
  }

  async function createReservation({
    productId,
    customerId,
    sourceLocationId,
    quantity,
    idempotencyKey,
    actor = {},
    context = {},
  } = {}) {
    const request = normalizeCreateRequest({ productId, customerId, sourceLocationId, quantity });
    const identity = reservationIdentity(idempotencyKey);
    const fingerprint = requestFingerprint(request);
    const now = asDate(clock());
    const reservationRef = db.collection(collections.reservations).doc(identity.reservationId);
    const idempotencyRef = db.collection(collections.idempotency).doc(identity.idempotencyKeyHash);

    const existingIdempotency = await idempotencyRef.get();
    if (existingIdempotency.exists) {
      const record = existingIdempotency.data() || {};
      if (record.requestFingerprint !== fingerprint || record.reservationId !== identity.reservationId) {
        throw new CommercialSalesAuthorityError(
          COMMERCIAL_SALES_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          "This idempotency key was already used for a different commercial reservation.",
          { reservationId: cleanText(record.reservationId, 180) },
        );
      }
      const replay = await getReservation(record.reservationId);
      return {
        success: true,
        replayed: true,
        reservationId: replay.reservationId || replay.id,
        reservation: replay,
      };
    }

    return db.runTransaction(async (transaction) => {
      const policyRef = db.collection(collections.settings).doc(RESERVATION_POLICY_ID);
      const productRef = db.collection(collections.products).doc(request.productId);
      const customerRef = db.collection(collections.customers).doc(request.customerId);
      const stockRef = db.collection(collections.stock).doc(request.productId);

      const [
        idempotencySnapshot,
        reservationSnapshot,
        policySnapshot,
        productSnap,
        customerSnapshot,
        stockSnapshot,
      ] = await Promise.all([
        transaction.get(idempotencyRef),
        transaction.get(reservationRef),
        transaction.get(policyRef),
        transaction.get(productRef),
        transaction.get(customerRef),
        transaction.get(stockRef),
      ]);

      if (idempotencySnapshot.exists) {
        const record = idempotencySnapshot.data() || {};
        if (record.requestFingerprint !== fingerprint || record.reservationId !== identity.reservationId) {
          throw new CommercialSalesAuthorityError(
            COMMERCIAL_SALES_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "This idempotency key was already used for a different commercial reservation.",
            { reservationId: cleanText(record.reservationId, 180) },
          );
        }
        if (!reservationSnapshot.exists) {
          throw new CommercialSalesAuthorityError(
            COMMERCIAL_SALES_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "The idempotency record exists without its canonical reservation.",
            { reservationId: identity.reservationId },
          );
        }
        const replay = { id: reservationSnapshot.id, ...reservationSnapshot.data() };
        return {
          success: true,
          replayed: true,
          reservationId: replay.reservationId || replay.id,
          reservation: replay,
        };
      }

      if (reservationSnapshot.exists) {
        const existing = { id: reservationSnapshot.id, ...reservationSnapshot.data() };
        if (existing.idempotencyKeyHash !== identity.idempotencyKeyHash || existing.requestFingerprint !== fingerprint) {
          throw new CommercialSalesAuthorityError(
            COMMERCIAL_SALES_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "The canonical reservation ID already exists with a different request.",
            { reservationId: identity.reservationId },
          );
        }
        return {
          success: true,
          replayed: true,
          reservationId: existing.reservationId || existing.id,
          reservation: existing,
        };
      }

      const policy = assertPolicy(policySnapshot);
      const { verifiedAt } = assertReservationInputs({
        productSnapshot: productSnap,
        customerSnapshot,
        stockSnapshot,
        request,
      });
      const actorInfo = actorFields(actor);
      const serverTime = serverTimestamp();
      const stockMutation = await applyLocationAwareProductStockMutation({
        db,
        transaction,
        stockRef,
        stockSnapshot,
        productId: request.productId,
        productName: productSnap.data()?.name,
        sourceLocationId: request.sourceLocationId,
        quantity: request.quantity,
        operation: PRODUCT_STOCK_OPERATIONS.RESERVE,
        reservationId: identity.reservationId,
        customerId: request.customerId,
        actor,
        reason: "Customer product reservation created",
        nowIso: now.toISOString(),
        serverTimestampValue: serverTime,
        collections,
      });
      const reservation = {
        id: identity.reservationId,
        reservationId: identity.reservationId,
        authorityVersion: COMMERCIAL_SALES_AUTHORITY_VERSION,
        version: 1,
        status: "active",
        policyMode: RESERVATION_POLICY_MODE,
        policyVersion: Number(policy.version || 1),
        customerId: request.customerId,
        productId: request.productId,
        sourceLocationId: request.sourceLocationId,
        sourceLocationName: stockMutation.sourceLocation.name,
        quantity: request.quantity,
        product: productSnapshot(productSnap.data(), productSnap.id),
        stockVerifiedAt: verifiedAt,
        requestFingerprint: fingerprint,
        idempotencyKeyHash: identity.idempotencyKeyHash,
        conversationId: cleanText(context.conversationId || context.conversationKey, 300),
        inboundMessageId: cleanText(context.inboundMessageId || context.messageId, 300),
        ...actorInfo,
        createdAtIso: now.toISOString(),
        updatedAtIso: now.toISOString(),
        inventoryMovementId: stockMutation.movement.id,
        createdAt: serverTime,
        updatedAt: serverTime,
      };
      transaction.set(reservationRef, reservation);
      transaction.set(idempotencyRef, {
        idempotencyKeyHash: identity.idempotencyKeyHash,
        reservationId: identity.reservationId,
        requestFingerprint: fingerprint,
        createdAtIso: now.toISOString(),
        sourceLocationId: request.sourceLocationId,
        createdAt: serverTime,
      });

      return {
        success: true,
        replayed: false,
        reservationId: identity.reservationId,
        reservation,
        stock: { ...stockMutation.stock, verifiedAt },
        movement: stockMutation.movement,
      };
    });
  }

  async function releaseReservation({
    reservationId,
    actor = {},
    reason = "",
  } = {}) {
    const id = cleanText(reservationId, 180);
    if (!id) {
      throw new CommercialSalesAuthorityError(
        COMMERCIAL_SALES_ERROR_CODES.INVALID_REQUEST,
        "reservationId is required.",
        { field: "reservationId" },
      );
    }
    const now = asDate(clock());
    return db.runTransaction(async (transaction) => {
      const reservationRef = db.collection(collections.reservations).doc(id);
      const reservationSnapshot = await transaction.get(reservationRef);
      if (!reservationSnapshot.exists) {
        throw new CommercialSalesAuthorityError(
          COMMERCIAL_SALES_ERROR_CODES.RESERVATION_NOT_FOUND,
          "The commercial reservation does not exist.",
          { reservationId: id },
        );
      }
      const reservation = { id: reservationSnapshot.id, ...reservationSnapshot.data() };
      if (reservation.status === "released") {
        return { success: true, replayed: true, reservationId: id, reservation };
      }
      if (reservation.status !== "active") {
        throw new CommercialSalesAuthorityError(
          COMMERCIAL_SALES_ERROR_CODES.RESERVATION_NOT_ACTIVE,
          "Only an active commercial reservation can be released.",
          { reservationId: id, status: cleanText(reservation.status, 80) },
        );
      }

      const stockRef = db.collection(collections.stock).doc(cleanText(reservation.productId, 160));
      const stockSnapshot = await transaction.get(stockRef);
      if (!stockSnapshot.exists) {
        throw new CommercialSalesAuthorityError(
          COMMERCIAL_SALES_ERROR_CODES.PRODUCT_STOCK_NOT_CONFIGURED,
          "Commercial stock no longer exists for the reserved product.",
          { productId: cleanText(reservation.productId, 160) },
        );
      }
      const quantity = Number(reservation.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new CommercialSalesAuthorityError(
          COMMERCIAL_SALES_ERROR_CODES.PRODUCT_STOCK_INVALID,
          "Commercial stock cannot safely release this reservation.",
          { reservationId: id },
        );
      }

      const actorInfo = actorFields(actor);
      const serverTime = serverTimestamp();
      const stockMutation = await applyLocationAwareProductStockMutation({
        db,
        transaction,
        stockRef,
        stockSnapshot,
        productId: reservation.productId,
        productName: reservation.product?.name,
        sourceLocationId: reservation.sourceLocationId,
        quantity,
        operation: PRODUCT_STOCK_OPERATIONS.RELEASE,
        reservationId: id,
        customerId: reservation.customerId,
        actor,
        reason: cleanText(reason, 500) || "Customer product reservation released",
        nowIso: now.toISOString(),
        serverTimestampValue: serverTime,
        collections,
      });
      transaction.set(reservationRef, {
        ...reservationSnapshot.data(),
        status: "released",
        releaseReason: cleanText(reason, 500),
        releasedAtIso: now.toISOString(),
        releasedAt: serverTime,
        releasedById: actorInfo.actorId,
        releasedByName: actorInfo.actorName,
        updatedAtIso: now.toISOString(),
        inventoryMovementId: stockMutation.movement.id,
        updatedAt: serverTime,
      });

      return {
        success: true,
        replayed: false,
        reservationId: id,
        reservation: {
          ...reservation,
          status: "released",
          releaseReason: cleanText(reason, 500),
          releasedAtIso: now.toISOString(),
          releasedById: actorInfo.actorId,
          releasedByName: actorInfo.actorName,
        },
        stock: stockMutation.stock,
        movement: stockMutation.movement,
      };
    });
  }

  async function commitReservation({
    reservationId,
    saleId,
    actor = {},
    reason = "",
  } = {}) {
    const id = cleanText(reservationId, 180);
    const canonicalSaleId = cleanText(saleId, 180);
    if (!id) {
      throw new CommercialSalesAuthorityError(
        COMMERCIAL_SALES_ERROR_CODES.INVALID_REQUEST,
        "reservationId is required.",
        { field: "reservationId" },
      );
    }
    if (!canonicalSaleId) {
      throw new CommercialSalesAuthorityError(
        COMMERCIAL_SALES_ERROR_CODES.SALE_ID_REQUIRED,
        "A stable canonical saleId is required to commit reserved stock.",
        { field: "saleId" },
      );
    }

    const now = asDate(clock());
    return db.runTransaction(async (transaction) => {
      const reservationRef = db.collection(collections.reservations).doc(id);
      const reservationSnapshot = await transaction.get(reservationRef);
      if (!reservationSnapshot.exists) {
        throw new CommercialSalesAuthorityError(
          COMMERCIAL_SALES_ERROR_CODES.RESERVATION_NOT_FOUND,
          "The commercial reservation does not exist.",
          { reservationId: id },
        );
      }

      const reservation = { id: reservationSnapshot.id, ...reservationSnapshot.data() };
      if (reservation.status === "committed") {
        if (cleanText(reservation.committedSaleId, 180) !== canonicalSaleId) {
          throw new CommercialSalesAuthorityError(
            COMMERCIAL_SALES_ERROR_CODES.SALE_COMMIT_CONFLICT,
            "This reservation was already committed to a different canonical sale.",
            { reservationId: id, committedSaleId: cleanText(reservation.committedSaleId, 180) },
          );
        }
        return { success: true, replayed: true, reservationId: id, reservation };
      }
      if (reservation.status !== "active") {
        throw new CommercialSalesAuthorityError(
          COMMERCIAL_SALES_ERROR_CODES.RESERVATION_NOT_ACTIVE,
          "Only an active commercial reservation can be committed to a sale.",
          { reservationId: id, status: cleanText(reservation.status, 80) },
        );
      }

      const productId = cleanText(reservation.productId, 160);
      const stockRef = db.collection(collections.stock).doc(productId);
      const stockSnapshot = await transaction.get(stockRef);
      if (!stockSnapshot.exists) {
        throw new CommercialSalesAuthorityError(
          COMMERCIAL_SALES_ERROR_CODES.PRODUCT_STOCK_NOT_CONFIGURED,
          "Commercial stock no longer exists for the reserved product.",
          { productId },
        );
      }
      const quantity = Number(reservation.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new CommercialSalesAuthorityError(
          COMMERCIAL_SALES_ERROR_CODES.PRODUCT_STOCK_INVALID,
          "Commercial stock cannot safely commit this reservation.",
          { reservationId: id },
        );
      }

      const actorInfo = actorFields(actor);
      const serverTime = serverTimestamp();
      const stockMutation = await applyLocationAwareProductStockMutation({
        db,
        transaction,
        stockRef,
        stockSnapshot,
        productId,
        productName: reservation.product?.name,
        sourceLocationId: reservation.sourceLocationId,
        quantity,
        operation: PRODUCT_STOCK_OPERATIONS.COMMIT,
        reservationId: id,
        customerId: reservation.customerId,
        saleId: canonicalSaleId,
        actor,
        reason: cleanText(reason, 500) || "Reserved product committed to canonical sale",
        nowIso: now.toISOString(),
        serverTimestampValue: serverTime,
        collections,
      });
      transaction.set(reservationRef, {
        ...reservationSnapshot.data(),
        status: "committed",
        committedSaleId: canonicalSaleId,
        committedAtIso: now.toISOString(),
        committedAt: serverTime,
        committedById: actorInfo.actorId,
        committedByName: actorInfo.actorName,
        updatedAtIso: now.toISOString(),
        inventoryMovementId: stockMutation.movement.id,
        updatedAt: serverTime,
      });

      return {
        success: true,
        replayed: false,
        reservationId: id,
        reservation: {
          ...reservation,
          status: "committed",
          committedSaleId: canonicalSaleId,
          committedAtIso: now.toISOString(),
          committedById: actorInfo.actorId,
          committedByName: actorInfo.actorName,
        },
        stock: stockMutation.stock,
        movement: stockMutation.movement,
      };
    });
  }

  return {
    version: COMMERCIAL_SALES_AUTHORITY_VERSION,
    commitReservation,
    createReservation,
    getReservation,
    releaseReservation,
  };
}

module.exports = {
  COMMERCIAL_SALES_AUTHORITY_VERSION,
  COMMERCIAL_SALES_COLLECTIONS,
  COMMERCIAL_SALES_ERROR_CODES,
  RESERVATION_POLICY_ID,
  RESERVATION_POLICY_MODE,
  CommercialSalesAuthorityError,
  createCommercialSalesAuthority,
  isSellableProduct,
  normalizeCreateRequest,
  requestFingerprint,
  reservationIdentity,
  stockCounts,
  timestampText,
};
