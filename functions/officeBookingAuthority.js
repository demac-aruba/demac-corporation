const { onRequest } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
  normalizeBookingRequest,
  positiveInteger,
} = require("./bookingAuthorityCore");
const { createBookingAuthority } = require("./bookingAuthorityFirestore");
const { createSchedulingProvider } = require("./bookingAuthoritySchedulingProvider");

const OFFICE_BOOKING_API_VERSION = 1;
const OFFICE_BOOKING_ROLES = Object.freeze(["admin", "office", "supervisor"]);
const OFFICE_BOOKING_ACTIONS = Object.freeze({
  LIST_PRESETS: "list_presets",
  CHECK_AVAILABILITY: "check_availability",
  CREATE_APPOINTMENT: "create_appointment",
  GET_APPOINTMENT: "get_appointment",
});

function requireOfficeRole(role) {
  const normalized = cleanText(role, 80).toLowerCase();
  if (!OFFICE_BOOKING_ROLES.includes(normalized)) {
    const error = new Error("This user is not allowed to schedule appointments.");
    error.code = "permission_denied";
    throw error;
  }
  return normalized;
}

function bearerToken(request) {
  const header = String(request?.headers?.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return cleanText(match?.[1], 4_000);
}

function officeRequestId(value) {
  const normalized = cleanText(value, 240);
  if (normalized.length < 8) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_IDEMPOTENCY_KEY,
      "A stable office requestId of at least 8 characters is required.",
      { field: "requestId" },
    );
  }
  return normalized;
}

function officeActor(identity = {}) {
  return {
    source: "office-scheduling",
    id: cleanText(identity.uid, 160),
    name: cleanText(identity.name || identity.email, 160),
  };
}

function bookingRequestFromOffice(data = {}) {
  const presetId = cleanText(data.presetId, 120);
  const serviceId = cleanText(data.serviceId, 120);
  const quantity = positiveInteger(data.quantity);
  return normalizeBookingRequest({
    customerId: data.customerId,
    propertyId: data.propertyId,
    workLines: [{
      id: "office-primary-work",
      presetId,
      serviceId,
      quantity,
      customerFacingDescription: cleanText(data.customerFacingDescription, 500),
      technicianInstructions: cleanText(data.technicianInstructions, 1_500),
    }],
    constraints: {
      requestedDate: data.requestedDate,
      requestedTime: data.requestedTime,
      preferredTime: data.preferredTime,
    },
    notes: cleanText(data.notes, 1_500),
  });
}

function compactPreset(item = {}) {
  return {
    id: cleanText(item.id, 120),
    label: cleanText(item.label || item.id, 180),
    kind: cleanText(item.kind, 80),
    durationMinutesPerUnit: Math.max(30, Number(item.durationMinutesPerUnit || 60)),
    active: item.active !== false,
  };
}

function apiError(error) {
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
    return {
      status: 403,
      body: { success: false, error: { code: "permission_denied", message: cleanText(error.message, 500), details: {} } },
    };
  }
  if (error?.code === "unauthenticated") {
    return {
      status: 401,
      body: { success: false, error: { code: "unauthenticated", message: cleanText(error.message, 500), details: {} } },
    };
  }
  return {
    status: 500,
    body: {
      success: false,
      error: { code: "internal_error", message: cleanText(error?.message || error, 500) || "Unexpected office booking error.", details: {} },
    },
  };
}

function createOfficeBookingApi({ db, verifyIdToken, bookingAuthority = null, schedulingProvider = null } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  if (typeof verifyIdToken !== "function") throw new Error("verifyIdToken is required.");
  const provider = schedulingProvider || createSchedulingProvider({ db });
  const authority = bookingAuthority || createBookingAuthority({ db, availabilityProvider: provider });

  async function authenticate(request) {
    const token = bearerToken(request);
    if (!token) {
      const error = new Error("Firebase authentication is required.");
      error.code = "unauthenticated";
      throw error;
    }
    let decoded;
    try {
      decoded = await verifyIdToken(token);
    } catch (cause) {
      const error = new Error("The Firebase session is invalid or expired.");
      error.code = "unauthenticated";
      error.cause = cause;
      throw error;
    }
    const uid = cleanText(decoded?.uid || decoded?.sub, 160);
    if (!uid) {
      const error = new Error("The authenticated user has no uid.");
      error.code = "unauthenticated";
      throw error;
    }
    const profileSnapshot = await db.collection("users").doc(uid).get();
    const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
    const role = requireOfficeRole(profile.role || decoded.role);
    if (profile.active === false) {
      const error = new Error("This user is inactive.");
      error.code = "permission_denied";
      throw error;
    }
    return {
      uid,
      role,
      email: cleanText(decoded.email || profile.email, 180),
      name: cleanText(profile.name || decoded.name || decoded.email, 180),
    };
  }

  async function listPresets() {
    const snapshot = await db.collection("businessSettings").doc("appointment-work-presets").get();
    const data = snapshot.exists ? snapshot.data() || {} : {};
    const presets = Array.isArray(data.presets)
      ? data.presets.map(compactPreset).filter((item) => item.id && item.active)
      : [];
    return { success: true, version: OFFICE_BOOKING_API_VERSION, presets };
  }

  async function execute({ action, data = {}, identity }) {
    const actor = officeActor(identity);
    if (action === OFFICE_BOOKING_ACTIONS.LIST_PRESETS) return listPresets();
    if (action === OFFICE_BOOKING_ACTIONS.CHECK_AVAILABILITY) {
      const requestId = officeRequestId(data.requestId);
      const request = bookingRequestFromOffice(data);
      return authority.checkAvailability({
        request,
        actor,
        context: {
          channel: "office",
          requestKey: `office:${identity.uid}:${requestId}:availability`,
          officeRequestId: requestId,
        },
      });
    }
    if (action === OFFICE_BOOKING_ACTIONS.CREATE_APPOINTMENT) {
      const requestId = officeRequestId(data.requestId);
      const offerId = cleanText(data.offerId, 180);
      const optionId = cleanText(data.optionId, 180);
      const offerVersion = positiveInteger(data.offerVersion);
      const result = await authority.createAppointment({
        offerId,
        offerVersion,
        optionId,
        idempotencyKey: `office:${identity.uid}:${requestId}:create:${offerId}:${optionId}`,
        actor,
        context: { channel: "office", officeRequestId: requestId },
      });
      if (!result?.success || !cleanText(result.appointmentId, 180)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
          "Booking Authority did not return a verified appointment id.",
        );
      }
      return result;
    }
    if (action === OFFICE_BOOKING_ACTIONS.GET_APPOINTMENT) {
      const appointment = await authority.getAppointment(data.appointmentId);
      return { success: true, appointmentId: appointment.appointmentId || appointment.id, appointment };
    }
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "Unsupported Office Booking Authority action.",
      { action: cleanText(action, 120) },
    );
  }

  async function handle(request) {
    if (request.method === "OPTIONS") return { status: 204, body: null };
    if (request.method !== "POST") return { status: 405, body: { success: false, error: { code: "method_not_allowed", message: "POST is required.", details: {} } } };
    try {
      const identity = await authenticate(request);
      const action = cleanText(request.body?.action, 120);
      const result = await execute({ action, data: request.body?.data || {}, identity });
      return { status: 200, body: result };
    } catch (error) {
      return apiError(error);
    }
  }

  return { version: OFFICE_BOOKING_API_VERSION, authenticate, execute, handle, listPresets };
}

let defaultApi;
function getDefaultApi() {
  if (!defaultApi) {
    const db = getFirestore();
    defaultApi = createOfficeBookingApi({
      db,
      verifyIdToken: (token) => getAuth().verifyIdToken(token),
    });
  }
  return defaultApi;
}

exports.officeBookingAuthority = onRequest(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 60 },
  async (request, response) => {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    const result = await getDefaultApi().handle(request);
    if (result.status === 204) {
      response.status(204).send("");
      return;
    }
    response.status(result.status).json(result.body);
  },
);

module.exports.OFFICE_BOOKING_API_VERSION = OFFICE_BOOKING_API_VERSION;
module.exports.OFFICE_BOOKING_ACTIONS = OFFICE_BOOKING_ACTIONS;
module.exports.OFFICE_BOOKING_ROLES = OFFICE_BOOKING_ROLES;
module.exports.bookingRequestFromOffice = bookingRequestFromOffice;
module.exports.createOfficeBookingApi = createOfficeBookingApi;
module.exports.officeRequestId = officeRequestId;
module.exports.requireOfficeRole = requireOfficeRole;
