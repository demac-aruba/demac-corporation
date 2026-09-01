const { BOOKING_ERROR_CODES, BookingAuthorityError, cleanText } = require("./bookingAuthorityCore");
const { canonicalizeVanCatalog, canonicalVanIdFromValue, resolveCanonicalVanId } = require("./bookingVanIdentity");
const { createOperatingCalendarService, dateKeyInTimeZone } = require("./operatingCalendarService");
const { DEFAULT_VAN_GROUP_NAMES, createTechnicianDailyScheduleService } = require("./technicianDailyScheduleService");
const { validWacliRecipient } = require("./whatsappTransactionalService");

const VAN_SCHEDULE_ACTIONS = new Set([
  "get_van_schedule_groups",
  "save_van_schedule_groups",
  "send_van_schedules_now",
]);

function groupJid(value) {
  const jid = cleanText(value, 180);
  return jid.endsWith("@g.us") && validWacliRecipient(jid) ? jid : "";
}

function normalizeGroupInput(value = {}, catalog = null) {
  const rawVanId = cleanText(value.vanId, 160);
  const vanId = catalog
    ? resolveCanonicalVanId(rawVanId, catalog.aliases)
    : canonicalVanIdFromValue(rawVanId);
  if (!vanId) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "A canonical Van id is required.", { field: "vanId" });
  }
  const catalogVan = catalog?.vans.find((van) => van.id === vanId);
  const jid = groupJid(value.groupJid);
  if (value.enabled !== false && !jid) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "A valid WhatsApp group JID ending in @g.us is required for an enabled van.", { field: "groupJid", vanId });
  }
  return {
    vanId,
    groupName: cleanText(value.groupName, 180) || DEFAULT_VAN_GROUP_NAMES[vanId] || catalogVan?.name || vanId,
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
    if (!supplied.length) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "At least one Van group configuration is required.", { field: "groups" });
    }
    const catalog = await loadVanCatalog();
    const groups = supplied.map((group) => normalizeGroupInput(group, catalog));
    const unique = new Set(groups.map((item) => item.vanId));
    if (unique.size !== groups.length) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "Each van can appear only once in the group configuration.", { field: "groups" });
    }
    const byId = new Map(catalog.vans.map((van) => [van.id, van]));
    const missing = groups.find((group) => !byId.get(group.vanId)?.sourceVanId);
    if (missing) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "The canonical Van is not present in the active Van catalog.", { vanId: missing.vanId });
    }
    const now = new Date().toISOString();
    for (const group of groups) {
      const van = byId.get(group.vanId);
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
    let targetVanId = "";
    if (data.vanId) {
      const catalog = await loadVanCatalog();
      targetVanId = resolveCanonicalVanId(data.vanId, catalog.aliases);
      if (!catalog.vans.some((van) => van.id === targetVanId)) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "vanId must identify an active Van in the canonical catalog.", { field: "vanId", vanId: targetVanId });
      }
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

  async function execute({ action, data = {}, identity = {} } = {}) {
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
