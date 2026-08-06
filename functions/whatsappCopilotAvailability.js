const {
  AFTERNOON_SLOTS,
  DEFAULT_PRESETS,
  EXTRA_MORNING_SLOT,
  MAX_OPTIONS,
  MAX_SEARCH_DAYS,
  MAX_VANS,
  MORNING_SLOTS,
  REGULAR_SLOTS,
  addDays,
  arubaDateParts,
  dateDistanceInDays,
  endTime,
  hashId,
  isHalfDay,
  normalizeRequestedDate,
  normalizeText,
  normalizeTime,
  occupiedSlots,
  orderBlocksCapacity,
  orderSlotCount,
  propertyZone,
  resolveAssignment,
  resolveCustomer,
  routeCompatibility,
  timeBlock,
  vanCanReceiveAppointments,
  weekday,
} = require("./whatsappCopilotSchedulingCore");

function resolvePreset(analysis, presetSettings) {
  const presets = Array.isArray(presetSettings?.presets) && presetSettings.presets.length
    ? presetSettings.presets.filter((preset) => preset.active !== false)
    : DEFAULT_PRESETS;
  const text = normalizeText([
    analysis.intent,
    analysis.summary,
    analysis.collectedInformation?.serviceType,
    analysis.collectedInformation?.extraDetails,
  ].filter(Boolean).join(" "));
  let desiredId = "standard_service";
  if (/deep|profundo|profunda|cleaning profundo|limpieza profunda/.test(text)) desiredId = "deep_cleaning";
  else if (/install|instalacion|instalación/.test(text) && /special|especial|rooftop|segundo piso|tercer piso|extendida/.test(text)) desiredId = "special_installation";
  else if (/install|instalacion|instalación/.test(text)) desiredId = "standard_installation";
  const preset = presets.find((item) => item.id === desiredId)
    ?? presets.find((item) => normalizeText(item.label).includes(desiredId.replaceAll("_", " ")))
    ?? presets.find((item) => item.kind === (desiredId.includes("installation") ? "installation" : "service"))
    ?? DEFAULT_PRESETS.find((item) => item.id === desiredId)
    ?? DEFAULT_PRESETS[0];
  return { ...preset, durationMinutesPerUnit: Math.max(30, Number(preset.durationMinutesPerUnit ?? 60)) };
}

function parseQuantity(value) {
  const match = String(value ?? "").match(/\d{1,2}/);
  if (!match) return 0;
  return Math.max(1, Math.min(40, Number(match[0])));
}

function distributeUnits(quantity, durationMinutesPerUnit, availableVanCount) {
  if (quantity === 7 && durationMinutesPerUnit === 60) return [{ quantity: 7, slots: 6, fullDay: true }];
  const maxUnitsPerVan = Math.max(1, Math.floor(360 / durationMinutesPerUnit));
  const required = Math.ceil(quantity / maxUnitsPerVan);
  if (required > Math.min(MAX_VANS, availableVanCount)) return [];
  const allocations = [];
  let remaining = quantity;
  for (let index = 0; index < required; index += 1) {
    const units = Math.min(maxUnitsPerVan, remaining);
    allocations.push({ quantity: units, slots: Math.ceil((units * durationMinutesPerUnit) / 60), fullDay: false });
    remaining -= units;
  }
  return allocations;
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

function candidateAvailability({ date, time, allocation, van, assignment, data, routeConfig, candidateZone }) {
  if (!vanCanReceiveAppointments(van, assignment)) return null;
  const halfDay = isHalfDay(van.id, date, data.vanHalfDaySchedules);
  if (allocation.fullDay && (halfDay || time !== "08:30")) return null;
  const slots = allocation.fullDay ? REGULAR_SLOTS : occupiedSlots(time, allocation.slots, halfDay);
  if (!slots.length) return null;
  const sameVanOrders = data.workOrders
    .filter((order) => order.date === date && orderBlocksCapacity(order) && order.vanId === van.id)
    .map((order) => ({
      ...order,
      time: normalizeOrderTime(order.time),
      occupied: occupiedSlots(normalizeOrderTime(order.time), orderSlotCount(order, data.services), halfDay),
      zoneInfo: propertyZone(
        data.properties.find((property) => property.id === order.propertyId),
        `${order.zone ?? ""} ${order.address ?? ""}`,
        routeConfig,
      ),
    }));
  if (sameVanOrders.some((order) => order.occupied.some((slot) => slots.includes(slot)))) return null;
  const office = routeConfig.zones.find((zone) => zone.id === routeConfig.officeZoneId);
  const compatibility = routeCompatibility({
    candidateZone,
    existingOrders: sameVanOrders,
    candidateTime: time,
    officePosition: office?.position ?? 50,
    maximumAnchorDistance: routeConfig.maximumAnchorDistance,
  });
  if (!compatibility.allowed) return null;
  return {
    vanId: van.id,
    vanName: van.name,
    technicianIds: assignment.technicianIds,
    driverStaffId: assignment.driverStaffId,
    helperStaffId: assignment.helperStaffId,
    quantity: allocation.quantity,
    slots: allocation.fullDay ? 6 : allocation.slots,
    fullDay: allocation.fullDay,
    routeScore: compatibility.score,
    routeReason: compatibility.reason,
  };
}

function normalizeOrderTime(value) {
  const time = normalizeTime(value);
  if (!time) return "08:30";
  if ([...REGULAR_SLOTS, EXTRA_MORNING_SLOT].includes(time)) return time;
  if (time < "09:00") return "08:30";
  if (time < "10:30") return "09:30";
  if (time < "11:30") return "10:30";
  if (time < "12:30") return EXTRA_MORNING_SLOT;
  if (time < "14:30") return "13:30";
  if (time < "15:30") return "14:30";
  return "15:30";
}

function dateClosed(date, settings, closures) {
  if (closures.some((closure) => closure.active !== false && closure.date === date)) return true;
  const closedWeekdays = Array.isArray(settings?.closedWeekdays) ? settings.closedWeekdays.map(Number) : [0];
  return closedWeekdays.includes(weekday(date));
}

function generateOptions({ analysis, request, data, routeConfig, today, currentTime = arubaDateParts().time }) {
  const options = [];
  const calendarSettings = data.businessSettings.find((item) => item.id === "business-calendar") ?? { closedWeekdays: [0] };
  const presetSettings = data.businessSettings.find((item) => item.id === "appointment-work-presets");
  const preset = resolvePreset(analysis, presetSettings);
  const quantity = parseQuantity(analysis.collectedInformation?.quantity);
  const allocations = distributeUnits(quantity, preset.durationMinutesPerUnit, data.vans.length);
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
  const requestedTime = normalizeTime(analysis.collectedInformation.requestedTime || analysis.collectedInformation.preferredTime);
  const requestedBlock = timeBlock(analysis.collectedInformation.requestedTime || analysis.collectedInformation.preferredTime || request.latestCustomerTurn);

  for (let dayOffset = 0; dayOffset < MAX_SEARCH_DAYS; dayOffset += 1) {
    const date = addDays(today, dayOffset);
    if (dateClosed(date, calendarSettings, data.calendarClosures)) continue;
    const dateAssignments = data.vans.map((van) => ({
      van,
      assignment: resolveAssignment(van, date, data.staffProfiles, data.dailyVanAssignments, data.staffAbsences),
    })).filter(({ van, assignment }) => vanCanReceiveAppointments(van, assignment));
    if (dateAssignments.length < allocations.length) continue;

    const candidateTimes = [...REGULAR_SLOTS];
    for (const time of candidateTimes) {
      if (date === today && time <= currentTime) continue;
      if (requestedBlock === "morning" && AFTERNOON_SLOTS.includes(time)) continue;
      if (requestedBlock === "afternoon" && MORNING_SLOTS.includes(time)) continue;
      const perVanCandidates = dateAssignments.map(({ van, assignment }) => candidateAvailability({
        date,
        time,
        allocation: allocations[0],
        van,
        assignment,
        data,
        routeConfig,
        candidateZone,
      })).filter(Boolean);
      if (perVanCandidates.length < allocations.length) continue;

      const selected = [];
      const remainingVans = [...dateAssignments];
      let possible = true;
      for (const allocation of allocations) {
        const candidates = remainingVans.map(({ van, assignment }) => candidateAvailability({
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
      const requestedDateDistancePenalty = requestedDate ? Math.abs(dateDistanceInDays(date, requestedDate)) * 18 : 0;
      const requestedTimeBonus = requestedTime && time === requestedTime ? 180 : 0;
      const requestedTimePenalty = requestedTime && time !== requestedTime ? 25 : 0;
      const morningBonus = !requestedTime && !requestedBlock && MORNING_SLOTS.includes(time) ? 8 : 0;
      const score = 1_000 + totalRouteScore + requestedDateBonus + requestedTimeBonus + morningBonus - datePenalty - requestedDateDistancePenalty - requestedTimePenalty;
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
    requestedDateUnavailable: Boolean(requestedDate && !options.some((option) => option.date === requestedDate)),
    requestedTimeUnavailable: Boolean(requestedTime && !options.some((option) => option.date === (requestedDate || option.date) && option.time === requestedTime)),
    customer,
    candidateZone,
    reason: unique.length ? "available" : "no-availability",
  };
}

function formatDateSpanish(date) {
  return new Intl.DateTimeFormat("es-AW", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${date}T12:00:00Z`));
}

function formatDateEnglish(date) {
  return new Intl.DateTimeFormat("en-AW", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" })
    .format(new Date(`${date}T12:00:00Z`));
}

function formatClock(value, language) {
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date(Date.UTC(2020, 0, 1, hour, minute));
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "es-AW", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function workPhrase(language, quantity, presetLabel) {
  if (language === "en") return `${presetLabel.toLowerCase()} for ${quantity} AC unit${quantity === 1 ? "" : "s"}`;
  if (language === "pap-aw") return `${presetLabel.toLowerCase()} pa ${quantity} airco`;
  return `${presetLabel.toLowerCase()} para ${quantity} aire${quantity === 1 ? "" : "s"} acondicionado${quantity === 1 ? "" : "s"}`;
}

function formatAvailabilityReply(language, result) {
  const { options, quantity, preset, requestedDateUnavailable, requestedDate } = result;
  if (!options.length) {
    if (language === "en") return "At this moment, our schedule does not have a suitable route and consecutive capacity for this service. Our operations team will review it manually and contact you with the closest option.";
    if (language === "pap-aw") return "Na e momento aki, nos agenda no tin un ruta y capacidad consecutivo cu ta cuadra cu e servicio. Nos team di Operacion lo revisa e agenda manualmente y lo bolbe cerca bo cu e opcion mas cercano.";
    return "En este momento, nuestra agenda no tiene una ruta y capacidad consecutiva adecuada para este servicio. Nuestro equipo de Operaciones la revisará manualmente y le responderá con la opción más cercana.";
  }
  const phrase = workPhrase(language, quantity, preset.label);
  if (language === "en") {
    const prefix = requestedDateUnavailable && requestedDate
      ? `We do not have a suitable opening on ${formatDateEnglish(requestedDate)}. `
      : "";
    const lines = options.map((option, index) => `${index + 1}) ${formatDateEnglish(option.date)}, ${formatClock(option.time, language)}–${formatClock(option.endTime, language)}`);
    return `${prefix}The closest available options for ${phrase} at ${options[0].address} are: ${lines.join("; ")}. Which option works best for you?`;
  }
  if (language === "pap-aw") {
    const prefix = requestedDateUnavailable && requestedDate
      ? `Nos no tin un cupo cu ta cuadra riba ${requestedDate}. `
      : "";
    const lines = options.map((option, index) => `${index + 1}) ${option.date}, ${formatClock(option.time, "es")} pa ${formatClock(option.endTime, "es")}`);
    return `${prefix}E opcionnan mas cerca cu nos tin disponibel pa ${phrase} na ${options[0].address} ta: ${lines.join("; ")}. Cua opcion ta mihor pa bo?`;
  }
  const prefix = requestedDateUnavailable && requestedDate
    ? `No tenemos un espacio adecuado el ${formatDateSpanish(requestedDate)}. `
    : "";
  const lines = options.map((option, index) => `${index + 1}) ${formatDateSpanish(option.date)}, de ${formatClock(option.time, language)} a ${formatClock(option.endTime, language)}`);
  return `${prefix}Las opciones disponibles más cercanas para ${phrase} en ${options[0].address} son: ${lines.join("; ")}. ¿Cuál de estas opciones prefiere?`;
}

function formatConfirmationReply(language, option) {
  if (language === "en") {
    return `Perfect. Your appointment is confirmed for ${formatDateEnglish(option.date)}, from ${formatClock(option.time, language)} to ${formatClock(option.endTime, language)} at ${option.address}. DEMAC will send the corresponding confirmation and reminder.`;
  }
  if (language === "pap-aw") {
    return `Perfecto. Bo cita ta confirma pa ${option.date}, di ${formatClock(option.time, "es")} pa ${formatClock(option.endTime, "es")} na ${option.address}. DEMAC lo manda e confirmacion y recordatorio correspondiente.`;
  }
  return `Perfecto. Su cita quedó confirmada para el ${formatDateSpanish(option.date)}, de ${formatClock(option.time, language)} a ${formatClock(option.endTime, language)}, en ${option.address}. DEMAC enviará la confirmación y el recordatorio correspondientes.`;
}

module.exports = {
  candidateAvailability,
  distributeUnits,
  formatAvailabilityReply,
  formatConfirmationReply,
  generateOptions,
  normalizeOrderTime,
  parseQuantity,
  resolvePreset,
};
