const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const ALLOWED_ROLES = new Set(["admin", "office"]);

function safeString(value, max = 1200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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

function sanitizeHardChecks(value) {
  if (!value || typeof value !== "object") return null;
  return {
    brandCenterLive: Boolean(value.brandCenterLive),
    languagePassed: Boolean(value.languagePassed),
    exactWhatsapp: Boolean(value.exactWhatsapp),
    productFactsApproved: Boolean(value.productFactsApproved),
    footerReserved: Boolean(value.footerReserved),
    allPassed: Boolean(value.allPassed),
  };
}

function sanitizeQa(qa = {}) {
  return {
    source: safeString(qa.source, 80),
    status: safeString(qa.status, 40),
    score: safeNumber(qa.score),
    selectionScore: safeNumber(qa.selectionScore),
    overallScore: safeNumber(qa.overallScore || qa.score),
    benchmarkLevel: safeString(qa.benchmarkLevel, 40),
    adSpendReady: Boolean(qa.adSpendReady),
    visibleTextExact: Boolean(qa.visibleTextExact),
    inventedFacts: Boolean(qa.inventedFacts),
    creativeDirection: safeNumber(qa.creativeDirection),
    composition: safeNumber(qa.composition),
    typography: safeNumber(qa.typography),
    professionalFinish: safeNumber(qa.professionalFinish),
    brandDistinctiveness: safeNumber(qa.brandDistinctiveness),
    conversionClarity: safeNumber(qa.conversionClarity),
    textFidelity: safeNumber(qa.textFidelity),
    footerSafety: safeNumber(qa.footerSafety),
    originality: safeNumber(qa.originality),
    thumbnailImpact: safeNumber(qa.thumbnailImpact),
    mobileLegibility: safeNumber(qa.mobileLegibility),
    visualHierarchy: safeNumber(qa.visualHierarchy),
    contrast: safeNumber(qa.contrast),
    footerClearance: safeNumber(qa.footerClearance),
    authenticity: safeNumber(qa.authenticity),
    professionalism: safeNumber(qa.professionalism),
    creativeQuality: safeNumber(qa.creativeQuality),
    scrollStoppingPower: safeNumber(qa.scrollStoppingPower),
    agencyFeel: safeNumber(qa.agencyFeel),
    photoIntegration: safeNumber(qa.photoIntegration),
    ctaProminence: safeNumber(qa.ctaProminence),
    visualSophistication: safeNumber(qa.visualSophistication),
    commercialCompleteness: safeNumber(qa.commercialCompleteness),
    layoutRichness: safeNumber(qa.layoutRichness),
    brandSystemCoherence: safeNumber(qa.brandSystemCoherence),
    offerClarity: safeNumber(qa.offerClarity),
    attempt: safeNumber(qa.attempt),
    amateurSignals: Array.isArray(qa.amateurSignals)
      ? qa.amateurSignals.slice(0, 10).map((item) => safeString(item, 350)).filter(Boolean)
      : [],
    issues: Array.isArray(qa.issues) ? qa.issues.slice(0, 10).map((item) => safeString(item, 350)).filter(Boolean) : [],
    revisionInstructions: Array.isArray(qa.revisionInstructions)
      ? qa.revisionInstructions.slice(0, 10).map((item) => safeString(item, 350)).filter(Boolean)
      : [],
    hardChecks: sanitizeHardChecks(qa.hardChecks),
  };
}

function sanitizeVariant(item = {}) {
  const layout = item.layout && typeof item.layout === "object" ? item.layout : {};
  return {
    id: safeString(item.id, 120),
    conceptId: safeString(item.conceptId, 120),
    name: safeString(item.name, 180),
    rationale: safeString(item.rationale, 1000),
    stage: safeString(item.stage, 80),
    parentVariantId: safeString(item.parentVariantId, 140),
    imageStoragePath: safeString(item.imageStoragePath, 1200),
    imageUrl: safeString(item.imageUrl, 3000),
    imageModel: safeString(item.imageModel, 100),
    selectionScore: safeNumber(item.selectionScore),
    revised: Boolean(item.revised),
    layout: {
      headlineZone: safeString(layout.headlineZone, 80),
      ctaZone: safeString(layout.ctaZone, 80),
      textPanelStyle: safeString(layout.textPanelStyle, 80),
      textAlign: safeString(layout.textAlign, 40),
      accentStyle: safeString(layout.accentStyle, 80),
      photoFocus: safeString(layout.photoFocus, 80),
      compositionTemplate: safeString(layout.compositionTemplate, 140),
      visualEnergy: safeString(layout.visualEnergy, 60),
      graphicLanguage: safeString(layout.graphicLanguage, 400),
      typographyDirection: safeString(layout.typographyDirection, 400),
      persuasionMechanism: safeString(layout.persuasionMechanism, 400),
      thumbnailIdea: safeString(layout.thumbnailIdea, 500),
    },
    qa: sanitizeQa(item.qa || {}),
  };
}

function sanitizeProviderManifest(value = {}) {
  const providers = value.providers && typeof value.providers === "object" ? value.providers : {};
  return {
    activeProvider: safeString(value.activeProvider, 100),
    activeImageModel: safeString(value.activeImageModel, 100),
    providers: {
      openai_full_design: Boolean(providers.openai_full_design),
      ideogram_v4_structured: Boolean(providers.ideogram_v4_structured),
      canva_layered_production: Boolean(providers.canva_layered_production),
    },
    notes: Array.isArray(value.notes) ? value.notes.slice(0, 8).map((item) => safeString(item, 500)).filter(Boolean) : [],
  };
}

function sanitizeDesignIntelligence(value = {}) {
  const jury = value.finalJury && typeof value.finalJury === "object" ? value.finalJury : {};
  return {
    explorationCount: safeNumber(value.explorationCount),
    shortlistCount: safeNumber(value.shortlistCount),
    refinementCount: safeNumber(value.refinementCount),
    strategyDiagnosis: safeString(value.strategyDiagnosis, 1400),
    benchmarkDefinition: safeString(value.benchmarkDefinition, 1400),
    creativeNorthStar: safeString(value.creativeNorthStar, 1400),
    exploredConcepts: Array.isArray(value.exploredConcepts)
      ? value.exploredConcepts.slice(0, 12).map((item) => ({
        id: safeString(item?.id, 100),
        name: safeString(item?.name, 180),
        archetype: safeString(item?.archetype, 180),
        thumbnailIdea: safeString(item?.thumbnailIdea, 500),
        whyItCouldWin: safeString(item?.whyItCouldWin, 600),
      }))
      : [],
    finalJury: {
      spendConfidence: safeNumber(jury.spendConfidence),
      reason: safeString(jury.reason, 1000),
      loserWeakness: safeString(jury.loserWeakness, 1000),
    },
  };
}

function sanitizeCreative(document) {
  const source = document.data() || {};
  const qa = source.qa || {};
  const exactText = source.exactText || {};
  const artDirection = source.artDirection && typeof source.artDirection === "object" ? source.artDirection : {};
  return {
    id: document.id,
    sessionId: safeString(source.sessionId, 220),
    campaignId: safeString(source.campaignId, 220),
    campaignType: safeString(source.campaignType, 100),
    version: safeNumber(source.version),
    status: safeString(source.status, 80),
    builderVersion: safeString(source.builderVersion, 40),
    heroAssetId: safeString(source.heroAssetId, 220),
    imageStoragePath: safeString(source.imageStoragePath, 1200),
    imageUrl: safeString(source.imageUrl, 3000),
    approvedUrl: safeString(source.approvedUrl, 3000),
    width: safeNumber(source.width),
    height: safeNumber(source.height),
    reservedFooterPx: safeNumber(source.reservedFooterPx),
    renderTemplate: safeString(source.renderTemplate, 140),
    renderMode: safeString(source.renderMode, 140),
    artDirectorModel: safeString(source.artDirectorModel, 100),
    imageModel: safeString(source.imageModel, 100),
    qaModel: safeString(source.qaModel, 100),
    selectedVariantId: safeString(source.selectedVariantId, 140),
    variantCount: safeNumber(source.variantCount),
    autoRevised: Boolean(source.autoRevised),
    providerManifest: sanitizeProviderManifest(source.providerManifest || {}),
    designIntelligence: sanitizeDesignIntelligence(source.designIntelligence || {}),
    artDirection: {
      campaignSummary: safeString(artDirection.campaignSummary, 1200),
      creativeNorthStar: safeString(artDirection.creativeNorthStar, 1200),
    },
    variants: Array.isArray(source.variants) ? source.variants.slice(0, 8).map(sanitizeVariant) : [],
    exactText: {
      headline: safeString(exactText.headline, 150),
      subheadline: safeString(exactText.subheadline, 250),
      primaryText: safeString(exactText.primaryText, 800),
      cta: safeString(exactText.cta, 100),
      whatsapp: safeString(exactText.whatsapp, 60),
      offer: safeString(exactText.offer, 220),
      eyebrow: safeString(exactText.eyebrow, 120),
      proofLabel: safeString(exactText.proofLabel, 160),
      supportPoints: Array.isArray(exactText.supportPoints)
        ? exactText.supportPoints.slice(0, 4).map((item) => safeString(item, 180)).filter(Boolean)
        : [],
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
    qa: sanitizeQa(qa),
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
