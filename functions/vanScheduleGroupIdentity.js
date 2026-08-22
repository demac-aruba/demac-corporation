const VAN_SCHEDULE_GROUP_TARGETS = Object.freeze([
  { vanId: "VAN-1", label: "Miguel Reyes / Alan Baquero", signatures: [["miguel"]] },
  { vanId: "VAN-2", label: "Mario Cornejo / Ronald Maury", signatures: [["mario", "ronald"]] },
  { vanId: "VAN-3", label: "Alejandro Marquez / Edwin Calvo", signatures: [["alejandro", "edwin"]] },
  { vanId: "VAN-4", label: "Jose Gregorio / Walter Rangel", signatures: [["gollo", "walter"], ["goyo", "walter"], ["gregorio", "walter"], ["jose", "gregorio", "walter"]] },
]);

const TARGET_BY_VAN_ID = new Map(VAN_SCHEDULE_GROUP_TARGETS.map((target) => [target.vanId, target]));

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value) {
  return text(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function targetVanIdForScheduleGroupName(groupName) {
  const value = normalized(groupName);
  if (!value) return "";
  for (const target of VAN_SCHEDULE_GROUP_TARGETS) {
    if (target.signatures.some((signature) => signature.every((token) => value.includes(token)))) return target.vanId;
  }
  return "";
}

function canonicalVanScheduleGroupLabel(vanId) {
  return TARGET_BY_VAN_ID.get(text(vanId))?.label || "";
}

function scheduleGroupConfig(van = {}) {
  return {
    groupName: text(van.whatsappScheduleGroupName),
    groupJid: text(van.whatsappScheduleGroupJid),
    enabled: van.scheduleDeliveryEnabled !== false,
  };
}

function failClosed(vans = [], reason) {
  return vans.map((van) => ({
    ...van,
    whatsappScheduleGroupName: canonicalVanScheduleGroupLabel(van.id) || text(van.whatsappScheduleGroupName),
    whatsappScheduleGroupJid: "",
    scheduleDeliveryEnabled: false,
    whatsappScheduleGroupAlignment: "invalid",
    whatsappScheduleGroupAlignmentReason: reason,
  }));
}

function realignCanonicalVanScheduleGroups(vans = []) {
  const list = Array.isArray(vans) ? vans : [];
  const configured = list
    .map((van) => ({ van, ...scheduleGroupConfig(van) }))
    .filter((item) => item.groupName || item.groupJid);

  if (!configured.length) return list;
  // Cross-Van realignment is only meaningful when the complete canonical fleet
  // and all four group configurations are present. Partial/admin configurations
  // are preserved exactly as supplied.
  if (list.length !== VAN_SCHEDULE_GROUP_TARGETS.length || configured.length !== VAN_SCHEDULE_GROUP_TARGETS.length) return list;

  if (configured.some((config) => !config.groupName || !config.groupJid)) {
    return failClosed(list, "group-name-or-jid-missing");
  }

  const recognized = configured.map((config) => ({
    ...config,
    targetVanId: targetVanIdForScheduleGroupName(config.groupName),
  }));
  const recognizedCount = recognized.filter((config) => config.targetVanId).length;

  // Four explicit custom names are a legitimate configuration and already carry
  // a direct Van -> group relationship. Do not reinterpret them by heuristics.
  if (recognizedCount === 0) return list;
  // A mixture of legacy/canonical identities and unknown names is unsafe: it may
  // represent a partially shifted production map. Never guess a WhatsApp target.
  if (recognizedCount !== VAN_SCHEDULE_GROUP_TARGETS.length) {
    return failClosed(list, "mixed-recognized-and-custom-group-identities");
  }

  const byTarget = new Map();
  for (const config of recognized) {
    if (byTarget.has(config.targetVanId)) {
      return failClosed(list, `duplicate-group-identity-${config.targetVanId}`);
    }
    byTarget.set(config.targetVanId, config);
  }

  const missing = VAN_SCHEDULE_GROUP_TARGETS.filter((target) => !byTarget.has(target.vanId));
  if (missing.length) return failClosed(list, `missing-group-identity-${missing.map((target) => target.vanId).join("-")}`);

  return list.map((van) => {
    const config = byTarget.get(van.id);
    const target = TARGET_BY_VAN_ID.get(van.id);
    if (!config || !target) return van;
    return {
      ...van,
      whatsappScheduleGroupName: target.label,
      whatsappScheduleGroupJid: config.groupJid,
      scheduleDeliveryEnabled: config.enabled,
      whatsappScheduleGroupAlignment: "canonical",
      whatsappScheduleGroupAlignmentSourceVanId: config.van.id,
    };
  });
}

module.exports.VAN_SCHEDULE_GROUP_TARGETS = VAN_SCHEDULE_GROUP_TARGETS;
module.exports.canonicalVanScheduleGroupLabel = canonicalVanScheduleGroupLabel;
module.exports.realignCanonicalVanScheduleGroups = realignCanonicalVanScheduleGroups;
module.exports.targetVanIdForScheduleGroupName = targetVanIdForScheduleGroupName;
