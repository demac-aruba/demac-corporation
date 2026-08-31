const { onRequest } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
} = require("./bookingAuthorityCore");
const { createBookingAuthority } = require("./bookingAuthorityFirestore");
const { createSchedulingProvider } = require("./bookingAuthoritySchedulingProvider");
const { createOfficeBookingApi } = require("./officeBookingAuthority");
const { createPartialCompletionAuthority } = require("./bookingPartialCompletion");

const RECORD_PARTIAL_COMPLETION = "record_partial_completion";
const SCHEDULE_REMAINING_WORK = "schedule_remaining_work";
const PARTIAL_PROTECTED_ACTIONS = new Set([
  "cancel_appointment",
  "reschedule_appointment",
  "move_appointment",
]);

function actorFromIdentity(identity = {}) {
  return {
    source: "office-scheduling",
    id: cleanText(identity.uid, 160),
    name: cleanText(identity.name || identity.email, 160),
  };
}

function errorResponse(error) {
  if (error instanceof BookingAuthorityError) {
    return {
      status: 409,
      body: {
        success: false,
        error: {
          code: error.code,
          message: cleanText(error.message, 500),
          details: error.details || {},
        },
      },
    };
  }
  if (error?.code === "permission_denied") {
    return { status: 403, body: { success: false, error: { code: "permission_denied", message: cleanText(error.message, 500), details: {} } } };
  }
  if (error?.code === "unauthenticated") {
    return { status: 401, body: { success: false, error: { code: "unauthenticated", message: cleanText(error.message, 500), details: {} } } };
  }
  return {
    status: 500,
    body: { success: false, error: { code: "internal_error", message: cleanText(error?.message || error, 500) || "Unexpected office booking error.", details: {} } },
  };
}

function partialOutcomeRecorded(appointment) {
  return cleanText(appointment?.executionOutcome?.status, 40) === "partial";
}

function createOfficeBookingPartialWrapper({ db, verifyIdToken } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  if (typeof verifyIdToken !== "function") throw new Error("verifyIdToken is required.");

  const provider = createSchedulingProvider({ db });
  const bookingAuthority = createBookingAuthority({ db, availabilityProvider: provider });
  const api = createOfficeBookingApi({
    db,
    verifyIdToken,
    bookingAuthority,
    schedulingProvider: provider,
  });
  const partial = createPartialCompletionAuthority({ db, bookingAuthority });

  async function handle(request) {
    if (request.method === "OPTIONS") return { status: 204, body: null };
    const action = cleanText(request.body?.action, 120);
    if (action !== RECORD_PARTIAL_COMPLETION
      && action !== SCHEDULE_REMAINING_WORK
      && !PARTIAL_PROTECTED_ACTIONS.has(action)) {
      return api.handle(request);
    }

    try {
      const identity = await api.authenticate(request);
      const data = request.body?.data || {};
      const actor = actorFromIdentity(identity);

      if (action === RECORD_PARTIAL_COMPLETION) {
        return {
          status: 200,
          body: await partial.recordPartialCompletion({
            appointmentId: data.appointmentId,
            requestId: data.requestId,
            completedQuantity: data.completedQuantity,
            actualEndTime: data.actualEndTime,
            reason: data.reason,
            note: data.note,
            actor,
          }),
        };
      }

      if (action === SCHEDULE_REMAINING_WORK) {
        return {
          status: 200,
          body: await partial.scheduleRemainingWork({
            appointmentId: data.appointmentId,
            requestId: data.requestId,
            offerId: data.offerId,
            offerVersion: data.offerVersion,
            optionId: data.optionId,
            actor,
          }),
        };
      }

      const appointmentId = cleanText(data.appointmentId, 180);
      if (appointmentId) {
        const appointment = await bookingAuthority.getAppointment(appointmentId);
        if (partialOutcomeRecorded(appointment)) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.INVALID_REQUEST,
            "This appointment has already been partially completed. Its executed history is locked; schedule the remaining work from Actual Outcome instead.",
            { appointmentId, reason: "partial-completion-history-locked", action },
          );
        }
      }
      return api.handle(request);
    } catch (error) {
      return errorResponse(error);
    }
  }

  return {
    handle,
    api,
    partial,
    bookingAuthority,
  };
}

let defaultWrapper;
function getDefaultWrapper() {
  if (!defaultWrapper) {
    defaultWrapper = createOfficeBookingPartialWrapper({
      db: getFirestore(),
      verifyIdToken: (token) => getAuth().verifyIdToken(token),
    });
  }
  return defaultWrapper;
}

exports.officeBookingAuthority = onRequest(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 60 },
  async (request, response) => {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    const result = await getDefaultWrapper().handle(request);
    if (result.status === 204) {
      response.status(204).send("");
      return;
    }
    response.status(result.status).json(result.body);
  },
);

module.exports.RECORD_PARTIAL_COMPLETION = RECORD_PARTIAL_COMPLETION;
module.exports.SCHEDULE_REMAINING_WORK = SCHEDULE_REMAINING_WORK;
module.exports.createOfficeBookingPartialWrapper = createOfficeBookingPartialWrapper;
module.exports.partialOutcomeRecorded = partialOutcomeRecorded;
