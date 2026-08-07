const availability = require("./whatsappCopilotAvailability");
const {
  AFTERNOON_SLOTS,
  EXTRA_MORNING_SLOT,
  MAX_OPTIONS,
  MAX_SEARCH_DAYS,
  MAX_VANS,
  MORNING_SLOTS,
  REGULAR_SLOTS,
  addDays,
  arubaDateParts,
  cleanText,
  dateDistanceInDays,
  endTime,
  hashId,
  normalizeRequestedDate,
  normalizeText,
  normalizeTime,
  propertyZone,
  resolveAssignment,
  resolveCustomer,
  timeBlock,
  vanCanReceiveAppointments,
  weekday,
} = require("./whatsappCopilotSchedulingCore");

function minutes(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function parseTimeConstraint(analysis, latestCustomerTurn = "") {
  const collected = analysis?.collectedInformation || {};
  const structured = cleanText(collected.requestedTime || collected.preferredTime, 120);
  const raw = cleanText([structured, latestCustomerTurn].filter(Boolean).join(" "), 500);
  const normalized = normalizeText(raw);
  const time = normalizeTime(raw);

  if (time && /\b(after|later than|despues|después|posterior|luego de|mas tarde de|más tarde de)\b/.test(normalized)) {
    return { kind: "after", time, raw };
  }
  if (time && /\b(from|starting at|a partir de|desde)\b/.test(normalized)) {
    return { kind: "from", time, raw };
  }
  if (time && /\b(before|earlier than|antes de)\b/.test(normalized)) {
    return { kind: "before", time, raw };
  }
  if (time && /\b(until|hasta)\b/.test(normalized)) {
    return { kind: "until", time, raw };
  }

  const block = timeBlock(raw);
  if (block) return { kind: block, time: "", raw };
  return { kind: "", time: "", raw };
}

function timeAllowed(candidateTime, constraint) {
  if (!constraint?.kind) return true;
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

function resolveServiceId(services, preset) {
  const normalizedLabel = normalizeText(preset.label);
  const exact = services.find((service) => normalizeText(service.name) === normalizedLabel);
  if (exact) return exact.id;
  const kindMatch = services.find((service) => {
    const text = normalizeText(`${service.name} ${service.category}`);
    if (preset.kind === "installation") return /instal/.test(text);
    if (preset.id === "deep_cleaning") return /profund|deep/.test(text);
    return /servicio|mantenimiento/.test(text);
  });
  return kindMatch?.id ?? services[0]?.id ?? "whatsapp-copilot-service";
}

function dateClosed(date, settings, closures) {
  if (closures.some((closure) => closure.active !== false && closure.date === date)) return true;
  const closedWeekdays = Array.isArray(settings?.closedWeekdays) ? settings.closedWeekdays.map(Number) : [0];
  return closedWeekdays.includes(weekday(date));
}

function generateOptionsWithHardCustomerTime({
  analysis,
  request,
  data,
  routeConfig,
  today,
  currentTime = arubaDateParts().time,
}) {
  const options = [];
  const calendarSettings = data.businessSettings.find((item) => item.id === "business-calendar")
    ?? { closedWeekdays: [0] };
  const presetSettings = data.businessSettings.find((item) => item.id === "appointment-work-presets");
  const preset = availability.resolvePreset(analysis, presetSettings);
  const quantity = availability.parseQuantity(analysis.collectedInformation?.quantity);
  const allocations = availability.distributeUnits(quantity, preset.durationMinutesPerUnit, data.vans.length);
  if (!quantity || !allocations.length) {
    return { options: [], preset, quantity, allocations, reason: quantity ? "capacity" : "missing-quantity" };
  }

  const customer = resolveCustomer({
    clients: data.clients,
    properties: data.properties,
    contactPhone: request.contactPhone,
    chatTitle: request.chatTitle,
    address: analysis.collectedInformation.address,
  });
  const candidateZone = propertyZone(customer.property, analysis.collectedInformation.address, routeConfig);
  const requestedDate = normalizeRequestedDate(
    analysis.collectedInformation.requestedDate || analysis.collectedInformation.preferredDate,
    request.latestCustomerTurn,
    today,
  );
  const requestedTime = normalizeTime(
    analysis.collectedInformation.requestedTime || analysis.collectedInformation.preferredTime,
  );
  const requestedBlock = timeBlock(
    analysis.collectedInformation.requestedTime
      || analysis.collectedInformation.preferredTime
      || request.latestCustomerTurn,
  );
  const timeConstraint = parseTimeConstraint(analysis, request.latestCustomerTurn);

  for (let dayOffset = 0; dayOffset < MAX_SEARCH_DAYS; dayOffset += 1) {
    const date = addDays(today, dayOffset);
    if (dateClosed(date, calendarSettings, data.calendarClosures)) continue;
    const dateAssignments = data.vans.map((van) => ({
      van,
      assignment: resolveAssignment(van, date, data.staffProfiles, data.dailyVanAssignments, data.staffAbsences),
    })).filter(({ van, assignment }) => vanCanReceiveAppointments(van, assignment));
    if (dateAssignments.length < allocations.length) continue;

    const candidateTimes = [...REGULAR_SLOTS, EXTRA_MORNING_SLOT].sort();
    for (const time of candidateTimes) {
      if (date === today && time <= currentTime) continue;
      if (!timeAllowed(time, timeConstraint)) continue;
      if (!timeConstraint.kind && requestedBlock === "morning" && AFTERNOON_SLOTS.includes(time)) continue;
      if (!timeConstraint.kind && requestedBlock === "afternoon" && [...MORNING_SLOTS, EXTRA_MORNING_SLOT].includes(time)) continue;

      const selected = [];
      const remainingVans = [...dateAssignments];
      let possible = true;
      for (const allocation of allocations) {
        const candidates = remainingVans.map(({ van, assignment }) => availability.candidateAvailability({
          date,
          time,
          allocation,
          van,
          assignment,
          data,
          routeConfig,
          candidateZone,
        })).filter(Boolean).sort((a, b) => b.routeScore - a.routeScore);
        const best = candidates[0];
        if (!best) {
          possible = false;
          break;
        }
        selected.push(best);
        const index = remainingVans.findIndex((item) => item.van.id === best.vanId);
        if (index >= 0) remainingVans.splice(index, 1);
      }
      if (!possible) continue;

      const totalRouteScore = selected.reduce((sum, item) => sum + item.routeScore, 0);
      const datePenalty = dayOffset * 9;
      const requestedDateBonus = requestedDate && date === requestedDate ? 500 : 0;
      const requestedDateDistancePenalty = requestedDate
        ? Math.abs(dateDistanceInDays(date, requestedDate)) * 18
        : 0;
      const exactTimePreference = timeConstraint.kind ? "" : requestedTime;
      const requestedTimeBonus = exactTimePreference && time === exactTimePreference ? 180 : 0;
      const requestedTimePenalty = exactTimePreference && time !== exactTimePreference ? 25 : 0;
      const morningBonus = !exactTimePreference && !requestedBlock && !timeConstraint.kind && MORNING_SLOTS.includes(time)
        ? 8
        : 0;
      const constraintBoundary = minutes(timeConstraint.time);
      const candidateMinutes = minutes(time);
      const proximityBonus = ["after", "from"].includes(timeConstraint.kind)
        && constraintBoundary !== null
        && candidateMinutes !== null
        ? Math.max(0, 90 - Math.floor((candidateMinutes - constraintBoundary) / 5))
        : 0;
      const score = 1_000
        + totalRouteScore
        + requestedDateBonus
        + requestedTimeBonus
        + morningBonus
        + proximityBonus
        - datePenalty
        - requestedDateDistancePenalty
        - requestedTimePenalty;

      options.push({
        id: `opt-${hashId(`${date}|${time}|${selected.map((item) => item.vanId).join(",")}|${quantity}|${preset.id}`, 16)}`,
        date,
        time,
        endTime: endTime(time, Math.max(...selected.map((item) => item.slots))),
        quantity,
        address: analysis.collectedInformation.address,
        zone: candidateZone?.label ?? cleanText(customer.property?.operationalZone || customer.property?.zone || "", 80),
        presetId: preset.id,
        presetLabel: preset.label,
        durationMinutesPerUnit: preset.durationMinutesPerUnit,
        serviceId: resolveServiceId(data.services, preset),
        assignments: selected,
        score,
        requestedDateMatch: Boolean(requestedDate && date === requestedDate),
        requestedTimeMatch: Boolean(requestedTime && time === requestedTime),
      });
    }
  }

  options.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const unique = [];
  const seen = new Set();
  for (const option of options) {
    const key = `${option.date}|${option.time}|${option.assignments.map((item) => item.vanId).sort().join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(option);
    if (unique.length >= MAX_OPTIONS) break;
  }

  return {
    options: unique,
    preset,
    quantity,
    allocations,
    requestedDate,
    requestedTime,
    timeConstraint,
    requestedDateUnavailable: Boolean(requestedDate && !options.some((option) => option.date === requestedDate)),
    requestedTimeUnavailable: Boolean(
      requestedTime
      && !options.some((option) => option.date === (requestedDate || option.date) && option.time === requestedTime),
    ),
    customer,
    candidateZone,
    reason: unique.length ? "available" : "no-availability",
  };
}

availability.generateOptions = generateOptionsWithHardCustomerTime;

module.exports = {
  generateOptionsWithHardCustomerTime,
  parseTimeConstraint,
  timeAllowed,
};
