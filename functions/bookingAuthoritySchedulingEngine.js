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
  endTime,
  hashId,
  normalizeText,
  normalizeTime,
  propertyZone,
  resolveAssignment,
  vanCanReceiveAppointments,
  weekday,
} = require("./bookingSchedulingPrimitives");
const { candidateAvailability } = require("./bookingCapacityAvailability");

const CANONICAL_SCHEDULING_ENGINE_VERSION = 2;
const CLIENT_OPTION_LIMIT = 2;
const ASSIGNMENT_COMBINATION_LIMIT = 8;

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
    Math.min(
      capacity.automaticSupportMaxUnits,
      capacity.singlePropertyMainVanMaxUnits + capacity.supportHalfDayMaxUnits,
    ),
  );
  return normalized;
}

function singleWork(request = {}) {
  const workLines = Array.isArray(request.workLines) ? request.workLines : [];
  const presetIds = [...new Set(workLines.map((line) => cleanText(line.presetId, 120)).filter(Boolean))];
  if (presetIds.length !== 1) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "Canonical scheduling requires exactly one appointment preset per booking request.",
      { presetIds },
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
  return { presetId: presetIds[0], quantity };
}

function exactPreset(data, presetId) {
  const settings = (data.businessSettings || []).find((item) => item.id === "appointment-work-presets");
  const presets = Array.isArray(settings?.presets)
    ? settings.presets.filter((item) => item.active !== false)
    : [];
  const preset = presets.find((item) => cleanText(item.id, 120) === presetId);
  if (!preset) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "The requested appointment preset is not configured in the ERP.",
      { presetId },
    );
  }
  return {
    id: presetId,
    label: cleanText(preset.label || presetId, 180),
    kind: cleanText(preset.kind, 80),
    durationMinutesPerUnit: Math.max(30, Number(preset.durationMinutesPerUnit || 60)),
  };
}

function isStandardServicePreset(preset = {}) {
  return preset.id === "standard_service"
    || /standard service|servicio estandar|servicio standard/.test(
      normalizeText(`${preset.id} ${preset.label}`),
    );
}

function buildAllocationPlan(quantity, durationMinutesPerUnit, availableVanCount, preset, rawRules) {
  const rules = normalizeOperationalRules(rawRules);
  const duration = Math.max(30, Number(durationMinutesPerUnit || 60));
  if (!quantity || !availableVanCount) return [];

  if (isStandardServicePreset(preset)) {
    const capacity = rules.standardService;
    const regularSlots = Math.ceil((quantity * duration) / 60);
    if (quantity <= capacity.differentPropertyDailyCapacity && regularSlots <= 6) {
      return [{
        quantity,
        slots: regularSlots,
        fullDay: false,
        role: "primary",
        timePolicy: "candidate",
      }];
    }
    if (quantity <= capacity.singlePropertyMainVanMaxUnits && availableVanCount >= 1) {
      return [{
        quantity,
        slots: 6,
        fullDay: true,
        role: "primary",
        fixedTime: "08:30",
        timePolicy: "fixed",
      }];
    }
    if (
      quantity >= capacity.automaticSupportFromUnits
      && quantity <= capacity.automaticSupportMaxUnits
      && availableVanCount >= 2
    ) {
      const supportQuantity = quantity - capacity.singlePropertyMainVanMaxUnits;
      const supportSlots = Math.ceil((supportQuantity * duration) / 60);
      if (
        supportQuantity > 0
        && supportQuantity <= capacity.supportHalfDayMaxUnits
        && supportSlots <= 3
      ) {
        return [
          {
            quantity: capacity.singlePropertyMainVanMaxUnits,
            slots: 6,
            fullDay: true,
            role: "primary",
            fixedTime: "08:30",
            timePolicy: "fixed",
          },
          {
            quantity: supportQuantity,
            slots: supportSlots,
            fullDay: false,
            role: "support",
            allowedTimes: ["08:30", "13:30"],
            timePolicy: "allowed",
          },
        ];
      }
    }
    return [];
  }

  const maxUnitsPerVan = Math.max(1, Math.floor(360 / duration));
  const requiredVans = Math.ceil(quantity / maxUnitsPerVan);
  if (requiredVans > availableVanCount) return [];
  const plan = [];
  let remaining = quantity;
  for (let index = 0; index < requiredVans; index += 1) {
    const units = Math.min(maxUnitsPerVan, remaining);
    plan.push({
      quantity: units,
      slots: Math.ceil((units * duration) / 60),
      fullDay: false,
      role: index === 0 ? "primary" : "support",
      timePolicy: "candidate",
    });
    remaining -= units;
  }
  return plan;
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
          endTime: endTime(allocationTime, candidate.slots),
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
}) {
  const work = singleWork(request);
  const preset = exactPreset(data, work.presetId);
  const operationalSettings = (data.businessSettings || []).find(
    (item) => item.id === "company-operational-rules",
  );
  const operationalRules = normalizeOperationalRules(operationalSettings);
  const allocations = buildAllocationPlan(
    work.quantity,
    preset.durationMinutesPerUnit,
    data.vans.length,
    preset,
    operationalRules,
  );
  if (!allocations.length) {
    return {
      options: [],
      preset,
      quantity: work.quantity,
      allocations,
      operationalRules,
      reason: "capacity",
    };
  }

  const address = cleanText(property.address || property.addressRaw || property.addressNormalized, 500);
  const candidateZone = propertyZone(property, address, routeConfig);
  const requestedDate = requestedDateValue(request.constraints?.requestedDate);
  const timeConstraint = parseStructuredTimeConstraint(request.constraints);
  const largeSingleProperty = isStandardServicePreset(preset)
    && work.quantity > operationalRules.standardService.differentPropertyDailyCapacity;
  const calendarSettings = (data.businessSettings || []).find((item) => item.id === "business-calendar")
    || { closedWeekdays: [0] };
  const primaryAllocation = allocations[0];
  const primaryCandidateTimes = primaryAllocation.timePolicy === "fixed"
    ? [primaryAllocation.fixedTime]
    : [...REGULAR_SLOTS, EXTRA_MORNING_SLOT].sort();
  const options = [];

  for (let dayOffset = 0; dayOffset < MAX_SEARCH_DAYS; dayOffset += 1) {
    const date = addDays(today, dayOffset);
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
      if (date === today && primaryTime <= currentTime) continue;
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
            `${date}|${primary.time}|${selected.map((item) => `${item.vanId}:${item.time}`).join(",")}|${work.quantity}|${preset.id}`,
            16,
          )}`,
          date,
          time: primary.time,
          endTime: primary.endTime,
          quantity: work.quantity,
          address,
          zone: candidateZone?.label || cleanText(property.operationalZone || property.zone, 80),
          presetId: preset.id,
          presetLabel: preset.label,
          durationMinutesPerUnit: preset.durationMinutesPerUnit,
          serviceId: serviceIdForRequest(request, preset, data.services),
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
    ? targetOptions.slice(0, CLIENT_OPTION_LIMIT)
    : selectClientOptions(targetOptions);

  return {
    options: clientOptions,
    preset,
    quantity: work.quantity,
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
  assignmentCombinations,
  buildAllocationPlan,
  exactPreset,
  generateCanonicalOptions,
  normalizeOperationalRules,
  parseStructuredTimeConstraint,
  requestedDateValue,
  selectClientOptions,
  serviceIdForRequest,
  singleWork,
  sortAllocationCandidates,
  timeAllowed,
};