require("./whatsappCopilotCorrections");
require("./whatsappCopilotPresentation");
require("./whatsappCopilotCompanyRules");
require("./whatsappCopilotServiceRules");
require("./whatsappCopilotFlowV19");
require("./whatsappCopilotSchedulingRuntimeV19");

const core = require("./index");
const appointmentNotifications = require("./appointmentNotifications");
const userManagement = require("./userManagement");
const voiceTranscription = require("./voiceTranscription");
const professionalReports = require("./professionalReportGeneration");
const scheduling = require("./whatsappCopilot");
const knowledge = require("./whatsappCopilotKnowledge");
const router = require("./whatsappCopilotRouter");

// Export the public Copilot endpoint explicitly so no earlier spread can shadow
// the V18 conversation orchestrator with the lower-level scheduling handler.
module.exports = {
  ...core,
  ...appointmentNotifications,
  ...userManagement,
  ...voiceTranscription,
  ...professionalReports,
  ...scheduling,
  ...knowledge,
  whatsappCopilotDraft: router.whatsappCopilotDraft,
};