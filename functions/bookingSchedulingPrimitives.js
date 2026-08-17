const crypto = require("node:crypto");

const ARUBA_TIME_ZONE = "America/Aruba";
const MORNING_SLOTS = ["08:30", "09:30", "10:30"];
const EXTRA_MORNING_SLOT = "11:30";
const AFTERNOON_SLOTS = ["13:30", "14:30", "15:30"];
const REGULAR_SLOTS = [...MORNING_SLOTS, ...AFTERNOON_SLOTS];
const HALF_DAY_SLOTS = [...MORNING_SLOTS, EXTRA_MORNING_SLOT];
const HALF_DAY_EFFECTIVE_FROM = "2026-08-01";
const MAX_SEARCH_DAYS = 21;
const MAX_VANS = 4;

const ACTIVE_BLOCKING_STATUSES = new Set([
  "Solicitud recibida",
  "Reserva temporal",
  "Confirmada",
  "Asignada",
  "En camino",
  "En el sitio",
  "En proceso",
  "Pendiente",
  "Completada",
  "Facturada",
  "Pagada",
]);

const DEFAULT_ROUTE_CONFIG = {
  officeZoneId: "santa-cruz",
  maximumAnchorDistance: 40,
  zones: [
    { id: "north-far", label: "Malmok / Arashi", position: 100, aliases: ["malmok", "arashi", "westpunt", "tierra del sol", "boca catalina"] },
    { id: "noord", label: "Noord / Palm Beach", position: 90, aliases: ["noord", "north", "palm beach", "bakval", "turibana", "kamay", "salina cerca", "rooi santo"] },
    { id: "north-central", label: "Bubali / Eagle", position: 78, aliases: ["bubali", "eagle beach", "tanki leendert", "boegoeroei", "kudawecha", "cunucu abao"] },
    { id: "oranjestad", label: "Oranjestad / Airport", position: 68, aliases: ["oranjestad", "ponton", "madiki", "dakota", "wayaca", "guayaca", "sabana blanco", "seroe blanco", "morgenster", "companshi", "mon plaisir"] },
    { id: "paradera", label: "Paradera / Hooiberg", position: 58, aliases: ["paradera", "piedra plat", "hooiberg", "papilon", "shaba", "tanki flip"] },
    { id: "santa-cruz", label: "Santa Cruz", position: 50, aliases: ["santa cruz", "macuarima", "urataka", "cashero", "jabruribari", "jan flemming", "bringamosa"] },
    { id: "bosch-chiquito", label: "Bosch Chiquito / Balashi", position: 42, aliases: ["bosch chiquito", "bos chiquito", "pos chiquito", "balashi", "sabana basora", "pavia"] },
    { id: "savaneta", label: "Savaneta", position: 28, aliases: ["savaneta", "sabaneta", "mangel halto", "de cuba", "cura cabai", "commanders bay"] },
    { id: "san-nicolas", label: "San Nicolas", position: 10, aliases: ["san nicolas", "sint nicolaas", "brazil", "zeewijk", "lago heights", "rooi kochi", "rooi kooki", "essoville"] },
    { id: "seroe-colorado", label: "Seroe Colorado", position: 0, aliases: ["seroe colorado", "baby beach", "rodgers beach", "ceru colorado"] },
  ],
};

function cleanText(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeText(value) {
  return cleanText(value, 2_000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 7) return `297${digits}`;
  return digits;
}

function hashId(value, length = 32) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, length);
}

function snapshotItems(snapshot) {
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function arubaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ARUBA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekday(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function dateDistanceInDays(left, right) {
  const leftDate = new Date(`${left}T12:00:00Z`).getTime();
  const rightDate = new Date(`${right}T12:00:00Z`).getTime();
  return Math.round((leftDate - rightDate) / 86_400_000);
}

function normalizeTime(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const match = String(value).match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?\b/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const suffix = String(match[3] ?? "").toLowerCase();
  if (suffix.includes("p") && hour < 12) hour += 12;
  if (suffix.includes("a") && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function endTime(start, slots) {
  const schedule = start === EXTRA_MORNING_SLOT
    ? HALF_DAY_SLOTS
    : AFTERNOON_SLOTS.includes(start)
      ? AFTERNOON_SLOTS
      : REGULAR_SLOTS;
  const index = schedule.indexOf(start);
  if (index < 0) return start;
  const last = schedule[Math.min(schedule.length - 1, index + Math.max(1, slots) - 1)] ?? start;
  const [hour, minute] = last.split(":").map(Number);
  return `${String(hour + 1).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function orderBlocksCapacity(order) {
  if (ACTIVE_BLOCKING_STATUSES.has(order.status)) return true;
  return !["Cancelada", "Reprogramada"].includes(order.status);
}

function orderSlotCount(order, services) {
  const storedSlots = Number(order.scheduledSlots ?? 0);
  if (storedSlots > 0) return Math.max(1, Math.min(6, Math.ceil(storedSlots)));
  const exactMinutes = Number(order.appointmentDurationMinutes ?? 0);
  if (exactMinutes > 0) return Math.max(1, Math.min(6, Math.ceil(exactMinutes / 60)));
  const service = services.find((item) => item.id === order.serviceId);
  return Math.max(1, Math.min(6, Math.ceil(Number(service?.durationMinutes ?? 60) / 60)));
}

function isHalfDay(vanId, date, schedules) {
  if (date < HALF_DAY_EFFECTIVE_FROM) return false;
  const day = weekday(date);
  return schedules.some((schedule) => schedule.active !== false && schedule.vanId === vanId && Number(schedule.weekday) === day);
}

function bookingSlots(halfDay) {
  return halfDay ? HALF_DAY_SLOTS : REGULAR_SLOTS;
}

function occupiedSlots(startTime, slotCount, halfDay) {
  const schedule = bookingSlots(halfDay);
  const start = schedule.indexOf(startTime);
  if (start < 0 || start + slotCount > schedule.length) return [];
  return schedule.slice(start, start + slotCount);
}

function staffUnavailable(profile, date, absences) {
  if (!profile || profile.active === false || profile.availability === "Inactivo") return true;
  const generallyUnavailable = profile.availability && profile.availability !== "Disponible"
    && (!profile.unavailableFrom || date >= profile.unavailableFrom)
    && (!profile.unavailableUntil || date <= profile.unavailableUntil);
  return Boolean(generallyUnavailable) || absences.some((absence) =>
    absence.active !== false
    && absence.staffId === profile.id
    && date >= absence.fromDate
    && date <= absence.toDate,
  );
}

function resolveAssignment(van, date, profiles, assignments, absences) {
  const saved = assignments.find((item) => item.vanId === van.id && item.date === date);
  const driver = profiles.find((item) => item.id === (saved?.driverStaffId ?? van.responsibleStaffId));
  const helper = profiles.find((item) => item.id === (saved?.helperStaffId ?? van.regularHelperId));
  const driverStaffId = driver?.canDriveVan && !staffUnavailable(driver, date, absences) ? driver.id : undefined;
  const helperStaffId = helper && !staffUnavailable(helper, date, absences) ? helper.id : undefined;
  let status;
  if (van.active === false || van.status === "Fuera de servicio" || saved?.status === "Fuera de servicio") status = "Fuera de servicio";
  else if (van.status === "Mantenimiento" || saved?.status === "Mantenimiento") status = "Mantenimiento";
  else if (!driverStaffId || saved?.status === "Sin personal") status = "Sin personal";
  else if (!helperStaffId || saved?.status === "Trabajo liviano") status = "Trabajo liviano";
  else status = "Disponible";
  return {
    vanId: van.id,
    driverStaffId,
    helperStaffId,
    technicianIds: [driverStaffId, helperStaffId].filter(Boolean),
    status,
  };
}

function vanCanReceiveAppointments(van, assignment) {
  return van.active !== false
    && Boolean(assignment.driverStaffId)
    && !["Mantenimiento", "Fuera de servicio", "Sin personal"].includes(assignment.status);
}

function normalizeRouteConfig(raw) {
  const zones = Array.isArray(raw?.zones) && raw.zones.length
    ? raw.zones.map((zone) => ({
      id: cleanText(zone.id, 80),
      label: cleanText(zone.label || zone.id, 120),
      position: Number(zone.position),
      aliases: Array.isArray(zone.aliases) ? zone.aliases.map((alias) => normalizeText(alias)).filter(Boolean) : [],
    })).filter((zone) => zone.id && Number.isFinite(zone.position) && zone.aliases.length)
    : DEFAULT_ROUTE_CONFIG.zones;
  return {
    officeZoneId: cleanText(raw?.officeZoneId, 80) || DEFAULT_ROUTE_CONFIG.officeZoneId,
    maximumAnchorDistance: Number.isFinite(Number(raw?.maximumAnchorDistance))
      ? Math.max(10, Math.min(100, Number(raw.maximumAnchorDistance)))
      : DEFAULT_ROUTE_CONFIG.maximumAnchorDistance,
    zones,
  };
}

function identifyZone(value, routeConfig) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  let best = null;
  for (const zone of routeConfig.zones) {
    for (const alias of zone.aliases) {
      if (!alias || !normalized.includes(alias)) continue;
      if (!best || alias.length > best.aliasLength) best = { ...zone, aliasLength: alias.length };
    }
  }
  return best ? { id: best.id, label: best.label, position: best.position } : null;
}

function propertyZone(property, fallbackAddress, routeConfig) {
  return identifyZone([
    property?.operationalZone,
    property?.zone,
    property?.neighborhood,
    property?.addressNormalized,
    property?.address,
    fallbackAddress,
  ].filter(Boolean).join(" "), routeConfig);
}

function routeCompatibility({ candidateZone, existingOrders, candidateTime, officePosition, maximumAnchorDistance }) {
  if (!candidateZone) return { allowed: true, score: 0, reason: "unknown-zone" };
  const blockSlots = AFTERNOON_SLOTS.includes(candidateTime) ? AFTERNOON_SLOTS : [...MORNING_SLOTS, EXTRA_MORNING_SLOT];
  const blockOrders = existingOrders
    .filter((item) => blockSlots.includes(item.time) && item.zoneInfo)
    .sort((a, b) => a.time.localeCompare(b.time));
  if (!blockOrders.length) return { allowed: true, score: 22, reason: "new-anchor" };

  const anchor = blockOrders[0];
  const anchorDistance = Math.abs(candidateZone.position - anchor.zoneInfo.position);
  const candidateIndex = blockSlots.indexOf(candidateTime);
  const anchorIndex = blockSlots.indexOf(anchor.time);
  const previous = [...blockOrders].reverse().find((item) => blockSlots.indexOf(item.time) < candidateIndex);
  const next = blockOrders.find((item) => blockSlots.indexOf(item.time) > candidateIndex);

  let allowed = anchorDistance <= maximumAnchorDistance;
  let score = Math.max(-25, 26 - anchorDistance);
  let reason = "anchor-compatible";

  if (candidateIndex > anchorIndex) {
    const reference = previous?.zoneInfo ?? anchor.zoneInfo;
    const referenceOfficeDistance = Math.abs(reference.position - officePosition);
    const candidateOfficeDistance = Math.abs(candidateZone.position - officePosition);
    if (candidateOfficeDistance <= referenceOfficeDistance + 4) {
      score += 24;
      reason = "toward-office";
    } else {
      score -= 38;
      reason = "away-from-office";
      if (candidateOfficeDistance - referenceOfficeDistance > 20) allowed = false;
    }
  }

  if (previous?.zoneInfo) score += Math.max(-18, 18 - Math.abs(candidateZone.position - previous.zoneInfo.position));
  if (next?.zoneInfo) score += Math.max(-18, 18 - Math.abs(candidateZone.position - next.zoneInfo.position));
  if (previous?.zoneInfo && next?.zoneInfo) {
    const minimum = Math.min(previous.zoneInfo.position, next.zoneInfo.position) - 8;
    const maximum = Math.max(previous.zoneInfo.position, next.zoneInfo.position) + 8;
    if (candidateZone.position >= minimum && candidateZone.position <= maximum) score += 16;
    else score -= 22;
  }

  return { allowed, score, reason };
}

function tokenSet(value) {
  return new Set(normalizeText(value).split(" ").filter((token) => token.length > 1));
}

function addressSimilarity(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  const jaccard = intersection / union;
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  const inclusion = normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft) ? 0.35 : 0;
  return Math.min(1, jaccard + inclusion);
}

module.exports = {
  AFTERNOON_SLOTS,
  EXTRA_MORNING_SLOT,
  MAX_SEARCH_DAYS,
  MAX_VANS,
  MORNING_SLOTS,
  REGULAR_SLOTS,
  addDays,
  addressSimilarity,
  arubaDateParts,
  cleanText,
  dateDistanceInDays,
  endTime,
  hashId,
  isHalfDay,
  normalizePhone,
  normalizeRouteConfig,
  normalizeText,
  normalizeTime,
  occupiedSlots,
  orderBlocksCapacity,
  orderSlotCount,
  propertyZone,
  resolveAssignment,
  routeCompatibility,
  snapshotItems,
  vanCanReceiveAppointments,
  weekday,
};
