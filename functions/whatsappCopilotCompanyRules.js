const availability = require("./whatsappCopilotAvailability");
const {
  parseTimeConstraint,
  timeAllowed,
} = require("./whatsappCopilotCorrections");
const {
  AFTERNOON_SLOTS,
  EXTRA_MORNING_SLOT,
  MAX_SEARCH_DAYS,
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

const CLIENT_OPTION_LIMIT = 2;
const DEFAULT_COMPANY_OPERATIONAL_RULES = Object.freeze({
  id: "company-operational-rules",
  version: 1,
  standardService: {
    differentPropertyDailyCapacity: 6,
    morningDifferentPropertyStops: 3,
    afternoonDifferentPropertyStops: 3,
    singlePropertyMainVanMaxUnits: 7,
    automaticSupportFromUnits: 8,
    automaticSupportMaxUnits: 10,
    supportHalfDayMaxUnits: 3,
  },
  routing: {
    officeZoneId: "santa-cruz",
    morningAnchorTime: "08:30",
    afternoonAnchorTime: "13:30",
  },
  customerCommunication: {
    hideSupportVanDetails: true,
    largeJobAllDayNotice: true,
    answerCurrentQuestionFirst: true,
  },
});

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function normalizeCompanyOperationalRules(raw) {
  const standard = raw?.standardService || {};
  const normalized = {
    ...DEFAULT_COMPANY_OPERATIONAL_RULES,
    standardService: {
      differentPropertyDailyCapacity: boundedInteger(
        standard.differentPropertyDailyCapacity,
        DEFAULT_COMPANY_OPERATIONAL_RULES.standardService.differentPropertyDailyCapacity,
        1,
        12,
      ),
      morningDifferentPropertyStops: boundedInteger(
        standard.morningDifferentPropertyStops,
        DEFAULT_COMPANY_OPERATIONAL_RULES.standardService.morningDifferentPropertyStops,
        1,
        6,
      ),
      afternoonDifferentPropertyStops: boundedInteger(
        standard.afternoonDifferentPropertyStops,
        DEFAULT_COMPANY_OPERATIONAL_RULES.standardService.afternoonDifferentPropertyStops,
        1,
        6,
      ),
      singlePropertyMainVanMaxUnits: boundedInteger(
        standard.singlePropertyMainVanMaxUnits,
        DEFAULT_COMPANY_OPERATIONAL_RULES.standardService.singlePropertyMainVanMaxUnits,
        1,
        12,
      ),
      automaticSupportFromUnits: boundedInteger(
        standard.automaticSupportFromUnits,
        DEFAULT_COMPANY_OPERATIONAL_RULES.standardService.automaticSupportFromUnits,
        2,
        20,
      ),
      automaticSupportMaxUnits: boundedInteger(
        standard.automaticSupportMaxUnits,
        DEFAULT_COMPANY_OPERATIONAL_RULES.standardService.automaticSupportMaxUnits,
        2,
        24,
      ),
      supportHalfDayMaxUnits: boundedInteger(
        standard.supportHalfDayMaxUnits,
        DEFAULT_COMPANY_OPERATIONAL_RULES.standardService.supportHalfDayMaxUnits,
        1,
        6,
      ),
    },
    routing: DEFAULT_COMPANY_OPERATIONAL_RULES.routing,
    customerCommunication: DEFAULT_COMPANY_OPERATIONAL_RULES.customerCommunication,
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

function isStandardServicePreset(preset) {
  const text = normalizeText(`${preset?.id || ""} ${preset?.label || ""}`);
  return /standard service|servicio estandar|servicio standard/.test(text)
    || preset?.id === "standard_service";
}

function blockForTime(time) {
  return AFTERNOON_SLOTS.includes(time) ? "afternoon" : "morning";
}

function buildAllocationPlan(quantity, durationMinutesPerUnit, availableVanCount, preset, rawRules) {
  const rules = normalizeCompanyOperationalRules(rawRules);
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

function distributeUnits(quantity, durationMinutesPerUnit, availableVanCount, rawRules, preset) {
  return buildAllocationPlan(
    Number(quantity),
    durationMinutesPerUnit,
    availableVanCount,
    preset || { id: "standard_service", label: "Servicio estándar" },
    rawRules,
  );
}

function dateClosed(date, settings, closures) {
  if (closures.some((closure) => closure.active !== false && closure.date === date)) return true;
  const closedWeekdays = Array.isArray(settings?.closedWeekdays) ? settings.closedWeekdays.map(Number) : [0];
  return closedWeekdays.includes(weekday(date));
}

function resolveServiceId(services, preset) {
  const normalizedLabel = normalizeText(preset.label);
  const exact = services.find((service) => normalizeText(service.name) === normalizedLabel);
  if (exact) return exact.id;
  const kindMatch = services.find((service) => {
    const text = normalizeText(`${service.name} ${service.category}`);
    if (preset.id === "repair_diagnostic") return /repair|repar|diagnost/.test(text);
    if (preset.kind === "installation") return /instal/.test(text);
    if (preset.id === "deep_cleaning") return /profund|deep/.test(text);
    return /servicio|mantenimiento/.test(text);
  });
  return kindMatch?.id ?? services[0]?.id ?? "whatsapp-copilot-service";
}

function candidateTimesForAllocation(allocation, primaryTime) {
  if (allocation.timePolicy === "fixed") return [allocation.fixedTime];
  if (allocation.timePolicy === "allowed") return allocation.allowedTimes || [];
  return [primaryTime];
}

function selectClientOptions(options) {
  const available = Array.isArray(options) ? options.filter(Boolean) : [];
  if (available.length <= CLIENT_OPTION_LIMIT) return available;
  const first = available[0];
  const differentDate = available.find((option) => option.date !== first.date);
  return differentDate ? [first, differentDate] : available.slice(0, CLIENT_OPTION_LIMIT);
}

function generateOptions({ analysis, request, data, routeConfig, today, currentTime = arubaDateParts().time }) {
  const options = [];
  const calendarSettings = data.businessSettings.find((item) => item.id === "business-calendar")
    ?? { closedWeekdays: [0] };
  const presetSettings = data.businessSettings.find((item) => item.id === "appointment-work-presets");
  const operationalSettings = data.businessSettings.find((item) => item.id === "company-operational-rules");
  const operationalRules = normalizeCompanyOperationalRules(operationalSettings);
  const preset = availability.resolvePreset(analysis, presetSettings);
  const quantity = availability.parseQuantity(analysis.collectedInformation?.quantity);
  const allocations = buildAllocationPlan(
    quantity,
    preset.durationMinutesPerUnit,
    data.vans.length,
    preset,
    operationalRules,
  );
  if (!quantity || !allocations.length) {
    return {
      options: [],
      preset,
      quantity,
      allocations,
      operationalRules,
      reason: quantity ? "capacity" : "missing-quantity",
    };
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
  const largeSingleProperty = isStandardServicePreset(preset)
    && quantity > operationalRules.standardService.differentPropertyDailyCapacity;
  const primaryAllocation = allocations[0];
  const primaryCandidateTimes = primaryAllocation.timePolicy === "fixed"
    ? [primaryAllocation.fixedTime]
    : [...REGULAR_SLOTS, EXTRA_MORNING_SLOT].sort();

  for (let dayOffset = 0; dayOffset < MAX_SEARCH_DAYS; dayOffset += 1) {
    const date = addDays(today, dayOffset);
    if (dateClosed(date, calendarSettings, data.calendarClosures)) continue;
    const dateAssignments = data.vans.map((van) => ({
      van,
      assignment: resolveAssignment(van, date, data.staffProfiles, data.dailyVanAssignments, data.staffAbsences),
    })).filter(({ van, assignment }) => vanCanReceiveAppointments(van, assignment));
    if (dateAssignments.length < allocations.length) continue;

    for (const primaryTime of primaryCandidateTimes) {
      if (!primaryTime) continue;
      if (date === today && primaryTime <= currentTime) continue;
      if (!timeAllowed(primaryTime, timeConstraint)) continue;
      if (!timeConstraint.kind && requestedBlock === "morning" && AFTERNOON_SLOTS.includes(primaryTime)) continue;
      if (!timeConstraint.kind && requestedBlock === "afternoon" && [...MORNING_SLOTS, EXTRA_MORNING_SLOT].includes(primaryTime)) continue;

      const selected = [];
      const remainingVans = [...dateAssignments];
      let possible = true;
      for (const allocation of allocations) {
        const allowedTimes = candidateTimesForAllocation(allocation, primaryTime);
        const candidates = [];
        for (const { van, assignment } of remainingVans) {
          for (const allocationTime of allowedTimes) {
            if (!allocationTime) continue;
            if (date === today && allocationTime <= currentTime) continue;
            const candidate = availability.candidateAvailability({
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
        candidates.sort((left, right) => {
          const routeDifference = right.routeScore - left.routeScore;
          if (routeDifference) return routeDifference;
          if (allocation.role === "support") {
            const leftMorning = left.block === "morning" ? 1 : 0;
            const rightMorning = right.block === "morning" ? 1 : 0;
            if (leftMorning !== rightMorning) return rightMorning - leftMorning;
          }
          return left.time.localeCompare(right.time);
        });
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

      const primary = selected.find((item) => item.role === "primary") || selected[0];
      const totalRouteScore = selected.reduce((sum, item) => sum + item.routeScore, 0);
      const datePenalty = dayOffset * 9;
      const requestedDateBonus = requestedDate && date === requestedDate ? 500 : 0;
      const requestedDateDistancePenalty = requestedDate
        ? Math.abs(dateDistanceInDays(date, requestedDate)) * 18
        : 0;
      const exactTimePreference = timeConstraint.kind ? "" : requestedTime;
      const requestedTimeBonus = exactTimePreference && primary.time === exactTimePreference ? 180 : 0;
      const requestedTimePenalty = exactTimePreference && primary.time !== exactTimePreference ? 25 : 0;
      const morningBonus = !exactTimePreference && !requestedBlock && !timeConstraint.kind && MORNING_SLOTS.includes(primary.time)
        ? 8
        : 0;
      const score = 1_000
        + totalRouteScore
        + requestedDateBonus
        + requestedTimeBonus
        + morningBonus
        - datePenalty
        - requestedDateDistancePenalty
        - requestedTimePenalty;

      options.push({
        id: `opt-${hashId(`${date}|${primary.time}|${selected.map((item) => `${item.vanId}:${item.time}`).join(",")}|${quantity}|${preset.id}`, 16)}`,
        date,
        time: primary.time,
        endTime: primary.endTime,
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
        requestedTimeMatch: Boolean(requestedTime && primary.time === requestedTime),
        largeSingleProperty,
        allDayCustomerNotice: largeSingleProperty && operationalRules.customerCommunication.largeJobAllDayNotice,
        internalSupportCount: Math.max(0, selected.length - 1),
      });
    }
  }

  options.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const unique = [];
  const seen = new Set();
  for (const option of options) {
    const key = `${option.date}|${option.time}|${option.assignments.map((item) => `${item.vanId}:${item.time}`).sort().join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(option);
    if (unique.length >= CLIENT_OPTION_LIMIT) break;
  }

  return {
    options: selectClientOptions(unique),
    preset,
    quantity,
    allocations,
    requestedDate,
    requestedTime,
    timeConstraint,
    operationalRules,
    largeSingleProperty,
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

function capitalize(value) {
  const text = String(value || "").trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function formatDateSpanish(date) {
  return capitalize(new Intl.DateTimeFormat("es-AW", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00Z`)).replace(",", ""));
}

function formatDateEnglish(date) {
  return new Intl.DateTimeFormat("en-AW", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatDatePapiamento(date) {
  const value = new Date(`${date}T12:00:00Z`);
  const weekdays = ["Diadomingo", "Dialuna", "Diamars", "Diaranson", "Diahuebs", "Diabierna", "Diasabra"];
  const months = ["yanuari", "februari", "maart", "aprel", "mei", "yüni", "yüli", "augustus", "sèptèmber", "òktober", "novèmber", "desèmber"];
  return `${weekdays[value.getUTCDay()]} ${value.getUTCDate()} di ${months[value.getUTCMonth()]}`;
}

function formatClock(value, language) {
  const [hour, minute] = String(value).split(":").map(Number);
  const date = new Date(Date.UTC(2020, 0, 1, hour, minute));
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "es-AW", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date).replace(/\u00a0/g, " ");
}

function serviceReference(language, quantity) {
  if (language === "en") return quantity === 1 ? "the AC service" : `the service for ${quantity} AC units`;
  if (language === "pap-aw") return quantity === 1 ? "e servicio di e airco" : `e servicio di ${quantity} airco`;
  return quantity === 1 ? "el servicio del aire acondicionado" : `el servicio de los ${quantity} aires`;
}

function optionLine(language, option, index) {
  const date = language === "en"
    ? formatDateEnglish(option.date)
    : language === "pap-aw"
      ? formatDatePapiamento(option.date)
      : formatDateSpanish(option.date);
  return `*${index + 1}. ${date} — ${formatClock(option.time, language)}*`;
}

function allDayNotice(language) {
  if (language === "en") return "Because of the number of AC units, our team will start at 8:30 a.m. and the work may continue throughout the day.";
  if (language === "pap-aw") return "Pa motibo di e cantidad di airco, nos team lo cuminsa 8:30 a.m. y e trabou por sigui durante henter e dia.";
  return "Por la cantidad de aires, nuestro equipo comenzará a las 8:30 a. m. y el trabajo puede extenderse durante el día.";
}

function formatAvailabilityReply(language, result) {
  const options = selectClientOptions(result?.options);
  if (!options.length) {
    if (language === "en") return "At this moment, I do not have a suitable opening for this service. Our Operations team will review the capacity and route manually and send you the closest option.";
    if (language === "pap-aw") return "Na e momento aki, mi no tin un cupo adecuado pa e servicio aki. Nos team di Operacion lo revisa capacidad y ruta manualmente y lo manda bo e opcion mas cercano.";
    return "En este momento no tengo un espacio adecuado para este servicio. Nuestro equipo de Operaciones revisará manualmente la capacidad y la ruta y le enviará la opción más cercana.";
  }

  const quantity = Number(result.quantity || options[0]?.quantity || 0);
  const intro = language === "en"
    ? `Perfect. For ${serviceReference(language, quantity)}, I have these options available:`
    : language === "pap-aw"
      ? `Perfecto. Pa ${serviceReference(language, quantity)}, nos tin e opcionnan aki disponibel:`
      : `Perfecto. Para ${serviceReference(language, quantity)}, tengo disponibles estas opciones:`;
  const lines = options.map((option, index) => optionLine(language, option, index));
  const notice = options.some((option) => option.allDayCustomerNotice)
    ? `\n\n${allDayNotice(language)}`
    : "";
  const question = language === "en"
    ? "Which option works best for you?"
    : language === "pap-aw"
      ? "Cua opcion ta mihor pa bo?"
      : "¿Cuál opción le resulta mejor?";
  return `${intro}\n\n${lines.join("\n\n")}${notice}\n\n${question}`;
}

function formatConfirmationReply(language, option) {
  const date = language === "en"
    ? formatDateEnglish(option.date)
    : language === "pap-aw"
      ? formatDatePapiamento(option.date)
      : formatDateSpanish(option.date);
  const time = formatClock(option.time, language);
  const notice = option.allDayCustomerNotice ? `\n\n${allDayNotice(language)}` : "";
  if (language === "en") {
    return `Perfect, your appointment is confirmed:\n\n*${date} — ${time}*\n${option.address}${notice}\n\nWe will send the corresponding confirmation and reminder.`;
  }
  if (language === "pap-aw") {
    return `Perfecto, bo cita ta confirma:\n\n*${date} — ${time}*\n${option.address}${notice}\n\nNos lo manda e confirmacion y recordatorio correspondiente.`;
  }
  return `Perfecto, su cita quedó confirmada:\n\n*${date} — ${time}*\n${option.address}${notice}\n\nLe enviaremos la confirmación y el recordatorio correspondientes.`;
}

availability.distributeUnits = distributeUnits;
availability.generateOptions = generateOptions;
availability.formatAvailabilityReply = formatAvailabilityReply;
availability.formatConfirmationReply = formatConfirmationReply;

module.exports = {
  CLIENT_OPTION_LIMIT,
  DEFAULT_COMPANY_OPERATIONAL_RULES,
  allDayNotice,
  buildAllocationPlan,
  distributeUnits,
  formatAvailabilityReply,
  formatConfirmationReply,
  generateOptions,
  normalizeCompanyOperationalRules,
  selectClientOptions,
};
