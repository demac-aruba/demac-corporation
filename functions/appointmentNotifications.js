const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");

const db = getFirestore();

const REGION = "us-central1";
const TIME_ZONE = "America/Aruba";
const DEFAULT_PHONE_NUMBER_ID = "1264611476725499";
const DEFAULT_CLOSED_WEEKDAYS = [0];
const REMINDER_SEARCH_DAYS = 60;
const CUSTOMER_VISIBLE_FIELDS = ["date", "time", "address", "problem", "serviceId", "propertyId"];
const CONFIRMATION_INELIGIBLE_STATUSES = new Set(["Solicitud recibida", "Reserva temporal", "Cancelada", "Reprogramada", "Completada", "Facturada", "Pagada"]);

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function safeDocumentId(value) {
  return String(value || "unknown")
    .replaceAll("/", "_")
    .replaceAll("#", "_")
    .slice(0, 1200);
}

function isAlreadyExistsError(error) {
  return error?.code === 6 || error?.code === "already-exists" || error?.code === "ALREADY_EXISTS";
}

function dateKeyInTimeZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekdayForDate(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function normalizePreferredLanguage(value) {
  const language = String(value || "unknown").trim().toLowerCase();
  if (["pap", "papiamento"].includes(language)) return "pap";
  if (["es", "spa", "spanish", "español", "espanol"].includes(language)) return "es";
  if (["nl", "dut", "dutch", "nederlands", "neerlandés", "neerlandes"].includes(language)) return "nl";
  if (["en", "eng", "english", "inglés", "ingles"].includes(language)) return "en";
  return "unknown";
}

function templateLanguageForRecipient(recipient, client) {
  const explicit = String(recipient?.templateLanguage || "").trim().toLowerCase();
  if (["en", "es", "nl"].includes(explicit)) return explicit;

  const recipientPreferred = normalizePreferredLanguage(recipient?.preferredLanguage);
  if (recipientPreferred === "es") return "es";
  if (recipientPreferred === "nl") return "nl";
  if (recipientPreferred === "en") return "en";

  const clientExplicit = String(client?.templateLanguage || "").trim().toLowerCase();
  if (["en", "es", "nl"].includes(clientExplicit)) return clientExplicit;

  const clientPreferred = normalizePreferredLanguage(client?.preferredLanguage);
  if (clientPreferred === "es") return "es";
  if (clientPreferred === "nl") return "nl";
  return "en";
}

function localeForLanguage(languageCode) {
  if (languageCode === "es") return "es-ES";
  if (languageCode === "nl") return "nl-NL";
  return "en-US";
}

function formatAppointmentDate(dateKey, languageCode) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat(localeForLanguage(languageCode), {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatAppointmentTime(value, languageCode) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(value || "");

  const hour = Number(match[1]);
  const minute = match[2];
  if (languageCode === "nl") return `${String(hour).padStart(2, "0")}:${minute}`;

  const suffix = hour >= 12 ? (languageCode === "es" ? "p. m." : "PM") : (languageCode === "es" ? "a. m." : "AM");
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function orderCanNotify(order) {
  return order
    && !CONFIRMATION_INELIGIBLE_STATUSES.has(order.status)
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

async function getWhatsAppPhoneNumberId() {
  const settings = await db.collection("businessSettings").doc("whatsapp").get();
  const configured = digitsOnly(settings.data()?.phoneNumberId);
  return configured || DEFAULT_PHONE_NUMBER_ID;
}

async function getClient(clientId) {
  if (!clientId) return null;
  const snapshot = await db.collection("clients").doc(clientId).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function getServiceDescription(order) {
  if (String(order.problem || "").trim()) return String(order.problem).trim();
  if (!order.serviceId) return "Air conditioning service";
  const service = await db.collection("services").doc(order.serviceId).get();
  return String(service.data()?.name || "Air conditioning service").trim();
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
    const to = digitsOnly(recipient?.whatsapp || recipient?.phone);
    if (seenNumbers.has(to)) continue;
    seenNumbers.add(to);
    unique.push(recipient);
  }
  return unique;
}

async function buildTemplateParameters(order, client, recipient, languageCode) {
  return [
    String(recipient?.name || client.name || client.company || "Customer").trim(),
    formatAppointmentDate(order.date, languageCode),
    formatAppointmentTime(order.time, languageCode),
    String(order.address || client.address || "").trim(),
    await getServiceDescription(order),
  ];
}

async function createQueueItem(queueId, data) {
  const reference = db.collection("whatsappOutboundQueue").doc(queueId);
  try {
    await reference.create({
      ...data,
      status: "queued",
      createdAt: FieldValue.serverTimestamp(),
    });
    return { created: true, reference };
  } catch (error) {
    if (isAlreadyExistsError(error)) return { created: false, reference };
    throw error;
  }
}

async function queueAppointmentMessage({
  order,
  client,
  recipient,
  eventId,
  templateName,
  notificationType,
  reason,
}) {
  const to = digitsOnly(recipient?.whatsapp || recipient?.phone);
  if (!/^\d{8,15}$/.test(to)) {
    logger.warn("Skipping appointment notification because a selected recipient has no valid WhatsApp number.", {
      clientId: client.id,
      workOrderId: order.id,
      recipientId: recipient?.id || recipient?.sourceId || null,
      recipientName: recipient?.name || null,
    });
    return null;
  }

  const languageCode = templateLanguageForRecipient(recipient, client);
  const phoneNumberId = await getWhatsAppPhoneNumberId();
  const bodyParameters = await buildTemplateParameters(order, client, recipient, languageCode);
  const recipientKey = recipient?.id || recipient?.sourceId || to;
  const queueId = safeDocumentId(`${notificationType}-${order.id}-${eventId}-${recipientKey}`);
  const result = await createQueueItem(queueId, {
    to,
    phoneNumberId,
    templateName,
    languageCode,
    bodyParameters,
    clientId: client.id,
    workOrderId: order.id,
    notificationType,
    reason,
    recipientId: recipient?.id || null,
    recipientSourceId: recipient?.sourceId || null,
    recipientType: recipient?.recipientType || "client",
    recipientName: recipient?.name || client.name || null,
    recipientRole: recipient?.role || null,
  });

  return {
    queueId,
    languageCode,
    recipientId: recipient?.id || null,
    recipientName: recipient?.name || client.name || "Customer",
    created: result.created,
  };
}

async function queueAppointmentMessages({
  order,
  client,
  recipients,
  eventId,
  templateName,
  notificationType,
  reason,
}) {
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
    });
    if (notification) notifications.push(notification);
  }
  return notifications;
}

exports.queueAppointmentConfirmation = onDocumentWritten(
  {
    document: "workOrders/{workOrderId}",
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    const beforeSnapshot = event.data?.before;
    const afterSnapshot = event.data?.after;
    if (!afterSnapshot?.exists) return;

    const before = beforeSnapshot?.exists ? beforeSnapshot.data() : null;
    const order = { id: afterSnapshot.id, ...afterSnapshot.data() };
    const created = !beforeSnapshot?.exists;
    const changedFields = created ? CUSTOMER_VISIBLE_FIELDS : customerVisibleChanges(before, order);
    const becameConfirmed = !confirmationEligible(before) && confirmationEligible(order);

    if (!confirmationEligible(order)) return;
    if (!created && !becameConfirmed && changedFields.length === 0) return;

    const client = await getClient(order.clientId);
    if (!client) {
      logger.warn("Skipping appointment confirmation because the client could not be found.", {
        clientId: order.clientId,
        workOrderId: order.id,
      });
      return;
    }

    const recipients = selectedRecipients(order, client, "confirmation");
    if (recipients.length === 0) {
      logger.info("Appointment confirmation has no selected recipients.", { workOrderId: order.id });
      return;
    }

    const reason = created ? "appointment-created" : becameConfirmed ? "appointment-confirmed" : "appointment-updated";
    const notifications = await queueAppointmentMessages({
      order,
      client,
      recipients,
      eventId: event.id,
      templateName: "appointment_confirmation",
      notificationType: "appointment-confirmation",
      reason,
    });

    if (notifications.length === 0) return;

    await afterSnapshot.ref.set({
      confirmationNotifications: {
        queueIds: notifications.map((notification) => notification.queueId),
        languageCodes: notifications.map((notification) => notification.languageCode),
        recipientIds: notifications.map((notification) => notification.recipientId),
        recipientNames: notifications.map((notification) => notification.recipientName),
        recipientCount: notifications.length,
        reason,
        changedFields,
        queuedAt: FieldValue.serverTimestamp(),
      },
      confirmationNotification: {
        queueId: notifications[0].queueId,
        languageCode: notifications[0].languageCode,
        reason,
        changedFields,
        queuedAt: FieldValue.serverTimestamp(),
      },
    }, { merge: true });
  },
);

exports.sendDailyAppointmentReminders = onSchedule(
  {
    schedule: "0 10 * * *",
    timeZone: TIME_ZONE,
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 300,
  },
  async () => {
    const runDate = dateKeyInTimeZone();
    const firstCandidate = addDays(runDate, 1);
    const lastCandidate = addDays(runDate, REMINDER_SEARCH_DAYS);

    const [calendarSettings, closuresSnapshot, ordersSnapshot] = await Promise.all([
      db.collection("businessSettings").doc("business-calendar").get(),
      db.collection("calendarClosures")
        .where("date", ">=", firstCandidate)
        .where("date", "<=", lastCandidate)
        .get(),
      db.collection("workOrders")
        .where("date", ">=", firstCandidate)
        .where("date", "<=", lastCandidate)
        .get(),
    ]);

    const closedWeekdays = Array.isArray(calendarSettings.data()?.closedWeekdays)
      ? calendarSettings.data().closedWeekdays.map(Number)
      : DEFAULT_CLOSED_WEEKDAYS;
    const closedDates = new Set(
      closuresSnapshot.docs
        .filter((document) => document.data().active !== false)
        .map((document) => document.data().date),
    );
    const ordersByDate = new Map();

    for (const document of ordersSnapshot.docs) {
      const order = { id: document.id, ...document.data() };
      if (!reminderEligible(order)) continue;
      if (!ordersByDate.has(order.date)) ordersByDate.set(order.date, []);
      ordersByDate.get(order.date).push(order);
    }

    let targetDate = null;
    let targetOrders = [];
    for (let offset = 1; offset <= REMINDER_SEARCH_DAYS; offset += 1) {
      const candidate = addDays(runDate, offset);
      if (closedWeekdays.includes(weekdayForDate(candidate)) || closedDates.has(candidate)) continue;
      const candidateOrders = ordersByDate.get(candidate) || [];
      if (candidateOrders.length > 0) {
        targetDate = candidate;
        targetOrders = candidateOrders;
        break;
      }
    }

    if (!targetDate) {
      logger.info("No future open date with appointments was found for the reminder run.", { runDate });
      return;
    }

    const reminderBatch = db.collection("reminderBatches").doc(targetDate);
    const existingBatch = await reminderBatch.get();
    if (existingBatch.exists && existingBatch.data()?.status === "complete") {
      logger.info("Appointment reminders for the next open appointment date were already processed.", {
        runDate,
        targetDate,
      });
      return;
    }

    await reminderBatch.set({
      runDate,
      targetDate,
      status: "processing",
      appointmentCount: targetOrders.length,
      startedAt: existingBatch.data()?.startedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    let queuedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const order of targetOrders) {
      try {
        const client = await getClient(order.clientId);
        if (!client) {
          skippedCount += 1;
          errors.push({ workOrderId: order.id, reason: "client-not-found" });
          continue;
        }

        const recipients = selectedRecipients(order, client, "reminder");
        if (recipients.length === 0) {
          skippedCount += 1;
          errors.push({ workOrderId: order.id, reason: "no-reminder-recipients" });
          continue;
        }

        const notifications = await queueAppointmentMessages({
          order,
          client,
          recipients,
          eventId: targetDate,
          templateName: "appointment_reminder_24_hours",
          notificationType: "appointment-reminder",
          reason: "daily-next-open-day-reminder",
        });

        if (notifications.length === 0) {
          skippedCount += 1;
          errors.push({ workOrderId: order.id, reason: "invalid-whatsapp-number" });
          continue;
        }

        queuedCount += notifications.filter((notification) => notification.created).length;
        await db.collection("workOrders").doc(order.id).set({
          reminderNotifications: {
            queueIds: notifications.map((notification) => notification.queueId),
            languageCodes: notifications.map((notification) => notification.languageCode),
            recipientIds: notifications.map((notification) => notification.recipientId),
            recipientNames: notifications.map((notification) => notification.recipientName),
            recipientCount: notifications.length,
            targetDate,
            queuedAt: FieldValue.serverTimestamp(),
          },
          reminderNotification: {
            queueId: notifications[0].queueId,
            languageCode: notifications[0].languageCode,
            targetDate,
            queuedAt: FieldValue.serverTimestamp(),
          },
        }, { merge: true });
      } catch (error) {
        skippedCount += 1;
        errors.push({
          workOrderId: order.id,
          reason: error instanceof Error ? error.message : String(error),
        });
        logger.error("Could not queue an appointment reminder.", {
          workOrderId: order.id,
          error,
        });
      }
    }

    await reminderBatch.set({
      status: "complete",
      queuedCount,
      skippedCount,
      errors,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    logger.info("Daily appointment reminder batch completed.", {
      runDate,
      targetDate,
      appointmentCount: targetOrders.length,
      queuedCount,
      skippedCount,
    });
  },
);
