const core = require("./index");
const officeBookingAuthorityFacade = require("./officeBookingAuthorityFacade");
const fieldOperationsAuthority = require("./fieldOperationsAuthority");
const workOrderApplicationService = require("./workOrderApplicationService");
const wacliGateway = require("./whatsappWacliGateway");
const wacliOutboundMediaUpload = require("./wacliOutboundMediaUpload");
const customerAgentCommunication = require("./demacCustomerAgentAllowlistCommunication");
const appointmentNotifications = require("./appointmentNotifications");
const taskAssignmentNotifications = require("./taskAssignmentNotifications");
const taskReminders = require("./taskReminders");
const taskTrackerApi = require("./taskTrackerApi");
const taskTrackerAttachments = require("./taskTrackerAttachments");
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
// officeBookingAuthorityFacade deliberately overrides the core export with the
// same public function name. Booking/lifecycle actions still delegate to the
// canonical Office Booking Authority; only appointment communication actions
// are projected per recipient by the dedicated communication authority.
//
// Task Tracker is an independent Operations boundary. Its authenticated API and
// private evidence transport are the mutation boundaries. Creation notifications
// and reminder workers enqueue only into the existing WhatsApp outbound authority.
// None of these surfaces import, mutate, or derive work from Scheduling & Dispatch.
// Only the deployable API handler is exported here; test helpers remain module-internal.
module.exports = {
  ...core,
  ...officeBookingAuthorityFacade,
  ...fieldOperationsAuthority,
  ...workOrderApplicationService,
  ...wacliGateway,
  ...wacliOutboundMediaUpload,
  ...customerAgentCommunication,
  ...appointmentNotifications,
  ...taskAssignmentNotifications,
  ...taskReminders,
  taskTrackerApi: taskTrackerApi.taskTrackerApi,
  ...taskTrackerAttachments,
  ...technicianDailySchedules,
  ...userManagement,
  ...require("./careers"),
  ...voiceTranscription,
  ...professionalReports,
  ...marketingImageAnalysisCallable,
  ...marketingCampaignStrategy,
  ...marketingCreativeBuilder,
  ...marketingCreativeRead,
  whatsappCopilotDraft: router.whatsappCopilotDraft,
};
