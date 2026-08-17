const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
} = require("./bookingAuthorityCore");
const {
  MAX_SEARCH_DAYS,
  MAX_VANS,
  addDays,
  arubaDateParts,
  hashId,
  isHalfDay,
  normalizeRouteConfig,
  occupiedSlots,
  orderBlocksCapacity,
  orderSlotCount,
  propertyZone,
  resolveAssignment,
  snapshotItems,
} = require("./whatsappCopilotSchedulingCore");
const {
  candidateAvailability,
  generateOptions,
  normalizeOrderTime,
} = require("./whatsappCopilotAvailability");

const SCHEDULING_PROVIDER_VERSION = "erp-scheduling-adapter-v1+legacy-capacity-engine";

async function loadSchedulingData(db, startDate, endDate) {
  const workOrderQuery = db.collection("workOrders").where("date", ">=", startDate).where("date", "<=", endDate);
  const [
    workOrderSnapshot,
    serviceSnapshot,
    propertySnapshot,
    clientSnapshot,
    vanSnapshot,
    staffSnapshot,
    assignmentSnapshot,
    absenceSnapshot,
    closureSnapshot,
    businessSnapshot,
    halfDaySnapshot,
  ] = await Promise.all([
    workOrderQuery.get(),
    db.collection("services").get(),
    db.collection("properties").get(),
    db.collection("clients").get(),
    db.collection("vans").get(),
    db.collection("staffProfiles").get(),
    db.collection("dailyVanAssignments").get(),
    db.collection("staffAbsences").get(),
    db.collection("calendarClosures").get(),
    db.collection("businessSettings").get(),
    db.collection("vanHalfDaySchedules").get(),
  ]);
  return {
    workOrders: snapshotItems(workOrderSnapshot),
    services: snapshotItems(serviceSnapshot),
    properties: snapshotItems(propertySnapshot),
    clients: snapshotItems(clientSnapshot),
    vans: snapshotItems(vanSnapshot).filter((van) => van.active !== false).slice(0, MAX_VANS),
    staffProfiles: snapshotItems(staffSnapshot),
    dailyVanAssignments: snapshotItems(assignmentSnapshot),
    staffAbsences: snapshotItems(absenceSnapshot),
    calendarClosures: snapshotItems(closureSnapshot),
    businessSettings: snapshotItems(businessSnapshot),
    vanHalfDaySchedules: snapshotItems(halfDaySnapshot),
  };
}

function routeConfigFromSettings(settings) {
  return normalizeRouteConfig((settings || []).find((item) => item.id === "whatsapp-copilot-routing"));
}

function exactCustomerProperty(data, request) {
  const client = data.clients.find((item) => item.id === request.customerId);
  if (!client) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.CUSTOMER_NOT_FOUND,
      "The customer no longer exists in the ERP.",
      { customerId: request.customerId },
    );
  }
  const property = data.properties.find((item) => item.id === request.propertyId);
  if (!property) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.PROPERTY_NOT_FOUND,
      "The property no longer exists in the ERP.",
      { propertyId: request.propertyId },
    );
  }
  if (cleanText(property.clientId, 160) !== request.customerId) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.PROPERTY_CUSTOMER_MISMATCH,
      "The property does not belong to the customer.",
      { customerId: request.customerId, propertyId: request.propertyId },
    );
  }
  return { client, property };
}

function singlePresetWork(request) {
  const workLines = Array.isArray(request.workLines) ? request.workLines : [];
  const presetIds = [...new Set(workLines.map((line) => cleanText(line.presetId, 120)).filter(Boolean))];
  if (presetIds.length !== 1) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "The current scheduling engine requires one appointment preset per booking request.",
      { presetIds },
    );
  }
  return {
    presetId: presetIds[0],
    quantity: workLines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 0), 0),
  };
}

function analysisForRequest(request, property) {
  const work = singlePresetWork(request);
  const address = cleanText(property.address || property.addressRaw || property.addressNormalized, 500);
  return {
    language: "es",
    intent: "appointment",
    summary: "Canonical booking request",
    collectedInformation: {
      serviceType: work.presetId,
      quantity: String(work.quantity),
      address,
      requestedDate: request.constraints?.requestedDate || "",
      requestedTime: request.constraints?.requestedTime || "",
      preferredTime: request.constraints?.preferredTime || "",
    },
  };
}

function requestContextForEngine(request, client) {
  const hints = [
    request.constraints?.requestedDate,
    request.constraints?.requestedTime,
    request.constraints?.preferredTime,
  ].filter(Boolean).join(" ");
  return {
    contactPhone: client.whatsapp || client.phone || "",
    chatTitle: client.name || client.company || "",
    latestCustomerTurn: hints,
  };
}

function buildCapacityLocks(option, halfDaySchedules = []) {
  const locks = [];
  for (const assignment of option.assignments || []) {
    const halfDay = isHalfDay(assignment.vanId, option.date, halfDaySchedules);
    const startTime = assignment.time || option.time;
    const slots = occupiedSlots(startTime, assignment.slots, halfDay);
    if (!slots.length) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
        "The selected assignment no longer maps to valid scheduling slots.",
        { date: option.date, vanId: assignment.vanId, startTime, slots: assignment.slots },
      );
    }
    slots.forEach((slot) => {
      locks.push({
        id: `BAL-${hashId(`${option.date}|${assignment.vanId}|${slot}`, 32).toUpperCase()}`,
        date: option.date,
        vanId: assignment.vanId,
        slot,
      });
    });
  }
  return locks;
}

function notificationRecipient(client) {
  const target = cleanText(client?.whatsapp || client?.phone, 80);
  if (!target) return null;
  return {
    id: `client-${client.id}`,
    recipientType: "client",
    sourceId: client.id,
    name: client.name || "Cliente",
    role: "Cliente / facturación",
    phone: client.phone || "",
    phoneCountry: client.phoneCountry || "AW",
    whatsapp: client.whatsapp || client.phone || "",
    whatsappCountry: client.whatsappCountry || client.phoneCountry || "AW",
    preferredLanguage: client.preferredLanguage || "Español",
    sendConfirmation: true,
    sendReminder: true,
  };
}

function buildWorkOrders({ appointment, option, request, customer, property, now = new Date() }) {
  const primaryWork = request.workLines[0];
  const recipient = notificationRecipient(customer);
  const supportCount = Math.max(0, option.assignments.length - 1);
  return option.assignments.map((assignment, index) => {
    const id = `WO-${appointment.appointmentId}-${index + 1}`;
    const quantity = assignment.quantity;
    const equipmentLabel = quantity === 1 ? "1 aire acondicionado" : `${quantity} aires acondicionados`;
    const presetLabel = option.presetLabel || primaryWork.presetId;
    const problem = `${presetLabel} para ${equipmentLabel}.`;
    const isPrimary = index === 0;
    const workItem = {
      id: primaryWork.id || primaryWork.presetId,
      presetId: primaryWork.presetId,
      serviceId: primaryWork.serviceId || option.serviceId || "",
      label: presetLabel,
      quantity,
      durationMinutesPerUnit: option.durationMinutesPerUnit,
    };
    return {
      id,
      appointmentId: appointment.appointmentId,
      clientId: customer.id,
      propertyId: property.id,
      serviceId: primaryWork.serviceId || option.serviceId || "",
      date: option.date,
      time: assignment.time || option.time,
      status: "Confirmada",
      technicianIds: assignment.technicianIds || [],
      vanId: assignment.vanId,
      address: option.address || property.address || property.addressRaw || "",
      zone: option.zone || property.operationalZone || property.zone || "",
      problem: isPrimary ? problem : `Apoyo a la cita principal: ${problem}`,
      officeNotes: isPrimary
        ? `Cita creada por DEMAC Booking Authority${supportCount ? ` con ${supportCount} van(es) de apoyo` : ""}.`
        : "Asignación interna de van de apoyo. No enviar confirmación ni recordatorio duplicado.",
      appointmentWorkType: primaryWork.presetId,
      appointmentPresetId: primaryWork.presetId,
      appointmentWorkLabel: presetLabel,
      appointmentDurationMinutes: quantity * option.durationMinutesPerUnit,
      appointmentWorkItems: [workItem],
      appointmentAssignmentRole: isPrimary ? "primary" : "support",
      parentWorkOrderId: isPrimary ? undefined : `WO-${appointment.appointmentId}-1`,
      fullDaySingleProperty: assignment.fullDay === true,
      amount: 0,
      paid: 0,
      schedulingMode: "perUnit",
      airConditionerCount: quantity,
      scheduledSlots: assignment.slots,
      whatsappNotificationsEnabled: isPrimary && Boolean(recipient),
      notificationRecipients: isPrimary && recipient ? [recipient] : [],
      confirmedAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      createdBy: "booking-authority",
    };
  });
}

function createSchedulingProvider({ db }) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");

  return {
    version: SCHEDULING_PROVIDER_VERSION,

    async checkAvailability({ request, now = new Date() }) {
      const today = arubaDateParts(now).date;
      const data = await loadSchedulingData(db, today, addDays(today, MAX_SEARCH_DAYS));
      const { client, property } = exactCustomerProperty(data, request);
      const analysis = analysisForRequest(request, property);
      const routeConfig = routeConfigFromSettings(data.businessSettings);
      const engineRequest = requestContextForEngine(request, client);
      const result = generateOptions({ analysis, request: engineRequest, data, routeConfig, today, currentTime: arubaDateParts(now).time });
      const address = cleanText(property.address || property.addressRaw || property.addressNormalized, 500);
      return {
        options: result.options.map((option) => ({ ...option, address: option.address || address })),
        reason: result.reason,
        providerVersion: SCHEDULING_PROVIDER_VERSION,
        metadata: {
          requestedDate: result.requestedDate || "",
          requestedTime: result.requestedTime || "",
          requestedDateUnavailable: result.requestedDateUnavailable === true,
          requestedTimeUnavailable: result.requestedTimeUnavailable === true,
          routeZone: result.candidateZone?.label || "",
          vansRequired: result.allocations?.length || 0,
        },
      };
    },

    async revalidateSelection({ request, option, now = new Date() }) {
      const today = arubaDateParts(now).date;
      if (option.date < today || (option.date === today && option.time <= arubaDateParts(now).time)) {
        return { available: false, reason: "selected-time-passed" };
      }
      const data = await loadSchedulingData(db, today, addDays(today, MAX_SEARCH_DAYS));
      const { property } = exactCustomerProperty(data, request);
      const routeConfig = routeConfigFromSettings(data.businessSettings);
      const candidateZone = propertyZone(property, option.address, routeConfig);
      const refreshedAssignments = [];
      for (const requested of option.assignments) {
        const van = data.vans.find((item) => item.id === requested.vanId);
        if (!van) return { available: false, reason: "van-unavailable", vanId: requested.vanId };
        const assignment = resolveAssignment(van, option.date, data.staffProfiles, data.dailyVanAssignments, data.staffAbsences);
        const startTime = requested.time || option.time;
        const availability = candidateAvailability({
          date: option.date,
          time: startTime,
          allocation: { quantity: requested.quantity, slots: requested.slots, fullDay: requested.fullDay },
          van,
          assignment,
          data,
          routeConfig,
          candidateZone,
        });
        if (!availability) return { available: false, reason: "capacity-or-route-changed", vanId: requested.vanId };
        refreshedAssignments.push({ ...availability, time: startTime });
      }
      return { available: true, option: { ...option, assignments: refreshedAssignments } };
    },

    async validateTransaction({ transaction, db: transactionDb, option, appointmentId }) {
      const sameDayQuery = transactionDb.collection("workOrders").where("date", "==", option.date);
      const [sameDaySnapshot, serviceSnapshot, halfDaySnapshot] = await Promise.all([
        transaction.get(sameDayQuery),
        transaction.get(transactionDb.collection("services")),
        transaction.get(transactionDb.collection("vanHalfDaySchedules")),
      ]);
      const services = snapshotItems(serviceSnapshot);
      const halfDaySchedules = snapshotItems(halfDaySnapshot);
      const sameDayOrders = snapshotItems(sameDaySnapshot)
        .filter(orderBlocksCapacity)
        .filter((order) => order.appointmentId !== appointmentId);

      for (const assignment of option.assignments) {
        const halfDay = isHalfDay(assignment.vanId, option.date, halfDaySchedules);
        const startTime = assignment.time || option.time;
        const requestedSlots = occupiedSlots(startTime, assignment.slots, halfDay);
        if (!requestedSlots.length) return { available: false, reason: "invalid-slot-map" };
        const conflict = sameDayOrders.some((order) => {
          if (order.vanId !== assignment.vanId) return false;
          const existingSlots = occupiedSlots(normalizeOrderTime(order.time), orderSlotCount(order, services), halfDay);
          return existingSlots.some((slot) => requestedSlots.includes(slot));
        });
        if (conflict) return { available: false, reason: "work-order-conflict", vanId: assignment.vanId };
      }

      return {
        available: true,
        capacityLocks: buildCapacityLocks(option, halfDaySchedules),
      };
    },

    async buildWorkOrders(args) {
      return buildWorkOrders(args);
    },
  };
}

module.exports = {
  SCHEDULING_PROVIDER_VERSION,
  analysisForRequest,
  buildCapacityLocks,
  buildWorkOrders,
  createSchedulingProvider,
  exactCustomerProperty,
  loadSchedulingData,
  notificationRecipient,
  requestContextForEngine,
  routeConfigFromSettings,
  singlePresetWork,
};
