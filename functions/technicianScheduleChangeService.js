const { arubaDateParts, resolveAssignment } = require("./bookingSchedulingPrimitives");
const { resolveCanonicalVanId } = require("./bookingVanIdentity");
const {
  activeWorkOrder,
  createTechnicianDailyScheduleService,
  formatScheduleDate,
  groupConfigForVan,
  renderVanWorkOrderText,
  staffFirstNamesForOrder,
} = require("./technicianDailyScheduleService");
const { createWhatsAppTransactionalService, safeDocumentId } = require("./whatsappTransactionalService");

const DAILY_SCHEDULE_START_TIME = "08:00";
const ADHOC_SUPPORT_KIND = "adhoc_rescue";

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
  if (after.backdated === true || text(after.bookingMode).toLowerCase() === "backdated") return false;
  if (text(after.date) !== text(now.date)) return false;
  if (text(now.time) < DAILY_SCHEDULE_START_TIME) return false;
  if (!before) return true;
  if (!activeWorkOrder(before)) return true;
  return scheduleMaterialChanged(before, after);
}

function isAdhocSupportOrder(order) {
  const role = text(order?.appointmentAssignmentRole || order?.assignmentRole).toLowerCase();
  return role === "support" && text(order?.supportAssignmentKind).toLowerCase() === ADHOC_SUPPORT_KIND;
}

function deterministicScheduleChangeQueueId({ eventId, orderId, vanId }) {
  return safeDocumentId(`van-same-day-change-${eventId}-${orderId}-${vanId}`);
}

function deterministicSupportScheduleChangeQueueId({ eventId, orderId, vanId, recipientRole }) {
  return safeDocumentId(`van-adhoc-support-${eventId}-${orderId}-${recipientRole}-${vanId}`);
}

function renderSameDayScheduleChangeText({ van, order, client, property, appointment, staffById, halfDaySchedules, sequence }) {
  const detail = renderVanWorkOrderText({ van, order, client, property, appointment, staffById, halfDaySchedules, sequence });
  return `🚨 *ACTUALIZACIÓN DE AGENDA · MISMO DÍA*\n${detail}`;
}

function formatClock(value) {
  const match = text(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return text(value) || "Hora pendiente";
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}

function actualCrew(day, van, dateKey) {
  return resolveAssignment(
    van,
    dateKey,
    day.staffProfiles,
    day.dailyVanAssignments,
    day.staffAbsences,
  );
}

function crewLabel(crew, staffById) {
  const names = staffFirstNamesForOrder({ technicianIds: crew?.technicianIds || [] }, staffById);
  return names.length ? names.join(" y ") : "Equipo por confirmar";
}

function supportPrimaryOrder(day, supportOrder) {
  const parentId = text(supportOrder?.parentWorkOrderId || supportOrder?.supportForWorkOrderId);
  if (parentId) {
    const parent = day.workOrders.find((order) => text(order.id) === parentId);
    if (parent) return parent;
  }
  return day.workOrders.find((order) => (
    text(order.appointmentId) === text(supportOrder?.appointmentId)
    && text(order.appointmentAssignmentRole || order.assignmentRole).toLowerCase() !== "support"
  )) || null;
}

function renderAdhocSupportVanText({
  supportVan,
  supportOrder,
  primaryVan,
  client,
  property,
  appointment,
  supportCrew,
  primaryCrew,
  staffById,
  halfDaySchedules,
  sequence,
}) {
  const orderForRender = { ...supportOrder, technicianIds: supportCrew.technicianIds };
  const detail = renderVanWorkOrderText({
    van: supportVan,
    order: orderForRender,
    client,
    property,
    appointment,
    staffById,
    halfDaySchedules,
    sequence,
  });
  const primaryName = text(primaryVan?.name || primaryVan?.id) || "Van principal";
  const primaryTeam = crewLabel(primaryCrew, staffById);
  const reason = text(supportOrder.supportReason || supportOrder.technicianInstructions);
  return [
    "🚨 *APOYO A COMPAÑERO · MISMO DÍA*",
    detail,
    `*Van principal:* ${primaryName} · ${primaryTeam}`,
    reason ? `*Motivo del apoyo:* ${reason}` : "",
  ].filter(Boolean).join("\n\n");
}

function renderAdhocPrimaryVanText({
  primaryVan,
  supportVan,
  supportOrder,
  client,
  property,
  supportCrew,
  staffById,
}) {
  const supportName = text(supportVan?.name || supportVan?.id) || "Van de apoyo";
  const supportTeam = crewLabel(supportCrew, staffById);
  const customer = text(client?.name || client?.company || supportOrder.clientName) || "Cliente";
  const location = text(property?.name || supportOrder.address || property?.address || property?.addressRaw) || "Ubicación del trabajo";
  const end = text(supportOrder.appointmentEndTime);
  const reason = text(supportOrder.supportReason || supportOrder.technicianInstructions);
  const primaryName = text(primaryVan?.name || primaryVan?.id) || "Van principal";
  return [
    "🚨 *APOYO ASIGNADO · MISMO DÍA*",
    `*Van principal:* ${primaryName}`,
    `*Cliente:* ${customer}`,
    `*Ubicación:* ${location}`,
    `*Apoyo:* ${supportName} · ${supportTeam}`,
    `*Hora de apoyo:* ${formatClock(supportOrder.time)}${end ? ` – ${formatClock(end)}` : ""}`,
    reason ? `*Motivo:* ${reason}` : "",
    "*Tu agenda principal no cambia.*",
  ].filter(Boolean).join("\n");
}

function createTechnicianScheduleChangeService({ db } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required for technician schedule changes.");
  const dailySchedules = createTechnicianDailyScheduleService({ db });
  const whatsapp = createWhatsAppTransactionalService({ db });

  async function queueVanGroup({ van, queueId, message, metadata }) {
    const config = groupConfigForVan(van);
    if (!config.enabled) return { queued: false, created: false, reason: "van-group-delivery-disabled", vanId: van?.id, groupName: config.groupName };
    if (!config.valid) return { queued: false, created: false, reason: "van-whatsapp-group-not-configured", vanId: van?.id, groupName: config.groupName };
    const result = await whatsapp.queueTransactionalMessage({
      queueId,
      to: config.groupJid,
      text: message,
      languageCode: "es",
      metadata: {
        ...metadata,
        recipientType: "whatsapp-group",
        vanId: van.id,
        groupName: config.groupName,
        groupJid: config.groupJid,
      },
    });
    return { ...result, vanId: van.id, groupName: config.groupName, groupJid: config.groupJid };
  }

  async function queueSameDayChange({ order, eventId, reason = "same-day-schedule-change" } = {}) {
    if (!order?.id || !eventId) return { queued: false, created: false, reason: "missing-change-identity" };
    const day = await dailySchedules.loadDay(order.date);
    const vanId = resolveCanonicalVanId(order.vanId) || text(order.vanId);
    const van = day.vans.find((item) => item.id === vanId);
    if (!van) return { queued: false, created: false, reason: "van-not-found", vanId };
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
    const result = await queueVanGroup({
      van,
      queueId,
      message,
      metadata: {
        notificationType: "van-same-day-schedule-change",
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
      workOrderId: currentOrder.id,
      appointmentId: currentOrder.appointmentId || null,
    };
  }

  async function queueAdhocSupportChange({ order, eventId, reason = "same-day-adhoc-support" } = {}) {
    if (!order?.id || !eventId) return { queued: false, created: false, reason: "missing-change-identity" };
    if (!isAdhocSupportOrder(order)) return { queued: false, created: false, reason: "not-adhoc-support" };

    const day = await dailySchedules.loadDay(order.date);
    const supportVanId = resolveCanonicalVanId(order.vanId) || text(order.vanId);
    const supportVan = day.vans.find((item) => item.id === supportVanId);
    if (!supportVan) return { queued: false, created: false, reason: "support-van-not-found", vanId: supportVanId };

    const currentOrder = day.workOrders.find((item) => item.id === order.id) || { ...order, vanId: supportVanId };
    const primaryOrder = supportPrimaryOrder(day, currentOrder);
    const primaryVanId = resolveCanonicalVanId(primaryOrder?.vanId || currentOrder.supportPrimaryVanId) || text(primaryOrder?.vanId || currentOrder.supportPrimaryVanId);
    const primaryVan = day.vans.find((item) => item.id === primaryVanId);
    if (!primaryOrder || !primaryVan) {
      return { queued: false, created: false, reason: "primary-support-link-not-found", supportVanId, primaryVanId };
    }

    const supportCrew = actualCrew(day, supportVan, currentOrder.date);
    const primaryCrew = actualCrew(day, primaryVan, currentOrder.date);
    const client = day.clientsById.get(String(currentOrder.clientId || primaryOrder.clientId || ""));
    const property = day.propertiesById.get(String(currentOrder.propertyId || primaryOrder.propertyId || ""));
    const appointment = day.appointmentsById.get(String(currentOrder.appointmentId || ""));
    const supportVanOrders = day.workOrders
      .filter((item) => item.vanId === supportVanId)
      .sort((a, b) => text(a.time).localeCompare(text(b.time)) || text(a.id).localeCompare(text(b.id)));
    const sequence = Math.max(1, supportVanOrders.findIndex((item) => item.id === currentOrder.id) + 1);

    const supportMessage = renderAdhocSupportVanText({
      supportVan,
      supportOrder: currentOrder,
      primaryVan,
      client,
      property,
      appointment,
      supportCrew,
      primaryCrew,
      staffById: day.staffById,
      halfDaySchedules: day.halfDaySchedules,
      sequence,
    });
    const primaryMessage = renderAdhocPrimaryVanText({
      primaryVan,
      supportVan,
      supportOrder: currentOrder,
      client,
      property,
      supportCrew,
      staffById: day.staffById,
    });

    const sharedMetadata = {
      notificationType: "van-adhoc-support-change",
      workOrderId: currentOrder.id,
      primaryWorkOrderId: primaryOrder.id,
      appointmentId: currentOrder.appointmentId || null,
      scheduleDate: currentOrder.date,
      scheduleTime: currentOrder.time,
      scheduleDateLabel: formatScheduleDate(currentOrder.date),
      primaryVanId,
      supportVanId,
      eventId,
      reason,
    };

    const supportResult = await queueVanGroup({
      van: supportVan,
      queueId: deterministicSupportScheduleChangeQueueId({ eventId, orderId: currentOrder.id, vanId: supportVanId, recipientRole: "support" }),
      message: supportMessage,
      metadata: { ...sharedMetadata, supportNotificationRole: "support" },
    });
    const primaryResult = await queueVanGroup({
      van: primaryVan,
      queueId: deterministicSupportScheduleChangeQueueId({ eventId, orderId: currentOrder.id, vanId: primaryVanId, recipientRole: "primary" }),
      message: primaryMessage,
      metadata: { ...sharedMetadata, supportNotificationRole: "primary" },
    });
    const notifications = [supportResult, primaryResult];
    return {
      queued: notifications.some((item) => item.queued),
      created: notifications.some((item) => item.created),
      reason: notifications.some((item) => item.queued) ? "queued" : notifications.map((item) => item.reason).filter(Boolean).join(",") || "support-groups-not-configured",
      appointmentId: currentOrder.appointmentId || null,
      workOrderId: currentOrder.id,
      primaryVanId,
      supportVanId,
      notifications,
    };
  }

  return { queueAdhocSupportChange, queueSameDayChange };
}

module.exports.ADHOC_SUPPORT_KIND = ADHOC_SUPPORT_KIND;
module.exports.DAILY_SCHEDULE_START_TIME = DAILY_SCHEDULE_START_TIME;
module.exports.actualCrew = actualCrew;
module.exports.createTechnicianScheduleChangeService = createTechnicianScheduleChangeService;
module.exports.deterministicScheduleChangeQueueId = deterministicScheduleChangeQueueId;
module.exports.deterministicSupportScheduleChangeQueueId = deterministicSupportScheduleChangeQueueId;
module.exports.isAdhocSupportOrder = isAdhocSupportOrder;
module.exports.renderAdhocPrimaryVanText = renderAdhocPrimaryVanText;
module.exports.renderAdhocSupportVanText = renderAdhocSupportVanText;
module.exports.renderSameDayScheduleChangeText = renderSameDayScheduleChangeText;
module.exports.sameDayScheduleChangeRequired = sameDayScheduleChangeRequired;
module.exports.scheduleMaterialChanged = scheduleMaterialChanged;
module.exports.supportPrimaryOrder = supportPrimaryOrder;
