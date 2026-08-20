const { cleanText } = require("./bookingAuthorityCore");
const { normalizeText } = require("./bookingSchedulingPrimitives");

const SCHEDULING_WORK_TYPES_SETTINGS_ID = "appointment-work-presets";
const SCHEDULING_WORK_TYPES_SOURCE = "scheduling_work_types";
const SCHEDULING_WORK_TYPES_VERSION = 2;

const DEFAULT_SCHEDULING_WORK_TYPES = Object.freeze([
  Object.freeze({ id: "standard_service", label: "Standard Service", durationMinutesPerUnit: 60, kind: "service", active: true, sortOrder: 10 }),
  Object.freeze({ id: "deep_cleaning", label: "Premium Deep Cleaning Service", durationMinutesPerUnit: 120, kind: "service", active: true, sortOrder: 20 }),
  Object.freeze({ id: "standard_installation", label: "Standard Installation", durationMinutesPerUnit: 120, kind: "installation", active: true, sortOrder: 30 }),
  Object.freeze({ id: "installation_extended_labor", label: "Installation Extended Labor", durationMinutesPerUnit: 180, kind: "installation", active: true, sortOrder: 40 }),
  Object.freeze({ id: "check_up", label: "Check Up", durationMinutesPerUnit: 60, kind: "service", active: true, sortOrder: 50 }),
  Object.freeze({ id: "leak_repair", label: "Leak Repair", durationMinutesPerUnit: 180, kind: "service", active: true, sortOrder: 60 }),
  Object.freeze({ id: "commercial_service", label: "Commercial Service", durationMinutesPerUnit: 180, kind: "commercial", active: true, sortOrder: 70 }),
  Object.freeze({ id: "other", label: "Other", durationMinutesPerUnit: 60, kind: "other", active: true, sortOrder: 80, manualDuration: true }),
]);

const DEFAULT_BY_ID = new Map(DEFAULT_SCHEDULING_WORK_TYPES.map((item) => [item.id, item]));

const LEGACY_ID_ALIASES = Object.freeze({
  standard_service: "standard_service",
  deep_cleaning: "deep_cleaning",
  premium_deep_cleaning: "deep_cleaning",
  standard_installation: "standard_installation",
  installation_standard: "standard_installation",
  extended_installation: "installation_extended_labor",
  special_installation: "installation_extended_labor",
  installation_extended: "installation_extended_labor",
  installation_extended_labor: "installation_extended_labor",
  rooftop_installation: "installation_extended_labor",
  installation_rooftop: "installation_extended_labor",
  second_floor_installation: "installation_extended_labor",
  installation_second_floor: "installation_extended_labor",
  third_floor_installation: "installation_extended_labor",
  installation_third_floor: "installation_extended_labor",
  checkup: "check_up",
  check_up: "check_up",
  diagnostic: "check_up",
  leak_repair: "leak_repair",
  commercial: "commercial_service",
  commercial_service: "commercial_service",
  other: "other",
  otro: "other",
});

function boundedDuration(value, fallback = 60) {
  const number = Number(value);
  const safe = Number.isFinite(number) && number > 0 ? number : fallback;
  return Math.max(60, Math.min(720, Math.round(safe / 30) * 30));
}

function boundedSortOrder(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10000, Math.round(number))) : fallback;
}

function canonicalSchedulingWorkTypeId(value) {
  const raw = cleanText(value, 120);
  if (!raw) return "";
  const normalized = normalizeText(raw).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return LEGACY_ID_ALIASES[normalized] || normalized;
}

function settingsDocument(businessSettings = []) {
  if (!Array.isArray(businessSettings)) return businessSettings?.id === SCHEDULING_WORK_TYPES_SETTINGS_ID ? businessSettings : null;
  return businessSettings.find((item) => item?.id === SCHEDULING_WORK_TYPES_SETTINGS_ID) || null;
}

function compactSchedulingWorkType(item = {}, index = 0) {
  const id = canonicalSchedulingWorkTypeId(item.id);
  if (!id) return null;
  const defaults = DEFAULT_BY_ID.get(id);
  const label = cleanText(item.label || defaults?.label || id.replaceAll("_", " "), 180);
  if (!label) return null;
  const manualDuration = id === "other" || item.manualDuration === true || defaults?.manualDuration === true;
  return {
    id,
    label,
    kind: cleanText(item.kind || defaults?.kind || "service", 80),
    durationMinutesPerUnit: boundedDuration(item.durationMinutesPerUnit, defaults?.durationMinutesPerUnit || 60),
    durationMode: "per_unit",
    active: item.active !== false,
    sortOrder: boundedSortOrder(item.sortOrder, defaults?.sortOrder || (index + 1) * 10),
    manualDuration,
    serviceId: "",
    source: SCHEDULING_WORK_TYPES_SOURCE,
    serviceDefinitionVersion: 0,
  };
}

function normalizeSchedulingWorkTypes(businessSettings = []) {
  const settings = settingsDocument(businessSettings);
  // V1/Legacy appointment presets were a different concept and may contain
  // rooftop/second-floor/third-floor variants or old labels. Until the new
  // editor saves version 2, migrate the picker to DEMAC's approved eight Work
  // Types instead of leaking Legacy complexity into the new Scheduling flow.
  const modern = Number(settings?.workTypesVersion || 0) >= SCHEDULING_WORK_TYPES_VERSION;
  const configured = modern && Array.isArray(settings?.presets) ? settings.presets : [];
  const configuredById = new Map();
  const custom = [];

  configured.forEach((raw, index) => {
    const compact = compactSchedulingWorkType(raw, index);
    if (!compact) return;
    if (DEFAULT_BY_ID.has(compact.id)) {
      if (!configuredById.has(compact.id)) configuredById.set(compact.id, compact);
      return;
    }
    if (!custom.some((item) => item.id === compact.id)) custom.push(compact);
  });

  const defaults = DEFAULT_SCHEDULING_WORK_TYPES.map((item, index) => (
    configuredById.get(item.id) || compactSchedulingWorkType(item, index)
  ));

  return [...defaults, ...custom]
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label));
}

function bookableSchedulingWorkTypes(businessSettings = []) {
  return normalizeSchedulingWorkTypes(businessSettings).filter((item) => item.active !== false);
}

function resolveSchedulingWorkType(businessSettings = [], value = {}) {
  const presetId = canonicalSchedulingWorkTypeId(typeof value === "string" ? value : value?.presetId);
  if (!presetId) return null;
  return normalizeSchedulingWorkTypes(businessSettings).find((item) => item.id === presetId) || null;
}

function settingsPayload(presets = []) {
  const normalized = normalizeSchedulingWorkTypes([{
    id: SCHEDULING_WORK_TYPES_SETTINGS_ID,
    workTypesVersion: SCHEDULING_WORK_TYPES_VERSION,
    presets,
  }]);
  return {
    id: SCHEDULING_WORK_TYPES_SETTINGS_ID,
    workTypesVersion: SCHEDULING_WORK_TYPES_VERSION,
    presets: normalized.map((item) => ({
      id: item.id,
      label: item.label,
      durationMinutesPerUnit: item.durationMinutesPerUnit,
      kind: item.kind,
      active: item.active !== false,
      sortOrder: item.sortOrder,
      ...(item.manualDuration ? { manualDuration: true } : {}),
    })),
  };
}

module.exports = {
  DEFAULT_SCHEDULING_WORK_TYPES,
  LEGACY_ID_ALIASES,
  SCHEDULING_WORK_TYPES_SETTINGS_ID,
  SCHEDULING_WORK_TYPES_SOURCE,
  SCHEDULING_WORK_TYPES_VERSION,
  bookableSchedulingWorkTypes,
  canonicalSchedulingWorkTypeId,
  compactSchedulingWorkType,
  normalizeSchedulingWorkTypes,
  resolveSchedulingWorkType,
  settingsPayload,
};