const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { canonicalizeVanCatalog } = require("../bookingVanIdentity");
const { validWacliRecipient } = require("../whatsappTransactionalService");

const TARGETS = Object.freeze([
  { vanId: "VAN-1", signatures: [["miguel"]] },
  { vanId: "VAN-2", signatures: [["mario", "ronald"]] },
  { vanId: "VAN-3", signatures: [["alejandro", "edwin"]] },
  { vanId: "VAN-4", signatures: [["gollo", "walter"], ["goyo", "walter"], ["gregorio", "walter"]] },
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value) {
  return text(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function targetForGroupName(groupName) {
  const value = normalized(groupName);
  if (!value) return "";
  for (const target of TARGETS) {
    if (target.signatures.some((signature) => signature.every((token) => value.includes(token)))) return target.vanId;
  }
  return "";
}

function deriveVanGroupRealignment(rawVans = []) {
  const catalog = canonicalizeVanCatalog(rawVans);
  const configs = catalog.vans.map((van) => ({
    sourceVanId: van.sourceVanId,
    currentVanId: van.id,
    groupName: text(van.whatsappScheduleGroupName),
    groupJid: text(van.whatsappScheduleGroupJid),
    enabled: van.scheduleDeliveryEnabled !== false,
  })).filter((item) => item.groupName && item.groupJid);

  const byTarget = new Map();
  for (const config of configs) {
    const targetVanId = targetForGroupName(config.groupName);
    if (!targetVanId) continue;
    if (byTarget.has(targetVanId)) throw new Error(`Multiple WhatsApp group configurations match ${targetVanId}.`);
    if (!config.groupJid.endsWith("@g.us") || !validWacliRecipient(config.groupJid)) {
      throw new Error(`The WhatsApp group JID for ${config.groupName} is invalid.`);
    }
    byTarget.set(targetVanId, config);
  }

  const missing = TARGETS.map((target) => target.vanId).filter((vanId) => !byTarget.has(vanId));
  if (missing.length) throw new Error(`Cannot safely realign van WhatsApp groups; missing recognizable configuration for ${missing.join(", ")}.`);

  const targetVanRecords = new Map(catalog.vans.map((van) => [van.id, van]));
  return TARGETS.map(({ vanId }) => {
    const targetVan = targetVanRecords.get(vanId);
    if (!targetVan?.sourceVanId) throw new Error(`Canonical ${vanId} is missing from the Van catalog.`);
    const config = byTarget.get(vanId);
    return {
      vanId,
      sourceVanId: targetVan.sourceVanId,
      groupName: config.groupName,
      groupJid: config.groupJid,
      enabled: config.enabled,
      movedFromVanId: config.currentVanId,
    };
  });
}

async function realignVanScheduleGroups({ db } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.batch !== "function") {
    throw new Error("A Firestore-compatible db is required for Van schedule group realignment.");
  }
  const snapshot = await db.collection("vans").get();
  const rawVans = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  const updates = deriveVanGroupRealignment(rawVans);
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  for (const update of updates) {
    batch.set(db.collection("vans").doc(update.sourceVanId), {
      whatsappScheduleGroupName: update.groupName,
      whatsappScheduleGroupJid: update.groupJid,
      scheduleDeliveryEnabled: update.enabled,
      scheduleDeliveryUpdatedAt: now,
      scheduleDeliveryMigration: "realign-van-groups-2026-08-22",
    }, { merge: true });
  }
  await batch.commit();
  return {
    updated: updates.length,
    mappings: updates.map((item) => ({
      vanId: item.vanId,
      groupName: item.groupName,
      movedFromVanId: item.movedFromVanId,
    })),
  };
}

async function runFromCommandLine() {
  if (!getApps().length) initializeApp({ projectId: "demac-corporation" });
  const result = await realignVanScheduleGroups({ db: getFirestore() });
  console.log(JSON.stringify({ migration: "realign-van-schedule-groups", ...result }));
}

if (require.main === module) {
  runFromCommandLine().catch((error) => {
    console.error("Van schedule group realignment failed.", error);
    process.exitCode = 1;
  });
}

module.exports.TARGETS = TARGETS;
module.exports.deriveVanGroupRealignment = deriveVanGroupRealignment;
module.exports.realignVanScheduleGroups = realignVanScheduleGroups;
module.exports.targetForGroupName = targetForGroupName;
