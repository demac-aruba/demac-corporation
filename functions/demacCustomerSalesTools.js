const {
  cleanText,
  normalizeText,
  snapshotItems,
} = require("./bookingSchedulingPrimitives");

const CUSTOMER_SALES_TOOLS_VERSION = 2;
const COMMERCIAL_PRODUCT_STOCK_COLLECTION = "commercialProductStock";
const CUSTOMER_SALES_TOOL_NAMES = Object.freeze({
  GET_PRODUCT_CATALOG: "get_product_catalog",
  GET_PRODUCT_STOCK: "get_product_stock",
});

const CUSTOMER_SALES_TOOL_DEFINITIONS = Object.freeze([
  {
    type: "function",
    name: CUSTOMER_SALES_TOOL_NAMES.GET_PRODUCT_CATALOG,
    description: "Read active sellable products and base prices from the ERP catalog. Product stock is stored separately and must be verified with get_product_stock before claiming physical availability.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Optional customer/product search text. Use an empty string to list the active product catalog." },
      },
    },
  },
  {
    type: "function",
    name: CUSTOMER_SALES_TOOL_NAMES.GET_PRODUCT_STOCK,
    description: "Verify current sellable physical stock for one exact ERP product ID. This is a read-only availability check and does not reserve, hold, or sell stock.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["productId"],
      properties: {
        productId: { type: "string", description: "Exact ERP product ID returned by get_product_catalog." },
      },
    },
  },
]);

function isSellableProduct(item = {}) {
  return item.active !== false && normalizeText(item.itemType) === "producto";
}

function productSearchText(item = {}) {
  return normalizeText([
    item.name,
    item.category,
    item.description,
    item.sku,
  ].filter(Boolean).join(" "));
}

function matchesProductQuery(item, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;
  const haystack = productSearchText(item);
  const compactHaystack = haystack.replace(/\s+/g, "");
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  return tokens.every((token) => haystack.includes(token) || compactHaystack.includes(token));
}

function customerProduct(item = {}) {
  const basePrice = Number(item.basePrice);
  return {
    id: cleanText(item.id, 160),
    name: cleanText(item.name, 220),
    category: cleanText(item.category, 160),
    sku: cleanText(item.sku, 120),
    description: cleanText(item.description, 1_000),
    basePrice: Number.isFinite(basePrice) && basePrice >= 0 ? basePrice : null,
    currency: "Afl.",
    stockTrackedByCatalog: false,
    stockVerificationRequired: true,
  };
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

function stockCounts(stock = {}) {
  const onHand = Number(stock.onHand);
  const reserved = Number(stock.reserved ?? 0);
  const valid = Number.isInteger(onHand)
    && Number.isInteger(reserved)
    && onHand >= 0
    && reserved >= 0
    && reserved <= onHand;
  return {
    valid,
    onHand: valid ? onHand : null,
    reserved: valid ? reserved : null,
    available: valid ? onHand - reserved : null,
  };
}

function createCustomerSalesTools({ db } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");

  async function getProductCatalog({ query = "" } = {}) {
    const snapshot = await db.collection("services").get();
    const allProducts = snapshotItems(snapshot)
      .filter(isSellableProduct)
      .sort((left, right) => cleanText(left.name, 220).localeCompare(cleanText(right.name, 220), "es", { sensitivity: "base" }));
    const products = allProducts.filter((item) => matchesProductQuery(item, query)).map(customerProduct);

    if (!allProducts.length) {
      return {
        success: false,
        configured: false,
        found: false,
        query: cleanText(query, 300),
        products: [],
        error: {
          code: "product_catalog_not_configured",
          message: "The ERP catalog has no active customer products configured.",
          details: {},
        },
      };
    }

    return {
      success: true,
      configured: true,
      found: products.length > 0,
      query: cleanText(query, 300),
      totalActiveProducts: allProducts.length,
      products: products.slice(0, 50),
      stockVerificationRequired: true,
      stockVerificationTool: CUSTOMER_SALES_TOOL_NAMES.GET_PRODUCT_STOCK,
      stockNote: "Physical commercial stock is stored separately from the product catalog. Use get_product_stock with the exact product ID before making any availability statement.",
    };
  }

  async function getProductStock({ productId = "" } = {}) {
    const id = cleanText(productId, 160);
    if (!id) {
      return {
        success: false,
        configured: false,
        stockVerified: false,
        error: {
          code: "product_id_required",
          message: "An exact ERP product ID is required to verify commercial stock.",
          details: {},
        },
      };
    }

    const [productSnapshot, stockSnapshot] = await Promise.all([
      db.collection("services").doc(id).get(),
      db.collection(COMMERCIAL_PRODUCT_STOCK_COLLECTION).doc(id).get(),
    ]);
    const product = productSnapshot.exists ? { id: productSnapshot.id, ...productSnapshot.data() } : null;

    if (!product || !isSellableProduct(product)) {
      return {
        success: false,
        configured: false,
        stockVerified: false,
        productId: id,
        error: {
          code: "product_not_sellable",
          message: "The requested ERP product does not exist as an active sellable product.",
          details: {},
        },
      };
    }

    if (!stockSnapshot.exists || stockSnapshot.data()?.active === false) {
      return {
        success: false,
        configured: false,
        stockVerified: false,
        product: customerProduct(product),
        productId: id,
        error: {
          code: "product_stock_not_configured",
          message: "Commercial stock is not configured for this ERP product.",
          details: {},
        },
      };
    }

    const stock = stockSnapshot.data() || {};
    const linkedProductId = cleanText(stock.productId, 160);
    const counts = stockCounts(stock);
    if ((linkedProductId && linkedProductId !== id) || !counts.valid) {
      return {
        success: false,
        configured: true,
        stockVerified: false,
        product: customerProduct(product),
        productId: id,
        error: {
          code: "product_stock_invalid",
          message: "Commercial stock data is inconsistent and cannot be used for a customer availability statement.",
          details: {},
        },
      };
    }

    const verifiedAt = timestampText(stock.verifiedAt);
    if (!verifiedAt) {
      return {
        success: false,
        configured: true,
        stockVerified: false,
        product: customerProduct(product),
        productId: id,
        onHand: counts.onHand,
        reserved: counts.reserved,
        error: {
          code: "product_stock_not_verified",
          message: "Commercial stock exists for this product but has no valid verification timestamp.",
          details: {},
        },
      };
    }

    return {
      success: true,
      configured: true,
      stockVerified: true,
      product: customerProduct(product),
      productId: id,
      onHand: counts.onHand,
      reserved: counts.reserved,
      available: counts.available,
      inStock: counts.available > 0,
      verifiedAt,
      reservationRequired: true,
      stockReservedForCustomer: false,
      stockNote: "This is current verified ERP availability only. No unit has been reserved or held for this customer by this read-only check.",
    };
  }

  async function invoke(name, args = {}) {
    try {
      switch (name) {
        case CUSTOMER_SALES_TOOL_NAMES.GET_PRODUCT_CATALOG:
          return await getProductCatalog(args);
        case CUSTOMER_SALES_TOOL_NAMES.GET_PRODUCT_STOCK:
          return await getProductStock(args);
        default:
          return {
            success: false,
            error: {
              code: "unknown_tool",
              message: `Unknown customer-sales tool: ${cleanText(name, 120)}`,
              details: {},
            },
          };
      }
    } catch (error) {
      return {
        success: false,
        error: {
          code: "internal_error",
          message: cleanText(error?.message || error, 500),
          details: {},
        },
      };
    }
  }

  return {
    version: CUSTOMER_SALES_TOOLS_VERSION,
    definitions: CUSTOMER_SALES_TOOL_DEFINITIONS,
    getProductCatalog,
    getProductStock,
    invoke,
  };
}

module.exports = {
  COMMERCIAL_PRODUCT_STOCK_COLLECTION,
  CUSTOMER_SALES_TOOLS_VERSION,
  CUSTOMER_SALES_TOOL_DEFINITIONS,
  CUSTOMER_SALES_TOOL_NAMES,
  createCustomerSalesTools,
  customerProduct,
  isSellableProduct,
  matchesProductQuery,
  productSearchText,
  stockCounts,
  timestampText,
};
