const { arubaDateParts } = require("./bookingSchedulingPrimitives");
const { resolveCanonicalVanId } = require("./bookingVanIdentity");
const {
  activeWorkOrder,
  createTechnicianDailyScheduleService,
  formatScheduleDate,
  groupConfigForVan,
  renderVanWorkOrderText,
} = require("./technicianDailyScheduleService");
const { createWhatsAppTransactionalService, safeDocumentId } = require("./whatsappTransactionalService");

const DAILY_SCHEDULE_START_TIME = "08:00";

function text(value) {
  return String(value ?? "").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(text));
  return text(value);
}

function scheduleMaterialChanged(before, after) {
  if (!before) return true;
  return ["date", "time", "vanId", "appointmentEndTime", "scheduledSlots", "technicianIds"]
    .some((field) => stableValue(before?.[field]) !== stableValue(after?.[field]));
}

function sameDayScheduleChangeRequired(before, after, now = arubaDateParts()) {
  if (!after || !activeWorkOrder(after)) return false;
  if (text(after.date) !== text(now.date)) return false;
  if (text(now.time) < DAILY_SCHEDULE_START_TIME) return false;
  if (!before) return true;
  if (!activeWorkOrder(before)) return true;
  return scheduleMaterialChanged(before, after);
}

function deterministicScheduleChangeQueueId({ eventId, orderId, vanId }) {
  return safeDocumentId(`van-same-day-change-${eventId}-${orderId}-${vanId}`);
}

function renderSameDayScheduleChangeText({ van, order, client, property, appointment, staffById, halfDaySchedules, sequence }) {
  const detail = renderVanWorkOrderText({ van, order, client, property, appointment, staffById, halfDaySchedules, sequence });
  return `🚨 *ACTUALIZACIÓN DE AGENDA · MISMO DÍA*\n${detail}`;
}

function createTechnicianScheduleChangeService({ db } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required for technician schedule changes.");
  const dailySchedules = createTechnicianDailyScheduleService({ db });
  const whatsapp = createWhatsAppTransactionalService({ db });

  async function queueSameDayChange({ order, eventId, reason = "same-day-schedule-change" } = {}) {
    if (!order?.id || !eventId) return { queued: false, created: false, reason: "missing-change-identity" };
    const day = await dailySchedules.loadDay(order.date);
    const vanId = resolveCanonicalVanId(order.vanId) || text(order.vanId);
    const van = day.vans.find((item) => item.id === vanId);
    if (!van) return { queued: false, created: false, reason: "van-not-found", vanId };
    const config = groupConfigForVan(van);
    if (!config.enabled) return { queued: false, created: false, reason: "van-group-delivery-disabled", vanId, groupName: config.groupName };
    if (!config.valid) return { queued: false, created: false, reason: "van-whatsapp-group-not-configured", vanId, groupName: config.groupName };

    const currentOrder = day.workOrders.find((item) => item.id === order.id) || { ...order, vanId };
    const sameVanOrders = day.workOrders
      .filter((item) => item.vanId === vanId)
      .sort((a, b) => text(a.time).localeCompare(text(b.time)) || text(a.id).localeCompare(text(b.id)));
    const sequence = Math.max(1, sameVanOrders.findIndex((item) => item.id === currentOrder.id) + 1);
    const client = day.clientsById.get(String(currentOrder.clientId || ""));
    const property = day.propertiesById.get(String(currentOrder.propertyId || ""));
    const appointment = day.appointmentsById.get(String(currentOrder.appointmentId || ""));
    const queueId = deterministicScheduleChangeQueueId({ eventId, orderId: currentOrder.id, vanId });
    const message = renderSameDayScheduleChangeText({
      van,
      order: currentOrder,
      client,
      property,
      appointment,
      staffById: day.staffById,
      halfDaySchedules: day.halfDaySchedules,
      sequence,
    });
    const result = await whatsapp.queueTransactionalMessage({
      queueId,
      to: config.groupJid,
      text: message,
      languageCode: "es",
      metadata: {
        notificationType: "van-same-day-schedule-change",
        recipientType: "whatsapp-group",
        vanId,
        groupName: config.groupName,
        groupJid: config.groupJid,
        workOrderId: currentOrder.id,
        appointmentId: currentOrder.appointmentId || null,
        scheduleDate: currentOrder.date,
        scheduleTime: currentOrder.time,
        scheduleDateLabel: formatScheduleDate(currentOrder.date),
        eventId,
        reason,
      },
    });
    return {
      ...result,
      vanId,
      groupName: config.groupName,
      groupJid: config.groupJid,
      workOrderId: currentOrder.id,
      appointmentId: currentOrder.appointmentId || null,
    };
  }

  return { queueSameDayChange };
}

module.exports.DAILY_SCHEDULE_START_TIME = DAILY_SCHEDULE_START_TIME;
module.exports.createTechnicianScheduleChangeService = createTechnicianScheduleChangeService;
module.exports.deterministicScheduleChangeQueueId = deterministicScheduleChangeQueueId;
module.exports.renderSameDayScheduleChangeText = renderSameDayScheduleChangeText;
module.exports.sameDayScheduleChangeRequired = sameDayScheduleChangeRequired;
module.exports.scheduleMaterialChanged = scheduleMaterialChanged;
