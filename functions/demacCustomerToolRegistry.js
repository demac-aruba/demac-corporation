const {
  CUSTOMER_AGENT_TOOL_DEFINITIONS,
  CUSTOMER_AGENT_TOOL_NAMES,
  createCustomerAgentTools,
} = require("./demacCustomerAgentTools");
const {
  CUSTOMER_BUSINESS_TOOL_DEFINITIONS,
  CUSTOMER_BUSINESS_TOOL_NAMES,
  createCustomerBusinessTools,
} = require("./demacCustomerBusinessTools");
const {
  CUSTOMER_SALES_TOOL_DEFINITIONS,
  CUSTOMER_SALES_TOOL_NAMES,
  createCustomerSalesTools,
} = require("./demacCustomerSalesTools");
const {
  CUSTOMER_POLICY_TOOL_DEFINITIONS,
  CUSTOMER_POLICY_TOOL_NAMES,
  createCustomerPolicyTools,
} = require("./demacCustomerPolicyTools");

const CUSTOMER_TOOL_REGISTRY_VERSION = 3;
const TOOL_ORDER = Object.freeze([
  CUSTOMER_AGENT_TOOL_NAMES.RESOLVE_CUSTOMER,
  CUSTOMER_AGENT_TOOL_NAMES.RESOLVE_PROPERTY,
  CUSTOMER_BUSINESS_TOOL_NAMES.CREATE_OR_UPDATE_LEAD,
  CUSTOMER_BUSINESS_TOOL_NAMES.GET_SERVICE_CATALOG,
  CUSTOMER_BUSINESS_TOOL_NAMES.GET_SERVICE_PRICE,
  CUSTOMER_SALES_TOOL_NAMES.GET_PRODUCT_CATALOG,
  CUSTOMER_POLICY_TOOL_NAMES.GET_COMPANY_POLICY,
  CUSTOMER_AGENT_TOOL_NAMES.CHECK_AVAILABILITY,
  CUSTOMER_AGENT_TOOL_NAMES.CREATE_APPOINTMENT,
  CUSTOMER_AGENT_TOOL_NAMES.GET_APPOINTMENT,
]);

function createDemacCustomerToolRegistry({
  db,
  customerTools = null,
  businessTools = null,
  salesTools = null,
  policyTools = null,
} = {}) {
  const base = customerTools || createCustomerAgentTools({ db });
  const business = businessTools || createCustomerBusinessTools({ db, customerTools: base });
  const sales = salesTools || createCustomerSalesTools({ db });
  const policies = policyTools || createCustomerPolicyTools({ db });
  const definitionsByName = new Map(
    [
      ...CUSTOMER_AGENT_TOOL_DEFINITIONS,
      ...CUSTOMER_BUSINESS_TOOL_DEFINITIONS,
      ...CUSTOMER_SALES_TOOL_DEFINITIONS,
      ...CUSTOMER_POLICY_TOOL_DEFINITIONS,
    ].map((definition) => [definition.name, definition]),
  );
  const definitions = TOOL_ORDER.map((name) => definitionsByName.get(name)).filter(Boolean);
  const baseNames = new Set(CUSTOMER_AGENT_TOOL_DEFINITIONS.map((item) => item.name));
  const businessNames = new Set(CUSTOMER_BUSINESS_TOOL_DEFINITIONS.map((item) => item.name));
  const salesNames = new Set(CUSTOMER_SALES_TOOL_DEFINITIONS.map((item) => item.name));
  const policyNames = new Set(CUSTOMER_POLICY_TOOL_DEFINITIONS.map((item) => item.name));

  async function invoke(name, args = {}, context = {}) {
    if (baseNames.has(name)) return base.invoke(name, args, context);
    if (businessNames.has(name)) return business.invoke(name, args, context);
    if (salesNames.has(name)) return sales.invoke(name, args, context);
    if (policyNames.has(name)) return policies.invoke(name, args, context);
    return {
      success: false,
      error: {
        code: "unknown_tool",
        message: `Unknown DEMAC customer tool: ${String(name || "")}`,
        details: {},
      },
    };
  }

  return {
    version: CUSTOMER_TOOL_REGISTRY_VERSION,
    definitions,
    invoke,
    customerTools: base,
    businessTools: business,
    salesTools: sales,
    policyTools: policies,
  };
}

module.exports = {
  CUSTOMER_TOOL_REGISTRY_VERSION,
  TOOL_ORDER,
  createDemacCustomerToolRegistry,
};
