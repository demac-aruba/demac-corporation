const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { canonicalizeVanCatalog } = require("../bookingVanIdentity");
const { VAN_SCHEDULE_GROUP_TARGETS } = require("../vanScheduleGroupIdentity");
const { validWacliRecipient } = require("../whatsappTransactionalService");

const MIGRATION_ID = "observed-van-group-jid-correction-2026-08-22-v1";
const LABEL_BY_VAN = new Map(VAN_SCHEDULE_GROUP_TARGETS.map((item) => [item.vanId, item.label]));

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function assertGroupJid(jid, vanId) {
  if (!jid.endsWith("@g.us") || !validWacliRecipient(jid)) {
    throw new Error(`${vanId} does not have a valid WhatsApp group JID.`);
  }
}

async function applyObservedVanGroupIdCorrection({ db } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.batch !== "function") {
    throw new Error("A Firestore-compatible db is required.");
  }

  const snapshot = await db.collection("vans").get();
  const rawVans = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  const catalog = canonicalizeVanCatalog(rawVans);
  if (catalog.vans.length !== 4) {
    throw new Error(`Expected four canonical vans; found ${catalog.vans.length}. No changes were made.`);
  }

  const rawById = new Map(rawVans.map((van) => [text(van.id), van]));
  const selected = new Map(catalog.vans.map((van) => [van.id, rawById.get(van.sourceVanId)]));
  for (const vanId of ["VAN-1", "VAN-2", "VAN-3", "VAN-4"]) {
    if (!selected.get(vanId)) throw new Error(`${vanId} source record is missing. No changes were made.`);
  }

  const alreadyApplied = ["VAN-1", "VAN-4"].every((vanId) => text(selected.get(vanId)?.scheduleDeliveryGroupCorrection) === MIGRATION_ID);
  if (alreadyApplied) {
    return {
      applied: false,
      reason: "already-applied",
      migrationId: MIGRATION_ID,
      mappings: ["VAN-1", "VAN-2", "VAN-3", "VAN-4"].map((vanId) => ({
        vanId,
        groupName: LABEL_BY_VAN.get(vanId) || vanId,
        groupJid: text(selected.get(vanId)?.whatsappScheduleGroupJid),
      })),
    };
  }

  const before = new Map();
  for (const vanId of ["VAN-1", "VAN-2", "VAN-3", "VAN-4"]) {
    const jid = text(selected.get(vanId)?.whatsappScheduleGroupJid);
    assertGroupJid(jid, vanId);
    before.set(vanId, jid);
  }
  if (new Set(before.values()).size !== 4) {
    throw new Error("The four vans do not currently have four unique WhatsApp group JIDs. No changes were made.");
  }

  // Physical WhatsApp probe observed on 2026-08-22:
  // VAN-1's configured JID delivered to the Gollo/Walter group (actual VAN-4).
  // VAN-4's configured JID delivered to the Miguel group (actual VAN-1).
  // VAN-2 and VAN-3 delivered to their intended groups and remain unchanged.
  const corrected = new Map(before);
  corrected.set("VAN-1", before.get("VAN-4"));
  corrected.set("VAN-4", before.get("VAN-1"));

  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  for (const van of catalog.vans) {
    const vanId = van.id;
    const source = selected.get(vanId);
    batch.set(db.collection("vans").doc(van.sourceVanId), {
      whatsappScheduleGroupName: LABEL_BY_VAN.get(vanId) || text(source?.whatsappScheduleGroupName) || vanId,
      whatsappScheduleGroupJid: corrected.get(vanId),
      scheduleDeliveryGroupCorrection: MIGRATION_ID,
      scheduleDeliveryGroupCorrectionReason: vanId === "VAN-1" || vanId === "VAN-4"
        ? "physical-whatsapp-probe-confirmed-van-1-van-4-jid-swap"
        : "physical-whatsapp-probe-confirmed-existing-jid-correct",
      scheduleDeliveryUpdatedAt: now,
    }, { merge: true });
  }
  await batch.commit();

  const verifySnapshot = await db.collection("vans").get();
  const verifyRaw = verifySnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  const verifyCatalog = canonicalizeVanCatalog(verifyRaw);
  const verifyRawById = new Map(verifyRaw.map((van) => [text(van.id), van]));

  const mappings = verifyCatalog.vans.map((van) => {
    const persisted = verifyRawById.get(van.sourceVanId) || {};
    const groupJid = text(persisted.whatsappScheduleGroupJid);
    if (groupJid !== corrected.get(van.id)) {
      throw new Error(`Verification failed for ${van.id}.`);
    }
    return {
      vanId: van.id,
      groupName: LABEL_BY_VAN.get(van.id) || van.id,
      groupJid,
    };
  });

  if (new Set(mappings.map((item) => item.groupJid)).size !== 4) {
    throw new Error("Post-write verification found duplicate group JIDs.");
  }

  return {
    applied: true,
    reason: "probe-confirmed-van-1-van-4-swap-applied",
    migrationId: MIGRATION_ID,
    mappings,
  };
}

async function runFromCommandLine() {
  if (!getApps().length) initializeApp({ projectId: "demac-corporation" });
  const result = await applyObservedVanGroupIdCorrection({ db: getFirestore() });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  runFromCommandLine().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports.MIGRATION_ID = MIGRATION_ID;
module.exports.applyObservedVanGroupIdCorrection = applyObservedVanGroupIdCorrection;
