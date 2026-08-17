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
const router = require("./whatsappCopilotRouter");

// Production customer conversations have one runtime: Customer Runtime V1.
// WhatsApp transport is exported separately through the wacli gateway and the
// canonical Communication Center bridge. Historical Copilot modules are not
// loaded or deployed from bootstrap.
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
  whatsappCopilotDraft: router.whatsappCopilotDraft,
};
