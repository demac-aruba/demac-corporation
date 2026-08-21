const { FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const {
  DEFAULT_CLOSED_WEEKDAYS,
  DEFAULT_SEARCH_DAYS,
  TIME_ZONE,
  addDays,
  dateKeyInTimeZone,
  nextOpenBusinessDate,
  weekdayForDate,
} = require("./operatingCalendarService");
const {
  formatAppointmentDate,
  formatAppointmentTime,
  localizeServiceDescription,
  renderAppointmentText,
  templateLanguageForRecipient,
} = require("./appointmentCommunicationRenderer");
const {
  createWhatsAppTransactionalService,
  digitsOnly,
  normalizeWhatsAppPhone,
  safeDocumentId,
} = require("./whatsappTransactionalService");

const REMINDER_SEARCH_DAYS = DEFAULT_SEARCH_DAYS;
const CUSTOMER_VISIBLE_FIELDS = Object.freeze(["date", "time", "address", "problem", "serviceId", "propertyId"]);
const NOTIFICATION_INELIGIBLE_STATUSES = new Set([
  "Solicitud recibida",
  "Reserva temporal",
  "Cancelada",
  "Reprogramada",
  "Completada",
  "Facturada",
  "Pagada",
]);

function orderCanNotify(order) {
  return Boolean(order)
    && !NOTIFICATION_INELIGIBLE_STATUSES.has(order.status)
    && order.whatsappNotificationsEnabled !== false;
}

function configuredRecipients(order) {
  return Array.isArray(order?.notificationRecipients) ? order.notificationRecipients : [];
}

function confirmationEligible(order) {
  if (!orderCanNotify(order)) return false;
  const recipients = configuredRecipients(order);
  return recipients.length === 0 || recipients.some((recipient) => recipient?.sendConfirmation === true);
}

function reminderEligible(order) {
  if (!orderCanNotify(order)) return false;
  const recipients = configuredRecipients(order);
  return recipients.length === 0 || recipients.some((recipient) => recipient?.sendReminder === true);
}

function customerVisibleChanges(before, after) {
  return CUSTOMER_VISIBLE_FIELDS.filter((field) => (before?.[field] ?? null) !== (after?.[field] ?? null));
}

function notificationQueueIds(value, { preferLatest = false } = {}) {
  const latest = Array.isArray(value?.latestQueueIds) ? value.latestQueueIds : [];
  const all = Array.isArray(value?.queueIds) ? value.queueIds : value?.queueId ? [value.queueId] : [];
  const source = preferLatest && latest.length ? latest : all;
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))].slice(-50);
}

function mergeQueueIds(existing, latest) {
  return [...new Set([...notificationQueueIds(existing), ...latest].filter(Boolean))].slice(-50);
}

function legacyClientRecipient(client, notificationType) {
  return {
    id: `client-${client.id}`,
    recipientType: "client",
    sourceId: client.id,
    name: client.name || client.company || "Customer",
    role: "Cliente / facturación",
    phone: client.phone || "",
    whatsapp: client.whatsapp || client.phone || "",
    preferredLanguage: client.preferredLanguage,
    templateLanguage: client.templateLanguage,
    sendConfirmation: notificationType === "confirmation",
    sendReminder: notificationType === "reminder",
  };
}

function selectedRecipients(order, client, notificationType) {
  const recipients = configuredRecipients(order);
  const selected = recipients.length
    ? recipients.filter((recipient) => notificationType === "confirmation"
      ? recipient?.sendConfirmation === true
      : recipient?.sendReminder === true)
    : [legacyClientRecipient(client, notificationType)];

  const unique = [];
  const seenNumbers = new Set();
  for (const recipient of selected) {
    const to = normalizeWhatsAppPhone(recipient?.whatsapp || recipient?.phone);
    if (!to || seenNumbers.has(to)) continue;
    seenNumbers.add(to);
    unique.push(recipient);
  }
  return unique;
}

function createAppointmentNotificationService({ db } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required for appointment notifications.");
  const whatsapp = createWhatsAppTransactionalService({ db });

  async function getClient(clientId) {
    if (!clientId) return null;
    const snapshot = await db.collection("clients").doc(clientId).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  }

  async function getServiceDescription(order, languageCode) {
    let fallback = String(order.problem || "").trim();
    if (!fallback && order.serviceId) {
      const service = await db.collection("services").doc(order.serviceId).get();
      fallback = String(service.data()?.name || "").trim();
    }
    if (!fallback) fallback = languageCode === "es" ? "Servicio de aire acondicionado" : languageCode === "pap" ? "Servicio di airco" : languageCode === "nl" ? "Aircoservice" : "Air conditioning service";
    return localizeServiceDescription(order, fallback, languageCode) || fallback;
  }

  async function buildTemplateParameters(order, client, recipient, languageCode) {
    return [
      String(recipient?.name || client.name || client.company || "Customer").trim(),
      formatAppointmentDate(order.date, languageCode),
      formatAppointmentTime(order.time, languageCode),
      String(order.address || client.address || "").trim(),
      await getServiceDescription(order, languageCode),
    ];
  }

  async function queueAppointmentMessage({ order, client, recipient, eventId, templateName, notificationType, reason, requestedById, requestedByName }) {
    const to = recipient?.whatsapp || recipient?.phone;
    const languageCode = templateLanguageForRecipient(recipient, client);
    const bodyParameters = await buildTemplateParameters(order, client, recipient, languageCode);
    const recipientKey = recipient?.id || recipient?.sourceId || normalizeWhatsAppPhone(to);
    const queueId = safeDocumentId(`${notificationType}-${order.id}-${eventId}-${recipientKey}`);
    const result = await whatsapp.queueTransactionalMessage({
      queueId,
      to,
      text: renderAppointmentText(notificationType, bodyParameters, languageCode),
      templateName,
      languageCode,
      bodyParameters,
      metadata: {
        clientId: client.id,
        appointmentId: order.appointmentId || null,
        workOrderId: order.id,
        notificationType,
        reason,
        recipientId: recipient?.id || null,
        recipientSourceId: recipient?.sourceId || null,
        recipientType: recipient?.recipientType || "client",
        recipientName: recipient?.name || client.name || null,
        recipientRole: recipient?.role || null,
        preferredLanguage: recipient?.preferredLanguage || client?.preferredLanguage || null,
        languageCode,
        requestedById: requestedById || null,
        requestedByName: requestedByName || null,
      },
    });

    if (!result.queued) {
      logger.warn("Skipping appointment notification because a selected recipient has no valid WhatsApp number.", {
        clientId: client.id,
        workOrderId: order.id,
        recipientId: recipient?.id || recipient?.sourceId || null,
        recipientName: recipient?.name || null,
      });
      return null;
    }

    return {
      queueId: result.queueId,
      languageCode,
      provider: result.provider,
      recipientId: recipient?.id || null,
      recipientName: recipient?.name || client.name || "Customer",
      created: result.created,
    };
  }

  async function queueAppointmentMessages({ order, client, recipients, eventId, templateName, notificationType, reason, requestedById, requestedByName }) {
    const notifications = [];
    for (const recipient of recipients) {
      const notification = await queueAppointmentMessage({
        order,
        client,
        recipient,
        eventId,
        templateName,
        notificationType,
        reason,
        requestedById,
        requestedByName,
      });
      if (notification) notifications.push(notification);
    }
    return notifications;
  }

  async function queueConfirmationForOrder({ order, eventId, reason, changedFields = [] }) {
    if (!confirmationEligible(order)) return { queued: false, reason: "confirmation-not-eligible", notifications: [] };
    const client = await getClient(order.clientId);
    if (!client) return { queued: false, reason: "client-not-found", notifications: [] };
    const recipients = selectedRecipients(order, client, "confirmation");
    if (!recipients.length) return { queued: false, reason: "no-confirmation-recipients", notifications: [] };
    const notifications = await queueAppointmentMessages({
      order,
      client,
      recipients,
      eventId,
      templateName: "appointment_confirmation",
      notificationType: "appointment-confirmation",
      reason,
    });
    if (!notifications.length) return { queued: false, reason: "invalid-whatsapp-number", notifications: [] };

    const latestQueueIds = notifications.map((notification) => notification.queueId);
    await db.collection("workOrders").doc(order.id).set({
      confirmationNotifications: {
        queueIds: mergeQueueIds(order.confirmationNotifications || order.confirmationNotification, latestQueueIds),
        latestQueueIds,
        languageCodes: notifications.map((notification) => notification.languageCode),
        providers: notifications.map((notification) => notification.provider),
        recipientIds: notifications.map((notification) => notification.recipientId),
        recipientNames: notifications.map((notification) => notification.recipientName),
        recipientCount: notifications.length,
        reason,
        changedFields,
        queuedAt: FieldValue.serverTimestamp(),
      },
      confirmationNotification: {
        queueId: latestQueueIds[0],
        languageCode: notifications[0].languageCode,
        provider: notifications[0].provider,
        reason,
        changedFields,
        queuedAt: FieldValue.serverTimestamp(),
      },
    }, { merge: true });
    return { queued: true, reason, notifications };
  }

  async function queueReminderForOrder({ order, eventId, reason, targetDate = order?.date, requestedById = null, requestedByName = null, manual = false }) {
    if (!reminderEligible(order)) return { queued: false, reason: "reminder-not-eligible", notifications: [] };
    const client = await getClient(order.clientId);
    if (!client) return { queued: false, reason: "client-not-found", notifications: [] };
    const recipients = selectedRecipients(order, client, "reminder");
    if (!recipients.length) return { queued: false, reason: "no-reminder-recipients", notifications: [] };
    const notifications = await queueAppointmentMessages({
      order,
      client,
      recipients,
      eventId,
      templateName: "appointment_reminder_24_hours",
      notificationType: "appointment-reminder",
      reason,
      requestedById,
      requestedByName,
    });
    if (!notifications.length) return { queued: false, reason: "invalid-whatsapp-number", notifications: [] };

    const latestQueueIds = notifications.map((notification) => notification.queueId);
    await db.collection("workOrders").doc(order.id).set({
      reminderNotifications: {
        queueIds: mergeQueueIds(order.reminderNotifications || order.reminderNotification, latestQueueIds),
        latestQueueIds,
        languageCodes: notifications.map((notification) => notification.languageCode),
        providers: notifications.map((notification) => notification.provider),
        recipientIds: notifications.map((notification) => notification.recipientId),
        recipientNames: notifications.map((notification) => notification.recipientName),
        recipientCount: notifications.length,
        targetDate,
        reason,
        manual,
        requestedById,
        requestedByName,
        queuedAt: FieldValue.serverTimestamp(),
      },
      reminderNotification: {
        queueId: latestQueueIds[0],
        languageCode: notifications[0].languageCode,
        provider: notifications[0].provider,
        targetDate,
        reason,
        manual,
        queuedAt: FieldValue.serverTimestamp(),
      },
    }, { merge: true });
    return { queued: true, reason, notifications };
  }

  return {
    queueConfirmationForOrder,
    queueReminderForOrder,
  };
}

module.exports.CUSTOMER_VISIBLE_FIELDS = CUSTOMER_VISIBLE_FIELDS;
module.exports.DEFAULT_CLOSED_WEEKDAYS = DEFAULT_CLOSED_WEEKDAYS;
module.exports.REMINDER_SEARCH_DAYS = REMINDER_SEARCH_DAYS;
module.exports.TIME_ZONE = TIME_ZONE;
module.exports.addDays = addDays;
module.exports.confirmationEligible = confirmationEligible;
module.exports.createAppointmentNotificationService = createAppointmentNotificationService;
module.exports.customerVisibleChanges = customerVisibleChanges;
module.exports.dateKeyInTimeZone = dateKeyInTimeZone;
module.exports.digitsOnly = digitsOnly;
module.exports.formatAppointmentDate = formatAppointmentDate;
module.exports.formatAppointmentTime = formatAppointmentTime;
module.exports.nextOpenBusinessDate = nextOpenBusinessDate;
module.exports.notificationQueueIds = notificationQueueIds;
module.exports.reminderEligible = reminderEligible;
module.exports.renderAppointmentText = renderAppointmentText;
module.exports.selectedRecipients = selectedRecipients;
module.exports.templateLanguageForRecipient = templateLanguageForRecipient;
module.exports.weekdayForDate = weekdayForDate;