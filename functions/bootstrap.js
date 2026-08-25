const core = require("./index");
const officeBookingAuthorityFacade = require("./officeBookingAuthorityFacade");
const communicationConversationAuthority = require("./communicationConversationAuthority");
const wacliGateway = require("./whatsappWacliGateway");
const wacliOutboundMediaUpload = require("./wacliOutboundMediaUpload");
const customerAgentCommunication = require("./demacCustomerAgentAllowlistCommunication");
const appointmentNotifications = require("./appointmentNotifications");
const technicianDailySchedules = require("./technicianDailySchedules");
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
// loaded or deployed from bootstrap. Maya's production communication entry
// points are gated by the server-side phone allowlist wrapper.
//
// Human conversation ownership/sending commands converge through the backend
// Communication Conversation Authority. This keeps ownershipVersion and final
// sender authority out of browser-only writes as V1.1 is adopted.
//
// officeBookingAuthorityFacade deliberately overrides the core export with the
// same public function name. Booking/lifecycle actions still delegate to the
// canonical Office Booking Authority; only appointment communication actions
// are projected per recipient by the dedicated communication authority.
module.exports = {
  ...core,
  ...officeBookingAuthorityFacade,
  ...communicationConversationAuthority,
  ...wacliGateway,
  ...wacliOutboundMediaUpload,
  ...customerAgentCommunication,
  ...appointmentNotifications,
  ...technicianDailySchedules,
  ...userManagement,
  ...voiceTranscription,
  ...professionalReports,
  ...marketingImageAnalysisCallable,
  ...marketingCampaignStrategy,
  ...marketingCreativeBuilder,
  ...marketingCreativeRead,
  whatsappCopilotDraft: router.whatsappCopilotDraft,
};