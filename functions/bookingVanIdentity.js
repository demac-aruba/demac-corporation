const { realignCanonicalVanScheduleGroups } = require("./vanScheduleGroupIdentity");

// These four IDs identify only the original fleet whose historical WhatsApp groups need
// realignment. Scheduling capacity itself is discovered from the complete Vans collection.
const LEGACY_CORE_WHATSAPP_VAN_IDS = Object.freeze(["VAN-1", "VAN-2", "VAN-3", "VAN-4"]);
const CORE_CANONICAL_VAN_SET = new Set(LEGACY_CORE_WHATSAPP_VAN_IDS);

// Closed migration registry. A new Van's master-data document ID is its scheduling
// identity; adding or renaming human-readable metadata must never create an alias.
const LEGACY_MASTER_DATA_VAN_ALIASES = Object.freeze({
  v1: "VAN-1",
  van1: "VAN-1",
  "van 1": "VAN-1",
  van_1: "VAN-1",
  v2: "VAN-2",
  van2: "VAN-2",
  "van 2": "VAN-2",
  van_2: "VAN-2",
  v3: "VAN-3",
  van3: "VAN-3",
  "van 3": "VAN-3",
  van_3: "VAN-3",
  v4: "VAN-4",
  van4: "VAN-4",
  "van 4": "VAN-4",
  van_4: "VAN-4",
  "van-1783800405341": "VAN-4",
  "van-1783801335935": "VAN-2",
  "van-1783801335936": "VAN-4",
  "van-1783801335937": "VAN-1",
  "van-1783801335938": "VAN-3",
});

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
  const raw = text(value);
  if (!raw) return "";
  const legacy = LEGACY_MASTER_DATA_VAN_ALIASES[raw.toLowerCase()];
  if (legacy) return legacy;
  const match = raw.match(/^VAN-([1-9]\d*)$/i);
  return match ? `VAN-${Number(match[1])}` : "";
}

function canonicalVanIdFromRecord(van = {}) {
  // Master-data ID owns identity. Only the closed migration aliases above may
  // translate an old document ID; editable names/numbers/codes are display data.
  return canonicalVanIdFromValue(van.id) || text(van.id);
}

function recordPreference(van = {}, canonicalId) {
  if (text(van.id).toUpperCase() === canonicalId) return 3;
  if (canonicalVanIdFromValue(van.id) === canonicalId) return 2;
  return 1;
}

function canonicalVanSort(left, right) {
  const leftNumber = canonicalVanNumber(left);
  const rightNumber = canonicalVanNumber(right);
  if (leftNumber && rightNumber) return leftNumber - rightNumber;
  if (leftNumber) return -1;
  if (rightNumber) return 1;
  return text(left).localeCompare(text(right), undefined, { numeric: true, sensitivity: "base" });
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
    .map(([id, van]) => {
      const number = canonicalVanNumber(id);
      const configuredName = text(van.name) || text(van.label) || text(van.code);
      return {
        ...van,
        sourceVanId: van.id,
        id,
        name: configuredName || (number ? `Van ${number}` : id),
      };
    });

  // Existing WhatsApp group defaults are intentionally defined only for the original four
  // lanes. Realign those four without inventing a group/JID for future Vans.
  return { aliases, vans: realignCoreScheduleGroups(canonicalVans) };
}

function resolveCanonicalVanId(value, aliases = new Map()) {
  // Historical appointment references may contain a physical Firestore document ID that
  // looks like VAN-<large number>. Resolve known aliases before treating the value as a lane.
  const raw = text(value);
  return aliases.get(raw) || canonicalVanIdFromValue(raw) || raw;
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
    capacityLocks: (Array.isArray(data.capacityLocks) ? data.capacityLocks : []).map((item) => normalizeVanReference(item, catalog.aliases)),
    bookingCapacityLocks: (Array.isArray(data.bookingCapacityLocks) ? data.bookingCapacityLocks : []).map((item) => normalizeVanReference(item, catalog.aliases)),
    vanAliases: catalog.aliases,
  };
}

module.exports = {
  LEGACY_CORE_WHATSAPP_VAN_IDS,
  LEGACY_MASTER_DATA_VAN_ALIASES,
  canonicalVanIdFromRecord,
  canonicalVanIdFromValue,
  canonicalizeSchedulingData,
  canonicalizeVanCatalog,
  resolveCanonicalVanId,
};
