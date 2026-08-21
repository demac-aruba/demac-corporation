const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const DEFAULT_GENERATION = "company-whatsapp-5642625-v1";
const DEFAULT_TARGET_PHONE = "2975642625";
const PAGE_SIZE = 400;

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 7) return `297${digits}`;
  return digits;
}

function validateTargetPhone(value) {
  const phone = normalizePhone(value);
  if (!/^\d{8,15}$/.test(phone)) throw new Error("A valid international WhatsApp account phone is required for the cutover.");
  return phone;
}

function alreadyApplied(settings = {}, { targetPhone, generation } = {}) {
  return normalizePhone(settings.wacliActiveAccountPhone) === targetPhone
    && String(settings.communicationProjectionGeneration || "") === generation;
}

async function clearLiveConversationProjection(db) {
  let deleted = 0;
  while (true) {
    const snapshot = await db.collection("communicationConversations").limit(PAGE_SIZE).get();
    if (snapshot.empty || !snapshot.docs.length) break;
    const batch = db.batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
    deleted += snapshot.docs.length;
    if (snapshot.docs.length < PAGE_SIZE) break;
  }
  return deleted;
}

async function cutoverWacliProductionAccount({
  db,
  targetPhone = DEFAULT_TARGET_PHONE,
  generation = DEFAULT_GENERATION,
  now = new Date(),
} = {}) {
  if (!db) throw new Error("Firestore db is required.");
  const normalizedTarget = validateTargetPhone(targetPhone);
  const normalizedGeneration = String(generation || "").trim();
  if (!normalizedGeneration) throw new Error("A communication projection generation is required.");

  const settingsRef = db.collection("businessSettings").doc("whatsapp");
  const settingsSnapshot = await settingsRef.get();
  const settings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};

  if (alreadyApplied(settings, { targetPhone: normalizedTarget, generation: normalizedGeneration })) {
    return { applied: false, reason: "already-applied", deletedConversations: 0, targetPhone: normalizedTarget, generation: normalizedGeneration };
  }

  // communicationConversations is the live/operator projection. Raw WhatsApp
  // messages, receipt statuses and webhook events are deliberately preserved.
  // This resets only the test-account inbox projection before production use.
  const deletedConversations = await clearLiveConversationProjection(db);
  const nowIso = now.toISOString();
  await settingsRef.set({
    wacliActiveAccountPhone: normalizedTarget,
    communicationProjectionGeneration: normalizedGeneration,
    communicationProjectionCutoverAt: nowIso,
    communicationProjectionSource: "wacli-production-cutover",
    legacyConversationProjectionRetired: true,
    transactionalProvider: "wacli",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    applied: true,
    reason: "cutover-applied",
    deletedConversations,
    targetPhone: normalizedTarget,
    generation: normalizedGeneration,
  };
}

async function main() {
  if (!getApps().length) initializeApp();
  const result = await cutoverWacliProductionAccount({
    db: getFirestore(),
    targetPhone: process.env.WACLI_CUTOVER_TARGET_PHONE || DEFAULT_TARGET_PHONE,
    generation: process.env.WACLI_CUTOVER_GENERATION || DEFAULT_GENERATION,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports.DEFAULT_GENERATION = DEFAULT_GENERATION;
module.exports.DEFAULT_TARGET_PHONE = DEFAULT_TARGET_PHONE;
module.exports.alreadyApplied = alreadyApplied;
module.exports.clearLiveConversationProjection = clearLiveConversationProjection;
module.exports.cutoverWacliProductionAccount = cutoverWacliProductionAccount;
module.exports.normalizePhone = normalizePhone;
module.exports.validateTargetPhone = validateTargetPhone;
