const core = require("./index");
const officeBookingAuthorityFacade = require("./officeBookingAuthorityFacade");
const communicationConversationAuthority = require("./communicationConversationAuthority");
const wacliGateway = require("./whatsappWacliGateway");
const wacliOutboundMediaUpload = require("./wacliOutboundMediaUpload");
const communicationIngressMetadata = require("./demacCommunicationIngressMetadata");
const customerAgentCommunication = require("./demacCustomerAgentAllowlistCommunication");
const customerTurnOrchestrator = require("./demacCustomerTurnOrchestrator");
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

// Production customer conversations have one customer-facing runtime: Customer
// Runtime V1. Maya Observer is a service stage inside the deferred customer-turn
// orchestrator, not an independently triggered agent or sender authority.
//
// Inbound/voice/reactivation triggers only schedule persistent queue truth. The
// task handler wakes the latest eligible turn, runs Observer/Case first, then
// Reply Policy and the same Customer Runtime. The task payload is never business
// truth and duplicate wake-ups remain governed by queue/epoch/lease idempotency.
//
// Trusted communication ingress metadata is stamped once on canonical message
// creation. Customer voice uses the same shared DEMAC transcription service and
// converges into this same deferred current-turn path only after transcription.
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
  ...communicationIngressMetadata,
  ...customerAgentCommunication,
  processCustomerAgentTurnWakeup: customerTurnOrchestrator.processCustomerAgentTurnWakeup,
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
