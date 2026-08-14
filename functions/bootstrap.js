// Stable ERP business-rule patches load before the scheduling module so they remain authoritative.
require('./whatsappCopilotCorrections');
require('./whatsappCopilotPresentation');
require('./whatsappCopilotCompanyRules');
require('./whatsappCopilotServiceRules');

const core = require('./index');
const wacliGateway = require('./whatsappWacliGateway');
const wacliGatewayV2 = require('./whatsappWacliGatewayV2');
const appointmentNotifications = require('./appointmentNotifications');
const userManagement = require('./userManagement');
const voiceTranscription = require('./voiceTranscription');
const professionalReports = require('./professionalReportGeneration');
const scheduling = require('./whatsappCopilot');
const knowledge = require('./whatsappCopilotKnowledge');
const router = require('./whatsappCopilotRouter');

// V2 intentionally spreads after the original wacli gateway. It preserves the
// deployed function names while replacing their implementations with the rich
// identity/media-aware handlers. appendCommunicationInternalNote remains from V1.
module.exports = {
  ...core,
  ...wacliGateway,
  ...wacliGatewayV2,
  ...appointmentNotifications,
  ...userManagement,
  ...voiceTranscription,
  ...professionalReports,
  ...scheduling,
  ...knowledge,
  whatsappCopilotDraft: router.whatsappCopilotDraft,
};
