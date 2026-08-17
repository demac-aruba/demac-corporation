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

function safeStringList(value, maxItems = 10, maxLen = 350) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => safeString(item, maxLen)).filter(Boolean) : [];
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

function sanitizeVisualReview(value = {}) {
  return {
    benchmarkLevel: safeString(value.benchmarkLevel, 50),
    composition: safeNumber(value.composition),
    typography: safeNumber(value.typography),
    professionalFinish: safeNumber(value.professionalFinish),
    brandCoherence: safeNumber(value.brandCoherence),
    photoAuthenticity: safeNumber(value.photoAuthenticity),
    originality: safeNumber(value.originality),
    mobileReadability: safeNumber(value.mobileReadability),
  };
}

function sanitizePerformanceReview(value = {}) {
  return {
    benchmarkLevel: safeString(value.benchmarkLevel, 50),
    scrollStopping: safeNumber(value.scrollStopping),
    promiseClarity: safeNumber(value.promiseClarity),
    proofStrength: safeNumber(value.proofStrength),
    ctaProminence: safeNumber(value.ctaProminence),
    conversionPath: safeNumber(value.conversionPath),
    audienceRelevance: safeNumber(value.audienceRelevance),
    modeFit: safeNumber(value.modeFit),
    offerClarity: safeNumber(value.offerClarity),
  };
}

function sanitizeQa(qa = {}) {
  return {
    source: safeString(qa.source, 80),
    status: safeString(qa.status, 40),
    score: safeNumber(qa.score),
    selectionScore: safeNumber(qa.selectionScore),
    overallScore: safeNumber(qa.overallScore || qa.score),
    benchmarkLevel: safeString(qa.benchmarkLevel, 50),
    visualBenchmarkLevel: safeString(qa.visualBenchmarkLevel, 50),
    performanceBenchmarkLevel: safeString(qa.performanceBenchmarkLevel, 50),
    visualScore: safeNumber(qa.visualScore),
    performanceScore: safeNumber(qa.performanceScore),
    visualReview: sanitizeVisualReview(qa.visualReview || {}),
    performanceReview: sanitizePerformanceReview(qa.performanceReview || {}),
    adSpendReady: Boolean(qa.adSpendReady),
    visibleTextExact: Boolean(qa.visibleTextExact),
    inventedFacts: Boolean(qa.inventedFacts),
    hardFailure: Boolean(qa.hardFailure),
    hardFailureReasons: safeStringList(qa.hardFailureReasons, 10, 380),
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
    amateurSignals: safeStringList(qa.amateurSignals, 10, 350),
    issues: safeStringList(qa.issues, 10, 350),
    revisionInstructions: safeStringList(qa.revisionInstructions, 12, 400),
    hardChecks: sanitizeHardChecks(qa.hardChecks),
  };
}

function sanitizeBlueprint(value = {}) {
  return {
    heroRegion: safeString(value.heroRegion, 260),
    heroSharePercent: safeNumber(value.heroSharePercent),
    headlineRegion: safeString(value.headlineRegion, 260),
    headlineMaxLines: safeNumber(value.headlineMaxLines),
    supportRegion: safeString(value.supportRegion, 260),
    ctaRegion: safeString(value.ctaRegion, 260),
    brandRegion: safeString(value.brandRegion, 260),
    proofRegion: safeString(value.proofRegion, 260),
    typographyScale: safeString(value.typographyScale, 380),
    negativeSpacePlan: safeString(value.negativeSpacePlan, 420),
    cropInstruction: safeString(value.cropInstruction, 420),
    primaryGraphicDevice: safeString(value.primaryGraphicDevice, 420),
    mobileReadSequence: safeStringList(value.mobileReadSequence, 6, 240),
    footerExclusion: safeString(value.footerExclusion, 340),
    mustPreserve: safeStringList(value.mustPreserve, 8, 260),
    mustAvoid: safeStringList(value.mustAvoid, 10, 260),
  };
}

function sanitizeVariant(item = {}) {
  const layout = item.layout && typeof item.layout === "object" ? item.layout : {};
  return {
    id: safeString(item.id, 140),
    conceptId: safeString(item.conceptId, 140),
    name: safeString(item.name, 180),
    rationale: safeString(item.rationale, 1000),
    diversityRationale: safeString(item.diversityRationale, 800),
    stage: safeString(item.stage, 80),
    parentVariantId: safeString(item.parentVariantId, 160),
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
      compositionTemplate: safeString(layout.compositionTemplate, 220),
      visualEnergy: safeString(layout.visualEnergy, 60),
      graphicLanguage: safeString(layout.graphicLanguage, 500),
      typographyDirection: safeString(layout.typographyDirection, 500),
      persuasionMechanism: safeString(layout.persuasionMechanism, 500),
      thumbnailIdea: safeString(layout.thumbnailIdea, 500),
      heroTreatment: safeString(layout.heroTreatment, 500),
      proofStrategy: safeString(layout.proofStrategy, 500),
      ctaStrategy: safeString(layout.ctaStrategy, 500),
      blueprint: sanitizeBlueprint(layout.blueprint || {}),
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
    notes: safeStringList(value.notes, 8, 500),
  };
}

function sanitizeCreativeBrief(value = {}) {
  return {
    creativeMode: safeString(value.creativeMode, 80),
    modeConfidence: safeNumber(value.modeConfidence),
    modeReason: safeString(value.modeReason, 1000),
    conversionGoal: safeString(value.conversionGoal, 700),
    targetAudience: safeString(value.targetAudience, 700),
    primaryPromise: safeString(value.primaryPromise, 700),
    supportingProof: safeStringList(value.supportingProof, 6, 360),
    persuasionMechanism: safeString(value.persuasionMechanism, 700),
    heroAssetRole: safeString(value.heroAssetRole, 700),
    brandRole: safeString(value.brandRole, 700),
    visualPriority: safeStringList(value.visualPriority, 6, 300),
    mandatoryInformation: safeStringList(value.mandatoryInformation, 10, 300),
    optionalInformation: safeStringList(value.optionalInformation, 8, 300),
    forbiddenClaims: safeStringList(value.forbiddenClaims, 10, 320),
    authenticityConstraints: safeStringList(value.authenticityConstraints, 10, 320),
    mobileRequirements: safeStringList(value.mobileRequirements, 8, 300),
    creativeNorthStar: safeString(value.creativeNorthStar, 1100),
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
    portfolioRationale: safeString(value.portfolioRationale, 1400),
    exploredConcepts: Array.isArray(value.exploredConcepts)
      ? value.exploredConcepts.slice(0, 12).map((item) => ({
        id: safeString(item?.id, 120),
        name: safeString(item?.name, 180),
        archetype: safeString(item?.archetype, 180),
        thumbnailIdea: safeString(item?.thumbnailIdea, 500),
        whyItCouldWin: safeString(item?.whyItCouldWin, 600),
        persuasionMechanism: safeString(item?.persuasionMechanism, 500),
        heroTreatment: safeString(item?.heroTreatment, 500),
        composition: safeString(item?.composition, 500),
        proofStrategy: safeString(item?.proofStrategy, 500),
        ctaStrategy: safeString(item?.ctaStrategy, 500),
        whyItMayConvert: safeString(item?.whyItMayConvert, 650),
        distinctnessAxis: safeString(item?.distinctnessAxis, 450),
      }))
      : [],
    selectedBlueprints: Array.isArray(value.selectedBlueprints)
      ? value.selectedBlueprints.slice(0, 4).map((item) => ({
        id: safeString(item?.id, 120),
        name: safeString(item?.name, 180),
        diversityRationale: safeString(item?.diversityRationale, 700),
        blueprint: sanitizeBlueprint(item?.blueprint || {}),
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
    creativeMode: safeString(source.creativeMode, 100),
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
    renderTemplate: safeString(source.renderTemplate, 220),
    renderMode: safeString(source.renderMode, 220),
    artDirectorModel: safeString(source.artDirectorModel, 100),
    imageModel: safeString(source.imageModel, 100),
    qaModel: safeString(source.qaModel, 100),
    selectedVariantId: safeString(source.selectedVariantId, 160),
    variantCount: safeNumber(source.variantCount),
    autoRevised: Boolean(source.autoRevised),
    providerManifest: sanitizeProviderManifest(source.providerManifest || {}),
    creativeBrief: sanitizeCreativeBrief(source.creativeBrief || {}),
    designIntelligence: sanitizeDesignIntelligence(source.designIntelligence || {}),
    artDirection: {
      campaignSummary: safeString(artDirection.campaignSummary, 1200),
      creativeNorthStar: safeString(artDirection.creativeNorthStar, 1200),
      creativeMode: safeString(artDirection.creativeMode, 100),
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
      supportPoints: safeStringList(exactText.supportPoints, 4, 180),
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