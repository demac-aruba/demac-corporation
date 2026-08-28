const { realignCanonicalVanScheduleGroups } = require("./vanScheduleGroupIdentity");

// These four IDs are the safe fallback fleet when Firestore master data is unavailable.
// Live Booking Authority may discover additional canonical VAN-N lanes from the Vans collection.
const CANONICAL_VAN_IDS = Object.freeze(["VAN-1", "VAN-2", "VAN-3", "VAN-4"]);
const CORE_CANONICAL_VAN_SET = new Set(CANONICAL_VAN_IDS);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalVanNumber(value) {
  const raw = text(value);
  if (!raw) return 0;
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = compact.match(/^(?:van|v)([1-9]\d*)$/);
  return match ? Number(match[1]) : 0;
}

function canonicalVanIdFromValue(value) {
  const number = canonicalVanNumber(value);
  return number ? `VAN-${number}` : "";
}

function canonicalVanIdFromRecord(van = {}) {
  for (const value of [van.number, van.vanNumber, van.unitNumber]) {
    const number = Number(value);
    if (Number.isInteger(number) && number >= 1) return `VAN-${number}`;
  }

  // Prefer business identity fields before the physical Firestore document ID. Historical
  // records can have IDs such as VAN-1783801335935 while their actual lane is named Van 2.
  for (const value of [van.name, van.label, van.code]) {
    const canonical = canonicalVanIdFromValue(value);
    if (canonical) return canonical;
  }

  return canonicalVanIdFromValue(van.id);
}

function recordPreference(van = {}, canonicalId) {
  if (text(van.id).toUpperCase() === canonicalId) return 3;
  if (canonicalVanIdFromValue(van.id) === canonicalId) return 2;
  return 1;
}

function canonicalVanSort(left, right) {
  return canonicalVanNumber(left) - canonicalVanNumber(right);
}

function realignCoreScheduleGroups(canonicalVans) {
  const core = canonicalVans.filter((van) => CORE_CANONICAL_VAN_SET.has(van.id));
  const alignedCore = realignCanonicalVanScheduleGroups(core);
  const alignedById = new Map(alignedCore.map((van) => [van.id, van]));
  return canonicalVans.map((van) => alignedById.get(van.id) || van);
}

function canonicalizeVanCatalog(vans = []) {
  const aliases = new Map();
  const selected = new Map();
  for (const van of vans) {
    if (!van || van.active === false) continue;
    const canonicalId = canonicalVanIdFromRecord(van);
    if (!canonicalId) continue;
    aliases.set(text(van.id), canonicalId);
    aliases.set(canonicalId, canonicalId);
    const current = selected.get(canonicalId);
    if (!current || recordPreference(van, canonicalId) > recordPreference(current, canonicalId)) {
      selected.set(canonicalId, van);
    }
  }

  const canonicalVans = [...selected.entries()]
    .sort(([left], [right]) => canonicalVanSort(left, right))
    .map(([id, van]) => ({ ...van, sourceVanId: van.id, id, name: `Van ${canonicalVanNumber(id)}` }));

  // Existing WhatsApp group defaults are intentionally defined only for the original four
  // lanes. Realign those four without inventing a group/JID for future Vans.
  return { aliases, vans: realignCoreScheduleGroups(canonicalVans) };
}

function resolveCanonicalVanId(value, aliases = new Map()) {
  // Historical appointment references may contain a physical Firestore document ID that
  // looks like VAN-<large number>. Resolve known aliases before treating the value as a lane.
  return aliases.get(text(value)) || canonicalVanIdFromValue(value) || "";
}

function normalizeVanReference(item, aliases) {
  if (!item || typeof item !== "object") return item;
  const raw = item.vanId ?? item.van;
  const canonical = resolveCanonicalVanId(raw, aliases);
  return canonical ? { ...item, vanId: canonical } : item;
}

function canonicalizeSchedulingData(data = {}) {
  const catalog = canonicalizeVanCatalog(Array.isArray(data.vans) ? data.vans : []);
  return {
    ...data,
    vans: catalog.vans,
    workOrders: (Array.isArray(data.workOrders) ? data.workOrders : []).map((item) => normalizeVanReference(item, catalog.aliases)),
    dailyVanAssignments: (Array.isArray(data.dailyVanAssignments) ? data.dailyVanAssignments : []).map((item) => normalizeVanReference(item, catalog.aliases)),
    vanHalfDaySchedules: (Array.isArray(data.vanHalfDaySchedules) ? data.vanHalfDaySchedules : []).map((item) => normalizeVanReference(item, catalog.aliases)),
    vanAliases: catalog.aliases,
  };
}

module.exports = {
  CANONICAL_VAN_IDS,
  canonicalVanIdFromRecord,
  canonicalVanIdFromValue,
  canonicalizeSchedulingData,
  canonicalizeVanCatalog,
  resolveCanonicalVanId,
};
