const { createCustomerAgentTools } = require("./demacCustomerAgentTools");
const {
  cleanText,
  hashId,
  normalizePhone,
  normalizeText,
  snapshotItems,
} = require("./bookingSchedulingPrimitives");

const CUSTOMER_BUSINESS_TOOLS_VERSION = 1;
const CUSTOMER_BUSINESS_TOOL_NAMES = Object.freeze({
  CREATE_OR_UPDATE_LEAD: "create_or_update_lead",
  GET_SERVICE_CATALOG: "get_service_catalog",
  GET_SERVICE_PRICE: "get_service_price",
});

const CUSTOMER_BUSINESS_TOOL_DEFINITIONS = Object.freeze([
  {
    type: "function",
    name: CUSTOMER_BUSINESS_TOOL_NAMES.CREATE_OR_UPDATE_LEAD,
    description: "Create or reuse a provisional CRM customer/property from stable conversation identity. Never merges an ambiguous existing customer.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["customerName", "contactPhone", "address", "preferredLanguage"],
      properties: {
        customerName: { type: "string" },
        contactPhone: { type: "string" },
        address: { type: "string" },
        preferredLanguage: { type: "string" },
      },
    },
  },
  {
    type: "function",
    name: CUSTOMER_BUSINESS_TOOL_NAMES.GET_SERVICE_CATALOG,
    description: "Read active ERP appointment presets and matching service IDs. Use this before availability so internal preset/service IDs are never guessed.",
    strict: true,
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    type: "function",
    name: CUSTOMER_BUSINESS_TOOL_NAMES.GET_SERVICE_PRICE,
    description: "Read configured ERP service pricing. Returns structured price rows by service kind and optional BTU; never formats or invents a customer price.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "btu"],
      properties: {
        kind: { type: "string", enum: ["standard_service", "deep_cleaning", "standard_installation"] },
        btu: { type: "integer", minimum: 0, maximum: 100000 },
      },
    },
  },
]);

function configuredPresetServiceId(preset, services) {
  const label = normalizeText(preset?.label);
  const id = normalizeText(preset?.id);
  const exact = services.find((service) => normalizeText(service.name) === label);
  if (exact) return exact.id;
  const scored = services.map((service) => {
    const text = normalizeText(`${service.name || ""} ${service.category || ""}`);
    let score = 0;
    if (preset?.kind === "installation" || /install/.test(id)) score = /instal/.test(text) ? 90 : 0;
    else if (/deep/.test(id)) score = /deep|profund/.test(text) ? 90 : 0;
    else if (/repair|diagnostic/.test(id)) score = /repair|repar|diagnost/.test(text) ? 90 : 0;
    else score = /servicio|service|mantenimiento/.test(text) ? 80 : 0;
    if (label && text.includes(label)) score += 20;
    return { service, score };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  return scored[0]?.service?.id || "";
}

function pricingRowsForKind(settings, kind) {
  if (kind === "deep_cleaning") return Array.isArray(settings?.deepCleaningSplit) ? settings.deepCleaningSplit : [];
  if (kind === "standard_installation") return Array.isArray(settings?.standardInstallationAdinaDemac) ? settings.standardInstallationAdinaDemac : [];
  return Array.isArray(settings?.standardServiceSplit) ? settings.standardServiceSplit : [];
}

function stableLeadIdentity(context = {}, phone = "") {
  const normalized = normalizePhone(phone || context.contactPhone);
  if (normalized) return `phone:${normalized}`;
  const technical = cleanText(context.contactJid || context.conversationId || context.conversationKey, 300);
  return technical ? `conversation:${technical}` : "";
}

function preferredLanguageValue(value) {
  const normalized = normalizeText(value);
  if (normalized === "en" || normalized.includes("english")) return "English";
  if (normalized.includes("pap")) return "Papiamento";
  return "Español";
}

function timestampValue() {
  try {
    const { FieldValue } = require("firebase-admin/firestore");
    return FieldValue.serverTimestamp();
  } catch {
    return new Date().toISOString();
  }
}

function createCustomerBusinessTools({ db, customerTools = null } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  const baseTools = customerTools || createCustomerAgentTools({ db });

  async function getServiceCatalog() {
    const [presetSnapshot, serviceSnapshot] = await Promise.all([
      db.collection("businessSettings").doc("appointment-work-presets").get(),
      db.collection("services").get(),
    ]);
    const services = snapshotItems(serviceSnapshot).filter((service) => service.active !== false);
    if (!presetSnapshot.exists) {
      return {
        success: false,
        configured: false,
        error: { code: "service_catalog_not_configured", message: "ERP appointment presets are not configured.", details: {} },
        services: services.map((service) => ({ id: service.id, name: cleanText(service.name, 180), category: cleanText(service.category, 120) })),
        presets: [],
      };
    }
    const settings = presetSnapshot.data() || {};
    const presets = (Array.isArray(settings.presets) ? settings.presets : [])
      .filter((preset) => preset.active !== false)
      .map((preset) => ({
        id: cleanText(preset.id, 120),
        label: cleanText(preset.label, 180),
        kind: cleanText(preset.kind, 80),
        durationMinutesPerUnit: Math.max(0, Number(preset.durationMinutesPerUnit || 0)),
        serviceId: configuredPresetServiceId(preset, services),
      }))
      .filter((preset) => preset.id);
    return {
      success: true,
      configured: true,
      version: Number(settings.version || 1),
      presets,
      services: services.map((service) => ({
        id: service.id,
        name: cleanText(service.name, 180),
        category: cleanText(service.category, 120),
        durationMinutes: Math.max(0, Number(service.durationMinutes || 0)),
      })),
    };
  }

  async function getServicePrice({ kind, btu = 0 } = {}) {
    const snapshot = await db.collection("businessSettings").doc("company-service-pricing-rules").get();
    if (!snapshot.exists) {
      return {
        success: false,
        configured: false,
        error: { code: "service_pricing_not_configured", message: "ERP service pricing is not configured.", details: {} },
        kind: cleanText(kind, 80),
        currency: "",
        rows: [],
      };
    }
    const settings = snapshot.data() || {};
    const rows = pricingRowsForKind(settings, kind).map((row) => ({
      btu: Number(row.btu || 0),
      price: Number(row.price),
      durationMinutes: Number(row.durationMinutes || 0),
      priceType: cleanText(row.priceType, 40),
    })).filter((row) => row.btu > 0 && Number.isFinite(row.price));
    const requestedBtu = Math.max(0, Number(btu || 0));
    const selected = requestedBtu ? rows.find((row) => row.btu === requestedBtu) || null : null;
    return {
      success: true,
      configured: true,
      kind: cleanText(kind, 80),
      currency: cleanText(settings.currency, 40) || "Afl.",
      requestedBtu,
      found: requestedBtu ? Boolean(selected) : rows.length > 0,
      price: selected,
      rows,
      scope: kind === "standard_installation"
        ? "Adina units purchased from DEMAC; standard installation"
        : "configured ERP service pricing",
    };
  }

  async function createOrUpdateLead(args = {}, context = {}) {
    const contactPhone = cleanText(args.contactPhone || context.contactPhone, 80);
    const existingCustomer = await baseTools.resolveCustomer({
      contactPhone,
      customerName: args.customerName,
      chatTitle: context.chatTitle || args.customerName,
    });
    if (existingCustomer.ambiguous) {
      return {
        success: false,
        error: { code: "ambiguous_customer", message: "More than one ERP customer matches this contact.", details: { candidates: existingCustomer.candidates } },
      };
    }

    const identity = stableLeadIdentity(context, contactPhone);
    if (!existingCustomer.resolved && !identity) {
      return {
        success: false,
        error: { code: "missing_stable_contact_identity", message: "A stable phone, JID, or conversation id is required before creating a lead.", details: {} },
      };
    }

    const nowIso = new Date().toISOString();
    const normalizedPhone = normalizePhone(contactPhone);
    const customerId = existingCustomer.customerId || `client-agent-${hashId(identity, 24)}`;
    const customerRef = db.collection("clients").doc(customerId);
    const customerSnapshot = await customerRef.get();
    const currentCustomer = customerSnapshot.exists ? customerSnapshot.data() || {} : {};
    const suppliedName = cleanText(args.customerName || context.chatTitle, 180);
    const customerData = {
      id: customerId,
      name: suppliedName || currentCustomer.name || "Cliente WhatsApp",
      active: true,
      source: currentCustomer.source || "DEMAC Customer Agent",
      preferredLanguage: cleanText(currentCustomer.preferredLanguage, 80) || preferredLanguageValue(args.preferredLanguage),
      provisional: currentCustomer.provisional !== false,
      contactVerificationRequired: currentCustomer.contactVerificationRequired === true || !normalizedPhone,
      updatedAt: timestampValue(),
      updatedAtIso: nowIso,
    };
    if (!customerSnapshot.exists) {
      customerData.createdAt = timestampValue();
      customerData.createdAtIso = nowIso;
    }
    if (normalizedPhone) {
      const displayPhone = normalizedPhone.startsWith("297") ? `+${normalizedPhone}` : normalizedPhone;
      customerData.phone = currentCustomer.phone || displayPhone;
      customerData.whatsapp = currentCustomer.whatsapp || displayPhone;
      customerData.phoneCountry = currentCustomer.phoneCountry || "AW";
      customerData.whatsappCountry = currentCustomer.whatsappCountry || "AW";
      customerData.contactVerificationRequired = false;
    }
    await customerRef.set(customerData, { merge: true });

    const address = cleanText(args.address, 500);
    if (!address) {
      return {
        success: true,
        customerId,
        propertyId: "",
        createdCustomer: !customerSnapshot.exists,
        createdProperty: false,
        needsProperty: true,
        provisional: true,
      };
    }

    const propertyResolution = await baseTools.resolveProperty({ customerId, address });
    if (propertyResolution.resolved) {
      return {
        success: true,
        customerId,
        propertyId: propertyResolution.propertyId,
        property: propertyResolution.property,
        createdCustomer: !customerSnapshot.exists,
        createdProperty: false,
        needsProperty: false,
        provisional: Boolean(customerData.provisional),
      };
    }
    if (propertyResolution.ambiguous) {
      return {
        success: false,
        error: { code: "ambiguous_property", message: "More than one property may match this address.", details: { candidates: propertyResolution.candidates } },
      };
    }

    const propertyId = `property-agent-${hashId(`${customerId}|${normalizeText(address)}`, 24)}`;
    const propertyRef = db.collection("properties").doc(propertyId);
    const propertySnapshot = await propertyRef.get();
    const propertyData = {
      id: propertyId,
      clientId: customerId,
      name: address,
      address,
      addressRaw: address,
      addressNormalized: normalizeText(address),
      active: true,
      source: "DEMAC Customer Agent",
      provisional: true,
      updatedAt: timestampValue(),
      updatedAtIso: nowIso,
    };
    if (!propertySnapshot.exists) {
      propertyData.createdAt = timestampValue();
      propertyData.createdAtIso = nowIso;
    }
    await propertyRef.set(propertyData, { merge: true });
    return {
      success: true,
      customerId,
      propertyId,
      property: { id: propertyId, clientId: customerId, address, similarity: 1 },
      createdCustomer: !customerSnapshot.exists,
      createdProperty: !propertySnapshot.exists,
      needsProperty: false,
      provisional: true,
    };
  }

  async function invoke(name, args = {}, context = {}) {
    try {
      switch (name) {
        case CUSTOMER_BUSINESS_TOOL_NAMES.CREATE_OR_UPDATE_LEAD:
          return await createOrUpdateLead(args, context);
        case CUSTOMER_BUSINESS_TOOL_NAMES.GET_SERVICE_CATALOG:
          return await getServiceCatalog();
        case CUSTOMER_BUSINESS_TOOL_NAMES.GET_SERVICE_PRICE:
          return await getServicePrice(args);
        default:
          return { success: false, error: { code: "unknown_tool", message: `Unknown customer-business tool: ${cleanText(name, 120)}`, details: {} } };
      }
    } catch (error) {
      return { success: false, error: { code: "internal_error", message: cleanText(error?.message || error, 500), details: {} } };
    }
  }

  return {
    version: CUSTOMER_BUSINESS_TOOLS_VERSION,
    definitions: CUSTOMER_BUSINESS_TOOL_DEFINITIONS,
    createOrUpdateLead,
    getServiceCatalog,
    getServicePrice,
    invoke,
  };
}

module.exports = {
  CUSTOMER_BUSINESS_TOOLS_VERSION,
  CUSTOMER_BUSINESS_TOOL_DEFINITIONS,
  CUSTOMER_BUSINESS_TOOL_NAMES,
  configuredPresetServiceId,
  createCustomerBusinessTools,
  preferredLanguageValue,
  pricingRowsForKind,
  stableLeadIdentity,
};
