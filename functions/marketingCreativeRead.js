const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const ALLOWED_ROLES = new Set(["admin", "office"]);

function safeString(value, max = 1200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanSessionId(value) {
  if (value == null || value === "") return "";
  const sessionId = typeof value === "string" ? value.trim() : "";
  if (!sessionId || sessionId.length > 220 || !/^[a-zA-Z0-9._-]+$/.test(sessionId)) {
    throw new HttpsError("invalid-argument", "Invalid marketing session id.");
  }
  return sessionId;
}

async function requireMarketingUser(uid) {
  const snapshot = await db.collection("users").doc(uid).get();
  const profile = snapshot.data() || {};
  if (!snapshot.exists || profile.active !== true || !ALLOWED_ROLES.has(profile.role)) {
    throw new HttpsError("permission-denied", "Your DEMAC account does not have Marketing Agent access.");
  }
}

function sanitizeCreative(document) {
  const source = document.data() || {};
  const qa = source.qa || {};
  const exactText = source.exactText || {};
  return {
    id: document.id,
    sessionId: safeString(source.sessionId, 220),
    campaignId: safeString(source.campaignId, 220),
    campaignType: safeString(source.campaignType, 100),
    version: Number(source.version) || 0,
    status: safeString(source.status, 80),
    heroAssetId: safeString(source.heroAssetId, 220),
    imageUrl: safeString(source.imageUrl, 3000),
    approvedUrl: safeString(source.approvedUrl, 3000),
    width: Number(source.width) || 0,
    height: Number(source.height) || 0,
    reservedFooterPx: Number(source.reservedFooterPx) || 0,
    renderTemplate: safeString(source.renderTemplate, 80),
    renderMode: safeString(source.renderMode, 80),
    imageModel: safeString(source.imageModel, 100),
    exactText: {
      headline: safeString(exactText.headline, 150),
      subheadline: safeString(exactText.subheadline, 250),
      cta: safeString(exactText.cta, 100),
      whatsapp: safeString(exactText.whatsapp, 60),
      offer: safeString(exactText.offer, 220),
      products: Array.isArray(exactText.products)
        ? exactText.products.slice(0, 5).map((item) => ({
          source: safeString(item?.source, 600),
          btu: safeString(item?.btu, 80),
          price: safeString(item?.price, 80),
          specs: safeString(item?.specs, 180),
        }))
        : [],
    },
    captionText: safeString(source.captionText, 800),
    papiamentoValidationStatus: safeString(source.papiamentoValidationStatus, 40),
    qa: {
      source: safeString(qa.source, 80),
      status: safeString(qa.status, 40),
      score: Number(qa.score) || 0,
      mobileLegibility: Number(qa.mobileLegibility) || 0,
      visualHierarchy: Number(qa.visualHierarchy) || 0,
      contrast: Number(qa.contrast) || 0,
      footerClearance: Number(qa.footerClearance) || 0,
      authenticity: Number(qa.authenticity) || 0,
      professionalism: Number(qa.professionalism) || 0,
      attempt: Number(qa.attempt) || 0,
      issues: Array.isArray(qa.issues) ? qa.issues.slice(0, 10).map((item) => safeString(item, 350)).filter(Boolean) : [],
      revisionInstructions: Array.isArray(qa.revisionInstructions)
        ? qa.revisionInstructions.slice(0, 8).map((item) => safeString(item, 350)).filter(Boolean)
        : [],
      hardChecks: qa.hardChecks && typeof qa.hardChecks === "object" ? {
        brandCenterLive: Boolean(qa.hardChecks.brandCenterLive),
        languagePassed: Boolean(qa.hardChecks.languagePassed),
        exactWhatsapp: Boolean(qa.hardChecks.exactWhatsapp),
        productFactsApproved: Boolean(qa.hardChecks.productFactsApproved),
        footerReserved: Boolean(qa.hardChecks.footerReserved),
        allPassed: Boolean(qa.hardChecks.allPassed),
      } : null,
    },
    approvedAt: safeString(source.approvedAt, 80),
    approvedByName: safeString(source.approvedByName, 180),
    createdAt: safeString(source.createdAt, 80),
    updatedAt: safeString(source.updatedAt, 80),
    createdByName: safeString(source.createdByName, 180),
  };
}

exports.getMarketingCreativeState = onCall({
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "512MiB",
}, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Firebase authentication is required.");
  await requireMarketingUser(request.auth.uid);
  const sessionId = cleanSessionId(request.data?.sessionId);

  let query = db.collection("marketingCreatives");
  if (sessionId) query = query.where("sessionId", "==", sessionId);
  const snapshot = await query.get();
  const creatives = snapshot.docs
    .map(sanitizeCreative)
    .sort((a, b) => {
      const aTime = Date.parse(a.updatedAt || a.createdAt || "") || 0;
      const bTime = Date.parse(b.updatedAt || b.createdAt || "") || 0;
      if (aTime !== bTime) return bTime - aTime;
      return b.version - a.version;
    })
    .slice(0, 150);

  return {
    sessionId: sessionId || null,
    creatives,
    approvedCount: creatives.filter((creative) => creative.status === "approved").length,
    qaPassedCount: creatives.filter((creative) => creative.status === "qa_passed" || creative.status === "approved").length,
  };
});
