const { createBookingAuthority } = require("./bookingAuthorityFirestore");
const { createSchedulingProvider } = require("./bookingAuthoritySchedulingProvider");
const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
} = require("./bookingAuthorityCore");
const {
  addressSimilarity,
  cleanText,
  normalizePhone,
  normalizeText,
  snapshotItems,
} = require("./bookingSchedulingPrimitives");

const CUSTOMER_AGENT_TOOLS_VERSION = 1;

const CUSTOMER_AGENT_TOOL_NAMES = Object.freeze({
  RESOLVE_CUSTOMER: "resolve_customer",
  RESOLVE_PROPERTY: "resolve_property",
  CHECK_AVAILABILITY: "check_availability",
  CREATE_APPOINTMENT: "create_appointment",
  GET_APPOINTMENT: "get_appointment",
});

const CUSTOMER_AGENT_TOOL_DEFINITIONS = Object.freeze([
  {
    type: "function",
    name: CUSTOMER_AGENT_TOOL_NAMES.RESOLVE_CUSTOMER,
    description: "Resolve an existing ERP customer from stable WhatsApp/contact identity or a customer name. Returns structured candidates; never invents a customer.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["contactPhone", "customerName", "chatTitle"],
      properties: {
        contactPhone: { type: "string" },
        customerName: { type: "string" },
        chatTitle: { type: "string" },
      },
    },
  },
  {
    type: "function",
    name: CUSTOMER_AGENT_TOOL_NAMES.RESOLVE_PROPERTY,
    description: "Resolve one property belonging to a known ERP customer. Returns ambiguity instead of guessing when multiple properties fit.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["customerId", "address"],
      properties: {
        customerId: { type: "string" },
        address: { type: "string" },
      },
    },
  },
  {
    type: "function",
    name: CUSTOMER_AGENT_TOOL_NAMES.CHECK_AVAILABILITY,
    description: "Ask DEMAC Booking Authority for real ERP availability for one customer/property/work request. Returns a canonical offer and options, never customer-facing prose.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["customerId", "propertyId", "presetId", "serviceId", "quantity", "requestedDate", "requestedTime", "timePreference"],
      properties: {
        customerId: { type: "string" },
        propertyId: { type: "string" },
        presetId: { type: "string" },
        serviceId: { type: "string" },
        quantity: { type: "integer", minimum: 1, maximum: 40 },
        requestedDate: { type: "string" },
        requestedTime: { type: "string" },
        timePreference: { type: "string" },
      },
    },
  },
  {
    type: "function",
    name: CUSTOMER_AGENT_TOOL_NAMES.CREATE_APPOINTMENT,
    description: "Create exactly one appointment from a canonical Booking Authority offer. Confirmation is allowed only when this returns success=true with a real appointmentId.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["offerId", "offerVersion", "optionId"],
      properties: {
        offerId: { type: "string" },
        offerVersion: { type: "integer", minimum: 1 },
        optionId: { type: "string" },
      },
    },
  },
  {
    type: "function",
    name: CUSTOMER_AGENT_TOOL_NAMES.GET_APPOINTMENT,
    description: "Read one canonical ERP appointment by appointmentId.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["appointmentId"],
      properties: {
        appointmentId: { type: "string" },
      },
    },
  },
]);

function compactCustomer(client) {
  return {
    id: cleanText(client?.id, 160),
    name: cleanText(client?.name, 180),
    company: cleanText(client?.company, 180),
    phone: cleanText(client?.phone, 80),
    whatsapp: cleanText(client?.whatsapp, 80),
    preferredLanguage: cleanText(client?.preferredLanguage, 80),
  };
}

function compactProperty(property, similarity = null) {
  return {
    id: cleanText(property?.id, 160),
    clientId: cleanText(property?.clientId, 160),
    name: cleanText(property?.name, 180),
    address: cleanText(property?.address || property?.addressRaw, 500),
    operationalZone: cleanText(property?.operationalZone || property?.zone, 120),
    similarity: similarity === null ? null : Number(similarity.toFixed(3)),
  };
}

function customerPhones(client) {
  return [client?.phone, client?.whatsapp]
    .map(normalizePhone)
    .filter(Boolean);
}

function nameMatchScore(query, client) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery || normalizedQuery.length < 3) return 0;
  const normalizedName = normalizeText(client?.name);
  const normalizedCompany = normalizeText(client?.company);
  if (normalizedName === normalizedQuery || normalizedCompany === normalizedQuery) return 1;
  if (normalizedName && (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName))) return 0.82;
  if (normalizedCompany && (normalizedCompany.includes(normalizedQuery) || normalizedQuery.includes(normalizedCompany))) return 0.78;
  return 0;
}

function stableContextValue(value, maxLength = 240) {
  return cleanText(value, maxLength);
}

function derivedBookingIdempotencyKey(context = {}, args = {}) {
  const provider = stableContextValue(context.provider || context.channel || "whatsapp", 80) || "whatsapp";
  const conversation = stableContextValue(
    context.conversationId || context.conversationKey || context.contactJid || context.contactPhone,
    240,
  );
  const inboundMessageId = stableContextValue(context.inboundMessageId || context.messageId, 300);
  if (!conversation || !inboundMessageId) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_IDEMPOTENCY_KEY,
      "A stable conversation id and inbound message id are required to create an appointment.",
      { conversationPresent: Boolean(conversation), inboundMessageIdPresent: Boolean(inboundMessageId) },
    );
  }
  return [
    provider,
    conversation,
    inboundMessageId,
    "create_appointment",
    stableContextValue(args.offerId, 180),
    stableContextValue(args.optionId, 180),
  ].join(":");
}

function toolError(error) {
  if (error instanceof BookingAuthorityError) {
    return {
      success: false,
      error: {
        code: error.code,
        message: cleanText(error.message, 500),
        details: error.details || {},
      },
    };
  }
  return {
    success: false,
    error: {
      code: "internal_error",
      message: cleanText(error?.message || error, 500) || "Unexpected tool error.",
      details: {},
    },
  };
}

function createCustomerAgentTools({ db, bookingAuthority = null, schedulingProvider = null } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  const provider = schedulingProvider || createSchedulingProvider({ db });
  const authority = bookingAuthority || createBookingAuthority({ db, availabilityProvider: provider });

  async function resolveCustomer({ contactPhone = "", customerName = "", chatTitle = "" } = {}) {
    const snapshot = await db.collection("clients").get();
    const clients = snapshotItems(snapshot).filter((client) => client.active !== false);
    const phone = normalizePhone(contactPhone);
    if (phone) {
      const matches = clients.filter((client) => customerPhones(client).some((candidate) =>
        candidate === phone
        || (candidate.length >= 7 && phone.length >= 7 && candidate.slice(-7) === phone.slice(-7)),
      ));
      if (matches.length === 1) {
        return { success: true, resolved: true, matchType: "phone", customerId: matches[0].id, customer: compactCustomer(matches[0]), candidates: [] };
      }
      if (matches.length > 1) {
        return { success: true, resolved: false, ambiguous: true, matchType: "phone", customerId: "", customer: null, candidates: matches.slice(0, 5).map(compactCustomer) };
      }
    }

    const query = cleanText(customerName || chatTitle, 180);
    if (query) {
      const scored = clients
        .map((client) => ({ client, score: nameMatchScore(query, client) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || String(a.client.id).localeCompare(String(b.client.id)));
      if (scored.length === 1 || (scored[0]?.score >= 0.95 && scored[0].score - (scored[1]?.score || 0) >= 0.15)) {
        return { success: true, resolved: true, matchType: "name", customerId: scored[0].client.id, customer: compactCustomer(scored[0].client), candidates: [] };
      }
      if (scored.length > 1) {
        return { success: true, resolved: false, ambiguous: true, matchType: "name", customerId: "", customer: null, candidates: scored.slice(0, 5).map((entry) => compactCustomer(entry.client)) };
      }
    }

    return { success: true, resolved: false, ambiguous: false, matchType: "none", customerId: "", customer: null, candidates: [] };
  }

  async function resolveProperty({ customerId, address = "" } = {}) {
    const id = cleanText(customerId, 160);
    if (!id) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "customerId is required.", { field: "customerId" });
    }
    const snapshot = await db.collection("properties").where("clientId", "==", id).get();
    const properties = snapshotItems(snapshot).filter((property) => property.active !== false);
    if (!properties.length) {
      return { success: true, resolved: false, ambiguous: false, propertyId: "", property: null, candidates: [], needsNewProperty: true };
    }

    const normalizedAddress = cleanText(address, 500);
    if (!normalizedAddress) {
      if (properties.length === 1) {
        return { success: true, resolved: true, matchType: "single-property", propertyId: properties[0].id, property: compactProperty(properties[0], 1), candidates: [], needsNewProperty: false };
      }
      return { success: true, resolved: false, ambiguous: true, matchType: "missing-address", propertyId: "", property: null, candidates: properties.slice(0, 8).map((item) => compactProperty(item)), needsNewProperty: false };
    }

    const ranked = properties
      .map((property) => ({
        property,
        similarity: addressSimilarity(normalizedAddress, property.addressNormalized || property.addressRaw || property.address),
      }))
      .sort((a, b) => b.similarity - a.similarity || String(a.property.id).localeCompare(String(b.property.id)));
    const best = ranked[0];
    const second = ranked[1];
    const uniqueStrong = best && best.similarity >= 0.82;
    const uniqueModerate = best && best.similarity >= 0.58 && best.similarity - (second?.similarity || 0) >= 0.18;
    if (uniqueStrong || uniqueModerate) {
      return { success: true, resolved: true, matchType: "address", propertyId: best.property.id, property: compactProperty(best.property, best.similarity), candidates: [], needsNewProperty: false };
    }
    if (best && best.similarity >= 0.45) {
      return {
        success: true,
        resolved: false,
        ambiguous: true,
        matchType: "address",
        propertyId: "",
        property: null,
        candidates: ranked.slice(0, 5).map((entry) => compactProperty(entry.property, entry.similarity)),
        needsNewProperty: false,
      };
    }
    return {
      success: true,
      resolved: false,
      ambiguous: false,
      matchType: "address",
      propertyId: "",
      property: null,
      candidates: properties.slice(0, 5).map((item) => compactProperty(item)),
      needsNewProperty: true,
    };
  }

  async function checkAvailability(args = {}, context = {}) {
    return authority.checkAvailability({
      request: {
        customerId: args.customerId,
        propertyId: args.propertyId,
        workLines: [{
          id: "work-1",
          presetId: args.presetId,
          serviceId: args.serviceId,
          quantity: args.quantity,
        }],
        constraints: {
          requestedDate: args.requestedDate,
          requestedTime: args.requestedTime,
          preferredTime: args.timePreference,
        },
      },
      actor: context.actor || { source: "demac-customer-agent" },
      context: {
        ...context,
        requestKey: context.requestKey || context.inboundMessageId || context.messageId || "",
      },
    });
  }

  async function createAppointment(args = {}, context = {}) {
    const result = await authority.createAppointment({
      offerId: args.offerId,
      offerVersion: args.offerVersion,
      optionId: args.optionId,
      idempotencyKey: derivedBookingIdempotencyKey(context, args),
      actor: context.actor || { source: "demac-customer-agent" },
      context,
    });
    if (!result?.success || !cleanText(result.appointmentId, 180)) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
        "Booking Authority returned without a canonical appointmentId.",
      );
    }
    return result;
  }

  async function getAppointment({ appointmentId } = {}) {
    const appointment = await authority.getAppointment(appointmentId);
    return { success: true, appointmentId: appointment.appointmentId || appointment.id, appointment };
  }

  async function invoke(name, args = {}, context = {}) {
    try {
      switch (name) {
        case CUSTOMER_AGENT_TOOL_NAMES.RESOLVE_CUSTOMER:
          return await resolveCustomer(args);
        case CUSTOMER_AGENT_TOOL_NAMES.RESOLVE_PROPERTY:
          return await resolveProperty(args);
        case CUSTOMER_AGENT_TOOL_NAMES.CHECK_AVAILABILITY:
          return await checkAvailability(args, context);
        case CUSTOMER_AGENT_TOOL_NAMES.CREATE_APPOINTMENT:
          return await createAppointment(args, context);
        case CUSTOMER_AGENT_TOOL_NAMES.GET_APPOINTMENT:
          return await getAppointment(args);
        default:
          return { success: false, error: { code: "unknown_tool", message: `Unknown customer-agent tool: ${cleanText(name, 120)}`, details: {} } };
      }
    } catch (error) {
      return toolError(error);
    }
  }

  return {
    version: CUSTOMER_AGENT_TOOLS_VERSION,
    definitions: CUSTOMER_AGENT_TOOL_DEFINITIONS,
    authority,
    resolveCustomer,
    resolveProperty,
    checkAvailability,
    createAppointment,
    getAppointment,
    invoke,
  };
}

module.exports = {
  CUSTOMER_AGENT_TOOLS_VERSION,
  CUSTOMER_AGENT_TOOL_DEFINITIONS,
  CUSTOMER_AGENT_TOOL_NAMES,
  compactCustomer,
  compactProperty,
  createCustomerAgentTools,
  customerPhones,
  derivedBookingIdempotencyKey,
  nameMatchScore,
  toolError,
};