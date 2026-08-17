const { cleanText } = require("./bookingSchedulingPrimitives");

const CUSTOMER_POLICY_TOOLS_VERSION = 1;
const CUSTOMER_POLICY_SETTINGS_ID = "company-customer-policies";
const CUSTOMER_POLICY_TOPICS = Object.freeze([
  "warranty",
  "payments",
  "cancellation_reschedule",
  "maintenance",
  "service_area",
  "emergency",
]);

const CUSTOMER_POLICY_TOOL_NAMES = Object.freeze({
  GET_COMPANY_POLICY: "get_company_policy",
});

const CUSTOMER_POLICY_TOOL_DEFINITIONS = Object.freeze([
  {
    type: "function",
    name: CUSTOMER_POLICY_TOOL_NAMES.GET_COMPANY_POLICY,
    description: "Read an approved customer-facing DEMAC company policy from ERP businessSettings. Choose the topic semantically from the conversation. Never infer a policy from keywords, memory, or defaults when this tool says it is not configured.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["topic"],
      properties: {
        topic: {
          type: "string",
          enum: CUSTOMER_POLICY_TOPICS,
          description: "Canonical policy topic selected from the customer's meaning, not by phrase matching.",
        },
      },
    },
  },
]);

function normalizedPolicyEntry(value = {}) {
  return {
    active: value.active !== false,
    textEs: cleanText(value.textEs, 4_000),
    textEn: cleanText(value.textEn, 4_000),
    textPapAw: cleanText(value.textPapAw, 4_000),
    requiresHumanForExceptions: value.requiresHumanForExceptions !== false,
  };
}

function policyHasApprovedText(policy = {}) {
  return Boolean(policy.textEs || policy.textEn || policy.textPapAw);
}

function createCustomerPolicyTools({ db } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");

  async function getCompanyPolicy({ topic } = {}) {
    const canonicalTopic = cleanText(topic, 80);
    if (!CUSTOMER_POLICY_TOPICS.includes(canonicalTopic)) {
      return {
        success: false,
        configured: false,
        found: false,
        topic: canonicalTopic,
        requiresHuman: true,
        error: {
          code: "unsupported_policy_topic",
          message: "The requested company policy topic is not supported.",
          details: { supportedTopics: CUSTOMER_POLICY_TOPICS },
        },
      };
    }

    const snapshot = await db.collection("businessSettings").doc(CUSTOMER_POLICY_SETTINGS_ID).get();
    if (!snapshot.exists) {
      return {
        success: false,
        configured: false,
        found: false,
        topic: canonicalTopic,
        requiresHuman: true,
        error: {
          code: "company_policies_not_configured",
          message: "Customer company policies are not configured in ERP businessSettings.",
          details: { settingId: CUSTOMER_POLICY_SETTINGS_ID },
        },
      };
    }

    const settings = snapshot.data() || {};
    const rawPolicy = settings.policies && typeof settings.policies === "object"
      ? settings.policies[canonicalTopic]
      : null;
    const policy = normalizedPolicyEntry(rawPolicy || {});
    if (!rawPolicy || !policy.active || !policyHasApprovedText(policy)) {
      return {
        success: false,
        configured: true,
        found: false,
        version: Number(settings.version || 1),
        topic: canonicalTopic,
        requiresHuman: true,
        error: {
          code: "company_policy_not_configured",
          message: "This customer policy is missing, inactive, or has no approved text in the ERP.",
          details: { topic: canonicalTopic },
        },
      };
    }

    return {
      success: true,
      configured: true,
      found: true,
      version: Number(settings.version || 1),
      topic: canonicalTopic,
      policy,
      requiresHumanForExceptions: policy.requiresHumanForExceptions,
      source: `businessSettings/${CUSTOMER_POLICY_SETTINGS_ID}`,
    };
  }

  async function invoke(name, args = {}) {
    try {
      if (name === CUSTOMER_POLICY_TOOL_NAMES.GET_COMPANY_POLICY) return await getCompanyPolicy(args);
      return {
        success: false,
        error: {
          code: "unknown_tool",
          message: `Unknown customer-policy tool: ${cleanText(name, 120)}`,
          details: {},
        },
      };
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
    version: CUSTOMER_POLICY_TOOLS_VERSION,
    definitions: CUSTOMER_POLICY_TOOL_DEFINITIONS,
    getCompanyPolicy,
    invoke,
  };
}

module.exports = {
  CUSTOMER_POLICY_SETTINGS_ID,
  CUSTOMER_POLICY_TOPICS,
  CUSTOMER_POLICY_TOOLS_VERSION,
  CUSTOMER_POLICY_TOOL_DEFINITIONS,
  CUSTOMER_POLICY_TOOL_NAMES,
  createCustomerPolicyTools,
  normalizedPolicyEntry,
  policyHasApprovedText,
};
