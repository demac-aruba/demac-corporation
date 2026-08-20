const { cleanText } = require("./bookingAuthorityCore");
const { normalizeText } = require("./bookingSchedulingPrimitives");

const SERVICE_DEFINITION_VERSION = 1;
const SERVICE_CATALOG_SOURCE = "service_catalog";
const LEGACY_PRESET_SOURCE = "appointment_work_presets";

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function serviceItem(service = {}) {
  const type = normalizeText(service.itemType || "servicio");
  return service.active !== false && type !== "producto" && type !== "product";
}

function serviceVisibleInScheduling(service = {}) {
  return serviceItem(service) && service.featured !== false;
}

function normalizeDuration(definition = {}, service = {}) {
  const raw = definition.duration || {};
  const fallback = Number(service.durationMinutes || 60);
  const minutes = boundedInteger(raw.minutes, Number.isFinite(fallback) && fallback > 0 ? fallback : 60, 30, 720);
  // Canonical service duration is always the duration of one execution.
  // Booking supplies an execution count and Scheduling multiplies it.
  return { mode: "per_unit", minutes };
}

function normalizeCatalogService(service = {}) {
  if (!serviceItem(service)) return null;
  const definition = service.serviceDefinition;
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null;

  const bookingCode = cleanText(definition.bookingCode || service.bookingCode || service.id, 120);
  const label = cleanText(service.name || definition.label || bookingCode, 180);
  if (!bookingCode || !label) return null;

  const duration = normalizeDuration(definition, service);
  return {
    id: bookingCode,
    label,
    kind: cleanText(definition.kind || service.category || "service", 80),
    durationMinutesPerUnit: duration.minutes,
    durationMode: duration.mode,
    active: true,
    serviceId: cleanText(service.id, 120),
    source: SERVICE_CATALOG_SOURCE,
    serviceDefinitionVersion: boundedInteger(definition.version, SERVICE_DEFINITION_VERSION, 1, SERVICE_DEFINITION_VERSION),
  };
}

function duplicateBookingCodeError(bookingCode, firstServiceId, secondServiceId) {
  return new Error(
    `Duplicate active canonical service bookingCode "${bookingCode}" for services "${firstServiceId}" and "${secondServiceId}".`,
  );
}

function catalogServicePresets(services = []) {
  const presets = [];
  const codeOwners = new Map();
  const seenServices = new Set();
  for (const service of services) {
    const preset = normalizeCatalogService(service);
    if (!preset || seenServices.has(preset.serviceId)) continue;
    const existingOwner = codeOwners.get(preset.id);
    if (existingOwner && existingOwner !== preset.serviceId) {
      throw duplicateBookingCodeError(preset.id, existingOwner, preset.serviceId);
    }
    codeOwners.set(preset.id, preset.serviceId);
    seenServices.add(preset.serviceId);
    presets.push(preset);
  }
  return presets.sort((left, right) => left.label.localeCompare(right.label));
}

function bookableCatalogPresets(services = []) {
  const visibleServiceIds = new Set(
    services.filter((service) => serviceVisibleInScheduling(service)).map((service) => cleanText(service.id, 120)),
  );
  return catalogServicePresets(services).filter((preset) => visibleServiceIds.has(preset.serviceId));
}

function compactLegacyPreset(item = {}, services = []) {
  const id = cleanText(item.id, 120);
  if (!id || item.active === false) return null;
  const label = cleanText(item.label || id, 180);
  const matchingService = services.find((service) => {
    if (!serviceItem(service)) return false;
    if (cleanText(service.id, 120) === cleanText(item.serviceId, 120)) return true;
    return normalizeText(service.name) === normalizeText(label);
  });
  return {
    id,
    label,
    kind: cleanText(item.kind, 80),
    durationMinutesPerUnit: boundedInteger(item.durationMinutesPerUnit, 60, 30, 720),
    durationMode: item.perUnit === false ? "fixed" : "per_unit",
    active: true,
    serviceId: cleanText(matchingService?.id || item.serviceId, 120),
    source: LEGACY_PRESET_SOURCE,
    serviceDefinitionVersion: 0,
  };
}

function legacyPresetSettings(businessSettings = []) {
  const settings = businessSettings.find((item) => item.id === "appointment-work-presets");
  return Array.isArray(settings?.presets) ? settings.presets : [];
}

function mergeBookablePresets(services = [], businessSettings = []) {
  const canonical = bookableCatalogPresets(services);
  const allCanonical = catalogServicePresets(services);
  const canonicalByCode = new Map(allCanonical.map((item) => [item.id, item]));
  const usedServices = new Set(allCanonical.map((item) => item.serviceId).filter(Boolean));
  const legacy = [];

  for (const item of legacyPresetSettings(businessSettings).map((entry) => compactLegacyPreset(entry, services)).filter(Boolean)) {
    const canonicalMatch = canonicalByCode.get(item.id);
    if (canonicalMatch) {
      if (item.serviceId && canonicalMatch.serviceId && item.serviceId !== canonicalMatch.serviceId) {
        throw duplicateBookingCodeError(item.id, canonicalMatch.serviceId, item.serviceId);
      }
      continue;
    }
    if (item.serviceId && usedServices.has(item.serviceId)) continue;
    legacy.push(item);
  }
  return [...canonical, ...legacy];
}

function resolveCatalogService(services = [], work = {}) {
  // Resolution deliberately uses every active canonical service, not only the
  // quick-pick services shown in Scheduling. Existing appointments and explicit
  // service references must remain resolvable after a service is hidden from the
  // booking picker.
  const canonical = catalogServicePresets(services);
  const serviceId = cleanText(work.serviceId, 120);
  if (serviceId) {
    const exact = canonical.find((preset) => preset.serviceId === serviceId);
    if (exact) return exact;
  }
  const presetId = cleanText(work.presetId, 120);
  if (!presetId) return null;
  return canonical.find((preset) => preset.id === presetId) || null;
}

module.exports = {
  LEGACY_PRESET_SOURCE,
  SERVICE_CATALOG_SOURCE,
  SERVICE_DEFINITION_VERSION,
  bookableCatalogPresets,
  catalogServicePresets,
  compactLegacyPreset,
  mergeBookablePresets,
  normalizeCatalogService,
  resolveCatalogService,
  serviceItem,
  serviceVisibleInScheduling,
};
