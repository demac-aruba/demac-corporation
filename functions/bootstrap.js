// Stable ERP business-rule patches load before the scheduling module so they remain authoritative.
require("./whatsappCopilotCorrections");
require("./whatsappCopilotPresentation");
require("./whatsappCopilotCompanyRules");
require("./whatsappCopilotServiceRules");

const core = require("./index");
const wacliGateway = require("./whatsappWacliGateway");
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

// Conversation V19–V22 modules remain in the repository as migration history/tests,
// but they are deliberately NOT loaded into production. V30 lets OpenAI interpret
// the conversation first and uses ERP code only as authoritative business tools.
// Marketing V1B+ is exposed only through authenticated callable functions. The
// legacy Firestore/Eventarc handler remains an internal reusable engine dependency
// of marketingImageAnalysisCallable and is intentionally not exported for deploy.
module.exports = {
  ...core,
  ...wacliGateway,
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
