const { canonicalizeVanCatalog, resolveCanonicalVanId } = require("./bookingVanIdentity");
const { createWhatsAppTransactionalService, safeDocumentId, validWacliRecipient } = require("./whatsappTransactionalService");

const VAN_DAILY_LANGUAGE = "es";
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

function activeWorkOrder(order) {
  return Boolean(order) && !INACTIVE_WORK_ORDER_STATUSES.has(normalizedText(order.status));
}

function orderTimeKey(order) {
  return normalizedText(order.time || "99:99").padStart(5, "0");
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

function arrivalContact(order, client) {
  const recipients = Array.isArray(order.notificationRecipients) ? order.notificationRecipients : [];
  const preferred = recipients.find((recipient) => recipient?.technicianArrival === true && normalizedText(recipient.whatsapp || recipient.phone));
  if (preferred) {
    return {
      name: normalizedText(preferred.name) || normalizedText(client?.name || client?.company) || "Cliente",
      role: normalizedText(preferred.role),
      phone: normalizedText(preferred.whatsapp || preferred.phone),
      source: "technician-arrival",
    };
  }
  return {
    name: normalizedText(client?.name || client?.company) || "Cliente",
    role: "",
    phone: normalizedText(client?.whatsapp || client?.phone),
    source: "primary-customer",
  };
}

function renderVanWorkOrderText({ van, order, client, property, appointment, staffById, sequence }) {
  const start = formatClock(order.time);
  const end = formatClock(order.appointmentEndTime);
  const contact = arrivalContact(order, client);
  const team = staffFirstNamesForOrder(order, staffById);
  const description = customerDescription(order);
  const instructions = technicianInstructions(appointment, order);
  const access = propertyAccessInstructions(property);
  const district = geographicDistrict(property);
  const zone = geographicZone(property);
  const vanLabel = normalizedText(van.name || van.id) || "Van";
  const headerLabel = team.length ? `${vanLabel} · ${team.join(" y ")}` : vanLabel;

  const header = [
    `*DEMAC · ${headerLabel}*`,
    `*Trabajo ${sequence} · ${formatScheduleDate(order.date)}*`,
  ];

  const customerBlock = [
    `*Hora:* ${start}${order.appointmentEndTime ? ` – ${end}` : ""}`,
    `*Cliente:* ${normalizedText(client?.name || client?.company || order.clientName) || "Cliente"}`,
  ];
  if (contact.source === "technician-arrival" && contact.name) {
    customerBlock.push(`*Contacto:* ${contact.name}${contact.role ? ` · ${contact.role}` : ""}`);
  }

  const locationBlock = [
    `*Dirección:* ${normalizedText(order.address || property?.address || property?.addressRaw) || "Dirección pendiente"}`,
  ];
  if (district) locationBlock.push(`*Distrito:* ${district}`);
  if (zone) locationBlock.push(`*Zona:* ${zone}`);
  if (access) locationBlock.push(`*Acceso:* ${access}`);

  const workBlock = [`*Trabajo:* ${workSummary(order)}`];
  if (description) workBlock.push(`*Descripción:* ${description}`);

  const blocks = [header, customerBlock, locationBlock, workBlock];
  if (instructions) blocks.push([`*Instrucciones técnico:* ${instructions}`]);
  return blocks.map((block) => block.filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
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

  async function queueDay(dateKey, { targetVanId = "", deliveryKey = "auto", reason = "daily-van-schedule" } = {}) {
    const day = await loadDay(dateKey);
    const canonicalTarget = targetVanId ? resolveCanonicalVanId(targetVanId) : "";
    const vans = day.vans.filter((van) => !canonicalTarget || van.id === canonicalTarget);
    const results = [];
    let workOrderCount = 0;
    for (const van of vans) {
      const orders = day.workOrders
        .filter((order) => order.vanId === van.id)
        .sort((a, b) => orderTimeKey(a).localeCompare(orderTimeKey(b)) || String(a.id || "").localeCompare(String(b.id || "")));
      workOrderCount += orders.length;
      for (let index = 0; index < orders.length; index += 1) {
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
    return {
      dateKey,
      vanCount: vans.length,
      workOrderCount,
      messageCount: results.length,
      results,
    };
  }

  return {
    loadDay,
    queueDay,
    queueWorkOrder,
  };
}

module.exports.DEFAULT_VAN_GROUP_NAMES = DEFAULT_VAN_GROUP_NAMES;
module.exports.INACTIVE_WORK_ORDER_STATUSES = INACTIVE_WORK_ORDER_STATUSES;
module.exports.VAN_DAILY_LANGUAGE = VAN_DAILY_LANGUAGE;
module.exports.activeWorkOrder = activeWorkOrder;
module.exports.arrivalContact = arrivalContact;
module.exports.createTechnicianDailyScheduleService = createTechnicianDailyScheduleService;
module.exports.customerDescription = customerDescription;
module.exports.deterministicQueueId = deterministicQueueId;
module.exports.firstName = firstName;
module.exports.formatScheduleDate = formatScheduleDate;
module.exports.geographicDistrict = geographicDistrict;
module.exports.geographicZone = geographicZone;
module.exports.groupConfigForVan = groupConfigForVan;
module.exports.propertyAccessInstructions = propertyAccessInstructions;
module.exports.renderVanWorkOrderText = renderVanWorkOrderText;
module.exports.staffFirstNamesForOrder = staffFirstNamesForOrder;
module.exports.staffNamesForOrder = staffNamesForOrder;
module.exports.technicianInstructions = technicianInstructions;
module.exports.workSummary = workSummary;
