const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { cleanText } = require("./bookingAuthorityCore");
const { createOfficeBookingApi, OFFICE_BOOKING_API_VERSION } = require("./officeBookingAuthority");
const {
  communicationError,
  createAppointmentCommunicationAuthority,
} = require("./appointmentCommunicationAuthority");
const {
  VAN_SCHEDULE_ACTIONS,
  createVanScheduleCommunicationAuthority,
} = require("./vanScheduleCommunicationAuthority");
const { createAfterHoursAuthority } = require("./bookingAfterHours");

const COMMUNICATION_ACTIONS = new Set([
  "get_appointment_communication",
  "update_appointment_communication",
  "send_appointment_communication",
]);
const AFTER_HOURS_ACTIONS = new Set([
  "create_after_hours_emergency",
]);

function officeActor(identity = {}) {
  return {
    source: "office-scheduling",
    id: cleanText(identity.uid, 160),
    name: cleanText(identity.name || identity.email, 160),
  };
}

function createOfficeBookingAuthorityFacade({ db, verifyIdToken } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  if (typeof verifyIdToken !== "function") throw new Error("verifyIdToken is required.");
  const baseApi = createOfficeBookingApi({ db, verifyIdToken });
  const communication = createAppointmentCommunicationAuthority({ db, apiVersion: OFFICE_BOOKING_API_VERSION });
  const vanSchedules = createVanScheduleCommunicationAuthority({ db, apiVersion: OFFICE_BOOKING_API_VERSION });
  const afterHours = createAfterHoursAuthority({ db });

  async function handle(request) {
    if (request.method === "OPTIONS") return { status: 204, body: null };
    if (request.method !== "POST") return { status: 405, body: { success: false, error: { code: "method_not_allowed", message: "POST is required.", details: {} } } };
    const action = cleanText(request.body?.action, 120);
    const data = request.body?.data || {};
    const legacyGlobalReminderUpdate = action === "update_appointment_communication" && !cleanText(data.recipientId, 180);
    const specialized = COMMUNICATION_ACTIONS.has(action) || VAN_SCHEDULE_ACTIONS.has(action) || AFTER_HOURS_ACTIONS.has(action);
    if (!specialized || legacyGlobalReminderUpdate) return baseApi.handle(request);
    try {
      const identity = await baseApi.authenticate(request);
      let result;
      if (VAN_SCHEDULE_ACTIONS.has(action)) {
        result = await vanSchedules.execute({ action, data, identity });
      } else if (AFTER_HOURS_ACTIONS.has(action)) {
        result = await afterHours.createEmergency({
          requestId: data.requestId,
          customerId: data.customerId,
          propertyId: data.propertyId,
          workLines: data.workLines,
          presetId: data.presetId,
          serviceId: data.serviceId,
          quantity: data.quantity,
          requestedDate: data.requestedDate,
          requestedTime: data.requestedTime,
          requiredVanId: data.requiredVanId,
          customerFacingDescription: data.customerFacingDescription,
          technicianInstructions: data.technicianInstructions,
          recipientSelections: data.recipientSelections,
          actor: officeActor(identity),
        });
      } else {
        result = await communication.execute({ action, data, identity });
      }
      return { status: 200, body: result };
    } catch (error) {
      return communicationError(error);
    }
  }

  return {
    afterHours,
    baseApi,
    communication,
    vanSchedules,
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

module.exports.AFTER_HOURS_ACTIONS = AFTER_HOURS_ACTIONS;
module.exports.COMMUNICATION_ACTIONS = COMMUNICATION_ACTIONS;
module.exports.createOfficeBookingAuthorityFacade = createOfficeBookingAuthorityFacade;
