const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
} = require("./bookingAuthorityCore");
const {
  AFTERNOON_SLOTS,
  EXTRA_MORNING_SLOT,
  MAX_SEARCH_DAYS,
  MORNING_SLOTS,
  REGULAR_SLOTS,
  addDays,
  dateDistanceInDays,
  hashId,
  normalizeText,
  normalizeTime,
  propertyZone,
  resolveAssignment,
  vanCanReceiveAppointments,
  weekday,
} = require("./bookingSchedulingPrimitives");
const { candidateAvailability } = require("./bookingCapacityAvailability");
const { resolveCatalogService } = require("./serviceCatalog");

const CANONICAL_SCHEDULING_ENGINE_VERSION = 9;
const CLIENT_OPTION_LIMIT = 2;
const ASSIGNMENT_COMBINATION_LIMIT = 8;
const OFFICE_TARGET_OPTION_LIMIT = ASSIGNMENT_COMBINATION_LIMIT;

// Scheduling owns operational capacity and van-allocation policy. The service
// catalog contributes only the identity and duration of one service execution.
const DEFAULT_OPERATIONAL_RULES = Object.freeze({
  standardService: {
    differentPropertyDailyCapacity: 6,
    morningDifferentPropertyStops: 3,
    afternoonDifferentPropertyStops: 3,
    singlePropertyMainVanMaxUnits: 7,
    automaticSupportFromUnits: 8,
    automaticSupportMaxUnits: 10,
    supportHalfDayMaxUnits: 3,
  },
  customerCommunication: {
    largeJobAllDayNotice: true,
  },
});

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function normalizeOperationalRules(raw = {}) {
  const standard = raw.standardService || {};
  const normalized = {
    standardService: {
      differentPropertyDailyCapacity: boundedInteger(
        standard.differentPropertyDailyCapacity,
        DEFAULT_OPERATIONAL_RULES.standardService.differentPropertyDailyCapacity,
        1,
        12,
      ),
      morningDifferentPropertyStops: boundedInteger(
        standard.morningDifferentPropertyStops,
        DEFAULT_OPERATIONAL_RULES.standardService.morningDifferentPropertyStops,
        1,
        6,
      ),
      afternoonDifferentPropertyStops: boundedInteger(
        standard.afternoonDifferentPropertyStops,
        DEFAULT_OPERATIONAL_RULES.standardService.afternoonDifferentPropertyStops,
        1,
        6,
      ),
      singlePropertyMainVanMaxUnits: boundedInteger(
        standard.singlePropertyMainVanMaxUnits,
        DEFAULT_OPERATIONAL_RULES.standardService.singlePropertyMainVanMaxUnits,
        1,
        12,
      ),
      automaticSupportFromUnits: boundedInteger(
        standard.automaticSupportFromUnits,
        DEFAULT_OPERATIONAL_RULES.standardService.automaticSupportFromUnits,
        2,
        20,
      ),
      automaticSupportMaxUnits: boundedInteger(
        standard.automaticSupportMaxUnits,
        DEFAULT_OPERATIONAL_RULES.standardService.automaticSupportMaxUnits,
        2,
        24,
      ),
      supportHalfDayMaxUnits: boundedInteger(
        standard.supportHalfDayMaxUnits,
        DEFAULT_OPERATIONAL_RULES.standardService.supportHalfDayMaxUnits,
        1,
        6,
      ),
    },
    customerCommunication: {
      largeJobAllDayNotice: raw.customerCommunication?.largeJobAllDayNotice !== false,
    },
  };

  const capacity = normalized.standardService;
  capacity.automaticSupportFromUnits = Math.max(
    capacity.singlePropertyMainVanMaxUnits + 1,
    capacity.automaticSupportFromUnits,
  );
  capacity.automaticSupportMaxUnits = Math.max(
    capacity.automaticSupportFromUnits,
    capacity.automaticSupportMaxUnits,
  );
  return normalized;
}

function singleWork(request = {}) {
  const workLines = Array.isArray(request.workLines) ? request.workLines : [];
  const presetIds = [...new Set(workLines.map((line) => cleanText(line.presetId, 120)).filter(Boolean))];
  if (presetIds.length !== 1) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "This scheduling operation requires exactly one appointment work type.",
      { presetIds },
    );
  }
  const serviceIds = [...new Set(workLines.map((line) => cleanText(line.serviceId, 120)).filter(Boolean))];
  if (serviceIds.length > 1) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "This scheduling operation requires exactly one service catalog item.",
      { serviceIds },
    );
  }
  const quantity = workLines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 0), 0);
  if (!quantity) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "Canonical scheduling requires a positive work quantity.",
      { field: "workLines.quantity" },
    );
  }
  return { presetId: presetIds[0], serviceId: serviceIds[0] || "", quantity };
}

function exactPreset(data, workOrPresetId) {
  const work = typeof workOrPresetId === "string"
    ? { presetId: cleanText(workOrPresetId, 120), serviceId: "" }
    : (workOrPresetId || {});
  const canonical = resolveCatalogService(data.services || [], work, data.businessSettings || []);
  if (canonical) return canonical;

  const presetId = cleanText(work.presetId, 120);
  const settings = (data.businessSettings || []).find((item) => item.id === "appointment-work-presets");
  const presets = Array.isArray(settings?.presets)
    ? settings.presets.filter((item) => item.active !== false)
    : [];
  const preset = presets.find((item) => cleanText(item.id, 120) === presetId);
  if (!preset) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "The requested service is not configured in the canonical service catalog or legacy appointment presets.",
      { presetId, serviceId: cleanText(work.serviceId, 120) },
    );
  }
  const matchingService = (data.services || []).find((service) => (
    cleanText(service.id, 120) === cleanText(work.serviceId, 120)
    || normalizeText(service.name) === normalizeText(preset.label || presetId)
  ));
  return {
    id: presetId,
    label: cleanText(preset.label || presetId, 180),
    kind: cleanText(preset.kind, 80),
    durationMinutesPerUnit: Math.max(30, Number(preset.durationMinutesPerUnit || 60)),
    durationMode: preset.perUnit === false ? "fixed" : "per_unit",
    allocation: null,
    serviceId: cleanText(matchingService?.id || work.serviceId, 120),
    source: "appointment_work_presets",
    serviceDefinitionVersion: 0,
  };
}

function isStandardServicePreset(preset = {}) {
  return preset.id === "standard_service"
    || /standard service|servicio estandar|servicio standard/.test(
      normalizeText(`${preset.id} ${preset.label}`),
    );
}

function isOtherPreset(preset = {}) {
  const normalized = normalizeText(`${preset.id} ${preset.label}`).trim();
  return /(^|\s)(other|otro)(\s|$)/.test(normalized);
}

function supportStartTimes(slotCount) {
  const slots = Math.max(1, Math.ceil(Number(slotCount) || 1));
  if (slots > REGULAR_SLOTS.length) return [];
  // CandidateAvailability is the source of truth for whether a particular van
  // can actually fit the requested span. Returning every operational start lets
  // the office choose the support van and arrival time instead of hiding valid
  // options behind coarse AM/PM rules.
  return [...MORNING_SLOTS, EXTRA_MORNING_SLOT, ...AFTERNOON_SLOTS];
}

function durationForQuantity(quantity, durationMinutesPerUnit, durationMode) {
  const duration = Math.max(30, Number(durationMinutesPerUnit || 60));
  return durationMode === "fixed" ? duration : Math.max(1, quantity) * duration;
}

function regularAllocation(quantity, durationMinutes, role = "primary") {
  const slots = Math.ceil(durationMinutes / 60);
  if (slots < 1 || slots > REGULAR_SLOTS.length) return null;
  return {
    quantity,
    durationMinutes,
    slots,
    fullDay: false,
    role,
    timePolicy: "candidate",
  };
}

function primarySupportAllocationPlan(quantity, durationMinutesPerUnit, availableVanCount, capacity = {}) {
  if (availableVanCount < 1) return [];
  const differentPropertyDailyMaxUnits = boundedInteger(
    capacity.differentPropertyDailyCapacity,
    DEFAULT_OPERATIONAL_RULES.standardService.differentPropertyDailyCapacity,
    1,
    24,
  );
  const primaryMaxUnits = boundedInteger(
    capacity.singlePropertyMainVanMaxUnits,
    DEFAULT_OPERATIONAL_RULES.standardService.singlePropertyMainVanMaxUnits,
    Math.max(1, differentPropertyDailyMaxUnits),
    48,
  );
  const totalDuration = durationForQuantity(quantity, durationMinutesPerUnit, "per_unit");

  if (quantity <= differentPropertyDailyMaxUnits) {
    const regular = regularAllocation(quantity, totalDuration);
    return regular ? [regular] : [];
  }

  if (quantity <= primaryMaxUnits) {
    return [{
      quantity,
      durationMinutes: totalDuration,
      slots: REGULAR_SLOTS.length,
      fullDay: true,
      role: "primary",
      fixedTime: "08:30",
      timePolicy: "fixed",
    }];
  }

  if (availableVanCount < 2) return [];
  const supportQuantity = quantity - primaryMaxUnits;
  const supportDuration = durationForQuantity(supportQuantity, durationMinutesPerUnit, "per_unit");
  const supportSlots = Math.ceil(supportDuration / 60);
  const allowedTimes = supportStartTimes(supportSlots);
  if (!supportQuantity || !allowedTimes.length) return [];

  return [
    {
      quantity: primaryMaxUnits,
      durationMinutes: durationForQuantity(primaryMaxUnits, durationMinutesPerUnit, "per_unit"),
      slots: REGULAR_SLOTS.length,
      fullDay: true,
      role: "primary",
      fixedTime: "08:30",
      timePolicy: "fixed",
    },
    {
      quantity: supportQuantity,
      durationMinutes: supportDuration,
      slots: supportSlots,
      fullDay: false,
      role: "support",
      allowedTimes,
      timePolicy: "allowed",
    },
  ];
}

function buildAllocationPlan(quantity, durationMinutesPerUnit, availableVanCount, preset, rawRules) {
  const rules = normalizeOperationalRules(rawRules);
  const duration = Math.max(30, Number(durationMinutesPerUnit || 60));
  if (!quantity || !availableVanCount) return [];

  // Standard Service capacity is an agenda rule regardless of whether the
  // service duration came from the canonical catalog or the legacy fallback.
  if (isStandardServicePreset(preset)) {
    return primarySupportAllocationPlan(
      quantity,
      duration,
      availableVanCount,
      rules.standardService,
    );
  }

  // Fixed-duration behavior is retained only for unmigrated legacy presets.
  // Canonical services always describe duration per execution.
  const durationMode = preset?.source === "appointment_work_presets" && preset?.durationMode === "fixed"
    ? "fixed"
    : "per_unit";
  if (durationMode === "fixed") {
    const allocation = regularAllocation(quantity, duration);
    return allocation ? [allocation] : [];
  }

  const maxUnitsPerVan = Math.max(1, Math.floor((REGULAR_SLOTS.length * 60) / duration));
  const requiredVans = Math.ceil(quantity / maxUnitsPerVan);
  if (requiredVans > availableVanCount) return [];
  const plan = [];
  let remaining = quantity;
  for (let index = 0; index < requiredVans; index += 1) {
    const units = Math.min(maxUnitsPerVan, remaining);
    plan.push({
      quantity: units,
      durationMinutes: units * duration,
      slots: Math.ceil((units * duration) / 60),
      fullDay: false,
      role: index === 0 ? "primary" : "support",
      timePolicy: "candidate",
    });
    remaining -= units;
  }
  return plan;
}

function resolveWorkScope(request = {}, data = {}) {
  const workLines = Array.isArray(request.workLines) ? request.workLines : [];
  if (!workLines.length) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "Canonical scheduling requires at least one work line.",
      { field: "workLines" },
    );
  }

  const items = workLines.map((line, index) => {
    const quantity = Math.max(0, Number(line.quantity) || 0);
    if (!quantity) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        `workLines[${index}].quantity must be positive.`,
        { field: `workLines[${index}].quantity` },
      );
    }
    const preset = exactPreset(data, line);
    const manualDurationMinutes = Math.max(0, Number(line.manualDurationMinutes) || 0);
    if (manualDurationMinutes && !isOtherPreset(preset)) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "Manual scheduled duration is only allowed for Other work.",
        { field: `workLines[${index}].manualDurationMinutes`, presetId: preset.id },
      );
    }
    if (manualDurationMinutes && (manualDurationMinutes < 60 || manualDurationMinutes > 720 || manualDurationMinutes % 30 !== 0)) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "Manual scheduled duration must be between 1 and 12 hours in 0.5-hour increments.",
        { field: `workLines[${index}].manualDurationMinutes`, presetId: preset.id },
      );
    }
    if (isOtherPreset(preset) && !manualDurationMinutes) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "Other work requires a manual scheduled duration.",
        { field: `workLines[${index}].manualDurationMinutes`, presetId: preset.id },
      );
    }
    const legacyFixed = preset.source === "appointment_work_presets" && preset.durationMode === "fixed";
    const durationMode = manualDurationMinutes ? "manual" : legacyFixed ? "fixed" : "per_unit";
    const durationMinutes = manualDurationMinutes
      || durationForQuantity(quantity, preset.durationMinutesPerUnit, legacyFixed ? "fixed" : "per_unit");
    return {
      id: cleanText(line.id, 120) || `work-${index + 1}`,
      presetId: preset.id,
      serviceId: cleanText(preset.serviceId || line.serviceId, 120),
      label: preset.label,
      quantity,
      durationMinutes,
      durationMinutesPerUnit: manualDurationMinutes || preset.durationMinutesPerUnit,
      durationMode,
      serviceDefinitionVersion: preset.serviceDefinitionVersion || 0,
      preset,
    };
  });

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalDurationMinutes = items.reduce((sum, item) => sum + item.durationMinutes, 0);
  const presetIds = [...new Set(items.map((item) => item.presetId))];
  const serviceIds = [...new Set(items.map((item) => item.serviceId).filter(Boolean))];
  const singleType = presetIds.length === 1 && serviceIds.length <= 1;
  const singlePreset = singleType ? items[0].preset : null;
  const hasManualDuration = items.some((item) => item.durationMode === "manual");

  return {
    items,
    workItems: items.map(({ preset, ...item }) => item),
    totalQuantity,
    totalDurationMinutes,
    singleType,
    singlePreset,
    hasManualDuration,
  };
}

function allocationPlanForScope(scope, availableVanCount, rawRules) {
  if (scope.singleType && scope.singlePreset && !scope.hasManualDuration) {
    return buildAllocationPlan(
      scope.totalQuantity,
      scope.singlePreset.durationMinutesPerUnit,
      availableVanCount,
      scope.singlePreset,
      rawRules,
    );
  }
  if (availableVanCount < 1) return [];
  const allocation = regularAllocation(scope.totalQuantity, scope.totalDurationMinutes);
  return allocation ? [allocation] : [];
}

function parseStructuredTimeConstraint(constraints = {}) {
  const exact = normalizeTime(constraints.requestedTime || "");
  if (exact) return { kind: "exact", time: exact };
  const raw = cleanText(constraints.preferredTime, 80).toLowerCase();
  if (!raw) return { kind: "", time: "" };
  if (raw === "morning") return { kind: "morning", time: "" };
  if (raw === "afternoon") return { kind: "afternoon", time: "" };
  const match = raw.match(/^(after|from|before|until)\s+(\d{1,2}(?::\d{2})?)$/);
  if (!match) return { kind: "", time: "" };
  const time = normalizeTime(match[2]);
  return time ? { kind: match[1], time } : { kind: "", time: "" };
}

function minutes(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function timeAllowed(candidateTime, constraint) {
  if (!constraint?.kind) return true;
  if (constraint.kind === "exact") return candidateTime === constraint.time;
  if (constraint.kind === "morning") return [...MORNING_SLOTS, EXTRA_MORNING_SLOT].includes(candidateTime);
  if (constraint.kind === "afternoon") return AFTERNOON_SLOTS.includes(candidateTime);
  const candidate = minutes(candidateTime);
  const boundary = minutes(constraint.time);
  if (candidate === null || boundary === null) return true;
  if (constraint.kind === "after") return candidate > boundary;
  if (constraint.kind === "from") return candidate >= boundary;
  if (constraint.kind === "before") return candidate < boundary;
  if (constraint.kind === "until") return candidate <= boundary;
  return true;
}

function requestedDateValue(value) {
  const date = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function dateClosed(date, settings, closures) {
  if ((closures || []).some((closure) => closure.active !== false && closure.date === date)) return true;
  const closedWeekdays = Array.isArray(settings?.closedWeekdays)
    ? settings.closedWeekdays.map(Number)
    : [0];
  return closedWeekdays.includes(weekday(date));
}

function candidateTimesForAllocation(allocation, primaryTime) {
  if (allocation.timePolicy === "fixed") return [allocation.fixedTime];
  if (allocation.timePolicy === "allowed") return allocation.allowedTimes || [];
  return [primaryTime];
}

function blockForTime(time) {
  return AFTERNOON_SLOTS.includes(time) ? "afternoon" : "morning";
}

function selectClientOptions(options) {
  const available = Array.isArray(options) ? options.filter(Boolean) : [];
  if (available.length <= CLIENT_OPTION_LIMIT) return available;
  const first = available[0];
  const differentDate = available.find((option) => option.date !== first.date);
  return differentDate ? [first, differentDate] : available.slice(0, CLIENT_OPTION_LIMIT);
}

function serviceIdForRequest(request, preset, services = []) {
  if (cleanText(preset?.serviceId, 120)) return cleanText(preset.serviceId, 120);
  const explicit = cleanText(
    request.workLines?.find((line) => line.serviceId)?.serviceId,
    120,
  );
  if (explicit) return explicit;
  const exact = services.find((service) => normalizeText(service.name) === normalizeText(preset.label));
  return cleanText(exact?.id, 120);
}

function sortAllocationCandidates(candidates, allocation) {
  const sorted = [...candidates].sort((left, right) => {
    const routeDifference = right.routeScore - left.routeScore;
    if (routeDifference) return routeDifference;
    if (allocation.role === "support") {
      const leftMorning = left.block === "morning" ? 1 : 0;
      const rightMorning = right.block === "morning" ? 1 : 0;
      if (leftMorning !== rightMorning) return rightMorning - leftMorning;
    }
    return left.time.localeCompare(right.time) || left.vanId.localeCompare(right.vanId);
  });
  if (allocation.role !== "support") return sorted;

  const firstByTime = [];
  const used = new Set();
  for (const allowedTime of allocation.allowedTimes || []) {
    const candidate = sorted.find((item) => item.time === allowedTime);
    if (!candidate) continue;
    firstByTime.push(candidate);
    used.add(`${candidate.vanId}|${candidate.time}`);
  }
  return [
    ...firstByTime,
    ...sorted.filter((item) => !used.has(`${item.vanId}|${item.time}`)),
  ];
}

function assignmentCombinations({
  allocations,
  dateAssignments,
  date,
  primaryTime,
  data,
  routeConfig,
  candidateZone,
  requiredPrimaryVanId,
}) {
  const results = [];

  function visit(allocationIndex, remainingVans, selected) {
    if (results.length >= ASSIGNMENT_COMBINATION_LIMIT) return;
    if (allocationIndex >= allocations.length) {
      results.push(selected);
      return;
    }

    const allocation = allocations[allocationIndex];
    const allowedTimes = candidateTimesForAllocation(allocation, primaryTime);
    const vanPool = allocation.role === "primary" && requiredPrimaryVanId
      ? remainingVans.filter(({ van }) => van.id === requiredPrimaryVanId)
      : remainingVans;
    const candidates = [];
    for (const { van, assignment } of vanPool) {
      for (const allocationTime of allowedTimes) {
        if (!allocationTime) continue;
        const candidate = candidateAvailability({
          date,
          time: allocationTime,
          allocation,
          van,
          assignment,
          data,
          routeConfig,
          candidateZone,
        });
        if (!candidate) continue;
        candidates.push({
          ...candidate,
          time: allocationTime,
          endTime: candidate.endTime,
          role: allocation.role,
          block: blockForTime(allocationTime),
        });
      }
    }

    for (const candidate of sortAllocationCandidates(candidates, allocation)) {
      const nextRemaining = remainingVans.filter((item) => item.van.id !== candidate.vanId);
      visit(allocationIndex + 1, nextRemaining, [...selected, candidate]);
      if (results.length >= ASSIGNMENT_COMBINATION_LIMIT) break;
    }
  }

  visit(0, dateAssignments, []);
  return results;
}

function generateCanonicalOptions({
  request,
  property,
  data,
  routeConfig,
  today,
  currentTime,
  requiredPrimaryVanId = "",
  requireRequestedTarget = false,
  allowBackdating = false,
}) {
  const scope = resolveWorkScope(request, data);
  const preset = scope.singlePreset || {
    id: "multiple_services",
    label: "Multiple services",
    kind: "mixed_service",
    durationMinutesPerUnit: scope.totalDurationMinutes,
    durationMode: "mixed",
    serviceId: "",
    source: "scheduling_scope",
    serviceDefinitionVersion: 0,
  };
  const operationalSettings = (data.businessSettings || []).find(
    (item) => item.id === "company-operational-rules",
  );
  const operationalRules = normalizeOperationalRules(operationalSettings);
  const allocations = allocationPlanForScope(
    scope,
    data.vans.length,
    operationalRules,
  );
  if (!allocations.length) {
    return {
      options: [],
      preset,
      quantity: scope.totalQuantity,
      workItems: scope.workItems,
      allocations,
      operationalRules,
      reason: scope.singleType ? "capacity" : "mixed-work-exceeds-single-van-capacity",
    };
  }

  const address = cleanText(property.address || property.addressRaw || property.addressNormalized, 500);
  const candidateZone = propertyZone(property, address, routeConfig);
  const requestedDate = requestedDateValue(request.constraints?.requestedDate);
  const timeConstraint = parseStructuredTimeConstraint(request.constraints);
  const largeSingleProperty = scope.singleType
    && isStandardServicePreset(preset)
    && scope.totalQuantity > operationalRules.standardService.differentPropertyDailyCapacity;
  const calendarSettings = (data.businessSettings || []).find((item) => item.id === "business-calendar")
    || { closedWeekdays: [0] };
  const primaryAllocation = allocations[0];
  const primaryCandidateTimes = primaryAllocation.timePolicy === "fixed"
    ? [primaryAllocation.fixedTime]
    : [...REGULAR_SLOTS, EXTRA_MORNING_SLOT].sort();
  const options = [];
  const workSignature = scope.workItems.map((item) => `${item.presetId}:${item.serviceId}:${item.quantity}:${item.durationMinutes}`).join("|");

  const candidateDates = allowBackdating && requestedDate
    ? [requestedDate]
    : Array.from({ length: MAX_SEARCH_DAYS }, (_, dayOffset) => addDays(today, dayOffset));

  for (const [dayOffset, date] of candidateDates.entries()) {
    if (requireRequestedTarget && requestedDate && date !== requestedDate) continue;
    if (dateClosed(date, calendarSettings, data.calendarClosures)) continue;
    const dateAssignments = data.vans.map((van) => ({
      van,
      assignment: resolveAssignment(
        van,
        date,
        data.staffProfiles,
        data.dailyVanAssignments,
        data.staffAbsences,
      ),
    })).filter(({ van, assignment }) => vanCanReceiveAppointments(van, assignment));
    if (dateAssignments.length < allocations.length) continue;
    if (requiredPrimaryVanId && !dateAssignments.some(({ van }) => van.id === requiredPrimaryVanId)) continue;

    for (const primaryTime of primaryCandidateTimes) {
      if (!primaryTime) continue;
      if (!allowBackdating && date === today && primaryTime <= currentTime) continue;
      if (!timeAllowed(primaryTime, timeConstraint)) continue;

      const combinations = assignmentCombinations({
        allocations,
        dateAssignments,
        date,
        primaryTime,
        data,
        routeConfig,
        candidateZone,
        requiredPrimaryVanId,
      });
      for (const selected of combinations) {
        const primary = selected.find((item) => item.role === "primary") || selected[0];
        if (!primary) continue;
        const totalRouteScore = selected.reduce((sum, item) => sum + item.routeScore, 0);
        const datePenalty = dayOffset * 9;
        const requestedDateBonus = requestedDate && date === requestedDate ? 500 : 0;
        const requestedDateDistancePenalty = requestedDate
          ? Math.abs(dateDistanceInDays(date, requestedDate)) * 18
          : 0;
        const exactTime = timeConstraint.kind === "exact" ? timeConstraint.time : "";
        const requestedTimeBonus = exactTime && primary.time === exactTime ? 180 : 0;
        const morningBonus = !timeConstraint.kind && MORNING_SLOTS.includes(primary.time) ? 8 : 0;
        const score = 1_000
          + totalRouteScore
          + requestedDateBonus
          + requestedTimeBonus
          + morningBonus
          - datePenalty
          - requestedDateDistancePenalty;

        options.push({
          id: `opt-${hashId(
            `${date}|${primary.time}|${selected.map((item) => `${item.vanId}:${item.time}`).join(",")}|${workSignature}`,
            16,
          )}`,
          date,
          time: primary.time,
          endTime: primary.endTime,
          capacityEndTime: primary.capacityEndTime || primary.endTime,
          quantity: scope.totalQuantity,
          address,
          zone: candidateZone?.label || cleanText(property.operationalZone || property.zone, 80),
          presetId: preset.id,
          presetLabel: preset.label,
          durationMinutesPerUnit: scope.singleType && !scope.hasManualDuration
            ? preset.durationMinutesPerUnit
            : scope.totalDurationMinutes,
          durationMode: scope.singleType && !scope.hasManualDuration
            ? preset.durationMode
            : scope.singleType ? scope.workItems[0].durationMode : "mixed",
          serviceDefinitionVersion: scope.singleType ? preset.serviceDefinitionVersion || 0 : 0,
          serviceId: scope.singleType ? cleanText(preset.serviceId, 120) : "",
          workItems: scope.workItems,
          assignments: selected,
          score,
          requestedDateMatch: Boolean(requestedDate && date === requestedDate),
          requestedTimeMatch: Boolean(exactTime && primary.time === exactTime),
          largeSingleProperty,
          allDayCustomerNotice: largeSingleProperty
            && operationalRules.customerCommunication.largeJobAllDayNotice,
          internalSupportCount: Math.max(0, selected.length - 1),
        });
      }
    }
  }

  options.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const unique = [];
  const seen = new Set();
  for (const option of options) {
    const key = `${option.date}|${option.time}|${option.assignments
      .map((item) => `${item.vanId}:${item.time}`).sort().join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(option);
  }

  const targetOptions = requireRequestedTarget
    ? unique.filter((option) => (
      (!requestedDate || option.date === requestedDate)
      && (timeConstraint.kind !== "exact" || option.time === timeConstraint.time)
      && (!requiredPrimaryVanId || option.assignments?.[0]?.vanId === requiredPrimaryVanId)
    ))
    : unique;
  const clientOptions = requireRequestedTarget
    ? targetOptions.slice(0, OFFICE_TARGET_OPTION_LIMIT)
    : selectClientOptions(targetOptions);

  return {
    options: clientOptions,
    preset,
    quantity: scope.totalQuantity,
    workItems: scope.workItems,
    allocations,
    requestedDate,
    requestedTime: timeConstraint.kind === "exact" ? timeConstraint.time : "",
    timeConstraint,
    operationalRules,
    largeSingleProperty,
    requestedDateUnavailable: Boolean(
      requestedDate && !options.some((option) => option.date === requestedDate),
    ),
    requestedTimeUnavailable: Boolean(
      timeConstraint.kind === "exact"
      && !options.some(
        (option) => option.date === (requestedDate || option.date) && option.time === timeConstraint.time,
      )
    ),
    candidateZone,
    reason: clientOptions.length ? "available" : "no-availability",
  };
}

module.exports = {
  ASSIGNMENT_COMBINATION_LIMIT,
  CANONICAL_SCHEDULING_ENGINE_VERSION,
  CLIENT_OPTION_LIMIT,
  DEFAULT_OPERATIONAL_RULES,
  OFFICE_TARGET_OPTION_LIMIT,
  allocationPlanForScope,
  assignmentCombinations,
  buildAllocationPlan,
  exactPreset,
  generateCanonicalOptions,
  isOtherPreset,
  normalizeOperationalRules,
  parseStructuredTimeConstraint,
  requestedDateValue,
  resolveWorkScope,
  selectClientOptions,
  serviceIdForRequest,
  singleWork,
  sortAllocationCandidates,
  supportStartTimes,
  timeAllowed,
};
