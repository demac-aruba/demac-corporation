const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const marketingImageAnalysis = require("./marketingImageAnalysis");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const ALLOWED_ROLES = new Set(["admin", "office"]);

function cleanSessionId(value) {
  const sessionId = typeof value === "string" ? value.trim() : "";
  if (!sessionId || sessionId.length > 200 || !/^[a-zA-Z0-9._-]+$/.test(sessionId)) {
    throw new HttpsError("invalid-argument", "Invalid marketing upload session id.");
  }
  return sessionId;
}

async function requireMarketingUser(uid) {
  const snapshot = await db.collection("users").doc(uid).get();
  const profile = snapshot.data() || {};
  if (!snapshot.exists || profile.active !== true || !ALLOWED_ROLES.has(profile.role)) {
    throw new HttpsError("permission-denied", "Your DEMAC account does not have Marketing Agent access.");
  }
  return profile;
}

async function invokeExistingAnalyzer(sessionId, sessionRef, before, after) {
  const target = marketingImageAnalysis.analyzeMarketingUploadSession;
  if (typeof target !== "function") throw new Error("Marketing image analyzer is not available.");
  const event = {
    data: {
      before: { data: () => before },
      after: { data: () => after, ref: sessionRef },
    },
    params: { sessionId },
  };
  const runner = typeof target.run === "function" ? target.run.bind(target) : target;
  await runner(event);
}

exports.requestMarketingImageAnalysis = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
    secrets: [openAiApiKey],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to DEMAC before using the Marketing Agent.");
    await requireMarketingUser(uid);

    const sessionId = cleanSessionId(request.data?.sessionId);
    const sessionRef = db.collection("marketingUploadSessions").doc(sessionId);
    const snapshot = await sessionRef.get();
    if (!snapshot.exists) throw new HttpsError("not-found", "Marketing upload session not found.");

    const before = snapshot.data() || {};
    if (!["ready", "partial"].includes(before.status)) {
      throw new HttpsError("failed-precondition", "Finish uploading the session before starting AI analysis.");
    }

    const requestedAt = new Date().toISOString();
    await sessionRef.set({
      analysisStatus: "queued",
      analysisRequestedAt: requestedAt,
      analysisRequestedByUserId: uid,
      analysisError: FieldValue.delete(),
      updatedAt: requestedAt,
    }, { merge: true });

    const after = {
      ...before,
      analysisStatus: "queued",
      analysisRequestedAt: requestedAt,
      analysisRequestedByUserId: uid,
      updatedAt: requestedAt,
    };

    try {
      await invokeExistingAnalyzer(sessionId, sessionRef, before, after);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      const message = String(error?.message || "Marketing analysis failed.").slice(0, 1_000);
      throw new HttpsError("internal", message);
    }

    const completedSnapshot = await sessionRef.get();
    const completed = completedSnapshot.data() || {};
    if (completed.analysisStatus !== "completed") {
      throw new HttpsError("internal", completed.analysisError || "Marketing analysis did not complete.");
    }

    return {
      ok: true,
      sessionId,
      analysisStatus: completed.analysisStatus,
      analyzedAssetCount: completed.analyzedAssetCount || 0,
      usableAssetCount: completed.usableAssetCount || 0,
      primaryAssetId: completed.primaryAssetId || null,
      bestAssetIds: completed.bestAssetIds || [],
      recommendedCampaignType: completed.recommendedCampaignType || before.campaignType || "other",
    };
  },
);
