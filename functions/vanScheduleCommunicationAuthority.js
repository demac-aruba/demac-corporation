const { BOOKING_ERROR_CODES, BookingAuthorityError, cleanText } = require("./bookingAuthorityCore");
const { canonicalizeVanCatalog, canonicalVanIdFromValue } = require("./bookingVanIdentity");
const { createOperatingCalendarService, dateKeyInTimeZone } = require("./operatingCalendarService");
const { createTechnicianDailyScheduleService } = require("./technicianDailyScheduleService");
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

function defaultGroupName(vanId, fallback = "") {
  return cleanText(fallback, 180) || cleanText(vanId, 80) || "Van";
}

function normalizeGroupInput(value = {}) {
  const vanId = canonicalVanIdFromValue(value.vanId);
  if (!vanId) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "An active canonical Van id is required.", { field: "vanId" });
  }
  const jid = groupJid(value.groupJid);
  if (value.enabled !== false && !jid) {
    throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "A valid WhatsApp group JID ending in @g.us is required for an enabled van.", { field: "groupJid", vanId });
  }
  return {
    vanId,
    groupName: cleanText(value.groupName, 180),
    groupJid: jid,
    enabled: value.enabled !== false,
  };
}

function assertUniqueEnabledGroupJids(groups = []) {
  const seen = new Map();
  for (const group of groups) {
    if (group.enabled === false || !group.groupJid) continue;
    const priorVanId = seen.get(group.groupJid);
    if (priorVanId && priorVanId !== group.vanId) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "The same WhatsApp group JID cannot be assigned to more than one enabled Van.",
        { field: "groupJid", vanId: group.vanId, conflictingVanId: priorVanId },
      );
    }
    seen.set(group.groupJid, group.vanId);
  }
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
        groupName: cleanText(van.whatsappScheduleGroupName, 180) || defaultGroupName(van.id, van.name),
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
    const groups = supplied.map(normalizeGroupInput);
    const unique = new Set(groups.map((item) => item.vanId));
    if (unique.size !== groups.length) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "Each van can appear only once in the group configuration.", { field: "groups" });
    }

    const catalog = await loadVanCatalog();
    const byId = new Map(catalog.vans.map((van) => [van.id, van]));
    for (const group of groups) {
      if (!byId.get(group.vanId)?.sourceVanId) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "The requested Van is not present in the active Van catalog.", { vanId: group.vanId });
      }
    }
    if (typeof db.runTransaction !== "function") {
      throw new Error("Firestore transaction support is required to update Van WhatsApp groups safely.");
    }

    const now = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      const currentByVan = new Map();
      for (const van of catalog.vans) {
        const reference = db.collection("vans").doc(van.sourceVanId);
        const snapshot = await transaction.get(reference);
        const persisted = snapshot.exists ? (snapshot.data() || {}) : {};
        currentByVan.set(van.id, {
          vanId: van.id,
          groupName: cleanText(persisted.whatsappScheduleGroupName, 180) || defaultGroupName(van.id, van.name),
          groupJid: groupJid(persisted.whatsappScheduleGroupJid),
          enabled: persisted.scheduleDeliveryEnabled !== false,
        });
      }

      for (const group of groups) {
        const current = currentByVan.get(group.vanId) || {};
        currentByVan.set(group.vanId, {
          ...group,
          groupName: group.groupName || current.groupName || defaultGroupName(group.vanId),
        });
      }
      assertUniqueEnabledGroupJids([...currentByVan.values()]);

      for (const group of groups) {
        const van = byId.get(group.vanId);
        const proposed = currentByVan.get(group.vanId);
        transaction.set(db.collection("vans").doc(van.sourceVanId), {
          whatsappScheduleGroupName: proposed.groupName,
          whatsappScheduleGroupJid: proposed.groupJid,
          scheduleDeliveryEnabled: proposed.enabled,
          scheduleDeliveryUpdatedAt: now,
          scheduleDeliveryUpdatedBy: cleanText(identity.uid, 160),
          scheduleDeliveryUpdatedByName: cleanText(identity.name || identity.email, 180),
        }, { merge: true });
      }
    });
    return getConfiguration();
  }

  async function sendNow(data = {}, identity = {}) {
    const dateKey = cleanText(data.dateKey, 20) || dateKeyInTimeZone();
    const targetVanId = data.vanId ? canonicalVanIdFromValue(data.vanId) : "";
    if (data.vanId && !targetVanId) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "An active canonical Van id is required when vanId is supplied.", { field: "vanId" });
    }
    if (targetVanId) {
      const catalog = await loadVanCatalog();
      if (!catalog.vans.some((van) => van.id === targetVanId)) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "The requested Van is not present in the active Van catalog.", { vanId: targetVanId });
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
module.exports.assertUniqueEnabledGroupJids = assertUniqueEnabledGroupJids;
module.exports.createVanScheduleCommunicationAuthority = createVanScheduleCommunicationAuthority;
module.exports.defaultGroupName = defaultGroupName;
module.exports.groupJid = groupJid;
module.exports.normalizeGroupInput = normalizeGroupInput;
