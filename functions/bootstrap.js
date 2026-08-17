// Stable ERP business-rule patches remain loaded only for historical endpoints that
// still depend on them. The canonical Customer Agent + Booking Authority path does not.
require("./whatsappCopilotCorrections");
require("./whatsappCopilotPresentation");
require("./whatsappCopilotCompanyRules");
require("./whatsappCopilotServiceRules");

const core = require("./index");
const wacliGateway = require("./whatsappWacliGateway");
const customerAgentCommunication = require("./demacCustomerAgentCommunication");
const appointmentNotifications = require("./appointmentNotifications");
const userManagement = require("./userManagement");
const voiceTranscription = require("./voiceTranscription");
const professionalReports = require("./professionalReportGeneration");
const marketingImageAnalysisCallable = require("./marketingImageAnalysisCallable");
const marketingCampaignStrategy = require("./marketingCampaignStrategyAruba");
const marketingCreativeBuilder = require("./marketingCreativeBuilderV2Compat");
const marketingCreativeRead = require("./marketingCreativeRead");
const scheduling = require("./whatsappCopilot");
const knowledge = require("./whatsappCopilotKnowledge");
const router = require("./whatsappCopilotRouter");

// The public customer endpoint is owned by Customer Runtime V1. Historical
// WhatsApp modules remain temporarily exported only for non-agent legacy
// functions until the final dead-code cleanup removes those endpoints.
// Marketing functions are kept entirely separate from the customer agent.
module.exports = {
  ...core,
  ...wacliGateway,
  ...customerAgentCommunication,
  ...appointmentNotifications,
  ...userManagement,
  ...voiceTranscription,
  ...professionalReports,
  ...marketingImageAnalysisCallable,
  ...marketingCampaignStrategy,
  ...marketingCreativeBuilder,
  ...marketingCreativeRead,
  ...scheduling,
  ...knowledge,
  whatsappCopilotDraft: router.whatsappCopilotDraft,
};
