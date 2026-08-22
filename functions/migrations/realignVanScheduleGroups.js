const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { canonicalizeVanCatalog } = require("../bookingVanIdentity");
const {
  VAN_SCHEDULE_GROUP_TARGETS,
  targetVanIdForScheduleGroupName,
} = require("../vanScheduleGroupIdentity");
const { validWacliRecipient } = require("../whatsappTransactionalService");

const TARGETS = VAN_SCHEDULE_GROUP_TARGETS;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function targetForGroupName(groupName) {
  return targetVanIdForScheduleGroupName(groupName);
}

function deriveVanGroupRealignment(rawVans = []) {
  const catalog = canonicalizeVanCatalog(rawVans);
  if (catalog.vans.length !== TARGETS.length) {
    throw new Error(`Cannot safely realign van WhatsApp groups; expected ${TARGETS.length} canonical Vans and found ${catalog.vans.length}.`);
  }

  return TARGETS.map(({ vanId, label }) => {
    const targetVan = catalog.vans.find((van) => van.id === vanId);
    if (!targetVan?.sourceVanId) throw new Error(`Canonical ${vanId} is missing from the Van catalog.`);
    const groupJid = text(targetVan.whatsappScheduleGroupJid);
    if (targetVan.whatsappScheduleGroupAlignment !== "canonical") {
      throw new Error(`Cannot safely realign ${vanId}; WhatsApp group identity is ${targetVan.whatsappScheduleGroupAlignment || "unresolved"}.`);
    }
    if (!groupJid.endsWith("@g.us") || !validWacliRecipient(groupJid)) {
      throw new Error(`The WhatsApp group JID resolved for ${vanId} is invalid.`);
    }
    return {
      vanId,
      sourceVanId: targetVan.sourceVanId,
      groupName: label,
      groupJid,
      enabled: targetVan.scheduleDeliveryEnabled !== false,
      movedFromVanId: text(targetVan.whatsappScheduleGroupAlignmentSourceVanId) || vanId,
      sourceGroupName: text(targetVan.whatsappScheduleGroupName),
    };
  });
}

function verifyAlignedVanGroups(rawVans = []) {
  const catalog = canonicalizeVanCatalog(rawVans);
  const rawById = new Map(rawVans.map((van) => [text(van?.id), van]));
  const seenJids = new Set();
  for (const target of TARGETS) {
    const canonicalVan = catalog.vans.find((van) => van.id === target.vanId);
    if (!canonicalVan?.sourceVanId) throw new Error(`Verification failed: ${target.vanId} is missing from the Van catalog.`);
    const persistedVan = rawById.get(canonicalVan.sourceVanId);
    if (!persistedVan) throw new Error(`Verification failed: persisted record for ${target.vanId} is missing.`);
    const groupName = text(persistedVan.whatsappScheduleGroupName);
    const groupJid = text(persistedVan.whatsappScheduleGroupJid);
    if (groupName !== target.label) {
      throw new Error(`Verification failed: ${target.vanId} persisted label is ${groupName || "missing"}; expected ${target.label}.`);
    }
    if (!groupJid.endsWith("@g.us") || !validWacliRecipient(groupJid)) {
      throw new Error(`Verification failed: ${target.vanId} has an invalid persisted WhatsApp group JID.`);
    }
    if (seenJids.has(groupJid)) throw new Error(`Verification failed: persisted WhatsApp group JID is duplicated for ${target.vanId}.`);
    seenJids.add(groupJid);
  }
  return TARGETS.map((target) => ({ vanId: target.vanId, groupName: target.label }));
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
      scheduleDeliveryMigration: "realign-van-groups-2026-08-22-v3",
    }, { merge: true });
  }
  await batch.commit();

  const verificationSnapshot = await db.collection("vans").get();
  const verifiedMappings = verifyAlignedVanGroups(
    verificationSnapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
  );

  return {
    updated: updates.length,
    verified: true,
    mappings: updates.map((item) => ({
      vanId: item.vanId,
      groupName: item.groupName,
      movedFromVanId: item.movedFromVanId,
    })),
    verifiedMappings,
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
module.exports.verifyAlignedVanGroups = verifyAlignedVanGroups;
