const {
  cleanText,
  normalizeText,
  snapshotItems,
} = require("./bookingSchedulingPrimitives");

const CUSTOMER_SALES_TOOLS_VERSION = 1;
const CUSTOMER_SALES_TOOL_NAMES = Object.freeze({
  GET_PRODUCT_CATALOG: "get_product_catalog",
});

const CUSTOMER_SALES_TOOL_DEFINITIONS = Object.freeze([
  {
    type: "function",
    name: CUSTOMER_SALES_TOOL_NAMES.GET_PRODUCT_CATALOG,
    description: "Read active sellable products and base prices from the ERP catalog. Product stock is not tracked by this catalog, so never claim that physical stock is available from this tool.",
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
    stockTracked: false,
    stockVerified: false,
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
        stockSourceConfigured: false,
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
      stockSourceConfigured: false,
      stockVerificationRequired: true,
      stockNote: "The current ERP product catalog stores sellable product facts and base prices, but it has no linked commercial stock quantity. Do not promise stock availability without human/ERP verification.",
    };
  }

  async function invoke(name, args = {}) {
    try {
      switch (name) {
        case CUSTOMER_SALES_TOOL_NAMES.GET_PRODUCT_CATALOG:
          return await getProductCatalog(args);
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
    invoke,
  };
}

module.exports = {
  CUSTOMER_SALES_TOOLS_VERSION,
  CUSTOMER_SALES_TOOL_DEFINITIONS,
  CUSTOMER_SALES_TOOL_NAMES,
  createCustomerSalesTools,
  customerProduct,
  isSellableProduct,
  matchesProductQuery,
  productSearchText,
};
