// Stable ERP business-rule patches load before the scheduling module so they remain authoritative.
require('./whatsappCopilotCorrections');
require('./whatsappCopilotPresentation');
require('./whatsappCopilotCompanyRules');
require('./whatsappCopilotServiceRules');

const core = require('./index');
const wacliGateway = require('./whatsappWacliGateway');
const wacliGatewayV2 = require('./whatsappWacliGatewayV2');
const wacliMediaSenderV2 = require('./whatsappWacliMediaSenderV2');
const wacliBackfill = require('./whatsappWacliBackfill');
const appointmentNotifications = require('./appointmentNotifications');
const userManagement = require('./userManagement');
const voiceTranscription = require('./voiceTranscription');
const professionalReports = require('./professionalReportGeneration');
const scheduling = require('./whatsappCopilot');
const knowledge = require('./whatsappCopilotKnowledge');
const router = require('./whatsappCopilotRouter');

// V1 remains authoritative for the already-proven text flow. V2 is exported
// under separate names so rich media/identity can be activated and rolled back
// without replacing the production-tested functions.
module.exports = {
  ...core,
  ...wacliGateway,
  ...appointmentNotifications,
  ...userManagement,
  ...voiceTranscription,
  ...professionalReports,
  ...scheduling,
  ...knowledge,
  whatsappCopilotDraft: router.whatsappCopilotDraft,
  wacliWebhookV2: wacliGatewayV2.wacliWebhook,
  wacliMediaUploadTicketV2: wacliGatewayV2.wacliMediaUploadTicket,
  sendQueuedWacliMediaMessageV2: wacliMediaSenderV2.sendQueuedWacliMediaMessageV2,
  wacliBackfillUpdateV2: wacliBackfill.wacliBackfillUpdate,
};
