const crypto = require("node:crypto");
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
const { createBookingAppointmentLifecycle } = require("./bookingAuthorityAppointmentLifecycle");
const { createOperationalMoveAuthority } = require("./bookingOperationalMove");
const { createSchedulingProvider } = require("./bookingAuthoritySchedulingProvider");
const { notificationRecipient } = require("./bookingAuthorityWorkOrders");
const { mergeBookablePresets } = require("./serviceCatalog");

const OFFICE_BOOKING_API_VERSION = 10;
const OFFICE_BOOKING_ROLES = Object.freeze([
  "admin",
  "office",
  "supervisor",
  "owner",
  "super_admin",
  "super-admin",
  "superadmin",
]);
const OFFICE_BOOKING_ACTIONS = Object.freeze({
  LIST_PRESETS: "list_presets",
  LIST_APPOINTMENT_ATTRIBUTION: "list_appointment_attribution",
  GET_APPOINTMENT_COMMUNICATION: "get_appointment_communication",
  UPDATE_APPOINTMENT_COMMUNICATION: "update_appointment_communication",
  CREATE_CUSTOMER_PROPERTY: "create_customer_property",
  CREATE_PROPERTY: "create_property",
  CHECK_AVAILABILITY: "check_availability",
  CREATE_APPOINTMENT: "create_appointment",
  GET_APPOINTMENT: "get_appointment",
  CANCEL_APPOINTMENT: "cancel_appointment",
  RESCHEDULE_APPOINTMENT: "reschedule_appointment",
  MOVE_APPOINTMENT: "move_appointment",
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

function lifecycleChangeKind(value) {
  return cleanText(value, 80) === "operational_move" ? "operational_move" : "customer_reschedule";
}

function bookingRequestFromOffice(data = {}) {
  const sharedDescription = cleanText(data.customerFacingDescription, 500);
  const sharedInstructions = cleanText(data.technicianInstructions, 1_500);
  const suppliedLines = Array.isArray(data.workLines) && data.workLines.length
    ? data.workLines
    : [{
      id: "office-primary-work",
      presetId: cleanText(data.presetId, 120),
      serviceId: cleanText(data.serviceId, 120),
      quantity: positiveInteger(data.quantity),
    }];
  const workLines = suppliedLines.map((line, index) => ({
    id: cleanText(line?.id, 120) || `office-work-${index + 1}`,
    presetId: cleanText(line?.presetId || line?.serviceType, 120),
    serviceId: cleanText(line?.serviceId, 120),
    quantity: positiveInteger(line?.quantity),
    manualDurationMinutes: line?.manualDurationMinutes,
    customerFacingDescription: cleanText(line?.customerFacingDescription, 500) || sharedDescription,
    technicianInstructions: cleanText(line?.technicianInstructions, 1_500) || sharedInstructions,
  }));
  return normalizeBookingRequest({
    customerId: data.customerId,
    propertyId: data.propertyId,
    workLines,
    constraints: {
      requestedDate: data.requestedDate,
      requestedTime: data.requestedTime,
      preferredTime: data.preferredTime,
    },
    notes: cleanText(data.notes, 1_500),
  });
}

function normalizedAppointmentIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, 180)).filter(Boolean))].slice(0, 500);
}

function masterDataId(prefix) {
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function normalizeOfficePhone(value) {
  const raw = cleanText(value, 80);
  if (!raw) return "";
  const plus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (plus) return `+${digits}`;
  if (digits.length === 7) return `+297${digits}`;
  return `+${digits}`;
}

function requiredMasterText(value, field, label, limit = 500) {
  const result = cleanText(value, limit);
  if (!result) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      `${label} is required.`,
      { field },
    );
  }
  return result;
}

function buildOfficeProperty({ id, clientId, input, identity, now }) {
  const address = requiredMasterText(input.address, "property.address", "Property address");
  const zone = requiredMasterText(input.zone, "property.zone", "Property area / zone", 120);
  return {
    id,
    clientId,
    name: cleanText(input.name, 180) || "Primary Property",
    type: cleanText(input.type, 80) || "Casa",
    address,
    addressRaw: address,
    addressNormalized: address,
    neighborhood: cleanText(input.neighborhood, 160),
    zone,
    operationalZone: zone,
    notes: cleanText(input.notes, 1_500),
    active: true,
    createdAt: now,
    updatedAt: now,
    createdById: cleanText(identity.uid, 160),
    createdByName: cleanText(identity.name || identity.email, 180),
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

function snapshotItems(snapshot) {
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function notificationQueueIds(value) {
  const ids = Array.isArray(value?.queueIds) ? value.queueIds : value?.queueId ? [value.queueId] : [];
  return [...new Set(ids.map((item) => cleanText(item, 1_200)).filter(Boolean))].slice(0, 50);
}

function notificationEnabled(order, field) {
  if (!order || order.whatsappNotificationsEnabled === false) return false;
  const recipients = Array.isArray(order.notificationRecipients) ? order.notificationRecipients : [];
  return recipients.length === 0 || recipients.some((recipient) => recipient?.[field] === true);
}

function communicationStateLabel(queueEntries) {
  if (!queueEntries.length) return "not_queued";
  const states = [...new Set(queueEntries.map((item) => cleanText(item.status, 80).toLowerCase() || "unknown"))];
  return states.length === 1 ? states[0] : "mixed";
}

function createOfficeBookingApi({
  db,
  verifyIdToken,
  bookingAuthority = null,
  schedulingProvider = null,
  lifecycleAuthority = null,
  operationalMoveAuthority = null,
} = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  if (typeof verifyIdToken !== "function") throw new Error("verifyIdToken is required.");
  const provider = schedulingProvider || createSchedulingProvider({ db });
  const authority = bookingAuthority || createBookingAuthority({ db, availabilityProvider: provider });
  let lifecycle = lifecycleAuthority;
  let operationalMove = operationalMoveAuthority;
  const getLifecycle = () => {
    if (!lifecycle) lifecycle = createBookingAppointmentLifecycle({ db, schedulingProvider: provider });
    return lifecycle;
  };
  const getOperationalMove = () => {
    if (!operationalMove) operationalMove = createOperationalMoveAuthority({ db });
    return operationalMove;
  };

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
    const [serviceSnapshot, legacySnapshot] = await Promise.all([
      db.collection("services").get(),
      db.collection("businessSettings").doc("appointment-work-presets").get(),
    ]);
    const services = snapshotItems(serviceSnapshot);
    const legacy = legacySnapshot.exists ? legacySnapshot.data() || {} : {};
    const presets = mergeBookablePresets(services, [{ id: "appointment-work-presets", ...legacy }]);
    return {
      success: true,
      version: OFFICE_BOOKING_API_VERSION,
      presets,
      catalogSource: presets.some((item) => item.source === "service_catalog") ? "services" : "legacy_fallback",
    };
  }

  async function listAppointmentAttribution(data = {}) {
    const appointmentIds = normalizedAppointmentIds(data.appointmentIds);
    if (!appointmentIds.length) return { success: true, version: OFFICE_BOOKING_API_VERSION, attribution: [] };
    const snapshots = await Promise.all(appointmentIds.map((id) => db.collection("appointments").doc(id).get()));
    const attribution = snapshots
      .filter((item) => item.exists)
      .map((item) => {
        const appointment = item.data() || {};
        return {
          appointmentId: cleanText(appointment.appointmentId || item.id, 180),
          source: cleanText(appointment.source, 80),
          createdBy: cleanText(appointment.createdBy, 160),
          createdByName: cleanText(appointment.createdByName, 160),
          createdAtIso: cleanText(appointment.createdAtIso, 80),
          updatedAtIso: cleanText(appointment.updatedAtIso, 80),
        };
      });
    return { success: true, version: OFFICE_BOOKING_API_VERSION, attribution };
  }

  async function appointmentWorkOrderDocs(appointmentId) {
    const id = requiredMasterText(appointmentId, "appointmentId", "Appointment id", 180);
    const snapshot = await db.collection("workOrders").where("appointmentId", "==", id).get();
    const docs = snapshot.docs || [];
    const primary = docs.find((doc) => {
      const value = doc.data() || {};
      return cleanText(value.appointmentAssignmentRole || value.assignmentRole, 40).toLowerCase() !== "support";
    }) || docs[0];
    if (!primary) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "No Work Order is linked to this appointment.",
        { appointmentId: id },
      );
    }
    return { appointmentId: id, docs, primary };
  }

  async function queueEntriesForIds(ids) {
    const snapshots = await Promise.all(ids.map((id) => db.collection("whatsappOutboundQueue").doc(id).get()));
    return snapshots.map((snapshot, index) => ({
      queueId: ids[index],
      status: snapshot.exists ? cleanText(snapshot.data()?.status, 80) || "unknown" : "missing",
    }));
  }

  async function appointmentCommunication(data = {}) {
    const { appointmentId, primary } = await appointmentWorkOrderDocs(data.appointmentId);
    const order = primary.data() || {};
    const recipients = Array.isArray(order.notificationRecipients) ? order.notificationRecipients : [];
    const confirmationQueueIds = notificationQueueIds(order.confirmationNotifications || order.confirmationNotification);
    const reminderQueueIds = notificationQueueIds(order.reminderNotifications || order.reminderNotification);
    const [confirmationQueue, reminderQueue] = await Promise.all([
      queueEntriesForIds(confirmationQueueIds),
      queueEntriesForIds(reminderQueueIds),
    ]);
    return {
      success: true,
      version: OFFICE_BOOKING_API_VERSION,
      appointmentId,
      workOrderId: primary.id,
      whatsappEnabled: order.whatsappNotificationsEnabled !== false,
      recipients: recipients.map((recipient) => ({
        id: cleanText(recipient?.id || recipient?.sourceId, 180),
        name: cleanText(recipient?.name, 180),
        phone: cleanText(recipient?.whatsapp || recipient?.phone, 80),
        preferredLanguage: cleanText(recipient?.preferredLanguage, 80),
        sendConfirmation: recipient?.sendConfirmation === true,
        sendReminder: recipient?.sendReminder === true,
      })),
      confirmation: {
        enabled: notificationEnabled(order, "sendConfirmation"),
        queueIds: confirmationQueueIds,
        state: communicationStateLabel(confirmationQueue),
        queue: confirmationQueue,
      },
      reminder: {
        enabled: notificationEnabled(order, "sendReminder"),
        queueIds: reminderQueueIds,
        state: communicationStateLabel(reminderQueue),
        queue: reminderQueue,
      },
    };
  }

  async function updateAppointmentCommunication(data = {}, identity = {}) {
    officeRequestId(data.requestId);
    if (typeof data.sendReminder !== "boolean") {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "sendReminder must be true or false.",
        { field: "sendReminder" },
      );
    }
    const { appointmentId, primary } = await appointmentWorkOrderDocs(data.appointmentId);
    const order = primary.data() || {};
    let recipients = Array.isArray(order.notificationRecipients) ? order.notificationRecipients.map((item) => ({ ...item })) : [];
    if (!recipients.length && cleanText(order.clientId, 180)) {
      const clientSnapshot = await db.collection("clients").doc(cleanText(order.clientId, 180)).get();
      if (clientSnapshot.exists) {
        const recipient = notificationRecipient({ id: clientSnapshot.id, ...clientSnapshot.data() });
        if (recipient) recipients = [recipient];
      }
    }
    recipients = recipients.map((recipient) => ({ ...recipient, sendReminder: data.sendReminder }));
    const now = new Date().toISOString();
    await primary.ref.set({
      notificationRecipients: recipients,
      notificationPreferenceUpdatedAt: now,
      notificationPreferenceUpdatedBy: cleanText(identity.uid, 160),
      updatedAt: now,
    }, { merge: true });

    if (data.sendReminder === false) {
      const queueIds = notificationQueueIds(order.reminderNotifications || order.reminderNotification);
      for (const queueId of queueIds) {
        const ref = db.collection("whatsappOutboundQueue").doc(queueId);
        const snapshot = await ref.get();
        if (snapshot.exists && cleanText(snapshot.data()?.status, 80).toLowerCase() === "queued") {
          await ref.set({
            status: "cancelled",
            cancelledAt: now,
            cancelledBy: cleanText(identity.uid, 160),
            cancellationReason: "appointment-reminder-disabled",
          }, { merge: true });
        }
      }
    }

    return appointmentCommunication({ appointmentId });
  }

  async function createCustomerProperty(data = {}, identity = {}) {
    if (typeof db.runTransaction !== "function") throw new Error("Firestore transactions are required for CRM master-data creation.");
    officeRequestId(data.requestId);
    const input = data.customer || {};
    const propertyInput = data.property || {};
    const name = requiredMasterText(input.name, "customer.name", "Customer name", 180);
    const phone = normalizeOfficePhone(input.phone || input.whatsapp);
    if (!phone) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "Customer phone / WhatsApp is required.",
        { field: "customer.phone" },
      );
    }
    const whatsapp = normalizeOfficePhone(input.whatsapp || input.phone) || phone;
    const now = new Date().toISOString();
    const clientId = masterDataId("client");
    const propertyId = masterDataId("property");
    const property = buildOfficeProperty({ id: propertyId, clientId, input: propertyInput, identity, now });
    const customer = {
      id: clientId,
      name,
      company: cleanText(input.company, 180),
      phone,
      phoneCountry: "AW",
      whatsapp,
      whatsappCountry: "AW",
      email: cleanText(input.email, 180),
      preferredLanguage: cleanText(input.preferredLanguage, 80) || "Papiamento",
      address: property.address,
      zone: property.zone,
      balance: 0,
      equipmentCount: 0,
      active: true,
      createdAt: now,
      updatedAt: now,
      createdById: cleanText(identity.uid, 160),
      createdByName: cleanText(identity.name || identity.email, 180),
    };
    const clientRef = db.collection("clients").doc(clientId);
    const propertyRef = db.collection("properties").doc(propertyId);
    await db.runTransaction(async (transaction) => {
      transaction.set(clientRef, customer);
      transaction.set(propertyRef, property);
    });
    return { success: true, version: OFFICE_BOOKING_API_VERSION, customer, property };
  }

  async function createProperty(data = {}, identity = {}) {
    if (typeof db.runTransaction !== "function") throw new Error("Firestore transactions are required for CRM master-data creation.");
    officeRequestId(data.requestId);
    const clientId = requiredMasterText(data.customerId, "customerId", "Customer id", 180);
    const now = new Date().toISOString();
    const propertyId = masterDataId("property");
    const property = buildOfficeProperty({ id: propertyId, clientId, input: data.property || {}, identity, now });
    const clientRef = db.collection("clients").doc(clientId);
    const propertyRef = db.collection("properties").doc(propertyId);
    await db.runTransaction(async (transaction) => {
      const customerSnapshot = await transaction.get(clientRef);
      if (!customerSnapshot.exists || customerSnapshot.data()?.active === false) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.CUSTOMER_NOT_FOUND,
          "The selected customer no longer exists or is inactive.",
          { customerId: clientId },
        );
      }
      transaction.set(propertyRef, property);
    });
    return { success: true, version: OFFICE_BOOKING_API_VERSION, property };
  }

  async function execute({ action, data = {}, identity }) {
    const actor = officeActor(identity);
    if (action === OFFICE_BOOKING_ACTIONS.LIST_PRESETS) return listPresets();
    if (action === OFFICE_BOOKING_ACTIONS.LIST_APPOINTMENT_ATTRIBUTION) return listAppointmentAttribution(data);
    if (action === OFFICE_BOOKING_ACTIONS.GET_APPOINTMENT_COMMUNICATION) return appointmentCommunication(data);
    if (action === OFFICE_BOOKING_ACTIONS.UPDATE_APPOINTMENT_COMMUNICATION) return updateAppointmentCommunication(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER_PROPERTY) return createCustomerProperty(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.CREATE_PROPERTY) return createProperty(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.CHECK_AVAILABILITY) {
      const requestId = officeRequestId(data.requestId);
      const request = bookingRequestFromOffice(data);
      const excludeAppointmentId = cleanText(data.appointmentId, 180);
      const requiredPrimaryVanId = cleanText(data.requiredVanId, 120);
      const changeKind = lifecycleChangeKind(data.changeKind);
      return authority.checkAvailability({
        request,
        actor,
        context: {
          channel: "office",
          requestKey: `office:${identity.uid}:${requestId}:availability`,
          officeRequestId: requestId,
          excludeAppointmentId,
          requiredPrimaryVanId,
          changeKind,
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
    if (action === OFFICE_BOOKING_ACTIONS.CANCEL_APPOINTMENT) {
      officeRequestId(data.requestId);
      return getLifecycle().cancelAppointment({
        appointmentId: data.appointmentId,
        reason: data.reason,
        note: data.note,
        actor,
      });
    }
    if (action === OFFICE_BOOKING_ACTIONS.RESCHEDULE_APPOINTMENT) {
      const requestId = officeRequestId(data.requestId);
      const changeKind = lifecycleChangeKind(data.changeKind);
      return getLifecycle().rescheduleAppointment({
        appointmentId: data.appointmentId,
        offerId: data.offerId,
        offerVersion: data.offerVersion,
        optionId: data.optionId,
        reason: data.reason,
        note: data.note,
        actor,
        changeKind,
        context: {
          channel: "office",
          officeRequestId: requestId,
          excludeAppointmentId: cleanText(data.appointmentId, 180),
          changeKind,
        },
      });
    }
    if (action === OFFICE_BOOKING_ACTIONS.MOVE_APPOINTMENT) {
      const requestId = officeRequestId(data.requestId);
      return getOperationalMove().moveAppointment({
        appointmentId: data.appointmentId,
        requestId,
        requestedDate: data.requestedDate,
        requestedTime: data.requestedTime,
        targetVanId: data.requiredVanId,
        reason: data.reason,
        note: data.note,
        actor,
      });
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

  return {
    version: OFFICE_BOOKING_API_VERSION,
    authenticate,
    execute,
    handle,
    listPresets,
    listAppointmentAttribution,
    appointmentCommunication,
    updateAppointmentCommunication,
    createCustomerProperty,
    createProperty,
  };
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
module.exports.buildOfficeProperty = buildOfficeProperty;
module.exports.createOfficeBookingApi = createOfficeBookingApi;
module.exports.normalizeOfficePhone = normalizeOfficePhone;
