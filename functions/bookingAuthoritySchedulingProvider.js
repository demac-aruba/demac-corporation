const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
} = require("./bookingAuthorityCore");
const {
  MAX_SEARCH_DAYS,
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
} = require("./bookingSchedulingPrimitives");
const {
  candidateAvailability,
  normalizeOrderTime,
} = require("./bookingCapacityAvailability");
const {
  CANONICAL_SCHEDULING_ENGINE_VERSION,
  generateCanonicalOptions,
} = require("./bookingAuthoritySchedulingEngine");
const { canonicalizeSchedulingData } = require("./bookingVanIdentity");

const SCHEDULING_PROVIDER_VERSION = "erp-booking-scheduling-provider-v2";

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
  return canonicalizeSchedulingData({
    workOrders: snapshotItems(workOrderSnapshot),
    services: snapshotItems(serviceSnapshot),
    properties: snapshotItems(propertySnapshot),
    clients: snapshotItems(clientSnapshot),
    vans: snapshotItems(vanSnapshot).filter((van) => van.active !== false),
    staffProfiles: snapshotItems(staffSnapshot),
    dailyVanAssignments: snapshotItems(assignmentSnapshot),
    staffAbsences: snapshotItems(absenceSnapshot),
    calendarClosures: snapshotItems(closureSnapshot),
    businessSettings: snapshotItems(businessSnapshot),
    vanHalfDaySchedules: snapshotItems(halfDaySnapshot),
  });
}

function dataWithoutAppointment(data, appointmentId) {
  const excluded = cleanText(appointmentId, 180);
  if (!excluded) return data;
  return {
    ...data,
    workOrders: data.workOrders.filter((order) => cleanText(order.appointmentId, 180) !== excluded),
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
    engineVersion: CANONICAL_SCHEDULING_ENGINE_VERSION,

    async checkAvailability({ request, context = {}, now = new Date() }) {
      const nowParts = arubaDateParts(now);
      const today = nowParts.date;
      const loaded = await loadSchedulingData(db, today, addDays(today, MAX_SEARCH_DAYS));
      const data = dataWithoutAppointment(loaded, context.excludeAppointmentId);
      const { property } = exactCustomerProperty(data, request);
      const routeConfig = routeConfigFromSettings(data.businessSettings);
      const result = generateCanonicalOptions({
        request,
        property,
        data,
        routeConfig,
        today,
        currentTime: nowParts.time,
      });
      return {
        options: result.options,
        reason: result.reason,
        providerVersion: SCHEDULING_PROVIDER_VERSION,
        engineVersion: CANONICAL_SCHEDULING_ENGINE_VERSION,
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

    async revalidateSelection({ request, option, context = {}, now = new Date() }) {
      const nowParts = arubaDateParts(now);
      const today = nowParts.date;
      if (option.date < today || (option.date === today && option.time <= nowParts.time)) {
        return { available: false, reason: "selected-time-passed" };
      }
      const loaded = await loadSchedulingData(db, today, addDays(today, MAX_SEARCH_DAYS));
      const data = dataWithoutAppointment(loaded, context.excludeAppointmentId);
      const { property } = exactCustomerProperty(data, request);
      const routeConfig = routeConfigFromSettings(data.businessSettings);
      const candidateZone = propertyZone(property, option.address, routeConfig);
      const refreshedAssignments = [];
      for (const requested of option.assignments) {
        const van = data.vans.find((item) => item.id === requested.vanId);
        if (!van) return { available: false, reason: "van-unavailable", vanId: requested.vanId };
        const assignment = resolveAssignment(
          van,
          option.date,
          data.staffProfiles,
          data.dailyVanAssignments,
          data.staffAbsences,
        );
        const startTime = requested.time || option.time;
        const availability = candidateAvailability({
          date: option.date,
          time: startTime,
          allocation: {
            quantity: requested.quantity,
            slots: requested.slots,
            fullDay: requested.fullDay,
          },
          van,
          assignment,
          data,
          routeConfig,
          candidateZone,
        });
        if (!availability) {
          return { available: false, reason: "capacity-or-route-changed", vanId: requested.vanId };
        }
        refreshedAssignments.push({ ...availability, time: startTime });
      }
      return { available: true, option: { ...option, assignments: refreshedAssignments } };
    },

    async validateTransaction({ transaction, db: transactionDb, option, appointmentId }) {
      const sameDayQuery = transactionDb.collection("workOrders").where("date", "==", option.date);
      const [sameDaySnapshot, serviceSnapshot, halfDaySnapshot, vanSnapshot] = await Promise.all([
        transaction.get(sameDayQuery),
        transaction.get(transactionDb.collection("services")),
        transaction.get(transactionDb.collection("vanHalfDaySchedules")),
        transaction.get(transactionDb.collection("vans")),
      ]);
      const services = snapshotItems(serviceSnapshot);
      const canonical = canonicalizeSchedulingData({
        vans: snapshotItems(vanSnapshot),
        workOrders: snapshotItems(sameDaySnapshot),
        vanHalfDaySchedules: snapshotItems(halfDaySnapshot),
      });
      const halfDaySchedules = canonical.vanHalfDaySchedules;
      const sameDayOrders = canonical.workOrders
        .filter(orderBlocksCapacity)
        .filter((order) => order.appointmentId !== appointmentId);

      for (const assignment of option.assignments) {
        const halfDay = isHalfDay(assignment.vanId, option.date, halfDaySchedules);
        const startTime = assignment.time || option.time;
        const requestedSlots = occupiedSlots(startTime, assignment.slots, halfDay);
        if (!requestedSlots.length) return { available: false, reason: "invalid-slot-map" };
        const conflict = sameDayOrders.some((order) => {
          if (order.vanId !== assignment.vanId) return false;
          const existingSlots = occupiedSlots(
            normalizeOrderTime(order.time),
            orderSlotCount(order, services),
            halfDay,
          );
          return existingSlots.some((slot) => requestedSlots.includes(slot));
        });
        if (conflict) {
          return { available: false, reason: "work-order-conflict", vanId: assignment.vanId };
        }
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
  buildCapacityLocks,
  buildWorkOrders,
  createSchedulingProvider,
  dataWithoutAppointment,
  exactCustomerProperty,
  loadSchedulingData,
  notificationRecipient,
  routeConfigFromSettings,
};
