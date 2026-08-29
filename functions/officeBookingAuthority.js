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
const {
  BOOKING_CREATE_MODES,
  createBookingAuthority,
} = require("./bookingAuthorityFirestore");
const { createBookingAppointmentLifecycle } = require("./bookingAuthorityAppointmentLifecycle");
const { createOperationalMoveAuthority } = require("./bookingOperationalMove");
const { createAdhocSupportAuthority } = require("./bookingAdhocSupport");
const { createSchedulingProvider } = require("./bookingAuthoritySchedulingProvider");
const { mergeBookablePresets } = require("./serviceCatalog");
const {
  CONTACT_ASSIGNMENT_COLLECTION,
  CONTACT_COLLECTION,
  resolveAppointmentRecipients,
  writeContactLinks,
} = require("./customerContactDirectory");
const {
  createAppointmentNotificationService,
  dateKeyInTimeZone,
  notificationQueueIds: canonicalNotificationQueueIds,
} = require("./appointmentNotificationService");

const OFFICE_BOOKING_API_VERSION = 16;
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
  LIST_CONTACT_DIRECTORY: "list_contact_directory",
  GET_APPOINTMENT_COMMUNICATION: "get_appointment_communication",
  UPDATE_APPOINTMENT_COMMUNICATION: "update_appointment_communication",
  SEND_APPOINTMENT_REMINDER: "send_appointment_reminder",
  CREATE_CUSTOMER: "create_customer",
  CREATE_CUSTOMER_PROPERTY: "create_customer_property",
  CREATE_PROPERTY: "create_property",
  UPDATE_CUSTOMER: "update_customer",
  UPDATE_PROPERTY: "update_property",
  UPDATE_CONTACT: "update_contact",
  SAVE_CONTACT_ASSIGNMENT: "save_contact_assignment",
  DEACTIVATE_CONTACT_ASSIGNMENT: "deactivate_contact_assignment",
  CHECK_AVAILABILITY: "check_availability",
  CREATE_APPOINTMENT: "create_appointment",
  CREATE_TEMPORARY_HOLD: "create_temporary_hold",
  CONFIRM_TEMPORARY_HOLD: "confirm_temporary_hold",
  GET_APPOINTMENT: "get_appointment",
  CANCEL_APPOINTMENT: "cancel_appointment",
  RESCHEDULE_APPOINTMENT: "reschedule_appointment",
  MOVE_APPOINTMENT: "move_appointment",
  ADD_ADHOC_SUPPORT: "add_adhoc_support",
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
  const normalized = cleanText(value, 80);
  if (normalized === "operational_move" || normalized === "details_edited") return normalized;
  return "customer_reschedule";
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

function masterDataId(prefix, seed = "") {
  const stableSeed = cleanText(seed, 500);
  if (stableSeed) {
    return `${prefix}-${crypto.createHash("sha256").update(stableSeed).digest("hex").slice(0, 20)}`;
  }
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function masterDataFingerprint(action, value) {
  return crypto.createHash("sha256").update(`${action}:${stableJson(value)}`).digest("hex");
}

function existingIdempotentRecord(snapshot, { entity, id, requestId, fingerprint, identity }) {
  if (!snapshot.exists) return null;
  const record = { id, ...(snapshot.data() || {}) };
  const matches = cleanText(record.creationRequestId, 240) === requestId
    && cleanText(record.creationRequestFingerprint, 80) === fingerprint
    && cleanText(record.createdById, 160) === cleanText(identity.uid, 160);
  if (matches) return record;
  throw new BookingAuthorityError(
    BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    `This ${entity} creation request conflicts with a previous request.`,
    { reason: "idempotency_conflict", id, requestId },
  );
}

function masterDataTimestamp(value) {
  if (!value) return "";
  if (typeof value === "object") {
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    if (value.timestampValue) return masterDataTimestamp(value.timestampValue);
    const seconds = Number(value.seconds ?? value._seconds);
    const nanoseconds = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      return new Date((seconds * 1_000) + Math.floor(nanoseconds / 1_000_000)).toISOString();
    }
  }
  const raw = cleanText(value, 120);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function serializeMasterDataTimestamps(record) {
  const serialized = { ...record };
  for (const field of ["createdAt", "updatedAt", "archivedAt"]) {
    const value = masterDataTimestamp(serialized[field]);
    if (value) serialized[field] = value;
  }
  return serialized;
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

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizedOfficeEmail(value) {
  return cleanText(value, 180).toLowerCase();
}

function updatedByFields(identity, now) {
  return {
    updatedAt: now,
    updatedById: cleanText(identity.uid, 160),
    updatedByName: cleanText(identity.name || identity.email, 180),
  };
}

function assertExpectedUpdatedAt(record, expectedUpdatedAt, entity, id) {
  const expected = masterDataTimestamp(expectedUpdatedAt);
  const current = masterDataTimestamp(record?.updatedAt);
  if (current && !expected) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      `Reload this ${entity} before saving changes.`,
      { reason: "missing_record_version", id, currentUpdatedAt: current },
    );
  }
  if (!current && !expected) return;
  if (current !== expected) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      `This ${entity} changed after it was opened. Reload before saving again.`,
      { reason: "stale_record", id, expectedUpdatedAt: expected, currentUpdatedAt: current },
    );
  }
}

function buildOfficeCustomer({ id, input, identity, now }) {
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
  return {
    id,
    name,
    company: cleanText(input.company, 180),
    legalName: cleanText(input.legalName, 180),
    type: cleanText(input.type, 80),
    phone,
    phoneCountry: "AW",
    whatsapp,
    whatsappCountry: "AW",
    email: normalizedOfficeEmail(input.email),
    preferredLanguage: cleanText(input.preferredLanguage, 80) || "Papiamento",
    address: "",
    zone: cleanText(input.zone, 120),
    balance: 0,
    equipmentCount: 0,
    active: true,
    createdAt: now,
    createdById: cleanText(identity.uid, 160),
    createdByName: cleanText(identity.name || identity.email, 180),
    ...updatedByFields(identity, now),
  };
}

function customerChanges(input = {}, current = {}) {
  const changes = {};
  if (hasOwn(input, "name")) changes.name = requiredMasterText(input.name, "changes.name", "Customer name", 180);
  if (hasOwn(input, "company")) changes.company = cleanText(input.company, 180);
  if (hasOwn(input, "legalName")) changes.legalName = cleanText(input.legalName, 180);
  if (hasOwn(input, "type")) changes.type = cleanText(input.type, 80);
  if (hasOwn(input, "phone")) {
    changes.phone = normalizeOfficePhone(input.phone);
    changes.phoneCountry = changes.phone ? "AW" : "";
  }
  if (hasOwn(input, "whatsapp")) {
    changes.whatsapp = normalizeOfficePhone(input.whatsapp);
    changes.whatsappCountry = changes.whatsapp ? "AW" : "";
  }
  if (hasOwn(input, "email")) changes.email = normalizedOfficeEmail(input.email);
  if (hasOwn(input, "preferredLanguage")) changes.preferredLanguage = cleanText(input.preferredLanguage, 80) || "Papiamento";
  if (hasOwn(input, "zone")) changes.zone = cleanText(input.zone, 120);
  const resultingPhone = hasOwn(changes, "phone") ? changes.phone : normalizeOfficePhone(current.phone);
  const resultingWhatsapp = hasOwn(changes, "whatsapp") ? changes.whatsapp : normalizeOfficePhone(current.whatsapp);
  if (!resultingPhone && !resultingWhatsapp) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "Customer phone / WhatsApp is required.",
      { field: "changes.phone" },
    );
  }
  return changes;
}

function propertyChanges(input = {}) {
  const changes = {};
  if (hasOwn(input, "name")) changes.name = cleanText(input.name, 180);
  if (hasOwn(input, "type")) changes.type = cleanText(input.type, 80) || "Casa";
  if (hasOwn(input, "address")) {
    const address = requiredMasterText(input.address, "changes.address", "Property address");
    changes.address = address;
    changes.addressRaw = address;
    changes.addressNormalized = address;
  }
  if (hasOwn(input, "zone")) {
    const zone = requiredMasterText(input.zone, "changes.zone", "Property area / zone", 120);
    changes.zone = zone;
    changes.operationalZone = zone;
  }
  if (hasOwn(input, "neighborhood")) changes.neighborhood = cleanText(input.neighborhood, 160);
  if (hasOwn(input, "notes")) changes.notes = cleanText(input.notes, 1_500);
  if (hasOwn(input, "accessInstructions")) changes.accessInstructions = cleanText(input.accessInstructions, 1_500);
  if (hasOwn(input, "landmark")) changes.landmark = cleanText(input.landmark, 500);
  return changes;
}

function contactChanges(input = {}, current = {}) {
  const changes = {};
  if (hasOwn(input, "name")) changes.name = requiredMasterText(input.name, "changes.name", "Contact name", 180);
  if (hasOwn(input, "phone")) {
    changes.phone = normalizeOfficePhone(input.phone);
    changes.phoneCountry = changes.phone ? "AW" : "";
  }
  if (hasOwn(input, "whatsapp")) {
    changes.whatsapp = normalizeOfficePhone(input.whatsapp);
    changes.whatsappCountry = changes.whatsapp ? "AW" : "";
  }
  if (hasOwn(input, "email")) changes.email = normalizedOfficeEmail(input.email);
  if (hasOwn(input, "preferredLanguage")) changes.preferredLanguage = cleanText(input.preferredLanguage, 80) || "Papiamento";
  if (hasOwn(input, "active")) changes.active = input.active === true;
  const resultingPhone = hasOwn(changes, "phone") ? changes.phone : normalizeOfficePhone(current.phone);
  const resultingWhatsapp = hasOwn(changes, "whatsapp") ? changes.whatsapp : normalizeOfficePhone(current.whatsapp);
  const resultingEmail = hasOwn(changes, "email") ? changes.email : normalizedOfficeEmail(current.email);
  if (!resultingPhone && !resultingWhatsapp && !resultingEmail) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "A contact requires at least one phone, WhatsApp, or email address.",
      { field: "changes.contact" },
    );
  }
  return changes;
}

function buildOfficeProperty({ id, clientId, input, identity, now }) {
  const address = requiredMasterText(input.address, "property.address", "Property address");
  const zone = requiredMasterText(input.zone, "property.zone", "Property area / zone", 120);
  return {
    id,
    clientId,
    name: cleanText(input.name, 180),
    type: cleanText(input.type, 80) || "Casa",
    address,
    addressRaw: address,
    addressNormalized: address,
    neighborhood: cleanText(input.neighborhood, 160),
    zone,
    operationalZone: zone,
    notes: cleanText(input.notes, 1_500),
    accessInstructions: cleanText(input.accessInstructions, 1_500),
    landmark: cleanText(input.landmark, 500),
    active: true,
    createdAt: now,
    createdById: cleanText(identity.uid, 160),
    createdByName: cleanText(identity.name || identity.email, 180),
    ...updatedByFields(identity, now),
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

function notificationQueueIds(value, options = {}) {
  return canonicalNotificationQueueIds(value, options)
    .map((item) => cleanText(item, 1_200))
    .filter(Boolean)
    .slice(-50);
}

function notificationEnabled(order, field) {
  if (!order || order.whatsappNotificationsEnabled === false) return false;
  const recipients = Array.isArray(order.notificationRecipients) ? order.notificationRecipients : [];
  return recipients.some((recipient) => recipient?.[field] === true);
}

function communicationStateLabel(queueEntries) {
  if (!queueEntries.length) return "not_queued";
  const states = queueEntries.map((item) => cleanText(item.status, 80).toLowerCase() || "unknown");
  const precedence = ["read", "delivered", "sent", "accepted", "processing", "queued", "failed", "cancelled", "missing", "unknown"];
  return precedence.find((state) => states.includes(state)) || "unknown";
}

function reminderCanSendNow(reminder) {
  if (!reminder?.enabled) return false;
  return !["read", "delivered", "sent", "accepted", "processing", "queued"].includes(reminder.state);
}

function createOfficeBookingApi({
  db,
  verifyIdToken,
  bookingAuthority = null,
  schedulingProvider = null,
  lifecycleAuthority = null,
  operationalMoveAuthority = null,
  adhocSupportAuthority = null,
  appointmentNotificationService = null,
} = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  if (typeof verifyIdToken !== "function") throw new Error("verifyIdToken is required.");
  const provider = schedulingProvider || createSchedulingProvider({ db });
  const authority = bookingAuthority || createBookingAuthority({ db, availabilityProvider: provider });
  const notifications = appointmentNotificationService || createAppointmentNotificationService({ db });
  let lifecycle = lifecycleAuthority;
  let operationalMove = operationalMoveAuthority;
  let adhocSupport = adhocSupportAuthority;
  const getLifecycle = () => {
    if (!lifecycle) lifecycle = createBookingAppointmentLifecycle({ db, schedulingProvider: provider });
    return lifecycle;
  };
  const getOperationalMove = () => {
    if (!operationalMove) operationalMove = createOperationalMoveAuthority({ db });
    return operationalMove;
  };
  const getAdhocSupport = () => {
    if (!adhocSupport) adhocSupport = createAdhocSupportAuthority({ db });
    return adhocSupport;
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

  async function listContactDirectory(data = {}) {
    const clientId = cleanText(data.customerId, 180);
    const contactQuery = clientId ? db.collection(CONTACT_COLLECTION).where("clientId", "==", clientId) : db.collection(CONTACT_COLLECTION);
    const assignmentQuery = clientId ? db.collection(CONTACT_ASSIGNMENT_COLLECTION).where("clientId", "==", clientId) : db.collection(CONTACT_ASSIGNMENT_COLLECTION);
    const [contactSnapshot, assignmentSnapshot] = await Promise.all([contactQuery.get(), assignmentQuery.get()]);
    return {
      success: true,
      version: OFFICE_BOOKING_API_VERSION,
      contacts: snapshotItems(contactSnapshot).filter((item) => item.active !== false).map(serializeMasterDataTimestamps),
      assignments: snapshotItems(assignmentSnapshot).filter((item) => item.active !== false).map(serializeMasterDataTimestamps),
    };
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
    return snapshots.map((snapshot, index) => {
      const value = snapshot.exists ? snapshot.data() || {} : {};
      return {
        queueId: ids[index],
        status: snapshot.exists ? cleanText(value.status, 80) || "unknown" : "missing",
        messageId: cleanText(value.messageId, 300),
        errorMessage: cleanText(value.errorMessage, 500),
        reason: cleanText(value.reason, 160),
      };
    });
  }

  async function appointmentCommunication(data = {}) {
    const { appointmentId, primary } = await appointmentWorkOrderDocs(data.appointmentId);
    const order = primary.data() || {};
    const recipients = Array.isArray(order.notificationRecipients) ? order.notificationRecipients : [];
    const confirmationSource = order.confirmationNotifications || order.confirmationNotification;
    const reminderSource = order.reminderNotifications || order.reminderNotification;
    const confirmationQueueIds = notificationQueueIds(confirmationSource, { preferLatest: true });
    const reminderQueueIds = notificationQueueIds(reminderSource, { preferLatest: true });
    const [confirmationQueue, reminderQueue] = await Promise.all([
      queueEntriesForIds(confirmationQueueIds),
      queueEntriesForIds(reminderQueueIds),
    ]);
    const confirmationState = communicationStateLabel(confirmationQueue);
    const reminderState = communicationStateLabel(reminderQueue);
    const reminder = {
      enabled: notificationEnabled(order, "sendReminder"),
      queueIds: reminderQueueIds,
      historyQueueIds: notificationQueueIds(reminderSource),
      state: reminderState,
      queue: reminderQueue,
      lastError: reminderQueue.find((entry) => entry.errorMessage)?.errorMessage || "",
    };
    reminder.canSendNow = reminderCanSendNow(reminder);
    return {
      success: true,
      version: OFFICE_BOOKING_API_VERSION,
      appointmentId,
      workOrderId: primary.id,
      whatsappEnabled: order.whatsappNotificationsEnabled === true,
      recipients: recipients.map((recipient) => ({
        id: cleanText(recipient?.id || `${recipient?.recipientType || "recipient"}-${recipient?.sourceId || "unknown"}`, 180),
        name: cleanText(recipient?.name, 180),
        phone: cleanText(recipient?.whatsapp || recipient?.phone, 80),
        preferredLanguage: cleanText(recipient?.preferredLanguage, 80),
        sendConfirmation: recipient?.sendConfirmation === true,
        sendReminder: recipient?.sendReminder === true,
      })),
      confirmation: {
        enabled: notificationEnabled(order, "sendConfirmation"),
        queueIds: confirmationQueueIds,
        historyQueueIds: notificationQueueIds(confirmationSource),
        state: confirmationState,
        queue: confirmationQueue,
        lastError: confirmationQueue.find((entry) => entry.errorMessage)?.errorMessage || "",
      },
      reminder,
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
    let recipients = Array.isArray(order.notificationRecipients)
      ? order.notificationRecipients.filter((recipient) => recipient && typeof recipient === "object").map((recipient) => ({ ...recipient }))
      : [];
    if (!recipients.length && cleanText(order.clientId, 180) && cleanText(order.propertyId, 180)) {
      recipients = await resolveAppointmentRecipients(db, {
        clientId: cleanText(order.clientId, 180),
        propertyId: cleanText(order.propertyId, 180),
        selections: [],
      });
    }
    if (data.sendReminder === true && !recipients.some((recipient) => cleanText(recipient.whatsapp || recipient.phone, 80))) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "No WhatsApp recipient is available for this appointment reminder.",
        { appointmentId },
      );
    }
    recipients = recipients.map((recipient) => ({ ...recipient, sendReminder: data.sendReminder }));
    const whatsappNotificationsEnabled = recipients.some((recipient) =>
      (recipient.sendConfirmation === true || recipient.sendReminder === true)
      && cleanText(recipient.whatsapp || recipient.phone, 80));
    const now = new Date().toISOString();
    await primary.ref.set({
      notificationRecipients: recipients,
      whatsappNotificationsEnabled,
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

  async function sendAppointmentReminder(data = {}, identity = {}) {
    const requestId = officeRequestId(data.requestId);
    const { appointmentId, primary } = await appointmentWorkOrderDocs(data.appointmentId);
    const order = { id: primary.id, ...primary.data() };
    const current = await appointmentCommunication({ appointmentId });

    if (!current.reminder.enabled) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "The appointment reminder is disabled. Turn it on before sending a manual reminder.",
        { appointmentId },
      );
    }
    if (["read", "delivered", "sent", "accepted"].includes(current.reminder.state)) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "The appointment reminder has already been sent successfully.",
        { appointmentId, state: current.reminder.state },
      );
    }
    if (["queued", "processing"].includes(current.reminder.state)) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "The appointment reminder is already queued or processing.",
        { appointmentId, state: current.reminder.state },
      );
    }
    if (cleanText(order.date, 20) && order.date < dateKeyInTimeZone()) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "A reminder cannot be sent for an appointment date that has already passed.",
        { appointmentId, appointmentDate: order.date },
      );
    }

    const result = await notifications.queueReminderForOrder({
      order,
      eventId: `manual-${requestId}`,
      reason: "manual-office-reminder",
      targetDate: order.date,
      requestedById: cleanText(identity.uid, 160),
      requestedByName: cleanText(identity.name || identity.email, 180),
      manual: true,
    });
    if (!result.queued) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "The appointment reminder could not be queued.",
        { appointmentId, reason: result.reason },
      );
    }
    return appointmentCommunication({ appointmentId });
  }

  async function createCustomerProperty(data = {}, identity = {}) {
    if (typeof db.runTransaction !== "function") throw new Error("Firestore transactions are required for CRM master-data creation.");
    const requestId = officeRequestId(data.requestId);
    const input = data.customer || {};
    const propertyInput = data.property || {};
    const fingerprint = masterDataFingerprint(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER_PROPERTY, { customer: input, property: propertyInput });
    const now = new Date().toISOString();
    const requestSeed = `${identity.uid}:${OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER_PROPERTY}:${requestId}`;
    const clientId = masterDataId("client", requestSeed);
    const propertyId = masterDataId("property", requestSeed);
    let property = {
      ...buildOfficeProperty({ id: propertyId, clientId, input: propertyInput, identity, now }),
      creationRequestId: requestId,
      creationRequestFingerprint: fingerprint,
    };
    let customer = {
      ...buildOfficeCustomer({ id: clientId, input, identity, now }),
      address: property.address,
      zone: cleanText(input.zone, 120) || property.zone,
      creationRequestId: requestId,
      creationRequestFingerprint: fingerprint,
    };
    const clientRef = db.collection("clients").doc(clientId);
    const propertyRef = db.collection("properties").doc(propertyId);
    await db.runTransaction(async (transaction) => {
      const [customerSnapshot, propertySnapshot] = await Promise.all([
        transaction.get(clientRef),
        transaction.get(propertyRef),
      ]);
      if (customerSnapshot.exists || propertySnapshot.exists) {
        const existingCustomer = existingIdempotentRecord(customerSnapshot, { entity: "customer", id: clientId, requestId, fingerprint, identity });
        const existingProperty = existingIdempotentRecord(propertySnapshot, { entity: "property", id: propertyId, requestId, fingerprint, identity });
        if (!existingCustomer || !existingProperty) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "This customer/property creation request is incomplete and cannot be replayed safely.",
            { reason: "idempotency_conflict", customerId: clientId, propertyId, requestId },
          );
        }
        customer = existingCustomer;
        property = existingProperty;
        return;
      }
      await writeContactLinks(transaction, db, {
        clientId,
        propertyId,
        links: propertyInput.contactLinks,
        identity,
        now,
      });
      transaction.set(clientRef, customer);
      transaction.set(propertyRef, property);
    });
    return { success: true, version: OFFICE_BOOKING_API_VERSION, customer, property };
  }

  async function createCustomer(data = {}, identity = {}) {
    if (typeof db.runTransaction !== "function") throw new Error("Firestore transactions are required for CRM master-data creation.");
    const requestId = officeRequestId(data.requestId);
    const input = data.customer || {};
    const fingerprint = masterDataFingerprint(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER, input);
    const now = new Date().toISOString();
    const clientId = masterDataId("client", `${identity.uid}:${OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER}:${requestId}`);
    let customer = {
      ...buildOfficeCustomer({ id: clientId, input, identity, now }),
      creationRequestId: requestId,
      creationRequestFingerprint: fingerprint,
    };
    const clientRef = db.collection("clients").doc(clientId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(clientRef);
      const existing = existingIdempotentRecord(snapshot, { entity: "customer", id: clientId, requestId, fingerprint, identity });
      if (existing) {
        customer = existing;
        return;
      }
      transaction.set(clientRef, customer);
    });
    return { success: true, version: OFFICE_BOOKING_API_VERSION, customer };
  }

  async function createProperty(data = {}, identity = {}) {
    if (typeof db.runTransaction !== "function") throw new Error("Firestore transactions are required for CRM master-data creation.");
    const requestId = officeRequestId(data.requestId);
    const clientId = requiredMasterText(data.customerId, "customerId", "Customer id", 180);
    const propertyInput = data.property || {};
    const fingerprint = masterDataFingerprint(OFFICE_BOOKING_ACTIONS.CREATE_PROPERTY, { customerId: clientId, property: propertyInput });
    const now = new Date().toISOString();
    const propertyId = masterDataId("property", `${identity.uid}:${OFFICE_BOOKING_ACTIONS.CREATE_PROPERTY}:${requestId}`);
    let property = {
      ...buildOfficeProperty({ id: propertyId, clientId, input: propertyInput, identity, now }),
      creationRequestId: requestId,
      creationRequestFingerprint: fingerprint,
    };
    const clientRef = db.collection("clients").doc(clientId);
    const propertyRef = db.collection("properties").doc(propertyId);
    await db.runTransaction(async (transaction) => {
      const [customerSnapshot, propertySnapshot] = await Promise.all([
        transaction.get(clientRef),
        transaction.get(propertyRef),
      ]);
      if (!customerSnapshot.exists || customerSnapshot.data()?.active === false) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.CUSTOMER_NOT_FOUND,
          "The selected customer no longer exists or is inactive.",
          { customerId: clientId },
        );
      }
      const existing = existingIdempotentRecord(propertySnapshot, { entity: "property", id: propertyId, requestId, fingerprint, identity });
      if (existing) {
        property = existing;
        return;
      }
      await writeContactLinks(transaction, db, {
        clientId,
        propertyId,
        links: propertyInput.contactLinks,
        identity,
        now,
      });
      transaction.set(propertyRef, property);
    });
    return { success: true, version: OFFICE_BOOKING_API_VERSION, property };
  }

  async function updateCustomer(data = {}, identity = {}) {
    if (typeof db.runTransaction !== "function") throw new Error("Firestore transactions are required for CRM master-data changes.");
    officeRequestId(data.requestId);
    const customerId = requiredMasterText(data.customerId, "customerId", "Customer id", 180);
    const clientRef = db.collection("clients").doc(customerId);
    const now = new Date().toISOString();
    let customer;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(clientRef);
      if (!snapshot.exists) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.CUSTOMER_NOT_FOUND,
          "The selected customer no longer exists.",
          { customerId },
        );
      }
      const current = { id: customerId, ...(snapshot.data() || {}) };
      assertExpectedUpdatedAt(current, data.expectedUpdatedAt, "customer", customerId);
      customer = {
        ...current,
        ...customerChanges(data.changes || {}, current),
        id: customerId,
        ...updatedByFields(identity, now),
      };
      transaction.set(clientRef, customer);
    });
    return { success: true, version: OFFICE_BOOKING_API_VERSION, customer };
  }

  async function updateProperty(data = {}, identity = {}) {
    if (typeof db.runTransaction !== "function") throw new Error("Firestore transactions are required for CRM master-data changes.");
    officeRequestId(data.requestId);
    const customerId = requiredMasterText(data.customerId, "customerId", "Customer id", 180);
    const propertyId = requiredMasterText(data.propertyId, "propertyId", "Property id", 180);
    const clientRef = db.collection("clients").doc(customerId);
    const propertyRef = db.collection("properties").doc(propertyId);
    const now = new Date().toISOString();
    let property;
    await db.runTransaction(async (transaction) => {
      const [customerSnapshot, propertySnapshot] = await Promise.all([
        transaction.get(clientRef),
        transaction.get(propertyRef),
      ]);
      if (!customerSnapshot.exists) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.CUSTOMER_NOT_FOUND, "The selected customer no longer exists.", { customerId });
      }
      if (!propertySnapshot.exists) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.PROPERTY_NOT_FOUND, "The selected property no longer exists.", { propertyId });
      }
      const current = { id: propertyId, ...(propertySnapshot.data() || {}) };
      if (cleanText(current.clientId, 180) !== customerId) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.PROPERTY_CUSTOMER_MISMATCH,
          "The selected property does not belong to this customer.",
          { customerId, propertyId },
        );
      }
      assertExpectedUpdatedAt(current, data.expectedUpdatedAt, "property", propertyId);
      property = {
        ...current,
        ...propertyChanges(data.changes || {}),
        id: propertyId,
        clientId: customerId,
        ...updatedByFields(identity, now),
      };
      transaction.set(propertyRef, property);
    });
    return { success: true, version: OFFICE_BOOKING_API_VERSION, property };
  }

  async function updateContact(data = {}, identity = {}) {
    if (typeof db.runTransaction !== "function") throw new Error("Firestore transactions are required for CRM master-data changes.");
    officeRequestId(data.requestId);
    const customerId = requiredMasterText(data.customerId, "customerId", "Customer id", 180);
    const contactId = requiredMasterText(data.contactId, "contactId", "Contact id", 180);
    const clientRef = db.collection("clients").doc(customerId);
    const contactRef = db.collection(CONTACT_COLLECTION).doc(contactId);
    const now = new Date().toISOString();
    let contact;
    await db.runTransaction(async (transaction) => {
      const [customerSnapshot, contactSnapshot] = await Promise.all([
        transaction.get(clientRef),
        transaction.get(contactRef),
      ]);
      if (!customerSnapshot.exists) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.CUSTOMER_NOT_FOUND, "The selected customer no longer exists.", { customerId });
      }
      if (!contactSnapshot.exists) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "The selected contact no longer exists.",
          { reason: "contact_not_found", contactId },
        );
      }
      const current = { id: contactId, ...(contactSnapshot.data() || {}) };
      if (cleanText(current.clientId, 180) !== customerId) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "The selected contact does not belong to this customer.",
          { reason: "contact_customer_mismatch", customerId, contactId },
        );
      }
      assertExpectedUpdatedAt(current, data.expectedUpdatedAt, "contact", contactId);
      contact = {
        ...current,
        ...contactChanges(data.changes || {}, current),
        id: contactId,
        clientId: customerId,
        ...updatedByFields(identity, now),
      };
      transaction.set(contactRef, contact);
    });
    return { success: true, version: OFFICE_BOOKING_API_VERSION, contact };
  }

  async function saveContactAssignment(data = {}, identity = {}) {
    if (typeof db.runTransaction !== "function") throw new Error("Firestore transactions are required for contact assignment changes.");
    officeRequestId(data.requestId);
    const clientId = requiredMasterText(data.customerId, "customerId", "Customer id", 180);
    const propertyId = requiredMasterText(data.propertyId, "propertyId", "Property id", 180);
    const link = data.link || {};
    const now = new Date().toISOString();
    const customerRef = db.collection("clients").doc(clientId);
    const propertyRef = db.collection("properties").doc(propertyId);
    let saved = [];
    await db.runTransaction(async (transaction) => {
      const [customerSnapshot, propertySnapshot] = await Promise.all([
        transaction.get(customerRef),
        transaction.get(propertyRef),
      ]);
      if (!customerSnapshot.exists || customerSnapshot.data()?.active === false) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.CUSTOMER_NOT_FOUND, "The selected customer no longer exists or is inactive.", { customerId: clientId });
      }
      if (!propertySnapshot.exists || cleanText(propertySnapshot.data()?.clientId, 180) !== clientId) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.PROPERTY_CUSTOMER_MISMATCH, "The selected property does not belong to this customer.", { clientId, propertyId });
      }
      saved = await writeContactLinks(transaction, db, { clientId, propertyId, links: [link], identity, now });
    });
    return { success: true, version: OFFICE_BOOKING_API_VERSION, ...(saved[0] || {}) };
  }

  async function deactivateContactAssignment(data = {}, identity = {}) {
    if (typeof db.runTransaction !== "function") throw new Error("Firestore transactions are required for contact assignment changes.");
    officeRequestId(data.requestId);
    const clientId = requiredMasterText(data.customerId, "customerId", "Customer id", 180);
    const propertyId = requiredMasterText(data.propertyId, "propertyId", "Property id", 180);
    const assignmentId = requiredMasterText(data.assignmentId, "assignmentId", "Contact assignment id", 180);
    const assignmentRef = db.collection(CONTACT_ASSIGNMENT_COLLECTION).doc(assignmentId);
    const now = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(assignmentRef);
      if (!snapshot.exists) return;
      const assignment = snapshot.data() || {};
      const belongs = cleanText(assignment.clientId, 180) === clientId
        && (assignment.scope === "all_properties" || cleanText(assignment.propertyId, 180) === propertyId);
      if (!belongs) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "This contact assignment does not belong to the selected customer/property.", { assignmentId });
      }
      transaction.set(assignmentRef, {
        active: false,
        updatedAt: now,
        archivedAt: now,
        archivedById: cleanText(identity.uid, 160),
        archivedByName: cleanText(identity.name || identity.email, 180),
      }, { merge: true });
    });
    return { success: true, version: OFFICE_BOOKING_API_VERSION, assignmentId };
  }

  async function execute({ action, data = {}, identity }) {
    const actor = officeActor(identity);
    if (action === OFFICE_BOOKING_ACTIONS.LIST_PRESETS) return listPresets();
    if (action === OFFICE_BOOKING_ACTIONS.LIST_APPOINTMENT_ATTRIBUTION) return listAppointmentAttribution(data);
    if (action === OFFICE_BOOKING_ACTIONS.LIST_CONTACT_DIRECTORY) return listContactDirectory(data);
    if (action === OFFICE_BOOKING_ACTIONS.GET_APPOINTMENT_COMMUNICATION) return appointmentCommunication(data);
    if (action === OFFICE_BOOKING_ACTIONS.UPDATE_APPOINTMENT_COMMUNICATION) return updateAppointmentCommunication(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.SEND_APPOINTMENT_REMINDER) return sendAppointmentReminder(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER) return createCustomer(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER_PROPERTY) return createCustomerProperty(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.CREATE_PROPERTY) return createProperty(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.UPDATE_CUSTOMER) return updateCustomer(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.UPDATE_PROPERTY) return updateProperty(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.UPDATE_CONTACT) return updateContact(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.SAVE_CONTACT_ASSIGNMENT) return saveContactAssignment(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.DEACTIVATE_CONTACT_ASSIGNMENT) return deactivateContactAssignment(data, identity);
    if (action === OFFICE_BOOKING_ACTIONS.CHECK_AVAILABILITY) {
      const requestId = officeRequestId(data.requestId);
      const request = bookingRequestFromOffice(data);
      const excludeAppointmentId = cleanText(data.appointmentId, 180);
      const requiredPrimaryVanId = cleanText(data.requiredVanId, 120);
      const changeKind = lifecycleChangeKind(data.changeKind);
      const notificationRecipients = await resolveAppointmentRecipients(db, {
        clientId: request.customerId,
        propertyId: request.propertyId,
        selections: data.recipientSelections,
      });
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
          notificationRecipients,
        },
      });
    }
    if (action === OFFICE_BOOKING_ACTIONS.CREATE_APPOINTMENT || action === OFFICE_BOOKING_ACTIONS.CREATE_TEMPORARY_HOLD) {
      const requestId = officeRequestId(data.requestId);
      const offerId = cleanText(data.offerId, 180);
      const optionId = cleanText(data.optionId, 180);
      const offerVersion = positiveInteger(data.offerVersion);
      const temporaryHold = action === OFFICE_BOOKING_ACTIONS.CREATE_TEMPORARY_HOLD;
      const result = await authority.createAppointment({
        offerId,
        offerVersion,
        optionId,
        idempotencyKey: `office:${identity.uid}:${requestId}:${temporaryHold ? "hold" : "create"}:${offerId}:${optionId}`,
        actor,
        createMode: temporaryHold ? BOOKING_CREATE_MODES.TEMPORARY_HOLD : BOOKING_CREATE_MODES.CONFIRMED,
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
    if (action === OFFICE_BOOKING_ACTIONS.CONFIRM_TEMPORARY_HOLD) {
      const requestId = officeRequestId(data.requestId);
      return getLifecycle().confirmTemporaryHold({
        appointmentId: data.appointmentId,
        actor,
        context: { channel: "office", officeRequestId: requestId },
      });
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
    if (action === OFFICE_BOOKING_ACTIONS.ADD_ADHOC_SUPPORT) {
      const requestId = officeRequestId(data.requestId);
      return getAdhocSupport().addSupport({
        appointmentId: data.appointmentId,
        requestId,
        requestedDate: data.requestedDate,
        requestedTime: data.requestedTime,
        targetVanId: data.requiredVanId,
        reason: data.reason,
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
    listContactDirectory,
    appointmentCommunication,
    updateAppointmentCommunication,
    sendAppointmentReminder,
    createCustomer,
    createCustomerProperty,
    createProperty,
    updateCustomer,
    updateProperty,
    updateContact,
    saveContactAssignment,
    deactivateContactAssignment,
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
