const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
} = require("./bookingAuthorityCore");
const {
  MAX_SEARCH_DAYS,
  addDays,
  arubaDateParts,
  halfDaySchedule,
  hashId,
  normalizeRouteConfig,
  propertyZone,
  resolveAssignment,
  snapshotItems,
} = require("./bookingSchedulingPrimitives");
const {
  candidateAvailability,
  capacityLockSlots,
  evaluateCandidateAvailability,
} = require("./bookingCapacityAvailability");
const {
  CANONICAL_SCHEDULING_ENGINE_VERSION,
  buildAllocationPlan,
  buildExactTargetDiagnostic,
  dateClosed,
  exactPreset,
  generateCanonicalOptions,
  normalizeOperationalRules,
  serviceIdForRequest,
  singleWork,
} = require("./bookingAuthoritySchedulingEngine");
const { buildWorkOrders: projectCanonicalWorkOrders } = require("./bookingAuthorityWorkOrders");
const { canonicalizeSchedulingData } = require("./bookingVanIdentity");

const SCHEDULING_PROVIDER_VERSION = "erp-booking-scheduling-provider-v16";

function uniqueIds(values = []) {
  return [...new Set(values.map((value) => cleanText(value, 180)).filter(Boolean))];
}

function documentItem(snapshot) {
  if (!snapshot?.exists) return null;
  return { id: snapshot.id, ...(snapshot.data() || {}) };
}

async function loadSchedulingData(db, startDate, endDate, {
  transaction = null,
  request = null,
  targetVanIds = [],
} = {}) {
  const workOrderQuery = startDate === endDate
    ? db.collection("workOrders").where("date", "==", startDate)
    : db.collection("workOrders").where("date", ">=", startDate).where("date", "<=", endDate);
  const read = (reference) => transaction ? transaction.get(reference) : reference.get();
  const dateRangeQuery = (collectionName) => startDate === endDate
    ? db.collection(collectionName).where("date", "==", startDate)
    : db.collection(collectionName).where("date", ">=", startDate).where("date", "<=", endDate);
  const requestedVanIds = uniqueIds(targetVanIds);
  const businessSettingIds = [
    "appointment-work-presets",
    "business-calendar",
    "company-operational-rules",
    "whatsapp-copilot-routing",
  ];
  const [
    workOrderSnapshot,
    assignmentSnapshot,
    closureSnapshot,
    vanSnapshots,
    businessSnapshots,
  ] = await Promise.all([
    read(workOrderQuery),
    read(dateRangeQuery("dailyVanAssignments")),
    read(dateRangeQuery("calendarClosures")),
    requestedVanIds.length
      ? Promise.all(requestedVanIds.map((id) => read(db.collection("vans").doc(id))))
      : read(db.collection("vans")),
    Promise.all(businessSettingIds.map((id) => read(db.collection("businessSettings").doc(id)))),
  ]);
  const workOrders = snapshotItems(workOrderSnapshot);
  const dailyVanAssignments = snapshotItems(assignmentSnapshot);
  const vans = (Array.isArray(vanSnapshots)
    ? vanSnapshots.map(documentItem).filter(Boolean)
    : snapshotItems(vanSnapshots)).filter((van) => van.active !== false);
  const canonicalVanIds = uniqueIds(vans.map((van) => van.id));
  const selectedAssignments = dailyVanAssignments.filter((assignment) => canonicalVanIds.includes(assignment.vanId));
  const staffIds = uniqueIds([
    ...vans.flatMap((van) => [van.responsibleStaffId, van.regularHelperId, van.additionalHelperId]),
    ...selectedAssignments.flatMap((assignment) => [
      assignment.driverStaffId,
      assignment.helperStaffId,
      assignment.additionalHelperStaffId,
    ]),
  ]);
  const requestServiceIds = uniqueIds((request?.workLines || []).map((line) => line.serviceId));
  const workOrderServiceIds = uniqueIds(workOrders.map((order) => order.serviceId));
  const serviceIds = uniqueIds([...requestServiceIds, ...workOrderServiceIds]);
  const propertyIds = uniqueIds([
    request?.propertyId,
    ...workOrders.map((order) => order.propertyId),
  ]);
  const clientIds = uniqueIds([request?.customerId]);
  const requiresCatalogFallback = (request?.workLines || []).some((line) => !cleanText(line.serviceId, 180));
  const [
    staffSnapshots,
    absenceSnapshots,
    halfDaySnapshots,
    serviceSnapshots,
    propertySnapshots,
    clientSnapshots,
  ] = await Promise.all([
    Promise.all(staffIds.map((id) => read(db.collection("staffProfiles").doc(id)))),
    Promise.all(staffIds.map((id) => read(db.collection("staffAbsences").where("staffId", "==", id)))),
    Promise.all(canonicalVanIds.map((id) => read(db.collection("vanHalfDaySchedules").where("vanId", "==", id)))),
    requiresCatalogFallback
      ? read(db.collection("services"))
      : Promise.all(serviceIds.map((id) => read(db.collection("services").doc(id)))),
    Promise.all(propertyIds.map((id) => read(db.collection("properties").doc(id)))),
    Promise.all(clientIds.map((id) => read(db.collection("clients").doc(id)))),
  ]);
  const services = Array.isArray(serviceSnapshots)
    ? serviceSnapshots.map(documentItem).filter(Boolean)
    : snapshotItems(serviceSnapshots);
  const staffAbsences = absenceSnapshots
    .flatMap(snapshotItems)
    .filter((absence) => absence.active !== false
      && cleanText(absence.fromDate, 20) <= endDate
      && cleanText(absence.toDate, 20) >= startDate);
  return canonicalizeSchedulingData({
    workOrders,
    services,
    properties: propertySnapshots.map(documentItem).filter(Boolean),
    clients: clientSnapshots.map(documentItem).filter(Boolean),
    vans,
    staffProfiles: staffSnapshots.map(documentItem).filter(Boolean),
    dailyVanAssignments: selectedAssignments,
    staffAbsences,
    calendarClosures: snapshotItems(closureSnapshot),
    businessSettings: businessSnapshots.map(documentItem).filter(Boolean),
    vanHalfDaySchedules: halfDaySnapshots.flatMap(snapshotItems),
  });
}

async function loadAppointmentSchedule(db, appointmentId, { transaction = null } = {}) {
  const id = cleanText(appointmentId, 180);
  if (!id) return null;
  const reference = db.collection("appointments").doc(id);
  const snapshot = await (transaction ? transaction.get(reference) : reference.get());
  if (!snapshot.exists) return null;
  const appointment = snapshot.data() || {};
  const assignments = Array.isArray(appointment.assignments) ? appointment.assignments : [];
  const primary = assignments.find((item) => cleanText(item?.role, 40) !== "support") || assignments[0] || {};
  return {
    date: cleanText(appointment.date, 20),
    time: cleanText(appointment.startTime || primary.time, 20),
  };
}

function operationalMoveDateAllowed({ date, currentSchedule }) {
  const currentDate = cleanText(currentSchedule?.date, 20);
  return Boolean(date && currentDate && date === currentDate);
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

function explicitOfficeRoutePolicy({ context = {}, request = {}, option = null } = {}) {
  if (context.channel !== "office") return "enforced";
  const requestedDate = cleanText(request.constraints?.requestedDate, 20);
  const requestedTime = cleanText(request.constraints?.requestedTime, 20);
  const explicitPrimaryTarget = Boolean(
    cleanText(context.requiredPrimaryVanId, 120)
    && requestedDate
    && requestedTime,
  );
  const revalidatingExplicitTarget = option?.requestedDateMatch === true
    && option?.requestedTimeMatch === true;
  return explicitPrimaryTarget || revalidatingExplicitTarget ? "advisory" : "enforced";
}

function routeConfigForPolicy(settings, policy) {
  return {
    ...routeConfigFromSettings(settings),
    routePolicy: policy === "advisory" ? "advisory" : "enforced",
  };
}

function operationalRulesFromSettings(settings) {
  return normalizeOperationalRules((settings || []).find((item) => item.id === "company-operational-rules"));
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
    const halfDay = halfDaySchedule(assignment.vanId, option.date, halfDaySchedules) || false;
    const startTime = assignment.time || option.time;
    const slots = capacityLockSlots({
      time: startTime,
      durationMinutes: assignment.durationMinutes,
      slots: assignment.slots,
      halfDay,
      fullDay: assignment.fullDay,
    });
    if (!slots.length) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
        "The selected assignment no longer maps to valid scheduling capacity.",
        {
          date: option.date,
          vanId: assignment.vanId,
          startTime,
          durationMinutes: assignment.durationMinutes,
          slots: assignment.slots,
        },
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

function buildWorkOrders(args) {
  return projectCanonicalWorkOrders(args);
}

function operationalMoveResult({ request, property, data, routeConfig, date, time, vanId, currentSchedule }) {
  if (!date || !time || !vanId) return { option: null, reason: "missing-operational-move-target" };
  if (!operationalMoveDateAllowed({ date, currentSchedule })) {
    return { option: null, reason: "operational-move-date-mismatch" };
  }
  const calendarSettings = (data.businessSettings || []).find((item) => item.id === "business-calendar")
    || { closedWeekdays: [0] };
  if (dateClosed(date, calendarSettings, data.calendarClosures || [])) {
    return { option: null, reason: "requested-date-closed" };
  }

  const work = singleWork(request);
  const preset = exactPreset(data, work);
  const allocations = buildAllocationPlan(
    work.quantity,
    preset.durationMinutesPerUnit,
    1,
    preset,
    operationalRulesFromSettings(data.businessSettings),
  );
  if (allocations.length !== 1) return { option: null, reason: "multi-van-booking-requires-reschedule" };

  const van = data.vans.find((item) => item.id === vanId);
  if (!van) return { option: null, reason: "required-van-unavailable" };
  const assignment = resolveAssignment(
    van,
    date,
    data.staffProfiles,
    data.dailyVanAssignments,
    data.staffAbsences,
  );
  const candidateZone = propertyZone(property, property.address || property.addressRaw || "", routeConfig);
  const availability = candidateAvailability({
    date,
    time,
    allocation: allocations[0],
    van,
    assignment,
    data,
    routeConfig,
    candidateZone,
    manualOperationalMove: false,
  });
  if (!availability) return { option: null, reason: "operational-target-unavailable" };

  const address = cleanText(property.address || property.addressRaw || property.addressNormalized, 500);
  const option = {
    id: `opt-${hashId(`${date}|${time}|${vanId}|${work.quantity}|${preset.id}|${preset.serviceId || ""}|operational-move`, 16)}`,
    date,
    time,
    endTime: availability.endTime,
    quantity: work.quantity,
    address,
    zone: candidateZone?.label || cleanText(property.operationalZone || property.zone, 80),
    presetId: preset.id,
    presetLabel: preset.label,
    durationMinutesPerUnit: preset.durationMinutesPerUnit,
    durationMode: preset.durationMode || "per_unit",
    serviceDefinitionVersion: preset.serviceDefinitionVersion || 0,
    serviceId: serviceIdForRequest(request, preset, data.services),
    assignments: [{ ...availability, time, endTime: availability.endTime, role: "primary" }],
    score: 0,
    requestedDateMatch: true,
    requestedTimeMatch: true,
    largeSingleProperty: false,
    allDayCustomerNotice: false,
    internalSupportCount: 0,
  };
  return { option, reason: "available", preset, candidateZone, allocations };
}

function validateCanonicalSelection({ request, option, context = {}, now = new Date(), loadedData, currentSchedule = null }) {
  const nowParts = arubaDateParts(now);
  const operationalMove = context.changeKind === "operational_move";
  if (operationalMove && !operationalMoveDateAllowed({ date: option.date, currentSchedule })) {
    return { available: false, reason: "operational-move-date-mismatch" };
  }
  if (option.date < nowParts.date || (option.date === nowParts.date && option.time <= nowParts.time)) {
    return {
      available: false,
      reason: "selected-time-passed",
      rejection: { stage: "temporal", code: "START_TIME_PASSED" },
    };
  }

  const data = dataWithoutAppointment(loadedData, context.excludeAppointmentId);
  const calendarSettings = (data.businessSettings || []).find((item) => item.id === "business-calendar")
    || { closedWeekdays: [0] };
  if (dateClosed(option.date, calendarSettings, data.calendarClosures || [])) {
    return { available: false, reason: "requested-date-closed" };
  }

  const { property } = exactCustomerProperty(data, request);
  const routePolicy = explicitOfficeRoutePolicy({ context, request, option });
  const routeConfig = routeConfigForPolicy(data.businessSettings, routePolicy);
  const candidateZone = propertyZone(
    property,
    option.address || property.address || property.addressRaw || property.addressNormalized || "",
    routeConfig,
  );
  const refreshedAssignments = [];
  for (const requested of option.assignments || []) {
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
    const evaluated = evaluateCandidateAvailability({
      date: option.date,
      time: startTime,
      allocation: {
        quantity: requested.quantity,
        durationMinutes: requested.durationMinutes,
        slots: requested.slots,
        fullDay: requested.fullDay,
      },
      van,
      assignment,
      data,
      routeConfig,
      candidateZone,
      manualOperationalMove: false,
    });
    if (!evaluated.available) {
      return {
        available: false,
        reason: evaluated.rejection?.code
          || (operationalMove ? "operational-target-unavailable" : "capacity-or-route-changed"),
        vanId: requested.vanId,
        rejection: evaluated.rejection || null,
      };
    }
    const availability = evaluated.candidate;
    refreshedAssignments.push({
      ...availability,
      time: startTime,
      endTime: availability.endTime,
      role: requested.role,
    });
  }
  if (!refreshedAssignments.length) return { available: false, reason: "missing-assignments" };
  const primary = refreshedAssignments.find((assignment) => assignment.role !== "support") || refreshedAssignments[0];
  return {
    available: true,
    option: {
      ...option,
      endTime: primary?.endTime || option.endTime,
      capacityEndTime: primary?.capacityEndTime || option.capacityEndTime,
      assignments: refreshedAssignments,
    },
    data,
    routePolicy,
  };
}

function createSchedulingProvider({ db }) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");

  return {
    version: SCHEDULING_PROVIDER_VERSION,
    engineVersion: CANONICAL_SCHEDULING_ENGINE_VERSION,

    async checkAvailability({ request, context = {}, now = new Date() }) {
      const nowParts = arubaDateParts(now);
      const today = nowParts.date;
      const requiredPrimaryVanId = cleanText(context.requiredPrimaryVanId, 120);
      const requestedDate = cleanText(request.constraints?.requestedDate, 20);
      const requestedTime = cleanText(request.constraints?.requestedTime, 20);
      const operationalMove = context.changeKind === "operational_move" && requiredPrimaryVanId && requestedDate && requestedTime;
      const requestedDateGrid = context.availabilityMode === "requested_date_grid";
      const exactDateLoad = Boolean(requestedDate && (operationalMove || requestedDateGrid || requiredPrimaryVanId));
      const [loaded, currentSchedule] = operationalMove
        ? await Promise.all([
          loadSchedulingData(db, requestedDate, requestedDate, { request }),
          loadAppointmentSchedule(db, context.excludeAppointmentId),
        ])
        : [await loadSchedulingData(
          db,
          exactDateLoad ? requestedDate : today,
          exactDateLoad ? requestedDate : addDays(today, MAX_SEARCH_DAYS - 1),
          { request },
        ), null];
      const data = dataWithoutAppointment(loaded, context.excludeAppointmentId);
      const requiredVanUnavailable = Boolean(
        requiredPrimaryVanId
        && !data.vans.some((van) => van.id === requiredPrimaryVanId),
      );
      const { property } = exactCustomerProperty(data, request);
      const routePolicy = explicitOfficeRoutePolicy({ context, request });
      const routeConfig = routeConfigForPolicy(data.businessSettings, routePolicy);

      if (operationalMove) {
        if (requestedDate < today || (requestedDate === today && requestedTime <= nowParts.time)) {
          return {
            options: [],
            reason: "selected-time-passed",
            providerVersion: SCHEDULING_PROVIDER_VERSION,
            engineVersion: CANONICAL_SCHEDULING_ENGINE_VERSION,
            metadata: {
              requestedDate,
              requestedTime,
              requestedDateUnavailable: true,
              requestedTimeUnavailable: true,
              requiredPrimaryVanId,
              operationalMove: true,
              routePolicy,
              diagnostic: buildExactTargetDiagnostic({
                stage: "temporal",
                code: "START_TIME_PASSED",
                requestedDate,
                requestedTime,
                requiredPrimaryVanId,
                today,
                currentTime: nowParts.time,
              }),
            },
          };
        }
        const exact = operationalMoveResult({
          request,
          property,
          data,
          routeConfig,
          date: requestedDate,
          time: requestedTime,
          vanId: requiredPrimaryVanId,
          currentSchedule,
        });
        return {
          options: exact.option ? [exact.option] : [],
          reason: exact.reason,
          providerVersion: SCHEDULING_PROVIDER_VERSION,
          engineVersion: CANONICAL_SCHEDULING_ENGINE_VERSION,
          metadata: {
            requestedDate,
            requestedTime,
            requestedDateUnavailable: !exact.option,
            requestedTimeUnavailable: !exact.option,
            routeZone: exact.candidateZone?.label || "",
            vansRequired: exact.allocations?.length || 1,
            requiredPrimaryVanId,
            operationalMove: true,
            routePolicy,
          },
        };
      }

      const result = generateCanonicalOptions({
        request,
        property,
        data,
        routeConfig,
        today,
        currentTime: nowParts.time,
        requiredPrimaryVanId,
        requireRequestedTarget: Boolean(requiredPrimaryVanId),
        requestedDateGrid,
      });
      const options = result.options;
      return {
        options,
        reason: options.length
          ? result.reason
          : requiredVanUnavailable
            ? "required-van-unavailable"
            : requiredPrimaryVanId
              ? "required-primary-target-unavailable"
              : result.reason,
        providerVersion: SCHEDULING_PROVIDER_VERSION,
        engineVersion: CANONICAL_SCHEDULING_ENGINE_VERSION,
        metadata: {
          requestedDate: result.requestedDate || "",
          requestedTime: result.requestedTime || "",
          requestedDateUnavailable: result.requestedDateUnavailable === true,
          requestedTimeUnavailable: result.requestedTimeUnavailable === true,
          routeZone: result.candidateZone?.label || "",
          vansRequired: result.allocations?.length || 0,
          requiredPrimaryVanId: requiredPrimaryVanId || "",
          routePolicy,
          availabilityMode: requestedDateGrid ? "requested_date_grid" : "client_shortlist",
          resolvedWorkload: result.resolvedWorkload,
          diagnostic: result.diagnostic,
        },
      };
    },

    async revalidateSelection({ request, option, context = {}, now = new Date() }) {
      const operationalMove = context.changeKind === "operational_move";
      const currentSchedule = operationalMove
        ? await loadAppointmentSchedule(db, context.excludeAppointmentId)
        : null;
      const loaded = await loadSchedulingData(db, option.date, option.date, {
        request,
        targetVanIds: (option.assignments || []).map((assignment) => assignment.vanId),
      });
      return validateCanonicalSelection({ request, option, context, now, loadedData: loaded, currentSchedule });
    },

    async validateTransaction({ transaction, db: transactionDb, request, option, appointmentId, context = {}, now = new Date() }) {
      const operationalMove = context.changeKind === "operational_move";
      const [loaded, currentSchedule] = await Promise.all([
        loadSchedulingData(transactionDb, option.date, option.date, {
          transaction,
          request,
          targetVanIds: (option.assignments || []).map((assignment) => assignment.vanId),
        }),
        operationalMove
          ? loadAppointmentSchedule(transactionDb, context.excludeAppointmentId || appointmentId, { transaction })
          : Promise.resolve(null),
      ]);
      const validation = validateCanonicalSelection({
        request,
        option,
        context: { ...context, excludeAppointmentId: context.excludeAppointmentId || appointmentId },
        now,
        loadedData: loaded,
        currentSchedule,
      });
      if (!validation.available || !validation.option) return validation;
      return {
        available: true,
        option: validation.option,
        capacityLocks: buildCapacityLocks(validation.option, loaded.vanHalfDaySchedules),
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
  explicitOfficeRoutePolicy,
  loadAppointmentSchedule,
  loadSchedulingData,
  notificationRecipient,
  operationalMoveDateAllowed,
  operationalMoveResult,
  operationalRulesFromSettings,
  routeConfigForPolicy,
  routeConfigFromSettings,
  validateCanonicalSelection,
};
