const { BOOKING_ERROR_CODES, BookingAuthorityError, cleanText } = require("./bookingAuthorityCore");
const { canonicalizeVanCatalog, canonicalVanIdFromValue, resolveCanonicalVanId } = require("./bookingVanIdentity");
const { createOperatingCalendarService, dateKeyInTimeZone } = require("./operatingCalendarService");
const { DEFAULT_VAN_GROUP_NAMES, createTechnicianDailyScheduleService, activeWorkOrder } = require("./technicianDailyScheduleService");
const { validWacliRecipient, createWhatsAppTransactionalService } = require("./whatsappTransactionalService");

const VAN_SCHEDULE_ACTIONS = new Set([
  "get_van_schedule_groups",
  "save_van_schedule_groups",
  "send_van_schedules_now",
  "retry_van_schedule_delivery",
]);

function groupJid(value) {
  const jid = cleanText(value, 180);
  return jid.endsWith("@g.us") && validWacliRecipient(jid) ? jid : "";
}

function normalizeGroupInput(value = {}) {
  const vanId = canonicalVanIdFromValue(value.vanId);
  if (!vanId) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "A canonical VAN-1 through VAN-4 id is required.", { field: "vanId" });
  }
  const jid = groupJid(value.groupJid);
  if (value.enabled !== false && !jid) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "A valid WhatsApp group JID ending in @g.us is required for an enabled van.", { field: "groupJid", vanId });
  }
  return {
    vanId,
    groupName: cleanText(value.groupName, 180) || DEFAULT_VAN_GROUP_NAMES[vanId] || vanId,
    groupJid: jid,
    enabled: value.enabled !== false,
  };
}

function createVanScheduleCommunicationAuthority({ db, scheduleService = null, operatingCalendar = null, apiVersion = 12 } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  const schedules = scheduleService || createTechnicianDailyScheduleService({ db });
  const calendar = operatingCalendar || createOperatingCalendarService({ db });

  async function loadVanCatalog() {
    const snapshot = await db.collection("vans").get();
    const raw = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    return canonicalizeVanCatalog(raw);
  }

  async function getConfiguration() {
    const catalog = await loadVanCatalog();
    return {
      success: true,
      version: apiVersion,
      groups: catalog.vans.map((van) => ({
        vanId: van.id,
        sourceVanId: van.sourceVanId,
        vanName: van.name,
        groupName: cleanText(van.whatsappScheduleGroupName, 180) || DEFAULT_VAN_GROUP_NAMES[van.id] || van.name,
        groupJid: cleanText(van.whatsappScheduleGroupJid, 180),
        enabled: van.scheduleDeliveryEnabled !== false,
        configured: Boolean(groupJid(van.whatsappScheduleGroupJid)),
      })),
    };
  }

  async function saveConfiguration(data = {}, identity = {}) {
    const supplied = Array.isArray(data.groups) ? data.groups : [];
    if (!supplied.length || supplied.length > 4) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "One to four van group configurations are required.", { field: "groups" });
    }
    const groups = supplied.map(normalizeGroupInput);
    const unique = new Set(groups.map((item) => item.vanId));
    if (unique.size !== groups.length) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "Each van can appear only once in the group configuration.", { field: "groups" });
    }
    const catalog = await loadVanCatalog();
    const byId = new Map(catalog.vans.map((van) => [van.id, van]));
    const now = new Date().toISOString();
    for (const group of groups) {
      const van = byId.get(group.vanId);
      if (!van?.sourceVanId) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "The canonical van is not present in the active van catalog.", { vanId: group.vanId });
      }
      await db.collection("vans").doc(van.sourceVanId).set({
        whatsappScheduleGroupName: group.groupName,
        whatsappScheduleGroupJid: group.groupJid,
        scheduleDeliveryEnabled: group.enabled,
        scheduleDeliveryUpdatedAt: now,
        scheduleDeliveryUpdatedBy: cleanText(identity.uid, 160),
        scheduleDeliveryUpdatedByName: cleanText(identity.name || identity.email, 180),
      }, { merge: true });
    }
    return getConfiguration();
  }

  async function sendNow(data = {}, identity = {}) {
    const dateKey = cleanText(data.dateKey, 20) || dateKeyInTimeZone();
    const targetVanId = data.vanId ? canonicalVanIdFromValue(data.vanId) : "";
    if (data.vanId && !targetVanId) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "vanId must be VAN-1 through VAN-4 when supplied.", { field: "vanId" });
    }
    const requestId = cleanText(data.requestId, 240);
    if (requestId.length < 8) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_IDEMPOTENCY_KEY, "A stable requestId of at least 8 characters is required.", { field: "requestId" });
    }
    if (!(await calendar.isOpenDate(dateKey))) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "Van schedules cannot be sent for a closed DEMAC business date.", { dateKey });
    }
    const result = await schedules.queueDay(dateKey, {
      targetVanId,
      deliveryKey: `manual-${requestId}`,
      reason: "manual-office-van-schedule",
    });
    return {
      success: true,
      version: apiVersion,
      requestedById: cleanText(identity.uid, 160),
      requestedByName: cleanText(identity.name || identity.email, 180),
      ...result,
    };
  }

  async function retryFailed(data = {}, identity = {}) {
    const dateKey = cleanText(data.dateKey, 20) || dateKeyInTimeZone();
    const target = data.vanId ? canonicalVanIdFromValue(data.vanId) : '';
    if (data.vanId && !target) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, 'A canonical Van is required.');
    const transport = await createWhatsAppTransactionalService({ db }).getTransportSettings();
    if (transport.transactionalProvider !== 'wacli') throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, 'Schedule media retries require the active wacli transport.');
    const catalog = await loadVanCatalog();
    const groups = new Map(catalog.vans.filter(van => van.scheduleDeliveryEnabled !== false).map(van => [van.id, groupJid(van.whatsappScheduleGroupJid)]));
    const snapshot = await db.collection('whatsappOutboundQueue').where('scheduleDate', '==', dateKey).get();
    let resumed = 0;
    for (const item of snapshot.docs) {
      resumed += await db.runTransaction(async transaction => {
        const fresh = await transaction.get(item.ref);
        const current = fresh.exists ? fresh.data() : {};
        const scheduleMessage = current.type === 'booking-reference-bundle' || ['van-daily-work-order', 'van-daily-lunch-break', 'van-daily-pending-period'].includes(current.notificationType);
        if (!scheduleMessage || current.provider !== 'wacli' || current.status !== 'failed'
            || (target && current.vanId !== target) || groups.get(current.vanId) !== current.to) return 0;
        // Revalidate work text as well as media before resuming a failed snapshot.
        // An unversioned bundle cannot establish that its files are still current.
        const bundle = current.type === 'booking-reference-bundle';
        if (bundle && (!Number.isInteger(current.referencesVersion) || current.referencesVersion < 0)) return 0;
        if (bundle || current.notificationType === 'van-daily-work-order') {
          if (!current.workOrderId || current.workOrderId.includes('/') || !current.appointmentId || current.appointmentId.includes('/')) return 0;
          const [orderSnapshot, appointmentSnapshot] = await Promise.all([
            transaction.get(db.collection('workOrders').doc(current.workOrderId)),
            transaction.get(db.collection('appointments').doc(current.appointmentId)),
          ]);
          const order = orderSnapshot.exists ? orderSnapshot.data() : null;
          const appointment = appointmentSnapshot.exists ? appointmentSnapshot.data() : null;
          if (!activeWorkOrder(order) || order.appointmentId !== current.appointmentId || order.date !== current.scheduleDate
              || (current.scheduleTime != null && order.time !== current.scheduleTime)
              || resolveCanonicalVanId(order.vanId, catalog.aliases) !== current.vanId || appointment?.status !== 'confirmed'
              || Number(appointment.visitReferences?.version || 0) !== (current.referencesVersion ?? 0)) return 0;
        }
        transaction.set(item.ref, { status: 'queued', partAttempts: 0, retryAfterIso: null, errorMessage: null,
          resumedAtIso: new Date().toISOString(), resumedBy: cleanText(identity.uid, 160) }, { merge: true });
        return 1;
      });
    }
    return { success: true, version: apiVersion, resumed };
  }

  async function execute({ action, data = {}, identity = {} } = {}) {
    if (action === "retry_van_schedule_delivery") return retryFailed(data, identity);
    if (action === "get_van_schedule_groups") return getConfiguration();
    if (action === "save_van_schedule_groups") return saveConfiguration(data, identity);
    if (action === "send_van_schedules_now") return sendNow(data, identity);
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "Unsupported van schedule communication action.", { action: cleanText(action, 120) });
  }

  return {
    execute,
    getConfiguration,
    saveConfiguration,
    sendNow,
  };
}

module.exports.VAN_SCHEDULE_ACTIONS = VAN_SCHEDULE_ACTIONS;
module.exports.createVanScheduleCommunicationAuthority = createVanScheduleCommunicationAuthority;
module.exports.groupJid = groupJid;
module.exports.normalizeGroupInput = normalizeGroupInput;
