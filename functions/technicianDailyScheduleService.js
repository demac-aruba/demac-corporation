const { canonicalizeVanCatalog, resolveCanonicalVanId } = require("./bookingVanIdentity");
const { AFTERNOON_SLOTS } = require("./bookingSchedulingPrimitives");
const { createWhatsAppTransactionalService, safeDocumentId, validWacliRecipient } = require("./whatsappTransactionalService");

const VAN_DAILY_LANGUAGE = "es";
const PREFERRED_LUNCH_START_MINUTES = 12 * 60;
const LUNCH_DURATION_MINUTES = 60;
const AFTERNOON_START_MINUTES = timeToMinutes(AFTERNOON_SLOTS[0]) || (13 * 60 + 30);
const INACTIVE_WORK_ORDER_STATUSES = new Set([
  "Solicitud recibida",
  "Reserva temporal",
  "Cancelada",
  "Reprogramada",
  "Completada",
  "Facturada",
  "Pagada",
]);
const DEFAULT_VAN_GROUP_NAMES = Object.freeze({
  "VAN-1": "TEC - Miguel",
  "VAN-2": "Gollo y Walter",
  "VAN-3": "TEC - Mario y Ronald",
  "VAN-4": "TEC - Alejandro y Edwin",
});

function normalizedText(value) {
  return String(value ?? "").trim();
}

function normalizedIdentity(value) {
  return normalizedText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function phoneDigits(value) {
  return normalizedText(value).replace(/\D/g, "");
}

function activeWorkOrder(order) {
  return Boolean(order) && !INACTIVE_WORK_ORDER_STATUSES.has(normalizedText(order.status));
}

function orderTimeKey(order) {
  return normalizedText(order.time || "99:99").padStart(5, "0");
}

function timeToMinutes(value) {
  const match = normalizedText(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function minutesToTime(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatClock(value) {
  const match = normalizedText(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return normalizedText(value) || "Hora pendiente";
  const hour = Number(match[1]);
  const minute = match[2];
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function formatScheduleDate(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

function workSummary(order) {
  const workItems = Array.isArray(order.appointmentWorkItems) ? order.appointmentWorkItems : [];
  if (workItems.length) {
    return workItems
      .map((item) => {
        const label = normalizedText(item.label || item.presetId || item.serviceId || "Trabajo");
        const quantity = Math.max(1, Number(item.quantity) || 1);
        return `${label} × ${quantity}`;
      })
      .join("; ");
  }
  return normalizedText(order.appointmentWorkLabel || order.problem || order.serviceId || "Trabajo programado");
}

function customerDescription(order) {
  return normalizedText(order.customerFacingDescription || order.problem);
}

function orderDurationMinutes(order) {
  const direct = Number(order?.appointmentDurationMinutes);
  if (Number.isFinite(direct) && direct > 0) return Math.max(30, Math.round(direct));
  const workItems = Array.isArray(order?.appointmentWorkItems) ? order.appointmentWorkItems : [];
  const itemDuration = workItems.reduce((sum, item) => sum + Math.max(0, Number(item?.durationMinutes) || 0), 0);
  if (itemDuration > 0) return Math.max(30, Math.round(itemDuration));
  const slots = Number(order?.scheduledSlots);
  if (Number.isFinite(slots) && slots > 0) return Math.max(30, Math.round(slots * 60));
  const start = timeToMinutes(order?.time);
  const end = timeToMinutes(order?.appointmentEndTime);
  if (start !== null && end !== null && end > start) return Math.max(30, end - start);
  return 60;
}

function projectedOrderEndMinutes(order) {
  const start = timeToMinutes(order?.time);
  return start === null ? null : start + orderDurationMinutes(order);
}

function hasCanonicalReservedCapacity(order) {
  if (Array.isArray(order?.scheduledSlots)) return order.scheduledSlots.length > 0;
  const slots = Number(order?.scheduledSlots);
  return Number.isFinite(slots) && slots > 0;
}

function displayedOrderEndTime(order) {
  const canonicalEnd = normalizedText(order?.appointmentEndTime);

  // Booking Authority persists both reserved capacity (`scheduledSlots`) and the
  // committed assignment end. When those reservation fields exist, the technician
  // schedule must display that committed schedule span instead of recomputing a
  // different end from service-duration minutes. Duration remains a compatibility
  // fallback for older records and is still used independently by lunch planning.
  if (hasCanonicalReservedCapacity(order) && canonicalEnd) return canonicalEnd;
  if (order?.fullDaySingleProperty === true && canonicalEnd) return canonicalEnd;

  const projected = projectedOrderEndMinutes(order);
  if (projected !== null) return minutesToTime(projected);
  return canonicalEnd;
}

function technicianInstructions(appointment, order) {
  const direct = normalizedText(order?.technicianInstructions);
  const lineInstructions = (Array.isArray(appointment?.workLines) ? appointment.workLines : [])
    .map((line) => normalizedText(line?.technicianInstructions))
    .filter(Boolean);
  const unique = [...new Set([direct, ...lineInstructions].filter(Boolean))];
  return unique.join("\n");
}

function propertyAccessInstructions(property) {
  return normalizedText(
    property?.accessInstructions
      || property?.propertyAccessInstructions
      || property?.entryInstructions
      || property?.accessNotes,
  );
}

function staffNamesForOrder(order, staffById = new Map()) {
  return [...new Set((Array.isArray(order.technicianIds) ? order.technicianIds : [])
    .map((id) => normalizedText(staffById.get(String(id))?.name || staffById.get(String(id))?.displayName))
    .filter(Boolean))];
}

function firstName(value) {
  return normalizedText(value).split(/\s+/).filter(Boolean)[0] || "";
}

function staffFirstNamesForOrder(order, staffById = new Map()) {
  return [...new Set(staffNamesForOrder(order, staffById).map(firstName).filter(Boolean))];
}

function geographicDistrict(property) {
  const explicit = normalizedText(property?.district || property?.addressDistrict);
  if (explicit) return explicit;
  const source = normalizedText(property?.operationalZone || property?.zone).toLowerCase();
  if (source.includes("oranjestad")) return "Oranjestad";
  if (source.includes("noord")) return "Noord";
  if (source.includes("paradera")) return "Paradera";
  if (source.includes("santa cruz")) return "Santa Cruz";
  if (source.includes("savaneta")) return "Savaneta";
  if (source.includes("san nicolas") || source.includes("san nicolaas")) return "San Nicolas";
  return "";
}

function geographicZone(property) {
  return normalizedText(property?.neighborhood || property?.addressNeighborhood);
}

function propertyLocationName(property) {
  const name = normalizedText(property?.name);
  if (!name) return "";
  const normalized = name.toLowerCase().replace(/\s+/g, " ");
  if (normalized === "primary property" || normalized === "property" || /^property\s+\d+$/.test(normalized)) return "";
  return name;
}

function samePersonAsCustomer(recipient, client) {
  if (!recipient || !client) return false;
  if (normalizedText(recipient.recipientType).toLowerCase() === "client") return true;
  if (normalizedText(recipient.sourceId) && normalizedText(recipient.sourceId) === normalizedText(client.id)) return true;
  const recipientName = normalizedIdentity(recipient.name);
  const clientName = normalizedIdentity(client.name || client.company);
  if (recipientName && clientName && recipientName === clientName) return true;
  const recipientPhone = phoneDigits(recipient.whatsapp || recipient.phone);
  const clientPhone = phoneDigits(client.whatsapp || client.phone);
  return Boolean(recipientPhone && clientPhone && recipientPhone === clientPhone);
}

function arrivalContact(order, client) {
  const recipients = Array.isArray(order.notificationRecipients) ? order.notificationRecipients : [];
  const preferred = recipients.find((recipient) => (
    recipient?.technicianArrival === true
      && normalizedText(recipient.name)
      && !samePersonAsCustomer(recipient, client)
  ));
  if (!preferred) return null;
  return {
    name: normalizedText(preferred.name),
    source: "additional-property-contact",
  };
}

function renderVanWorkOrderText({ van, order, client, property, appointment, staffById, sequence }) {
  const start = formatClock(order.time);
  const endValue = displayedOrderEndTime(order);
  const end = endValue ? formatClock(endValue) : "";
  const contact = arrivalContact(order, client);
  const team = staffFirstNamesForOrder(order, staffById);
  const description = customerDescription(order) || workSummary(order);
  const instructions = technicianInstructions(appointment, order);
  const access = propertyAccessInstructions(property);
  const district = geographicDistrict(property);
  const zone = geographicZone(property);
  const locationName = propertyLocationName(property);
  const vanLabel = normalizedText(van.name || van.id) || "Van";
  const headerLabel = team.length ? `${vanLabel} · ${team.join(" y ")}` : vanLabel;

  const header = [
    `*DEMAC · ${headerLabel}*`,
    `*Trabajo ${sequence} · ${formatScheduleDate(order.date)}*`,
  ];

  const customerBlock = [
    `*Hora:* ${start}${end ? ` – ${end}` : ""}`,
    `*Cliente:* ${normalizedText(client?.name || client?.company || order.clientName) || "Cliente"}`,
  ];
  if (contact?.name) customerBlock.push(`*Contacto:* ${contact.name}`);

  const locationBlock = [];
  if (locationName) locationBlock.push(`*Location:* ${locationName}`);
  locationBlock.push(`*Dirección:* ${normalizedText(order.address || property?.address || property?.addressRaw) || "Dirección pendiente"}`);
  if (district) locationBlock.push(`*Distrito:* ${district}`);
  if (zone) locationBlock.push(`*Zona:* ${zone}`);
  if (access) locationBlock.push(`*Acceso:* ${access}`);

  const descriptionBlock = description ? [`*Descripción:* ${description}`] : [];
  const blocks = [header, customerBlock, locationBlock, descriptionBlock];
  if (instructions) blocks.push([`*Instrucciones técnico:* ${instructions}`]);
  return blocks.map((block) => block.filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
}

function longSingleProject(orders) {
  if (!Array.isArray(orders) || orders.length !== 1) return false;
  const [order] = orders;
  return order.fullDaySingleProperty === true
    || Number(order.scheduledSlots || 0) >= 5
    || orderDurationMinutes(order) >= 300;
}

function scheduleSpansLunch(orders) {
  if (!Array.isArray(orders) || !orders.length) return false;
  if (longSingleProject(orders)) return true;
  return orders.some((order) => {
    const start = timeToMinutes(order.time);
    const end = projectedOrderEndMinutes(order);
    return (start !== null && start >= AFTERNOON_START_MINUTES)
      || (end !== null && end > PREFERRED_LUNCH_START_MINUTES);
  });
}

function planLunchBreak(orders) {
  const sorted = [...(Array.isArray(orders) ? orders : [])]
    .sort((a, b) => orderTimeKey(a).localeCompare(orderTimeKey(b)) || String(a.id || "").localeCompare(String(b.id || "")));
  if (!scheduleSpansLunch(sorted)) return null;

  const onSite = longSingleProject(sorted);
  if (onSite) {
    return {
      startMinutes: PREFERRED_LUNCH_START_MINUTES,
      endMinutes: PREFERRED_LUNCH_START_MINUTES + LUNCH_DURATION_MINUTES,
      insertAfterCount: 1,
      onSite: true,
      reason: "single-project-all-day",
    };
  }

  let startMinutes = PREFERRED_LUNCH_START_MINUTES;
  for (const order of sorted) {
    const orderStart = timeToMinutes(order.time);
    const orderEnd = projectedOrderEndMinutes(order);
    if (orderStart === null || orderEnd === null) continue;
    if (orderEnd <= startMinutes) continue;
    if (orderStart >= startMinutes + LUNCH_DURATION_MINUTES) break;
    startMinutes = Math.max(startMinutes, orderEnd);
  }

  const endMinutes = startMinutes + LUNCH_DURATION_MINUTES;
  const insertAfterCount = sorted.filter((order) => {
    const start = timeToMinutes(order.time);
    return start !== null && start < startMinutes;
  }).length;
  return {
    startMinutes,
    endMinutes,
    insertAfterCount,
    onSite: false,
    reason: startMinutes === PREFERRED_LUNCH_START_MINUTES ? "standard-lunch-window" : "lunch-shifted-after-work",
  };
}

function renderLunchBreakText() {
  return "*LUNCH BREAK*";
}

function groupConfigForVan(van) {
  const groupJid = normalizedText(van?.whatsappScheduleGroupJid);
  const groupName = normalizedText(van?.whatsappScheduleGroupName) || DEFAULT_VAN_GROUP_NAMES[van?.id] || van?.name || van?.id;
  return {
    enabled: van?.scheduleDeliveryEnabled !== false,
    groupJid,
    groupName,
    valid: Boolean(groupJid && groupJid.endsWith("@g.us") && validWacliRecipient(groupJid)),
  };
}

function deterministicQueueId({ dateKey, vanId, order, deliveryKey = "auto" }) {
  const time = normalizedText(order.time).replace(/\D/g, "") || "time";
  return safeDocumentId(`van-daily-work-${dateKey}-${vanId}-${time}-${order.id}-${deliveryKey}`);
}

function deterministicLunchQueueId({ dateKey, vanId, deliveryKey = "auto" }) {
  return safeDocumentId(`van-daily-lunch-${dateKey}-${vanId}-${deliveryKey}`);
}

function createTechnicianDailyScheduleService({ db } = {}) {
  if (!db || typeof db.collection !== "function") {
    throw new Error("A Firestore-compatible db is required for van daily schedules.");
  }
  const whatsapp = createWhatsAppTransactionalService({ db });

  async function loadDocuments(collectionName, ids) {
    const uniqueIds = [...new Set((ids || []).map((id) => normalizedText(id)).filter(Boolean))];
    const entries = await Promise.all(uniqueIds.map(async (id) => {
      const snapshot = await db.collection(collectionName).doc(id).get();
      return snapshot.exists ? [id, { id: snapshot.id, ...snapshot.data() }] : [id, null];
    }));
    return new Map(entries.filter(([, value]) => value));
  }

  async function loadDay(dateKey) {
    const [vanSnapshot, staffSnapshot, workOrderSnapshot] = await Promise.all([
      db.collection("vans").get(),
      db.collection("staffProfiles").get(),
      db.collection("workOrders").where("date", "==", dateKey).get(),
    ]);
    const rawVans = vanSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    const catalog = canonicalizeVanCatalog(rawVans);
    const workOrders = workOrderSnapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter(activeWorkOrder)
      .map((order) => ({ ...order, vanId: resolveCanonicalVanId(order.vanId, catalog.aliases) || normalizedText(order.vanId) }));
    const clientsById = await loadDocuments("clients", workOrders.map((order) => order.clientId));
    const propertiesById = await loadDocuments("properties", workOrders.map((order) => order.propertyId));
    const appointmentsById = await loadDocuments("appointments", workOrders.map((order) => order.appointmentId));
    const staffById = new Map(staffSnapshot.docs.map((document) => [document.id, { id: document.id, ...document.data() }]));
    return { vans: catalog.vans, workOrders, clientsById, propertiesById, appointmentsById, staffById };
  }

  async function queueWorkOrder({ dateKey, van, order, day, sequence, deliveryKey, reason }) {
    const config = groupConfigForVan(van);
    if (!config.enabled) {
      return { queued: false, created: false, reason: "van-group-delivery-disabled", vanId: van.id, groupName: config.groupName, workOrderId: order.id };
    }
    if (!config.valid) {
      return { queued: false, created: false, reason: "van-whatsapp-group-not-configured", vanId: van.id, groupName: config.groupName, workOrderId: order.id };
    }
    const client = day.clientsById.get(String(order.clientId || ""));
    const property = day.propertiesById.get(String(order.propertyId || ""));
    const appointment = day.appointmentsById.get(String(order.appointmentId || ""));
    const queueId = deterministicQueueId({ dateKey, vanId: van.id, order, deliveryKey });
    const text = renderVanWorkOrderText({ van, order, client, property, appointment, staffById: day.staffById, sequence });
    const result = await whatsapp.queueTransactionalMessage({
      queueId,
      to: config.groupJid,
      text,
      languageCode: VAN_DAILY_LANGUAGE,
      metadata: {
        notificationType: "van-daily-work-order",
        recipientType: "whatsapp-group",
        vanId: van.id,
        groupName: config.groupName,
        groupJid: config.groupJid,
        workOrderId: order.id,
        appointmentId: order.appointmentId || null,
        scheduleDate: dateKey,
        sequence,
        reason,
      },
    });
    return {
      ...result,
      vanId: van.id,
      groupName: config.groupName,
      groupJid: config.groupJid,
      workOrderId: order.id,
      appointmentId: order.appointmentId || null,
      sequence,
    };
  }

  async function queueLunchBreak({ dateKey, van, orders, day, lunch, deliveryKey, reason }) {
    const config = groupConfigForVan(van);
    if (!config.enabled) {
      return { queued: false, created: false, reason: "van-group-delivery-disabled", vanId: van.id, groupName: config.groupName, lunchBreak: true };
    }
    if (!config.valid) {
      return { queued: false, created: false, reason: "van-whatsapp-group-not-configured", vanId: van.id, groupName: config.groupName, lunchBreak: true };
    }
    const queueId = deterministicLunchQueueId({ dateKey, vanId: van.id, deliveryKey });
    const text = renderLunchBreakText({ van, dateKey, lunch, orders, staffById: day.staffById });
    const result = await whatsapp.queueTransactionalMessage({
      queueId,
      to: config.groupJid,
      text,
      languageCode: VAN_DAILY_LANGUAGE,
      metadata: {
        notificationType: "van-daily-lunch-break",
        recipientType: "whatsapp-group",
        vanId: van.id,
        groupName: config.groupName,
        groupJid: config.groupJid,
        scheduleDate: dateKey,
        lunchStart: minutesToTime(lunch.startMinutes),
        lunchEnd: minutesToTime(lunch.endMinutes),
        afterWorkOrderCount: lunch.insertAfterCount,
        onSite: lunch.onSite === true,
        lunchReason: lunch.reason,
        reason,
      },
    });
    return {
      ...result,
      vanId: van.id,
      groupName: config.groupName,
      groupJid: config.groupJid,
      lunchBreak: true,
      lunch,
    };
  }

  async function queueDay(dateKey, { targetVanId = "", deliveryKey = "auto", reason = "daily-van-schedule" } = {}) {
    const day = await loadDay(dateKey);
    const canonicalTarget = targetVanId ? resolveCanonicalVanId(targetVanId) : "";
    const vans = day.vans.filter((van) => !canonicalTarget || van.id === canonicalTarget);
    const results = [];
    let workOrderCount = 0;
    let lunchBreakCount = 0;
    for (const van of vans) {
      const orders = day.workOrders
        .filter((order) => order.vanId === van.id)
        .sort((a, b) => orderTimeKey(a).localeCompare(orderTimeKey(b)) || String(a.id || "").localeCompare(String(b.id || "")));
      workOrderCount += orders.length;
      const lunch = planLunchBreak(orders);
      for (let index = 0; index <= orders.length; index += 1) {
        if (lunch && lunch.insertAfterCount === index) {
          results.push(await queueLunchBreak({ dateKey, van, orders, day, lunch, deliveryKey, reason }));
          lunchBreakCount += 1;
        }
        if (index < orders.length) {
          results.push(await queueWorkOrder({
            dateKey,
            van,
            order: orders[index],
            day,
            sequence: index + 1,
            deliveryKey,
            reason,
          }));
        }
      }
    }
    return {
      dateKey,
      vanCount: vans.length,
      workOrderCount,
      lunchBreakCount,
      messageCount: results.length,
      results,
    };
  }

  return {
    loadDay,
    queueDay,
    queueLunchBreak,
    queueWorkOrder,
  };
}

module.exports.DEFAULT_VAN_GROUP_NAMES = DEFAULT_VAN_GROUP_NAMES;
module.exports.INACTIVE_WORK_ORDER_STATUSES = INACTIVE_WORK_ORDER_STATUSES;
module.exports.LUNCH_DURATION_MINUTES = LUNCH_DURATION_MINUTES;
module.exports.PREFERRED_LUNCH_START_MINUTES = PREFERRED_LUNCH_START_MINUTES;
module.exports.VAN_DAILY_LANGUAGE = VAN_DAILY_LANGUAGE;
module.exports.activeWorkOrder = activeWorkOrder;
module.exports.arrivalContact = arrivalContact;
module.exports.createTechnicianDailyScheduleService = createTechnicianDailyScheduleService;
module.exports.customerDescription = customerDescription;
module.exports.deterministicLunchQueueId = deterministicLunchQueueId;
module.exports.deterministicQueueId = deterministicQueueId;
module.exports.displayedOrderEndTime = displayedOrderEndTime;
module.exports.firstName = firstName;
module.exports.formatScheduleDate = formatScheduleDate;
module.exports.geographicDistrict = geographicDistrict;
module.exports.geographicZone = geographicZone;
module.exports.groupConfigForVan = groupConfigForVan;
module.exports.hasCanonicalReservedCapacity = hasCanonicalReservedCapacity;
module.exports.minutesToTime = minutesToTime;
module.exports.orderDurationMinutes = orderDurationMinutes;
module.exports.planLunchBreak = planLunchBreak;
module.exports.projectedOrderEndMinutes = projectedOrderEndMinutes;
module.exports.propertyAccessInstructions = propertyAccessInstructions;
module.exports.propertyLocationName = propertyLocationName;
module.exports.renderLunchBreakText = renderLunchBreakText;
module.exports.renderVanWorkOrderText = renderVanWorkOrderText;
module.exports.samePersonAsCustomer = samePersonAsCustomer;
module.exports.scheduleSpansLunch = scheduleSpansLunch;
module.exports.staffFirstNamesForOrder = staffFirstNamesForOrder;
module.exports.staffNamesForOrder = staffNamesForOrder;
module.exports.technicianInstructions = technicianInstructions;
module.exports.timeToMinutes = timeToMinutes;
module.exports.workSummary = workSummary;