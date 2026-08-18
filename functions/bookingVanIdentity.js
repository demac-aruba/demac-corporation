const CANONICAL_VAN_IDS = Object.freeze(["VAN-1", "VAN-2", "VAN-3", "VAN-4"]);
const CANONICAL_VAN_SET = new Set(CANONICAL_VAN_IDS);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalVanIdFromValue(value) {
  const raw = text(value);
  if (!raw) return "";
  const upper = raw.toUpperCase().replaceAll("_", "-").replace(/\s+/g, "-");
  if (CANONICAL_VAN_SET.has(upper)) return upper;
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = compact.match(/^(?:van|v)([1-4])$/);
  return match ? `VAN-${match[1]}` : "";
}

function canonicalVanIdFromRecord(van = {}) {
  for (const value of [van.number, van.vanNumber, van.unitNumber]) {
    const number = Number(value);
    if (Number.isInteger(number) && number >= 1 && number <= 4) return `VAN-${number}`;
  }
  for (const value of [van.id, van.code, van.name, van.label]) {
    const canonical = canonicalVanIdFromValue(value);
    if (canonical) return canonical;
  }
  return "";
}

function recordPreference(van = {}, canonicalId) {
  if (text(van.id).toUpperCase() === canonicalId) return 3;
  if (canonicalVanIdFromValue(van.id) === canonicalId) return 2;
  return 1;
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
  const canonicalVans = CANONICAL_VAN_IDS
    .map((id) => selected.get(id) ? { ...selected.get(id), sourceVanId: selected.get(id).id, id, name: `Van ${id.slice(-1)}` } : null)
    .filter(Boolean);
  return { aliases, vans: canonicalVans };
}

function resolveCanonicalVanId(value, aliases = new Map()) {
  return canonicalVanIdFromValue(value) || aliases.get(text(value)) || "";
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
