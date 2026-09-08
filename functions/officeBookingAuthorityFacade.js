const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { cleanText } = require("./bookingAuthorityCore");
const { createOfficeBookingApi, OFFICE_BOOKING_API_VERSION, OFFICE_BOOKING_ROLES } = require("./officeBookingAuthority");
const {
  communicationError,
  createAppointmentCommunicationAuthority,
} = require("./appointmentCommunicationAuthority");
const {
  VAN_SCHEDULE_ACTIONS,
  createVanScheduleCommunicationAuthority,
} = require("./vanScheduleCommunicationAuthority");
const { createMayaOperationsReadModel } = require("./mayaOperationsReadModel");
const { createMayaRecoveryMatching } = require("./mayaRecoveryMatching");

const COMMUNICATION_ACTIONS = new Set([
  "get_appointment_communication",
  "update_appointment_communication",
  "send_appointment_communication",
]);
const MAYA_READ_ACTIONS = new Set(["list_maya_cancellations", "list_maya_waitlist", "inspect_maya_recovery_candidates"]);
const RECOVERY_ERROR_MESSAGES = Object.freeze({
  unauthenticated: [401, "A valid Firebase session is required."],
  permission_denied: [403, "An active authorized office profile is required to inspect waiting candidates."],
  invalid_request: [400, "Select a valid cancellation reference and a page size between one and ten. Slot and routing overrides are not accepted."],
  invalid_cursor: [409, "The active-account waiting list changed. Check again from the start."],
  not_cancelled: [409, "The selected record is not an actual cancelled appointment. Refresh the cancellation list."],
  invalid_cancellation: [409, "The cancellation's recorded date, interval or capacity references need review."],
  target_elapsed: [409, "The cancelled appointment's former start time has already passed."],
  configuration_missing: [409, "Verify the active WhatsApp communication account before inspecting candidates."],
});

function recoveryInspectionError(error) {
  const known = Object.prototype.hasOwnProperty.call(RECOVERY_ERROR_MESSAGES, error?.code)
    ? RECOVERY_ERROR_MESSAGES[error.code] : null;
  // Never expose raw provider/Firestore errors, identifiers, stack traces or
  // index configuration links through this cross-customer read endpoint.
  return {
    status: known ? known[0] : 500,
    body: { success: false, error: {
      code: known ? error.code : "internal_error",
      message: known ? known[1] : "Candidate compatibility could not be checked. No appointment or message was changed.",
      details: {},
    } },
  };
}

function createOfficeBookingAuthorityFacade({ db, verifyIdToken } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  if (typeof verifyIdToken !== "function") throw new Error("verifyIdToken is required.");
  const baseApi = createOfficeBookingApi({ db, verifyIdToken });
  const communication = createAppointmentCommunicationAuthority({ db, apiVersion: OFFICE_BOOKING_API_VERSION });
  const vanSchedules = createVanScheduleCommunicationAuthority({ db, apiVersion: OFFICE_BOOKING_API_VERSION });
  const mayaOperations = createMayaOperationsReadModel({ db });

  async function handle(request) {
    if (request.method === "OPTIONS") return { status: 204, body: null };
    if (request.method !== "POST") return { status: 405, body: { success: false, error: { code: "method_not_allowed", message: "POST is required.", details: {} } } };
    const action = cleanText(request.body?.action, 120);
    const data = request.body?.data || {};
    const legacyGlobalReminderUpdate = action === "update_appointment_communication" && !cleanText(data.recipientId, 180);
    if ((!COMMUNICATION_ACTIONS.has(action) && !VAN_SCHEDULE_ACTIONS.has(action) && !MAYA_READ_ACTIONS.has(action)) || legacyGlobalReminderUpdate) return baseApi.handle(request);
    try {
      const identity = await baseApi.authenticate(request);
      if (action === "inspect_maya_recovery_candidates") {
        // New cross-customer inspection must not inherit the older token-role
        // fallback when the canonical user profile is absent or not active.
        const profileSnapshot = await db.collection("users").doc(identity.uid).get();
        const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
        if (profile.active !== true || !OFFICE_BOOKING_ROLES.includes(cleanText(profile.role, 80).toLowerCase())) {
          throw Object.assign(new Error("An active canonical office profile is required."), { code: "permission_denied" });
        }
        return { status: 200, body: await createMayaRecoveryMatching({ db }).inspect(data) };
      }
      if (MAYA_READ_ACTIONS.has(action)) {
        const result = action === "list_maya_cancellations"
          ? await mayaOperations.listCancellations(data)
          : await mayaOperations.listWaitlist(data);
        return { status: 200, body: result };
      }
      const result = VAN_SCHEDULE_ACTIONS.has(action)
        ? await vanSchedules.execute({ action, data, identity })
        : await communication.execute({ action, data, identity });
      return { status: 200, body: result };
    } catch (error) {
      return action === "inspect_maya_recovery_candidates" ? recoveryInspectionError(error) : communicationError(error);
    }
  }

  return {
    baseApi,
    communication,
    vanSchedules,
    mayaOperations,
    handle,
    version: OFFICE_BOOKING_API_VERSION,
  };
}

let defaultFacade;
function getDefaultFacade() {
  if (!defaultFacade) {
    defaultFacade = createOfficeBookingAuthorityFacade({
      db: getFirestore(),
      verifyIdToken: (token) => getAuth().verifyIdToken(token),
    });
  }
  return defaultFacade;
}

exports.officeBookingAuthority = onRequest(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 60 },
  async (request, response) => {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    const result = await getDefaultFacade().handle(request);
    if (result.status === 204) {
      response.status(204).send("");
      return;
    }
    response.status(result.status).json(result.body);
  },
);

module.exports.COMMUNICATION_ACTIONS = COMMUNICATION_ACTIONS;
module.exports.MAYA_READ_ACTIONS = MAYA_READ_ACTIONS;
module.exports.recoveryInspectionError = recoveryInspectionError;
module.exports.createOfficeBookingAuthorityFacade = createOfficeBookingAuthorityFacade;
