require("./whatsappCopilotCorrections");
require("./whatsappCopilotPresentation");
require("./whatsappCopilotCompanyRules");

module.exports = {
  ...require("./index"),
  ...require("./appointmentNotifications"),
  ...require("./userManagement"),
  ...require("./voiceTranscription"),
  ...require("./professionalReportGeneration"),
  ...require("./whatsappCopilot"),
  ...require("./whatsappCopilotKnowledge"),
  ...require("./whatsappCopilotRouter"),
};