const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
} = require("./bookingAuthorityCore");
const {
  EXTRA_MORNING_SLOT,
  MAX_SEARCH_DAYS,
  REGULAR_SLOTS,
  addDays,
  arubaDateParts,
  hashId,
  isHalfDay,
  normalizeTime,
  normalizeRouteConfig,
  orderBlocksCapacity,
  propertyZone,
  resolveAssignment,
  snapshotItems,
  vanCanReceiveAppointments,
} = require("./bookingSchedulingPrimitives");
const {
  assignmentCapacityInterval,
  candidateAvailability,
  capacityLockSlots,
  intervalsOverlap,
  workOrderBlocksOperationalMoveCapacity,
  workOrderCapacityInterval,
} = require("./bookingCapacityAvailability");
const {
  CANONICAL_SCHEDULING_ENGINE_VERSION,
  buildAllocationPlan,
  exactPreset,
  generateCanonicalOptions,
  normalizeOperationalRules,
  serviceIdForRequest,
  singleWork,
} = require("./bookingAuthoritySchedulingEngine");
const { buildWorkOrders: projectCanonicalWorkOrders } = require("./bookingAuthorityWorkOrders");
const { canonicalizeSchedulingData } = require("./bookingVanIdentity");

const SCHEDULING_PROVIDER_VERSION = "erp-booking-scheduling-provider-v15";
const BACKDATED_BOOKING_MODE = "backdated";

function backdatingIntent({ context = {}, offer = null } = {}) {
  const metadata = offer?.metadata || {};
  const bookingMode = cleanText(context.bookingMode || metadata.bookingMode, 40);
  const acknowledged = context.backdatingAcknowledged === true
    || metadata.backdatingAcknowledged === true;
  return context.channel === "office"
    && bookingMode === BACKDATED_BOOKING_MODE
    && acknowledged;
}

function requestedTargetPassed({ requestedDate, requestedTime, today, currentTime }) {
  const normalizedTime = normalizeTime(requestedTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || normalizedTime !== requestedTime) return false;
  return requestedDate < today || (requestedDate === today && normalizedTime <= currentTime);
}

function backdatingConfirmationRequired({ targetPassed, backdated, operationalMove }) {
  return targetPassed === true && backdated !== true && operationalMove !== true;
}

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

async function loadAppointmentSchedule(db, appointmentId) {
  const id = cleanText(appointmentId, 180);
  if (!id) return null;
  const snapshot = await db.collection("appointments").doc(id).get();
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
  if (context.channel !== "office" || context.changeKind === "operational_move") return "enforced";
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
    const halfDay = isHalfDay(assignment.vanId, option.date, halfDaySchedules);
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

function standardServicePreset(preset = {}) {
  const value = `${cleanText(preset.id, 120)} ${cleanText(preset.label, 180)}`.toLowerCase();
  return cleanText(preset.id, 120) === "standard_service"
    || /standard service|servicio estandar|servicio standard/.test(value);
}

function supportSelectionPolicy(result = {}) {
  const quantity = Math.max(0, Number(result.quantity) || 0);
  const preset = result.preset || {};
  const durationMinutes = Math.max(30, Number(preset.durationMinutesPerUnit) || 60);
  const capacity = result.operationalRules?.standardService || {};
  const primaryMax = Math.max(1, Number(capacity.singlePropertyMainVanMaxUnits) || 7);
  const policyMax = Math.max(1, Number(capacity.supportHalfDayMaxUnits) || 3);
  if (!standardServicePreset(preset) || durationMinutes !== 60 || quantity <= primaryMax) return null;
  const minimum = Math.max(1, quantity - primaryMax);
  const maximum = Math.min(quantity - 1, policyMax);
  if (minimum > maximum) return null;
  return { quantity, durationMinutes, primaryMax, minimum, maximum };
}

function supportSlotTimes() {
  return [...new Set([...REGULAR_SLOTS, EXTRA_MORNING_SLOT])].sort();
}

function supportSlotCandidates({ result, data, routeConfig, date, requiredPrimaryVanId }) {
  const policy = supportSelectionPolicy(result);
  if (!policy || !date || !requiredPrimaryVanId) return [];
  const candidates = [];
  const candidateZone = result.candidateZone;
  const allocation = {
    quantity: 1,
    durationMinutes: policy.durationMinutes,
    slots: 1,
    fullDay: false,
  };
  for (const van of data.vans) {
    if (van.id === requiredPrimaryVanId) continue;
    const assignment = resolveAssignment(
      van,
      date,
      data.staffProfiles,
      data.dailyVanAssignments,
      data.staffAbsences,
    );
    if (!vanCanReceiveAppointments(van, assignment)) continue;
    for (const time of supportSlotTimes()) {
      const available = candidateAvailability({
        date,
        time,
        allocation,
        van,
        assignment,
        data,
        routeConfig,
        candidateZone,
      });
      if (!available) continue;
      candidates.push({
        id: `support-${hashId(`${date}|${van.id}|${time}|${result.preset?.id || "standard_service"}`, 18)}`,
        vanId: van.id,
        vanName: van.name || van.id,
        time,
        endTime: available.endTime,
        capacityEndTime: available.capacityEndTime || available.endTime,
        durationMinutes: policy.durationMinutes,
        slots: 1,
      });
    }
  }
  return candidates.sort((left, right) => left.time.localeCompare(right.time) || left.vanId.localeCompare(right.vanId));
}

function cleanSupportSelectionIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, 120)).filter(Boolean))];
}

function clockMinutes(value) {
  const match = cleanText(value, 20).match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function contiguousSupportGroups(selectedCandidates) {
  const byVan = new Map();
  for (const candidate of selectedCandidates) {
    const current = byVan.get(candidate.vanId) || [];
    current.push(candidate);
    byVan.set(candidate.vanId, current);
  }
  const groups = [];
  for (const entries of byVan.values()) {
    const sorted = [...entries].sort((left, right) => left.time.localeCompare(right.time));
    let group = [];
    for (const candidate of sorted) {
      if (!group.length) {
        group = [candidate];
        continue;
      }
      const previous = group[group.length - 1];
      const previousEnd = clockMinutes(previous.endTime);
      const nextStart = clockMinutes(candidate.time);
      if (previousEnd !== null && nextStart !== null && previousEnd === nextStart) {
        group.push(candidate);
      } else {
        groups.push(group);
        group = [candidate];
      }
    }
    if (group.length) groups.push(group);
  }
  return groups.sort((left, right) => left[0].time.localeCompare(right[0].time) || left[0].vanId.localeCompare(right[0].vanId));
}

function composeSelectedSupportOption({
  result,
  request,
  property,
  data,
  routeConfig,
  requiredPrimaryVanId,
  selectedIds,
  candidates,
}) {
  const policy = supportSelectionPolicy(result);
  if (!policy) return { option: null, reason: "support-selection-not-applicable" };
  if (selectedIds.length < policy.minimum || selectedIds.length > policy.maximum) {
    return { option: null, reason: "support-selection-count" };
  }
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selected = selectedIds.map((id) => candidateById.get(id));
  if (selected.some((candidate) => !candidate)) {
    return { option: null, reason: "support-selection-unavailable" };
  }

  const primaryQuantity = policy.quantity - selected.length;
  if (primaryQuantity < 1) return { option: null, reason: "support-selection-count" };
  const primaryVan = data.vans.find((van) => van.id === requiredPrimaryVanId);
  if (!primaryVan) return { option: null, reason: "required-van-unavailable" };
  const primaryCrew = resolveAssignment(
    primaryVan,
    result.requestedDate,
    data.staffProfiles,
    data.dailyVanAssignments,
    data.staffAbsences,
  );
  const primaryFullDay = primaryQuantity > (Number(result.operationalRules?.standardService?.differentPropertyDailyCapacity) || 6);
  const primaryAllocation = {
    quantity: primaryQuantity,
    durationMinutes: primaryQuantity * policy.durationMinutes,
    slots: primaryFullDay ? REGULAR_SLOTS.length : primaryQuantity,
    fullDay: primaryFullDay,
  };
  const primary = candidateAvailability({
    date: result.requestedDate,
    time: result.requestedTime,
    allocation: primaryAllocation,
    van: primaryVan,
    assignment: primaryCrew,
    data,
    routeConfig,
    candidateZone: result.candidateZone,
  });
  if (!primary) return { option: null, reason: "required-primary-target-unavailable" };

  const supportAssignments = [];
  for (const group of contiguousSupportGroups(selected)) {
    const first = group[0];
    const van = data.vans.find((item) => item.id === first.vanId);
    if (!van) return { option: null, reason: "support-selection-unavailable" };
    const crew = resolveAssignment(
      van,
      result.requestedDate,
      data.staffProfiles,
      data.dailyVanAssignments,
      data.staffAbsences,
    );
    const allocation = {
      quantity: group.length,
      durationMinutes: group.length * policy.durationMinutes,
      slots: group.length,
      fullDay: false,
    };
    const available = candidateAvailability({
      date: result.requestedDate,
      time: first.time,
      allocation,
      van,
      assignment: crew,
      data,
      routeConfig,
      candidateZone: result.candidateZone,
    });
    if (!available) return { option: null, reason: "support-selection-unavailable" };
    supportAssignments.push({
      ...available,
      time: first.time,
      endTime: available.endTime,
      role: "support",
      supportSlotIds: group.map((candidate) => candidate.id),
    });
  }

  const address = cleanText(property.address || property.addressRaw || property.addressNormalized, 500);
  const option = {
    id: `opt-${hashId(`${result.requestedDate}|${result.requestedTime}|${requiredPrimaryVanId}|${selectedIds.slice().sort().join(",")}|${policy.quantity}`, 16)}`,
    date: result.requestedDate,
    time: result.requestedTime,
    endTime: primary.endTime,
    capacityEndTime: primary.capacityEndTime || primary.endTime,
    quantity: policy.quantity,
    address,
    zone: result.candidateZone?.label || cleanText(property.operationalZone || property.zone, 80),
    presetId: result.preset?.id || "standard_service",
    presetLabel: result.preset?.label || "Standard Service",
    durationMinutesPerUnit: policy.durationMinutes,
    durationMode: result.preset?.durationMode || "per_unit",
    serviceDefinitionVersion: result.preset?.serviceDefinitionVersion || 0,
    serviceId: cleanText(result.preset?.serviceId, 120),
    workItems: result.workItems || [],
    assignments: [
      { ...primary, time: result.requestedTime, endTime: primary.endTime, role: "primary" },
      ...supportAssignments,
    ],
    score: 2_000,
    requestedDateMatch: true,
    requestedTimeMatch: true,
    largeSingleProperty: true,
    allDayCustomerNotice: result.operationalRules?.customerCommunication?.largeJobAllDayNotice !== false,
    internalSupportCount: supportAssignments.length,
  };
  return { option, reason: "available" };
}

function operationalMoveResult({ request, property, data, routeConfig, date, time, vanId, currentSchedule }) {
  if (!date || !time || !vanId) return { option: null, reason: "missing-operational-move-target" };
  if (!operationalMoveDateAllowed({ date, currentSchedule })) {
    return { option: null, reason: "operational-move-date-mismatch" };
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
    manualOperationalMove: true,
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
      const officeExactTarget = context.channel === "office"
        && Boolean(requiredPrimaryVanId && requestedDate && requestedTime);
      const includeRequestedDateAlternatives = context.channel === "office"
        && context.changeKind === "customer_reschedule"
        && context.includeRequestedDateAlternatives === true
        && Boolean(context.excludeAppointmentId && requestedDate);
      const backdated = backdatingIntent({ context });
      const targetPassed = requestedTargetPassed({
        requestedDate,
        requestedTime,
        today,
        currentTime: nowParts.time,
      });
      if (backdatingConfirmationRequired({ targetPassed, backdated, operationalMove })) {
        return {
          options: [],
          reason: "backdating-confirmation-required",
          providerVersion: SCHEDULING_PROVIDER_VERSION,
          engineVersion: CANONICAL_SCHEDULING_ENGINE_VERSION,
          metadata: { requestedDate, requestedTime, requiredPrimaryVanId },
        };
      }
      if (backdated && (!requiredPrimaryVanId || !requestedDate || !requestedTime)) {
        return {
          options: [],
          reason: "backdating-target-required",
          providerVersion: SCHEDULING_PROVIDER_VERSION,
          engineVersion: CANONICAL_SCHEDULING_ENGINE_VERSION,
          metadata: {
            requestedDate,
            requestedTime,
            requiredPrimaryVanId,
            bookingMode: BACKDATED_BOOKING_MODE,
            backdatingAcknowledged: true,
          },
        };
      }
      if (backdated && !targetPassed) {
        return {
          options: [],
          reason: "backdating-target-not-past",
          providerVersion: SCHEDULING_PROVIDER_VERSION,
          engineVersion: CANONICAL_SCHEDULING_ENGINE_VERSION,
          metadata: {
            requestedDate,
            requestedTime,
            requiredPrimaryVanId,
            bookingMode: BACKDATED_BOOKING_MODE,
            backdatingAcknowledged: true,
          },
        };
      }
      const [loaded, currentSchedule] = operationalMove
        ? await Promise.all([
          loadSchedulingData(db, requestedDate, requestedDate),
          loadAppointmentSchedule(db, context.excludeAppointmentId),
        ])
        : [await loadSchedulingData(
          db,
          backdated || officeExactTarget || includeRequestedDateAlternatives ? requestedDate : today,
          backdated || officeExactTarget || includeRequestedDateAlternatives ? requestedDate : addDays(today, MAX_SEARCH_DAYS),
        ), null];
      const data = dataWithoutAppointment(loaded, context.excludeAppointmentId);
      if (requiredPrimaryVanId && !data.vans.some((van) => van.id === requiredPrimaryVanId)) {
        return {
          options: [],
          reason: "required-van-unavailable",
          providerVersion: SCHEDULING_PROVIDER_VERSION,
          engineVersion: CANONICAL_SCHEDULING_ENGINE_VERSION,
          metadata: { requiredPrimaryVanId },
        };
      }
      const { property } = exactCustomerProperty(data, request);
      const routePolicy = explicitOfficeRoutePolicy({ context, request });
      const routeConfig = routeConfigForPolicy(data.businessSettings, routePolicy);

      if (operationalMove) {
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
        includeRequestedDateAlternatives,
        allowBackdating: backdated,
      });
      const selectionPolicy = officeExactTarget ? supportSelectionPolicy(result) : null;
      const candidates = selectionPolicy
        ? supportSlotCandidates({
          result,
          data,
          routeConfig,
          date: requestedDate,
          requiredPrimaryVanId,
        })
        : [];
      const requestedSupportSlotIds = cleanSupportSelectionIds(context.requestedSupportSlotIds);
      let options = result.options;
      let supportReason = "";
      if (selectionPolicy && requestedSupportSlotIds.length) {
        const composed = composeSelectedSupportOption({
          result,
          request,
          property,
          data,
          routeConfig,
          requiredPrimaryVanId,
          selectedIds: requestedSupportSlotIds,
          candidates,
        });
        options = composed.option ? [composed.option] : [];
        supportReason = composed.reason;
      }
      const defaultSupportSlotIds = selectionPolicy
        ? candidates.slice(0, selectionPolicy.minimum).map((candidate) => candidate.id)
        : [];
      const metadata = {
        requestedDate: result.requestedDate || "",
        requestedTime: result.requestedTime || "",
        requestedDateUnavailable: result.requestedDateUnavailable === true,
        requestedTimeUnavailable: result.requestedTimeUnavailable === true,
        routeZone: result.candidateZone?.label || "",
        vansRequired: options[0]?.assignments?.length || result.allocations?.length || 0,
        requiredPrimaryVanId: requiredPrimaryVanId || "",
        includeRequestedDateAlternatives,
        routePolicy,
        ...(selectionPolicy
          ? {
            supportSlotCandidates: candidates,
            supportMinSlots: selectionPolicy.minimum,
            supportMaxSlots: selectionPolicy.maximum,
            defaultSupportSlotIds,
            selectedSupportSlotIds: requestedSupportSlotIds,
          }
          : {}),
        ...(backdated
          ? {
            bookingMode: BACKDATED_BOOKING_MODE,
            backdatingAcknowledged: true,
            workAlreadyPerformed: true,
          }
          : {}),
      };
      return {
        options,
        reason: options.length
          ? (supportReason || result.reason)
          : (supportReason || (backdated ? "backdated-target-unavailable" : (requiredPrimaryVanId ? "required-primary-target-unavailable" : result.reason))),
        providerVersion: SCHEDULING_PROVIDER_VERSION,
        engineVersion: CANONICAL_SCHEDULING_ENGINE_VERSION,
        metadata,
      };
    },

    async revalidateSelection({ request, offer, option, context = {}, now = new Date() }) {
      const nowParts = arubaDateParts(now);
      const today = nowParts.date;
      const operationalMove = context.changeKind === "operational_move";
      const backdated = backdatingIntent({ context, offer });
      const officeExactTarget = context.channel === "office"
        && option.requestedDateMatch === true
        && option.requestedTimeMatch === true;
      const currentSchedule = operationalMove
        ? await loadAppointmentSchedule(db, context.excludeAppointmentId)
        : null;
      if (operationalMove) {
        if (!operationalMoveDateAllowed({ date: option.date, currentSchedule })) {
          return { available: false, reason: "operational-move-date-mismatch" };
        }
      } else if (!backdated && (option.date < today || (option.date === today && option.time <= nowParts.time))) {
        return { available: false, reason: "selected-time-passed" };
      }

      const loaded = operationalMove
        ? await loadSchedulingData(db, option.date, option.date)
        : await loadSchedulingData(
          db,
          backdated || officeExactTarget ? option.date : today,
          backdated || officeExactTarget ? option.date : addDays(today, MAX_SEARCH_DAYS),
        );
      const data = dataWithoutAppointment(loaded, context.excludeAppointmentId);
      const { property } = exactCustomerProperty(data, request);
      const routePolicy = explicitOfficeRoutePolicy({ context, request, option });
      const routeConfig = routeConfigForPolicy(data.businessSettings, routePolicy);
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
            durationMinutes: requested.durationMinutes,
            slots: requested.slots,
            fullDay: requested.fullDay,
          },
          van,
          assignment,
          data,
          routeConfig,
          candidateZone,
          manualOperationalMove: operationalMove,
        });
        if (!availability) {
          return { available: false, reason: operationalMove ? "operational-target-unavailable" : "capacity-or-route-changed", vanId: requested.vanId };
        }
        refreshedAssignments.push({ ...availability, time: startTime, endTime: availability.endTime, role: requested.role });
      }
      const primary = refreshedAssignments.find((assignment) => assignment.role !== "support") || refreshedAssignments[0];
      return {
        available: true,
        option: {
          ...option,
          endTime: primary?.endTime || option.endTime,
          assignments: refreshedAssignments,
        },
      };
    },

    async validateTransaction({ transaction, db: transactionDb, option, appointmentId, context = {} }) {
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
      const operationalMove = context.changeKind === "operational_move";
      const sameDayOrders = canonical.workOrders
        .filter((order) => operationalMove
          ? workOrderBlocksOperationalMoveCapacity(order)
          : orderBlocksCapacity(order))
        .filter((order) => order.appointmentId !== appointmentId);

      for (const assignment of option.assignments) {
        const halfDay = isHalfDay(assignment.vanId, option.date, halfDaySchedules);
        const startTime = assignment.time || option.time;
        const requestedInterval = assignmentCapacityInterval({
          time: startTime,
          allocation: {
            durationMinutes: assignment.durationMinutes,
            slots: assignment.slots,
            fullDay: assignment.fullDay,
          },
          halfDay,
        });
        if (!requestedInterval) return { available: false, reason: "invalid-capacity-interval" };
        const conflict = sameDayOrders.some((order) => {
          if (order.vanId !== assignment.vanId) return false;
          return intervalsOverlap(requestedInterval, workOrderCapacityInterval(order, services, halfDay));
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
  BACKDATED_BOOKING_MODE,
  SCHEDULING_PROVIDER_VERSION,
  backdatingConfirmationRequired,
  backdatingIntent,
  buildCapacityLocks,
  buildWorkOrders,
  cleanSupportSelectionIds,
  composeSelectedSupportOption,
  contiguousSupportGroups,
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
  requestedTargetPassed,
  standardServicePreset,
  supportSelectionPolicy,
  supportSlotCandidates,
};
