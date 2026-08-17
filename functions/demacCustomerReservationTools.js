const {
  cleanText,
} = require("./bookingSchedulingPrimitives");
const {
  createCommercialSalesAuthority,
} = require("./commercialSalesAuthority");

const CUSTOMER_RESERVATION_TOOLS_VERSION = 1;
const CUSTOMER_RESERVATION_TOOL_NAMES = Object.freeze({
  CREATE_PRODUCT_RESERVATION: "create_product_reservation",
  GET_PRODUCT_RESERVATION: "get_product_reservation",
  RELEASE_PRODUCT_RESERVATION: "release_product_reservation",
});

const CUSTOMER_RESERVATION_TOOL_DEFINITIONS = Object.freeze([
  {
    type: "function",
    name: CUSTOMER_RESERVATION_TOOL_NAMES.CREATE_PRODUCT_RESERVATION,
    description: "Create one real ERP commercial product reservation after the customer has clearly chosen a product and quantity. The Commercial Sales Authority revalidates customer, policy, product and verified stock transactionally before reserving anything.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["productId", "customerId", "quantity"],
      properties: {
        productId: { type: "string", description: "Exact ERP product ID returned by get_product_catalog." },
        customerId: { type: "string", description: "Exact resolved ERP customer ID." },
        quantity: { type: "integer", minimum: 1, description: "Positive whole number of units the customer explicitly wants reserved." },
      },
    },
  },
  {
    type: "function",
    name: CUSTOMER_RESERVATION_TOOL_NAMES.GET_PRODUCT_RESERVATION,
    description: "Read one exact ERP commercial product reservation by reservation ID before making a statement about its current status.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["reservationId"],
      properties: {
        reservationId: { type: "string", description: "Exact ERP reservation ID previously returned by the Commercial Sales Authority." },
      },
    },
  },
  {
    type: "function",
    name: CUSTOMER_RESERVATION_TOOL_NAMES.RELEASE_PRODUCT_RESERVATION,
    description: "Release one active ERP commercial product reservation when the customer explicitly cancels or asks DEMAC to stop holding the product. The authority returns the stock transactionally.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["reservationId", "reason"],
      properties: {
        reservationId: { type: "string", description: "Exact ERP reservation ID to release." },
        reason: { type: "string", description: "Concise factual reason based on the customer's request." },
      },
    },
  },
]);

function stableReservationIdempotencyKey(context = {}) {
  const provider = cleanText(context.provider || context.channel || "whatsapp", 80) || "whatsapp";
  const conversationId = cleanText(
    context.conversationId || context.conversationKey || context.contactJid || context.contactPhone,
    300,
  );
  const inboundMessageId = cleanText(context.inboundMessageId || context.messageId, 300);
  if (!conversationId || !inboundMessageId) return "";
  return `customer-agent|${provider}|${conversationId}|${inboundMessageId}|create-product-reservation`;
}

function authorityFailure(error) {
  return {
    success: false,
    error: {
      code: cleanText(error?.code || "commercial_sales_authority_error", 120),
      message: cleanText(error?.message || error, 500),
      details: error?.details && typeof error.details === "object" ? error.details : {},
    },
  };
}

function createCustomerReservationTools({ db, reservationAuthority = null } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  let authority = reservationAuthority;

  function getAuthority() {
    if (!authority) authority = createCommercialSalesAuthority({ db });
    return authority;
  }

  async function createProductReservation({ productId = "", customerId = "", quantity = 0 } = {}, context = {}) {
    const idempotencyKey = stableReservationIdempotencyKey(context);
    if (!idempotencyKey) {
      return {
        success: false,
        error: {
          code: "stable_reservation_identity_required",
          message: "A stable conversation and inbound message identity are required before creating a product reservation.",
          details: {},
        },
      };
    }
    try {
      return await getAuthority().createReservation({
        productId: cleanText(productId, 160),
        customerId: cleanText(customerId, 160),
        quantity: Number(quantity),
        idempotencyKey,
        actor: context.actor || {},
        context,
      });
    } catch (error) {
      return authorityFailure(error);
    }
  }

  async function getProductReservation({ reservationId = "" } = {}) {
    try {
      const reservation = await getAuthority().getReservation(cleanText(reservationId, 180));
      const id = cleanText(reservation?.reservationId || reservation?.id, 180);
      return {
        success: true,
        reservationId: id,
        status: cleanText(reservation?.status, 80),
        reservation,
      };
    } catch (error) {
      return authorityFailure(error);
    }
  }

  async function releaseProductReservation({ reservationId = "", reason = "" } = {}, context = {}) {
    try {
      return await getAuthority().releaseReservation({
        reservationId: cleanText(reservationId, 180),
        reason: cleanText(reason, 500),
        actor: context.actor || {},
      });
    } catch (error) {
      return authorityFailure(error);
    }
  }

  async function invoke(name, args = {}, context = {}) {
    switch (name) {
      case CUSTOMER_RESERVATION_TOOL_NAMES.CREATE_PRODUCT_RESERVATION:
        return createProductReservation(args, context);
      case CUSTOMER_RESERVATION_TOOL_NAMES.GET_PRODUCT_RESERVATION:
        return getProductReservation(args, context);
      case CUSTOMER_RESERVATION_TOOL_NAMES.RELEASE_PRODUCT_RESERVATION:
        return releaseProductReservation(args, context);
      default:
        return {
          success: false,
          error: {
            code: "unknown_tool",
            message: `Unknown customer-reservation tool: ${cleanText(name, 120)}`,
            details: {},
          },
        };
    }
  }

  return {
    version: CUSTOMER_RESERVATION_TOOLS_VERSION,
    definitions: CUSTOMER_RESERVATION_TOOL_DEFINITIONS,
    createProductReservation,
    getProductReservation,
    releaseProductReservation,
    invoke,
  };
}

module.exports = {
  CUSTOMER_RESERVATION_TOOLS_VERSION,
  CUSTOMER_RESERVATION_TOOL_DEFINITIONS,
  CUSTOMER_RESERVATION_TOOL_NAMES,
  authorityFailure,
  createCustomerReservationTools,
  stableReservationIdempotencyKey,
};
