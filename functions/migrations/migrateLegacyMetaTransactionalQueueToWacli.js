const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const {
  buildLegacyMetaToWacliMigration,
  normalizeTransactionalProvider,
} = require("../whatsappTransactionalService");

async function migrateLegacyMetaTransactionalQueueToWacli({ db } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db is required for the legacy transactional queue migration.");
  }

  const settingsSnapshot = await db.collection("businessSettings").doc("whatsapp").get();
  const settings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
  const activeProvider = normalizeTransactionalProvider(settings.transactionalProvider);

  if (settings.transactionalOutboundEnabled === false) {
    return {
      activeProvider,
      scanned: 0,
      migrated: 0,
      skipped: 0,
      disabled: true,
    };
  }

  if (activeProvider !== "wacli") {
    return {
      activeProvider,
      scanned: 0,
      migrated: 0,
      skipped: 0,
      disabled: false,
    };
  }

  const queuedSnapshot = await db.collection("whatsappOutboundQueue")
    .where("status", "==", "queued")
    .get();

  let migrated = 0;
  let skipped = 0;

  for (const candidate of queuedSnapshot.docs) {
    const initial = candidate.data() || {};
    if (!buildLegacyMetaToWacliMigration(initial, activeProvider)) {
      skipped += 1;
      continue;
    }

    const changed = await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(candidate.ref);
      if (!currentSnapshot.exists) return false;
      const current = currentSnapshot.data() || {};
      const migration = buildLegacyMetaToWacliMigration(current, activeProvider);
      if (!migration) return false;

      transaction.set(candidate.ref, {
        ...migration,
        providerMigratedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });

    if (changed) migrated += 1;
    else skipped += 1;
  }

  return {
    activeProvider,
    scanned: queuedSnapshot.size,
    migrated,
    skipped,
    disabled: false,
  };
}

async function runFromCommandLine() {
  if (!getApps().length) initializeApp({ projectId: "demac-corporation" });
  const result = await migrateLegacyMetaTransactionalQueueToWacli({ db: getFirestore() });
  console.log(JSON.stringify({ migration: "legacy-meta-transactional-queue-to-wacli", ...result }));
}

if (require.main === module) {
  runFromCommandLine().catch((error) => {
    console.error("Legacy transactional queue migration failed.", error);
    process.exitCode = 1;
  });
}

module.exports.migrateLegacyMetaTransactionalQueueToWacli = migrateLegacyMetaTransactionalQueueToWacli;
