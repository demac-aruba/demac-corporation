const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { defineSecret } = require('firebase-functions/params');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');

const db = getFirestore();
const whatsappAccessToken = defineSecret('WHATSAPP_ACCESS_TOKEN');

const REGION = 'us-central1';
const TIME_ZONE = 'America/Aruba';
const OFFICIAL_DISPLAY_PHONE = '+297 564-2625';
const DEFAULT_PHONE_NUMBER_ID = '1264611476725499';
const DEFAULT_GRAPH_API_VERSION = 'v25.0';
const CUSTOMER_VISIBLE_FIELDS = ['date', 'time', 'address', 'problem', 'serviceId', 'propertyId'];
const INELIGIBLE_STATUSES = new Set([
  'Solicitud recibida',
  'Reserva temporal',
  'Cancelada',
  'Reprogramada',
  'Completada',
  'Facturada',
  'Pagada',
]);

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function safeDocumentId(value) {
  return String(value || 'unknown')
    .replaceAll('/', '_')
    .replaceAll('#', '_')
    .slice(0, 1200);
}

function isAlreadyExistsError(error) {
  return error?.code === 6 || error?.code === 'already-exists' || error?.code === 'ALREADY_EXISTS';
}

function cleanTemplateName(value, fallback) {
  const candidate = String(value || '').trim();
  return /^[a-z0-9_]{1,512}$/.test(candidate) ? candidate : fallback;
}

function cleanGraphVersion(value) {
  const candidate = String(value || '').trim();
  return /^v\d+\.\d+$/.test(candidate) ? candidate : DEFAULT_GRAPH_API_VERSION;
}

function dateKeyInTimeZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function normalizePreferredLanguage(value) {
  const language = String(value || 'unknown').trim().toLowerCase();
  if (['pap', 'papiamento'].includes(language)) return 'pap';
  if (['es', 'spa', 'spanish', 'español', 'espanol'].includes(language)) return 'es';
  if (['nl', 'dut', 'dutch', 'nederlands', 'neerlandés', 'neerlandes'].includes(language)) return 'nl';
  if (['en', 'eng', 'english', 'inglés', 'ingles'].includes(language)) return 'en';
  return 'unknown';
}

function localeForLanguage(languageCode) {
  if (languageCode === 'es') return 'es-ES';
  if (languageCode === 'nl') return 'nl-NL';
  return 'en-US';
}

function formatAppointmentDate(dateKey, languageCode) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat(localeForLanguage(languageCode), {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function formatAppointmentTime(value, languageCode) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(value || '');
  const hour = Number(match[1]);
  const minute = match[2];
  if (languageCode === 'nl') return `${String(hour).padStart(2, '0')}:${minute}`;
  const suffix = hour >= 12
    ? (languageCode === 'es' ? 'p. m.' : 'PM')
    : (languageCode === 'es' ? 'a. m.' : 'AM');
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

async function getWhatsAppSettings() {
  const snapshot = await db.collection('businessSettings').doc('whatsapp').get();
  const data = snapshot.exists ? snapshot.data() : {};
  return {
    enabled: data?.enabled !== false,
    displayPhoneNumber: String(data?.displayPhoneNumber || OFFICIAL_DISPLAY_PHONE).trim(),
    phoneNumberId: digitsOnly(data?.phoneNumberId) || DEFAULT_PHONE_NUMBER_ID,
    confirmationTemplateName: cleanTemplateName(data?.confirmationTemplateName, 'appointment_confirmation'),
    appointmentReminderTemplateName: cleanTemplateName(data?.appointmentReminderTemplateName, 'appointment_reminder_24_hours'),
    papiamentoTemplateLanguage: ['en', 'es', 'nl', 'pap'].includes(String(data?.papiamentoTemplateLanguage || '').toLowerCase())
      ? String(data.papiamentoTemplateLanguage).toLowerCase()
      : 'en',
    graphApiVersion: cleanGraphVersion(data?.graphApiVersion),
  };
}

function templateLanguageForRecipient(recipient, client, settings) {
  const explicit = String(recipient?.templateLanguage || '').trim().toLowerCase();
  if (['en', 'es', 'nl'].includes(explicit)) return explicit;

  const recipientPreferred = normalizePreferredLanguage(recipient?.preferredLanguage);
  if (recipientPreferred === 'pap') return settings.papiamentoTemplateLanguage;
  if (['es', 'nl', 'en'].includes(recipientPreferred)) return recipientPreferred;

  const clientExplicit = String(client?.templateLanguage || '').trim().toLowerCase();
  if (['en', 'es', 'nl'].includes(clientExplicit)) return clientExplicit;

  const clientPreferred = normalizePreferredLanguage(client?.preferredLanguage);
  if (clientPreferred === 'pap') return settings.papiamentoTemplateLanguage;
  if (clientPreferred === 'es') return 'es';
  if (clientPreferred === 'nl') return 'nl';
  return 'en';
}

function orderCanNotify(order, settings) {
  return settings.enabled
    && order
    && !INELIGIBLE_STATUSES.has(order.status)
    && order.whatsappNotificationsEnabled !== false;
}

function configuredRecipients(order) {
  return Array.isArray(order?.notificationRecipients) ? order.notificationRecipients : [];
}

function notificationEligible(order, settings, field) {
  if (!orderCanNotify(order, settings)) return false;
  const recipients = configuredRecipients(order);
  return recipients.length === 0 || recipients.some((recipient) => recipient?.[field] === true);
}

function customerVisibleChanges(before, after) {
  return CUSTOMER_VISIBLE_FIELDS.filter((field) => (before?.[field] ?? null) !== (after?.[field] ?? null));
}

async function getClient(clientId) {
  if (!clientId) return null;
  const snapshot = await db.collection('clients').doc(clientId).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function getServiceDescription(order) {
  if (String(order.problem || '').trim()) return String(order.problem).trim();
  if (!order.serviceId) return 'Air conditioning service';
  const service = await db.collection('services').doc(order.serviceId).get();
  return String(service.data()?.name || 'Air conditioning service').trim();
}

function legacyClientRecipient(client, notificationType) {
  return {
    id: `client-${client.id}`,
    recipientType: 'client',
    sourceId: client.id,
    name: client.name || client.company || 'Customer',
    role: 'Cliente / facturación',
    phone: client.phone || '',
    whatsapp: client.whatsapp || client.phone || '',
    preferredLanguage: client.preferredLanguage,
    templateLanguage: client.templateLanguage,
    sendConfirmation: notificationType === 'confirmation',
    sendReminder: notificationType === 'reminder',
  };
}

function selectedRecipients(order, client, notificationType) {
  const recipients = configuredRecipients(order);
  const selected = recipients.length
    ? recipients.filter((recipient) => notificationType === 'confirmation'
      ? recipient?.sendConfirmation === true
      : recipient?.sendReminder === true)
    : [legacyClientRecipient(client, notificationType)];

  const unique = [];
  const seenNumbers = new Set();
  for (const recipient of selected) {
    const to = digitsOnly(recipient?.whatsapp || recipient?.phone);
    if (!to || seenNumbers.has(to)) continue;
    seenNumbers.add(to);
    unique.push(recipient);
  }
  return unique;
}

async function buildTemplateParameters(order, client, recipient, languageCode) {
  return [
    String(recipient?.name || client.name || client.company || 'Customer').trim(),
    formatAppointmentDate(order.date, languageCode),
    formatAppointmentTime(order.time, languageCode),
    String(order.address || client.address || '').trim(),
    await getServiceDescription(order),
  ];
}

async function createQueueItem(queueId, data) {
  const reference = db.collection('whatsappOutboundQueue').doc(queueId);
  try {
    await reference.create({
      ...data,
      status: 'queued',
      createdAt: FieldValue.serverTimestamp(),
    });
    return { created: true, reference };
  } catch (error) {
    if (isAlreadyExistsError(error)) return { created: false, reference };
    throw error;
  }
}

async function queueAppointmentMessage({ order, client, recipient, eventId, templateName, notificationType, reason, settings }) {
  const to = digitsOnly(recipient?.whatsapp || recipient?.phone);
  if (!/^\d{8,15}$/.test(to)) {
    logger.warn('Skipping WhatsApp notification because the selected recipient number is invalid.', {
      clientId: client.id,
      workOrderId: order.id,
      recipientId: recipient?.id || recipient?.sourceId || null,
    });
    return null;
  }

  if (!/^\d{5,30}$/.test(settings.phoneNumberId)) {
    throw new Error('The official WhatsApp Phone Number ID is not configured.');
  }

  const languageCode = templateLanguageForRecipient(recipient, client, settings);
  const bodyParameters = await buildTemplateParameters(order, client, recipient, languageCode);
  const recipientKey = recipient?.id || recipient?.sourceId || to;
  const queueId = safeDocumentId(`${notificationType}-${order.id}-${eventId}-${recipientKey}`);
  const result = await createQueueItem(queueId, {
    to,
    phoneNumberId: settings.phoneNumberId,
    senderDisplayPhoneNumber: settings.displayPhoneNumber,
    templateName,
    languageCode,
    bodyParameters,
    clientId: client.id,
    workOrderId: order.id,
    notificationType,
    reason,
    recipientId: recipient?.id || null,
    recipientSourceId: recipient?.sourceId || null,
    recipientType: recipient?.recipientType || 'client',
    recipientName: recipient?.name || client.name || null,
    recipientRole: recipient?.role || null,
    source: 'demac-agenda',
  });

  return {
    queueId,
    languageCode,
    recipientId: recipient?.id || null,
    recipientName: recipient?.name || client.name || 'Customer',
    created: result.created,
  };
}

async function queueAppointmentMessages(options) {
  const notifications = [];
  for (const recipient of options.recipients) {
    const notification = await queueAppointmentMessage({ ...options, recipient });
    if (notification) notifications.push(notification);
  }
  return notifications;
}

exports.queueAppointmentConfirmation = onDocumentWritten(
  {
    document: 'workOrders/{workOrderId}',
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (event) => {
    const beforeSnapshot = event.data?.before;
    const afterSnapshot = event.data?.after;
    if (!afterSnapshot?.exists) return;

    const settings = await getWhatsAppSettings();
    const before = beforeSnapshot?.exists ? beforeSnapshot.data() : null;
    const order = { id: afterSnapshot.id, ...afterSnapshot.data() };
    const created = !beforeSnapshot?.exists;
    const changedFields = created ? CUSTOMER_VISIBLE_FIELDS : customerVisibleChanges(before, order);
    const becameEligible = !notificationEligible(before, settings, 'sendConfirmation')
      && notificationEligible(order, settings, 'sendConfirmation');

    if (!notificationEligible(order, settings, 'sendConfirmation')) return;
    if (!created && !becameEligible && changedFields.length === 0) return;

    const client = await getClient(order.clientId);
    if (!client) {
      logger.warn('Skipping appointment confirmation because the client could not be found.', {
        clientId: order.clientId,
        workOrderId: order.id,
      });
      return;
    }

    const recipients = selectedRecipients(order, client, 'confirmation');
    if (!recipients.length) return;
    const reason = created ? 'appointment-created' : becameEligible ? 'appointment-confirmed' : 'appointment-updated';
    const notifications = await queueAppointmentMessages({
      order,
      client,
      recipients,
      eventId: event.id,
      templateName: settings.confirmationTemplateName,
      notificationType: 'appointment-confirmation',
      reason,
      settings,
    });
    if (!notifications.length) return;

    await afterSnapshot.ref.set({
      confirmationNotifications: {
        queueIds: notifications.map((notification) => notification.queueId),
        languageCodes: notifications.map((notification) => notification.languageCode),
        recipientIds: notifications.map((notification) => notification.recipientId),
        recipientNames: notifications.map((notification) => notification.recipientName),
        recipientCount: notifications.length,
        senderDisplayPhoneNumber: settings.displayPhoneNumber,
        reason,
        changedFields,
        queuedAt: FieldValue.serverTimestamp(),
      },
      confirmationNotification: {
        queueId: notifications[0].queueId,
        languageCode: notifications[0].languageCode,
        senderDisplayPhoneNumber: settings.displayPhoneNumber,
        reason,
        changedFields,
        queuedAt: FieldValue.serverTimestamp(),
      },
    }, { merge: true });
  },
);

exports.sendDailyAppointmentReminders = onSchedule(
  {
    schedule: '0 10 * * *',
    timeZone: TIME_ZONE,
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 300,
    retryCount: 2,
  },
  async () => {
    const settings = await getWhatsAppSettings();
    if (!settings.enabled) {
      logger.info('WhatsApp reminders are disabled in business settings.');
      return;
    }

    const runDate = dateKeyInTimeZone();
    const targetDate = addDays(runDate, 1);
    const ordersSnapshot = await db.collection('workOrders').where('date', '==', targetDate).get();
    const targetOrders = ordersSnapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter((order) => notificationEligible(order, settings, 'sendReminder'));

    let queuedCount = 0;
    let existingCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const order of targetOrders) {
      try {
        const client = await getClient(order.clientId);
        if (!client) {
          skippedCount += 1;
          errors.push({ workOrderId: order.id, reason: 'client-not-found' });
          continue;
        }
        const recipients = selectedRecipients(order, client, 'reminder');
        if (!recipients.length) {
          skippedCount += 1;
          errors.push({ workOrderId: order.id, reason: 'no-reminder-recipients' });
          continue;
        }

        const notifications = await queueAppointmentMessages({
          order,
          client,
          recipients,
          eventId: targetDate,
          templateName: settings.appointmentReminderTemplateName,
          notificationType: 'appointment-reminder',
          reason: 'next-day-reminder',
          settings,
        });
        if (!notifications.length) {
          skippedCount += 1;
          errors.push({ workOrderId: order.id, reason: 'invalid-whatsapp-number' });
          continue;
        }

        queuedCount += notifications.filter((notification) => notification.created).length;
        existingCount += notifications.filter((notification) => !notification.created).length;
        await db.collection('workOrders').doc(order.id).set({
          reminderNotifications: {
            queueIds: notifications.map((notification) => notification.queueId),
            languageCodes: notifications.map((notification) => notification.languageCode),
            recipientIds: notifications.map((notification) => notification.recipientId),
            recipientNames: notifications.map((notification) => notification.recipientName),
            recipientCount: notifications.length,
            senderDisplayPhoneNumber: settings.displayPhoneNumber,
            targetDate,
            queuedAt: FieldValue.serverTimestamp(),
          },
          reminderNotification: {
            queueId: notifications[0].queueId,
            languageCode: notifications[0].languageCode,
            senderDisplayPhoneNumber: settings.displayPhoneNumber,
            targetDate,
            queuedAt: FieldValue.serverTimestamp(),
          },
        }, { merge: true });
      } catch (error) {
        skippedCount += 1;
        errors.push({ workOrderId: order.id, reason: error instanceof Error ? error.message : String(error) });
        logger.error('Could not queue an appointment reminder.', { workOrderId: order.id, error });
      }
    }

    await db.collection('reminderBatches').doc(targetDate).set({
      runDate,
      targetDate,
      status: errors.length ? 'complete-with-errors' : 'complete',
      appointmentCount: targetOrders.length,
      queuedCount,
      existingCount,
      skippedCount,
      errors,
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    logger.info('Next-day appointment reminder batch completed.', {
      runDate,
      targetDate,
      appointmentCount: targetOrders.length,
      queuedCount,
      existingCount,
      skippedCount,
    });
  },
);

function settingsSignature(data) {
  return JSON.stringify({
    enabled: data?.enabled !== false,
    displayPhoneNumber: digitsOnly(data?.displayPhoneNumber || OFFICIAL_DISPLAY_PHONE),
    phoneNumberId: digitsOnly(data?.phoneNumberId),
    confirmationTemplateName: data?.confirmationTemplateName || '',
    appointmentReminderTemplateName: data?.appointmentReminderTemplateName || '',
    graphApiVersion: data?.graphApiVersion || '',
  });
}

exports.validateWhatsAppBusinessSettings = onDocumentWritten(
  {
    document: 'businessSettings/whatsapp',
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: [whatsappAccessToken],
  },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const afterSnapshot = event.data?.after;
    if (!afterSnapshot?.exists) return;
    const after = afterSnapshot.data();
    if (settingsSignature(before) === settingsSignature(after)) return;

    const settings = await getWhatsAppSettings();
    if (!settings.enabled) {
      await afterSnapshot.ref.set({
        connectionStatus: 'disabled',
        validationMessage: 'WhatsApp está desactivado en DEMAC.',
        lastValidatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/${settings.graphApiVersion}/${settings.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
        { headers: { Authorization: `Bearer ${whatsappAccessToken.value()}` } },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload?.error?.message || `Meta returned HTTP ${response.status}`);
        error.code = payload?.error?.code || response.status;
        throw error;
      }

      const verifiedDisplayPhoneNumber = String(payload?.display_phone_number || '').trim();
      const expectedDigits = digitsOnly(settings.displayPhoneNumber);
      const verifiedDigits = digitsOnly(verifiedDisplayPhoneNumber);
      const matchesOfficialNumber = Boolean(expectedDigits && verifiedDigits && expectedDigits === verifiedDigits);
      await afterSnapshot.ref.set({
        connectionStatus: matchesOfficialNumber ? 'connected' : 'number-mismatch',
        validationMessage: matchesOfficialNumber
          ? `Meta confirmó el número oficial ${verifiedDisplayPhoneNumber}.`
          : `Meta respondió con ${verifiedDisplayPhoneNumber || 'un número desconocido'}, diferente de ${settings.displayPhoneNumber}.`,
        verifiedDisplayPhoneNumber: verifiedDisplayPhoneNumber || null,
        verifiedName: payload?.verified_name || null,
        qualityRating: payload?.quality_rating || null,
        codeVerificationStatus: payload?.code_verification_status || null,
        lastValidationError: null,
        lastValidatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      await afterSnapshot.ref.set({
        connectionStatus: 'error',
        validationMessage: 'No se pudo validar la conexión con Meta.',
        lastValidationError: error?.message || String(error),
        lastValidationErrorCode: error?.code ? String(error.code) : null,
        lastValidatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.error('Could not validate the official WhatsApp number.', error);
    }
  },
);
