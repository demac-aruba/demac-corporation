const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { cleanText } = require("./bookingAuthorityCore");
const { createOfficeBookingApi, OFFICE_BOOKING_API_VERSION } = require("./officeBookingAuthority");
const {
  communicationError,
  createAppointmentCommunicationAuthority,
} = require("./appointmentCommunicationAuthority");

const COMMUNICATION_ACTIONS = new Set([
  "get_appointment_communication",
  "update_appointment_communication",
  "send_appointment_communication",
]);

function createOfficeBookingAuthorityFacade({ db, verifyIdToken } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  if (typeof verifyIdToken !== "function") throw new Error("verifyIdToken is required.");
  const baseApi = createOfficeBookingApi({ db, verifyIdToken });
  const communication = createAppointmentCommunicationAuthority({ db, apiVersion: OFFICE_BOOKING_API_VERSION });

  async function handle(request) {
    if (request.method === "OPTIONS") return { status: 204, body: null };
    if (request.method !== "POST") return { status: 405, body: { success: false, error: { code: "method_not_allowed", message: "POST is required.", details: {} } } };
    const action = cleanText(request.body?.action, 120);
    if (!COMMUNICATION_ACTIONS.has(action)) return baseApi.handle(request);
    try {
      const identity = await baseApi.authenticate(request);
      const result = await communication.execute({ action, data: request.body?.data || {}, identity });
      return { status: 200, body: result };
    } catch (error) {
      return communicationError(error);
    }
  }

  return {
    baseApi,
    communication,
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
module.exports.createOfficeBookingAuthorityFacade = createOfficeBookingAuthorityFacade;
