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
const marketingImageAnalysis = require("./marketingImageAnalysis");
const scheduling = require("./whatsappCopilot");
const knowledge = require("./whatsappCopilotKnowledge");
const router = require("./whatsappCopilotRouter");

// Conversation V19–V22 modules remain in the repository as migration history/tests,
// but they are deliberately NOT loaded into production. V30 lets OpenAI interpret
// the conversation first and uses ERP code only as authoritative business tools.
module.exports = {
  ...core,
  ...wacliGateway,
  ...appointmentNotifications,
  ...userManagement,
  ...voiceTranscription,
  ...professionalReports,
  ...marketingImageAnalysis,
  ...scheduling,
  ...knowledge,
  whatsappCopilotDraft: router.whatsappCopilotDraft,
};