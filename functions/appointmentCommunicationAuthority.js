const { BOOKING_ERROR_CODES, BookingAuthorityError, cleanText } = require("./bookingAuthorityCore");
const {
  createAppointmentNotificationService,
  dateKeyInTimeZone,
  notificationQueueIds,
} = require("./appointmentNotificationService");

const PURPOSES = new Set(["confirmation", "reminder"]);
const SUCCESS_STATES = new Set(["accepted", "sent", "delivered", "read"]);
const ACTIVE_STATES = new Set(["queued", "processing"]);

function normalizePurpose(value) {
  const purpose = cleanText(value, 40).toLowerCase();
  return PURPOSES.has(purpose) ? purpose : "";
}

function normalizedState(value) {
  return cleanText(value, 80).toLowerCase() || "unknown";
}

function isManualAttempt(entry = {}) {
  return entry.manual === true || cleanText(entry.reason, 160).toLowerCase().startsWith("manual-office-");
}

function isSuccessfulState(value) {
  return SUCCESS_STATES.has(normalizedState(value));
}

function isActiveState(value) {
  return ACTIVE_STATES.has(normalizedState(value));
}

function recipientIdentity(recipient = {}) {
  return cleanText(recipient.id || `${recipient.recipientType || "recipient"}-${recipient.sourceId || "unknown"}`, 180);
}

function hasWhatsApp(recipient = {}) {
  return Boolean(cleanText(recipient.whatsapp || recipient.phone, 80));
}

function queueFallbackRecipients(source = {}) {
  const mapping = new Map();
  const latest = notificationQueueIds(source, { preferLatest: true });
  const recipientIds = Array.isArray(source?.recipientIds) ? source.recipientIds : [];
  latest.forEach((queueId, index) => {
    const recipientId = cleanText(recipientIds[index], 180);
    if (recipientId) mapping.set(queueId, recipientId);
  });
  return mapping;
}

function queueBelongsToRecipient(entry, recipient, singleRecipient = false) {
  const id = recipientIdentity(recipient);
  const sourceId = cleanText(recipient?.sourceId, 180);
  const entryRecipientId = cleanText(entry?.recipientId || entry?.fallbackRecipientId, 180);
  const entrySourceId = cleanText(entry?.recipientSourceId, 180);
  if (entryRecipientId && entryRecipientId === id) return true;
  if (sourceId && entrySourceId && entrySourceId === sourceId) return true;
  return singleRecipient && !entryRecipientId && !entrySourceId;
}

function deriveRecipientPurposeState({ recipient, purpose, queue = [], singleRecipient = false, appointmentDate = "" } = {}) {
  const selectedField = purpose === "confirmation" ? "sendConfirmation" : "sendReminder";
  const selected = recipient?.[selectedField] === true;
  const history = queue.filter((entry) => queueBelongsToRecipient(entry, recipient, singleRecipient));
  const relevant = selected
    ? history
    : history.filter((entry) => isManualAttempt(entry) || isSuccessfulState(entry.status) || isActiveState(entry.status));
  const latest = relevant.length ? relevant[relevant.length - 1] : null;
  const state = latest ? normalizedState(latest.status) : selected ? "not_sent" : "not_requested";
  const appointmentPassed = purpose === "reminder" && cleanText(appointmentDate, 20) && appointmentDate < dateKeyInTimeZone();
  const canSendNow = hasWhatsApp(recipient)
    && !appointmentPassed
    && !isSuccessfulState(state)
    && !isActiveState(state);

  return {
    selected,
    state,
    queueIds: relevant.map((entry) => entry.queueId),
    historyQueueIds: history.map((entry) => entry.queueId),
    lastError: latest && normalizedState(latest.status) === "failed" ? cleanText(latest.errorMessage, 500) : "",
    canSendNow,
    manual: latest ? isManualAttempt(latest) : false,
    reason: latest ? cleanText(latest.reason, 160) : selected ? "selected-no-send-attempt" : "not-requested-by-operator",
    messageId: latest ? cleanText(latest.messageId, 300) : "",
    provider: latest ? cleanText(latest.provider, 40) : "",
    historyAttemptCount: history.length,
  };
}

function aggregatePurpose(recipients, purpose) {
  const states = recipients.map((recipient) => recipient[purpose]);
  const active = states.filter((item) => item.selected || item.state !== "not_requested");
  if (!active.length) {
    return {
      enabled: false,
      state: "not_requested",
      queueIds: [],
      historyQueueIds: states.flatMap((item) => item.historyQueueIds),
      queue: [],
      lastError: "",
      canSendNow: states.some((item) => item.canSendNow),
    };
  }
  const unique = [...new Set(active.map((item) => item.state))];
  const state = unique.length === 1 ? unique[0] : "partial";
  return {
    enabled: states.some((item) => item.selected),
    state,
    queueIds: active.flatMap((item) => item.queueIds),
    historyQueueIds: states.flatMap((item) => item.historyQueueIds),
    queue: [],
    lastError: active.find((item) => item.lastError)?.lastError || "",
    canSendNow: active.some((item) => item.canSendNow),
  };
}

function projectRecipientCommunication({ order = {}, confirmationQueue = [], reminderQueue = [] } = {}) {
  const rawRecipients = Array.isArray(order.notificationRecipients) ? order.notificationRecipients.filter(Boolean) : [];
  const recipients = rawRecipients.map((recipient) => ({
    id: recipientIdentity(recipient),
    recipientType: cleanText(recipient.recipientType, 40) || "recipient",
    sourceId: cleanText(recipient.sourceId, 180),
    name: cleanText(recipient.name, 180) || "Recipient",
    role: cleanText(recipient.role, 120) || "Contact",
    phone: cleanText(recipient.whatsapp || recipient.phone, 80),
    preferredLanguage: cleanText(recipient.preferredLanguage, 80),
    sendConfirmation: recipient.sendConfirmation === true,
    sendReminder: recipient.sendReminder === true,
    confirmation: deriveRecipientPurposeState({
      recipient,
      purpose: "confirmation",
      queue: confirmationQueue,
      singleRecipient: rawRecipients.length === 1,
      appointmentDate: order.date,
    }),
    reminder: deriveRecipientPurposeState({
      recipient,
      purpose: "reminder",
      queue: reminderQueue,
      singleRecipient: rawRecipients.length === 1,
      appointmentDate: order.date,
    }),
  }));
  return {
    recipients,
    confirmation: aggregatePurpose(recipients, "confirmation"),
    reminder: aggregatePurpose(recipients, "reminder"),
  };
}

function communicationError(error) {
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
    body: { success: false, error: { code: "internal_error", message: cleanText(error?.message || error, 500) || "Unexpected appointment communication error.", details: {} } },
  };
}

function createAppointmentCommunicationAuthority({ db, notificationService = null, apiVersion = 12 } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  const notifications = notificationService || createAppointmentNotificationService({ db });

  async function appointmentWorkOrder(appointmentId) {
    const id = cleanText(appointmentId, 180);
    if (!id) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "Appointment id is required.", { field: "appointmentId" });
    const snapshot = await db.collection("workOrders").where("appointmentId", "==", id).get();
    const docs = snapshot.docs || [];
    const primary = docs.find((doc) => cleanText(doc.data()?.appointmentAssignmentRole || doc.data()?.assignmentRole, 40).toLowerCase() !== "support") || docs[0];
    if (!primary) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "No Work Order is linked to this appointment.", { appointmentId: id });
    return { appointmentId: id, primary, order: { id: primary.id, ...(primary.data() || {}) } };
  }

  async function queueEntries(source = {}) {
    const ids = notificationQueueIds(source);
    const fallback = queueFallbackRecipients(source);
    const snapshots = await Promise.all(ids.map((id) => db.collection("whatsappOutboundQueue").doc(id).get()));
    return snapshots.map((snapshot, index) => {
      const value = snapshot.exists ? snapshot.data() || {} : {};
      return {
        queueId: ids[index],
        status: snapshot.exists ? cleanText(value.status, 80) || "unknown" : "missing",
        messageId: cleanText(value.messageId, 300),
        errorMessage: cleanText(value.errorMessage, 500),
        reason: cleanText(value.reason, 160),
        provider: cleanText(value.provider, 40),
        recipientId: cleanText(value.recipientId, 180),
        recipientSourceId: cleanText(value.recipientSourceId, 180),
        fallbackRecipientId: fallback.get(ids[index]) || "",
        manual: value.manual === true,
      };
    });
  }

  async function appointmentCommunication(data = {}) {
    const { appointmentId, primary, order } = await appointmentWorkOrder(data.appointmentId);
    const confirmationSource = order.confirmationNotifications || order.confirmationNotification || {};
    const reminderSource = order.reminderNotifications || order.reminderNotification || {};
    const [confirmationQueue, reminderQueue] = await Promise.all([
      queueEntries(confirmationSource),
      queueEntries(reminderSource),
    ]);
    const projection = projectRecipientCommunication({ order, confirmationQueue, reminderQueue });
    return {
      success: true,
      version: apiVersion,
      appointmentId,
      workOrderId: primary.id,
      whatsappEnabled: order.whatsappNotificationsEnabled === true,
      ...projection,
    };
  }

  async function updateReminderPreference(data = {}, identity = {}) {
    const recipientId = cleanText(data.recipientId, 180);
    if (!recipientId || typeof data.enabled !== "boolean") {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "recipientId and boolean enabled are required.", { field: "recipientId" });
    }
    const { appointmentId, primary, order } = await appointmentWorkOrder(data.appointmentId);
    const recipients = Array.isArray(order.notificationRecipients) ? order.notificationRecipients.map((recipient) => ({ ...recipient })) : [];
    const index = recipients.findIndex((recipient) => recipientIdentity(recipient) === recipientId);
    if (index < 0) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "The selected communication recipient is not part of this appointment.", { appointmentId, recipientId });
    if (data.enabled && !hasWhatsApp(recipients[index])) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "The selected recipient has no WhatsApp number.", { appointmentId, recipientId });
    recipients[index].sendReminder = data.enabled;
    const whatsappNotificationsEnabled = recipients.some((recipient) => (recipient.sendConfirmation === true || recipient.sendReminder === true) && hasWhatsApp(recipient));
    const now = new Date().toISOString();
    await primary.ref.set({
      notificationRecipients: recipients,
      whatsappNotificationsEnabled,
      notificationPreferenceUpdatedAt: now,
      notificationPreferenceUpdatedBy: cleanText(identity.uid, 160),
      updatedAt: now,
    }, { merge: true });

    if (!data.enabled) {
      const current = await appointmentCommunication({ appointmentId });
      const target = current.recipients.find((recipient) => recipient.id === recipientId);
      for (const queueId of target?.reminder?.queueIds || []) {
        const ref = db.collection("whatsappOutboundQueue").doc(queueId);
        const snapshot = await ref.get();
        if (snapshot.exists && normalizedState(snapshot.data()?.status) === "queued") {
          await ref.set({ status: "cancelled", cancelledAt: now, cancelledBy: cleanText(identity.uid, 160), cancellationReason: "appointment-reminder-recipient-disabled" }, { merge: true });
        }
      }
    }
    return appointmentCommunication({ appointmentId });
  }

  async function sendManualCommunication(data = {}, identity = {}) {
    const purpose = normalizePurpose(data.purpose);
    const recipientId = cleanText(data.recipientId, 180);
    const requestId = cleanText(data.requestId, 240);
    if (!purpose || !recipientId || requestId.length < 8) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "purpose, recipientId, and a stable requestId are required.", { field: "purpose" });
    }
    const { appointmentId, order } = await appointmentWorkOrder(data.appointmentId);
    const current = await appointmentCommunication({ appointmentId });
    const currentRecipient = current.recipients.find((recipient) => recipient.id === recipientId);
    if (!currentRecipient) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "The selected communication recipient is not part of this appointment.", { appointmentId, recipientId });
    const currentPurpose = currentRecipient[purpose];
    if (!currentPurpose.canSendNow) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, `This ${purpose} cannot be sent now.`, { appointmentId, recipientId, state: currentPurpose.state });
    }
    if (purpose === "reminder" && cleanText(order.date, 20) && order.date < dateKeyInTimeZone()) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "A reminder cannot be sent for an appointment date that has already passed.", { appointmentId, appointmentDate: order.date });
    }
    const originalRecipients = Array.isArray(order.notificationRecipients) ? order.notificationRecipients : [];
    const target = originalRecipients.find((recipient) => recipientIdentity(recipient) === recipientId);
    if (!target || !hasWhatsApp(target)) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "The selected recipient has no WhatsApp number.", { appointmentId, recipientId });
    const manualRecipient = {
      ...target,
      sendConfirmation: purpose === "confirmation",
      sendReminder: purpose === "reminder",
    };
    const manualOrder = { ...order, notificationRecipients: [manualRecipient], whatsappNotificationsEnabled: true };
    const reason = `manual-office-${purpose}`;
    const eventId = `manual-${requestId}`;
    const result = purpose === "confirmation"
      ? await notifications.queueConfirmationForOrder({ order: manualOrder, eventId, reason, changedFields: [] })
      : await notifications.queueReminderForOrder({
        order: manualOrder,
        eventId,
        reason,
        targetDate: order.date,
        requestedById: cleanText(identity.uid, 160),
        requestedByName: cleanText(identity.name || identity.email, 180),
        manual: true,
      });
    if (!result?.queued) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, `The ${purpose} could not be queued.`, { appointmentId, recipientId, reason: result?.reason || "not-queued" });
    const now = new Date().toISOString();
    await Promise.all((result.notifications || []).map((notification) => db.collection("whatsappOutboundQueue").doc(notification.queueId).set({
      manual: true,
      requestedById: cleanText(identity.uid, 160),
      requestedByName: cleanText(identity.name || identity.email, 180),
      manualRequestedAt: now,
    }, { merge: true })));
    return appointmentCommunication({ appointmentId });
  }

  async function execute({ action, data = {}, identity = {} } = {}) {
    if (action === "get_appointment_communication") return appointmentCommunication(data);
    if (action === "update_appointment_communication") return updateReminderPreference(data, identity);
    if (action === "send_appointment_communication") return sendManualCommunication(data, identity);
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "Unsupported appointment communication action.", { action: cleanText(action, 120) });
  }

  return {
    appointmentCommunication,
    execute,
    sendManualCommunication,
    updateReminderPreference,
  };
}

module.exports.ACTIVE_STATES = ACTIVE_STATES;
module.exports.PURPOSES = PURPOSES;
module.exports.SUCCESS_STATES = SUCCESS_STATES;
module.exports.aggregatePurpose = aggregatePurpose;
module.exports.communicationError = communicationError;
module.exports.createAppointmentCommunicationAuthority = createAppointmentCommunicationAuthority;
module.exports.deriveRecipientPurposeState = deriveRecipientPurposeState;
module.exports.isManualAttempt = isManualAttempt;
module.exports.projectRecipientCommunication = projectRecipientCommunication;
module.exports.recipientIdentity = recipientIdentity;
