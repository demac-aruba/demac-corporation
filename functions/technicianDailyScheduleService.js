const { createWhatsAppTransactionalService, normalizeWhatsAppPhone, safeDocumentId } = require("./whatsappTransactionalService");

const TECHNICIAN_DAILY_TEMPLATE = "technician_daily_schedule";
const TECHNICIAN_DAILY_LANGUAGE = "es";
const INACTIVE_WORK_ORDER_STATUSES = new Set([
  "Solicitud recibida",
  "Reserva temporal",
  "Cancelada",
  "Reprogramada",
  "Completada",
  "Facturada",
  "Pagada",
]);

function normalizedText(value) {
  return String(value ?? "").trim();
}

function isTechnicianProfile(profile) {
  if (!profile || profile.active === false) return false;
  const employeeType = normalizedText(profile.employeeType).toLowerCase();
  const role = normalizedText(profile.role).toLowerCase();
  return employeeType.includes("técnic")
    || employeeType.includes("tecnic")
    || employeeType.includes("technician")
    || role.includes("técnic")
    || role.includes("tecnic")
    || role.includes("technician")
    || role.includes("hvac")
    || role.includes("ayudante")
    || role.includes("helper");
}

function absenceCoversDate(absence, dateKey) {
  if (!absence || absence.active === false) return false;
  const fromDate = normalizedText(absence.fromDate || absence.date);
  const toDate = normalizedText(absence.toDate || absence.date || absence.fromDate);
  return Boolean(fromDate && toDate && fromDate <= dateKey && dateKey <= toDate);
}

function technicianAvailableOnDate(profile, absences, dateKey) {
  if (!isTechnicianProfile(profile)) return false;
  return !(Array.isArray(absences) ? absences : []).some((absence) =>
    absence.staffId === profile.id && absenceCoversDate(absence, dateKey));
}

function activeWorkOrder(order) {
  return Boolean(order) && !INACTIVE_WORK_ORDER_STATUSES.has(normalizedText(order.status));
}

function assignedToTechnician(order, staffId) {
  return activeWorkOrder(order)
    && Array.isArray(order.technicianIds)
    && order.technicianIds.map(String).includes(String(staffId));
}

function orderTimeKey(order) {
  return normalizedText(order.time || "99:99").padStart(5, "0");
}

function workSummary(order) {
  const workItems = Array.isArray(order.appointmentWorkItems) ? order.appointmentWorkItems : [];
  if (workItems.length) {
    return workItems
      .map((item) => {
        const label = normalizedText(item.label || item.presetId || item.serviceId || "Trabajo");
        const quantity = Math.max(1, Number(item.quantity) || 1);
        return quantity > 1 ? `${label} x${quantity}` : label;
      })
      .join("; ");
  }
  return normalizedText(order.appointmentWorkLabel || order.problem || order.serviceId || "Trabajo programado");
}

function clientNameForOrder(order, clientsById = new Map()) {
  const client = clientsById.get(String(order.clientId || ""));
  return normalizedText(client?.name || client?.company || order.clientName || "Cliente");
}

function scheduleLine(order, index, clientsById = new Map()) {
  const start = normalizedText(order.time || "Hora pendiente");
  const end = normalizedText(order.appointmentEndTime);
  const time = end ? `${start}-${end}` : start;
  const client = clientNameForOrder(order, clientsById);
  const address = normalizedText(order.address || "Dirección pendiente");
  const work = workSummary(order);
  const van = normalizedText(order.vanId);
  return `${index + 1}. ${time} | ${client} | ${address} | ${work}${van ? ` | ${van}` : ""}`;
}

function buildTechnicianAgendaText(orders, clientsById = new Map()) {
  const sorted = [...(Array.isArray(orders) ? orders : [])]
    .filter(activeWorkOrder)
    .sort((a, b) => orderTimeKey(a).localeCompare(orderTimeKey(b)) || String(a.id || "").localeCompare(String(b.id || "")));
  if (!sorted.length) {
    return "No tienes trabajos asignados en el ERP a las 8:00 AM. Revisa el ERP antes de salir por cualquier actualización.";
  }
  return sorted.map((order, index) => scheduleLine(order, index, clientsById)).join("\n");
}

function formatScheduleDate(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function renderTechnicianScheduleText(name, date, agenda) {
  return [
    `Hola ${name},`,
    "",
    `Esta es tu agenda de trabajo de DEMAC para ${date}:`,
    "",
    agenda,
    "",
    "Revisa el ERP antes de salir por cualquier cambio o actualización.",
  ].join("\n");
}

function createTechnicianDailyScheduleService({ db } = {}) {
  if (!db || typeof db.collection !== "function") {
    throw new Error("A Firestore-compatible db is required for technician daily schedules.");
  }
  const whatsapp = createWhatsAppTransactionalService({ db });

  async function loadClients(orders) {
    const ids = [...new Set((orders || []).map((order) => normalizedText(order.clientId)).filter(Boolean))];
    const entries = await Promise.all(ids.map(async (id) => {
      const snapshot = await db.collection("clients").doc(id).get();
      return snapshot.exists ? [id, { id: snapshot.id, ...snapshot.data() }] : [id, null];
    }));
    return new Map(entries.filter(([, value]) => value));
  }

  async function loadDay(dateKey) {
    const [staffSnapshot, absenceSnapshot, workOrderSnapshot] = await Promise.all([
      db.collection("staffProfiles").get(),
      db.collection("staffAbsences").get(),
      db.collection("workOrders").where("date", "==", dateKey).get(),
    ]);
    const staffProfiles = staffSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    const absences = absenceSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    const workOrders = workOrderSnapshot.docs.map((document) => ({ id: document.id, ...document.data() })).filter(activeWorkOrder);
    const clientsById = await loadClients(workOrders);
    return { staffProfiles, absences, workOrders, clientsById };
  }

  async function queueTechnicianSchedule({ technician, dateKey, orders, clientsById }) {
    const to = technician.whatsapp || technician.phone;
    const normalizedTo = normalizeWhatsAppPhone(to);
    const queueId = safeDocumentId(`technician-daily-schedule-${dateKey}-${technician.id}`);
    const technicianName = normalizedText(technician.name || "Técnico");
    const scheduleDate = formatScheduleDate(dateKey);
    const agenda = buildTechnicianAgendaText(orders, clientsById);
    const result = await whatsapp.queueTransactionalMessage({
      queueId,
      to,
      text: renderTechnicianScheduleText(technicianName, scheduleDate, agenda),
      templateName: TECHNICIAN_DAILY_TEMPLATE,
      languageCode: TECHNICIAN_DAILY_LANGUAGE,
      bodyParameters: [technicianName, scheduleDate, agenda],
      metadata: {
        notificationType: "technician-daily-schedule",
        recipientType: "staff",
        recipientId: technician.id,
        recipientName: technician.name || null,
        technicianId: technician.id,
        scheduleDate: dateKey,
      },
    });
    return { ...result, technicianId: technician.id, technicianName: technician.name || technician.id, to: normalizedTo };
  }

  async function queueDay(dateKey) {
    const day = await loadDay(dateKey);
    const technicians = day.staffProfiles
      .filter((profile) => technicianAvailableOnDate(profile, day.absences, dateKey))
      .sort((a, b) => normalizedText(a.name).localeCompare(normalizedText(b.name)));
    const results = [];
    for (const technician of technicians) {
      const orders = day.workOrders.filter((order) => assignedToTechnician(order, technician.id));
      results.push(await queueTechnicianSchedule({ technician, dateKey, orders, clientsById: day.clientsById }));
    }
    return {
      dateKey,
      technicianCount: technicians.length,
      results,
    };
  }

  return {
    loadDay,
    queueDay,
    queueTechnicianSchedule,
  };
}

module.exports.INACTIVE_WORK_ORDER_STATUSES = INACTIVE_WORK_ORDER_STATUSES;
module.exports.TECHNICIAN_DAILY_LANGUAGE = TECHNICIAN_DAILY_LANGUAGE;
module.exports.TECHNICIAN_DAILY_TEMPLATE = TECHNICIAN_DAILY_TEMPLATE;
module.exports.absenceCoversDate = absenceCoversDate;
module.exports.activeWorkOrder = activeWorkOrder;
module.exports.assignedToTechnician = assignedToTechnician;
module.exports.buildTechnicianAgendaText = buildTechnicianAgendaText;
module.exports.createTechnicianDailyScheduleService = createTechnicianDailyScheduleService;
module.exports.formatScheduleDate = formatScheduleDate;
module.exports.isTechnicianProfile = isTechnicianProfile;
module.exports.renderTechnicianScheduleText = renderTechnicianScheduleText;
module.exports.technicianAvailableOnDate = technicianAvailableOnDate;
module.exports.workSummary = workSummary;
