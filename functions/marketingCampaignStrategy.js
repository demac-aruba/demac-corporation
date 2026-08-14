const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const papiamentoVocabulary = require("./data/papiamento-aruba-vocabulary-2009.json");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const STRATEGY_MODEL = "gpt-5.6-terra";
const ALLOWED_ROLES = new Set(["admin", "office"]);
const CAMPAIGN_TYPES = new Set([
  "otro_cliente_contento",
  "airco_sales",
  "installation",
  "service",
  "seasonal_heat",
  "other",
]);

const CAMPAIGN_GUIDANCE = {
  otro_cliente_contento: "Use the real completed installation as social proof. Never invent a customer quote, name, rating, or testimonial. The approved campaign concept 'OTRO CLIENTE CONTENTO' may be used as a headline.",
  airco_sales: "Drive qualified WhatsApp inquiries about buying an air conditioner. Emphasize product value and comfort, but do not invent price, BTU, efficiency, warranty, availability, discount, or promotion.",
  installation: "Emphasize professional installation quality, trust, clean workmanship, and a clear WhatsApp booking action.",
  service: "Drive service or maintenance bookings. Focus on comfort, preventive care, professional service, and a simple WhatsApp action.",
  seasonal_heat: "Connect Aruba heat discomfort with the need for reliable cooling and a strong WhatsApp inquiry action. Avoid unsupported urgency or scarcity claims.",
  other: "Choose the strongest lead-generation or brand-trust angle supported by the analyzed images and approved business facts.",
};

const STRATEGY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["campaignType", "objective", "angle", "targetAction", "heroAssetId", "supportingAssetIds", "copy", "visualDirection", "factPolicy"],
  properties: {
    campaignType: {
      type: "string",
      enum: ["otro_cliente_contento", "airco_sales", "installation", "service", "seasonal_heat", "other"],
    },
    objective: { type: "string" },
    angle: { type: "string" },
    targetAction: { type: "string" },
    heroAssetId: { type: "string" },
    supportingAssetIds: { type: "array", maxItems: 4, items: { type: "string" } },
    copy: {
      type: "object",
      additionalProperties: false,
      required: ["language", "headline", "subheadline", "primaryText", "cta"],
      properties: {
        language: { type: "string", enum: ["pap_aw"] },
        headline: { type: "string" },
        subheadline: { type: "string" },
        primaryText: { type: "string" },
        cta: { type: "string" },
      },
    },
    visualDirection: {
      type: "object",
      additionalProperties: false,
      required: ["heroTreatment", "hierarchy", "overlayNotes", "footerInstruction"],
      properties: {
        heroTreatment: { type: "string" },
        hierarchy: { type: "array", maxItems: 7, items: { type: "string" } },
        overlayNotes: { type: "array", maxItems: 6, items: { type: "string" } },
        footerInstruction: { type: "string" },
      },
    },
    factPolicy: {
      type: "object",
      additionalProperties: false,
      required: ["priceOrPromoIncluded", "factNotes"],
      properties: {
        priceOrPromoIncluded: { type: "boolean" },
        factNotes: { type: "array", maxItems: 8, items: { type: "string" } },
      },
    },
  },
};

const PAPIAMENTO_WORDS = new Set((papiamentoVocabulary.words || []).map((word) => String(word).toLocaleLowerCase("en-US")));
const PAPIAMENTO_ALLOWED_WORDS = new Set([
  "demac", "airco", "aircos", "btu", "hvac", "split", "cassette", "inverter", "seer", "r32", "r410a", "r22",
  "whatsapp", "facebook", "instagram", "premium", "service", "installation", "instalacion", "inverter", "high", "efficiency",
  "royal", "blue", "cta", "professional", "cooling", "solutions", "awe", "calor",
]);

function cleanSessionId(value) {
  const sessionId = typeof value === "string" ? value.trim() : "";
  if (!sessionId || sessionId.length > 200 || !/^[a-zA-Z0-9._-]+$/.test(sessionId)) {
    throw new HttpsError("invalid-argument", "Invalid marketing upload session id.");
  }
  return sessionId;
}

function safeString(value, max = 1_500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

async function requireMarketingUser(uid) {
  const snapshot = await db.collection("users").doc(uid).get();
  const profile = snapshot.data() || {};
  if (!snapshot.exists || profile.active !== true || !ALLOWED_ROLES.has(profile.role)) {
    throw new HttpsError("permission-denied", "Your DEMAC account does not have Marketing Agent access.");
  }
  return profile;
}

async function loadApprovedPapiamentoCorrections() {
  const snapshot = await db.collection("papiamentoCorrections")
    .where("active", "==", true)
    .limit(100)
    .get();
  return snapshot.docs.map((document) => {
    const correction = document.data() || {};
    return {
      section: safeString(correction.sectionKey, 120),
      spanishSource: safeString(correction.sourceText, 600),
      previousTranslation: safeString(correction.generatedText, 600),
      approvedCorrection: safeString(correction.correctedText, 600),
    };
  });
}

function approvedCorrectionWords(corrections) {
  const words = new Set();
  for (const correction of corrections) {
    const tokens = correction.approvedCorrection?.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    for (const token of tokens) words.add(token.toLocaleLowerCase("en-US"));
  }
  return words;
}

function strategyCopyText(strategy) {
  return [
    strategy?.copy?.headline,
    strategy?.copy?.subheadline,
    strategy?.copy?.primaryText,
    strategy?.copy?.cta,
  ].filter(Boolean).join("\n");
}

function papiamentoUnknownWords(strategy, corrections) {
  const correctionWords = approvedCorrectionWords(corrections);
  const unknown = new Set();
  const tokens = strategyCopyText(strategy).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
  for (const originalToken of tokens) {
    if (/^\d/.test(originalToken)) continue;
    const token = originalToken.toLocaleLowerCase("en-US").replace(/^[’']+|[’']+$/g, "");
    if (!token || token.length <= 1) continue;
    if (PAPIAMENTO_WORDS.has(token) || PAPIAMENTO_ALLOWED_WORDS.has(token) || correctionWords.has(token)) continue;
    if (/^(afl|usd|www|com|aw)$/i.test(token)) continue;
    unknown.add(originalToken);
  }
  return [...unknown].sort((a, b) => a.localeCompare(b)).slice(0, 40);
}

async function loadBrandSettings() {
  const snapshot = await db.collection("marketingBrandSettings").doc("default").get();
  if (!snapshot.exists) return {};
  const source = snapshot.data() || {};
  const allowedKeys = [
    "companyName", "brandName", "whatsapp", "primaryContact", "approvedClaims", "approvedOffers", "approvedProducts",
    "primaryColor", "secondaryColor", "style", "footerRule", "language", "campaignNotes",
  ];
  const result = {};
  for (const key of allowedKeys) {
    const value = source[key];
    if (typeof value === "string") result[key] = safeString(value, 2_000);
    else if (Array.isArray(value)) result[key] = value.slice(0, 30).map((item) => safeString(item, 500)).filter(Boolean);
    else if (value && typeof value === "object") result[key] = value;
  }
  return result;
}

function campaignFacts(brandSettings) {
  const approvedFacts = {
    companyName: brandSettings.companyName || brandSettings.brandName || "DEMAC Professional Cooling Solutions",
    primaryContact: brandSettings.primaryContact || "WhatsApp",
    whatsapp: brandSettings.whatsapp || null,
    approvedClaims: Array.isArray(brandSettings.approvedClaims) ? brandSettings.approvedClaims : [],
    approvedOffers: Array.isArray(brandSettings.approvedOffers) ? brandSettings.approvedOffers : [],
    approvedProducts: Array.isArray(brandSettings.approvedProducts) ? brandSettings.approvedProducts : [],
  };
  return approvedFacts;
}

function chooseCampaignType(session) {
  if (CAMPAIGN_TYPES.has(session.campaignType) && session.campaignType !== "other") return session.campaignType;
  if (CAMPAIGN_TYPES.has(session.recommendedCampaignType)) return session.recommendedCampaignType;
  return "other";
}

async function loadUsableAssets(sessionId) {
  const snapshot = await db.collection("marketingAssets").where("sessionId", "==", sessionId).get();
  return snapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((asset) => asset.analysisStatus === "completed" && asset.doNotUse !== true)
    .sort((a, b) => {
      const aRank = Number.isFinite(a.rank) ? a.rank : 9999;
      const bRank = Number.isFinite(b.rank) ? b.rank : 9999;
      if (aRank !== bRank) return aRank - bRank;
      return (Number(b.rankingScore) || 0) - (Number(a.rankingScore) || 0);
    });
}

function assetContext(asset) {
  return {
    id: asset.id,
    rank: Number.isFinite(asset.rank) ? asset.rank : null,
    rankingScore: Number.isFinite(asset.rankingScore) ? asset.rankingScore : null,
    marketingSuitabilityScore: Number.isFinite(asset.marketingSuitabilityScore) ? asset.marketingSuitabilityScore : null,
    qualityScore: Number.isFinite(asset.qualityScore) ? asset.qualityScore : null,
    shotType: safeString(asset.shotType, 100),
    recommendedCampaignType: safeString(asset.recommendedCampaignType, 100),
    strengths: Array.isArray(asset.strengths) ? asset.strengths.slice(0, 6).map((item) => safeString(item, 300)) : [],
    issues: Array.isArray(asset.issues) ? asset.issues.slice(0, 6).map((item) => safeString(item, 300)) : [],
    recommendedUse: safeString(asset.recommendedUse, 600),
    analysisSummary: safeString(asset.analysisSummary, 1_000),
    containsPerson: Boolean(asset.containsPerson),
    personUsageNote: safeString(asset.personUsageNote, 500),
    containsReadableSensitiveData: Boolean(asset.containsReadableSensitiveData),
    sensitiveDataNote: safeString(asset.sensitiveDataNote, 500),
  };
}

function clampStrategy(strategy, allowedAssetIds, fallbackHero, campaignType) {
  const result = { ...strategy };
  result.campaignType = CAMPAIGN_TYPES.has(result.campaignType) ? result.campaignType : campaignType;
  result.heroAssetId = allowedAssetIds.has(result.heroAssetId) ? result.heroAssetId : fallbackHero;
  result.supportingAssetIds = Array.isArray(result.supportingAssetIds)
    ? [...new Set(result.supportingAssetIds.filter((id) => allowedAssetIds.has(id) && id !== result.heroAssetId))].slice(0, 4)
    : [];
  result.copy = {
    language: "pap_aw",
    headline: safeString(result.copy?.headline, 100),
    subheadline: safeString(result.copy?.subheadline, 160),
    primaryText: safeString(result.copy?.primaryText, 500),
    cta: safeString(result.copy?.cta, 80),
  };
  result.visualDirection = {
    heroTreatment: safeString(result.visualDirection?.heroTreatment, 500),
    hierarchy: Array.isArray(result.visualDirection?.hierarchy) ? result.visualDirection.hierarchy.slice(0, 7).map((item) => safeString(item, 160)) : [],
    overlayNotes: Array.isArray(result.visualDirection?.overlayNotes) ? result.visualDirection.overlayNotes.slice(0, 6).map((item) => safeString(item, 200)) : [],
    footerInstruction: "Reserve a sufficiently large blank bottom margin for DEMAC's original company footer. Never recreate or generate the footer inside the advertisement.",
  };
  result.factPolicy = {
    priceOrPromoIncluded: Boolean(result.factPolicy?.priceOrPromoIncluded),
    factNotes: Array.isArray(result.factPolicy?.factNotes) ? result.factPolicy.factNotes.slice(0, 8).map((item) => safeString(item, 300)) : [],
  };
  result.objective = safeString(result.objective, 350);
  result.angle = safeString(result.angle, 450);
  result.targetAction = safeString(result.targetAction, 250);
  return result;
}

async function callStrategyModel({ session, assets, campaignType, approvedFacts, brandSettings, corrections, revision }) {
  const hero = assets.find((asset) => asset.id === session.primaryAssetId) || assets[0];
  const allowedAssetIds = assets.map((asset) => asset.id);
  const approvedCommercialFacts = {
    ...approvedFacts,
    brandStyle: brandSettings.style || "premium, modern, clean, professional, high contrast, mobile-first",
    primaryColor: brandSettings.primaryColor || "royal blue",
    secondaryColor: brandSettings.secondaryColor || "white",
    defaultFormat: "Facebook/Instagram square 1:1",
    footerRule: "Reserve a sufficiently large blank bottom margin for the original DEMAC company footer; never generate or recreate the footer.",
    imageRule: "Use real DEMAC installation/work photos authentically; do not distort people, installations, or official branding.",
  };

  const instructions = [
    "You are the senior campaign strategist and Papiamento di Aruba advertising copywriter for DEMAC Professional Cooling Solutions in Aruba.",
    `Build ONE campaign strategy for campaign type ${campaignType}. ${CAMPAIGN_GUIDANCE[campaignType]}`,
    "Use only the supplied analyzed image evidence and approvedCommercialFacts. Never invent a price, discount, promotion, warranty, BTU, SEER, product specification, stock level, installation inclusion, customer quote, testimonial, rating, deadline, or scarcity claim.",
    "If approvedOffers/approvedProducts/approvedClaims are empty, create persuasive copy without such claims. factPolicy.priceOrPromoIncluded must be false unless an explicit approved offer with the exact fact is supplied.",
    "Write customer-facing ad copy specifically in natural Papiamento di Aruba, not Papiamentu di Curaçao. Prefer short, familiar Aruba wording over uncertain or elaborate vocabulary.",
    "Approved Papiamento corrections supplied by DEMAC are authoritative examples. Preserve brands, product codes, BTU, SEER, refrigerants, WhatsApp and standard technical abbreviations when explicitly present in approved facts.",
    "The headline must be very short and legible on a phone. The subheadline should complement it. primaryText should be concise enough for a social ad. CTA must be direct and WhatsApp-oriented unless approvedCommercialFacts say otherwise.",
    "Choose heroAssetId only from allowedAssetIds. Prefer the highest-ranked image unless another supplied image analysis clearly supports the campaign angle better. supportingAssetIds must also come from allowedAssetIds.",
    "Visual direction must preserve the real photo as dominant proof, maintain premium royal-blue/white styling, strong hierarchy and phone legibility. Footer instruction must preserve the blank bottom footer area.",
    "Do not mention AI, internal analysis scores, privacy checks, or internal workflow in customer-facing copy.",
    revision ? `This is a language revision pass. Replace or simplify these uncertain Papiamento tokens without changing facts or strategy: ${revision.join(", ")}.` : "",
  ].filter(Boolean).join(" ");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: STRATEGY_MODEL,
      reasoning: { effort: "low" },
      max_output_tokens: 1_800,
      instructions,
      input: JSON.stringify({
        campaignType,
        campaignSession: {
          id: session.id,
          name: safeString(session.name, 300),
          requestedCampaignType: session.campaignType,
          recommendedCampaignType: session.recommendedCampaignType || null,
          primaryAssetId: session.primaryAssetId || null,
        },
        allowedAssetIds,
        preferredHeroAssetId: hero.id,
        analyzedAssets: assets.slice(0, 5).map(assetContext),
        approvedCommercialFacts,
        approvedPapiamentoCorrectionExamples: corrections.slice(0, 60),
      }),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "demac_marketing_campaign_strategy",
          strict: true,
          schema: STRATEGY_SCHEMA,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI returned HTTP ${response.status}`;
    throw new Error(message);
  }
  const text = outputText(payload);
  if (!text) throw new Error("OpenAI did not return a campaign strategy.");
  return JSON.parse(text);
}

async function generateCampaignStrategy({ session, assets, campaignType, approvedFacts, brandSettings, corrections }) {
  const allowedAssetIds = new Set(assets.map((asset) => asset.id));
  const fallbackHero = assets.find((asset) => asset.id === session.primaryAssetId)?.id || assets[0].id;
  let strategy = clampStrategy(
    await callStrategyModel({ session, assets, campaignType, approvedFacts, brandSettings, corrections }),
    allowedAssetIds,
    fallbackHero,
    campaignType,
  );
  let unknownWords = papiamentoUnknownWords(strategy, corrections);
  let revisionAttempted = false;
  if (unknownWords.length) {
    revisionAttempted = true;
    strategy = clampStrategy(
      await callStrategyModel({ session, assets, campaignType, approvedFacts, brandSettings, corrections, revision: unknownWords }),
      allowedAssetIds,
      fallbackHero,
      campaignType,
    );
    unknownWords = papiamentoUnknownWords(strategy, corrections);
  }
  return {
    strategy,
    validation: {
      status: unknownWords.length ? "needs_review" : "passed",
      unknownWords,
      revisionAttempted,
      vocabulary: {
        source: papiamentoVocabulary.source || "Papiamento Aruba vocabulary",
        sourceUrl: papiamentoVocabulary.sourceUrl || null,
        orthographyVersion: papiamentoVocabulary.orthographyVersion || null,
        wordCount: papiamentoVocabulary.wordCount || PAPIAMENTO_WORDS.size,
      },
    },
  };
}

exports.requestMarketingCampaignStrategy = onCall(
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
    const campaignRef = db.collection("marketingCampaigns").doc(sessionId);
    const sessionSnapshot = await sessionRef.get();
    if (!sessionSnapshot.exists) throw new HttpsError("not-found", "Marketing upload session not found.");
    const session = { id: sessionSnapshot.id, ...sessionSnapshot.data() };
    if (session.analysisStatus !== "completed") {
      throw new HttpsError("failed-precondition", "Complete visual analysis before generating campaign strategy.");
    }

    const assets = await loadUsableAssets(sessionId);
    if (!assets.length) throw new HttpsError("failed-precondition", "No usable analyzed images are available for this campaign.");

    const campaignType = chooseCampaignType(session);
    const requestedAt = new Date().toISOString();
    await sessionRef.set({
      campaignStrategyStatus: "processing",
      campaignStrategyRequestedAt: requestedAt,
      campaignStrategyRequestedByUserId: uid,
      campaignStrategyError: FieldValue.delete(),
      updatedAt: requestedAt,
    }, { merge: true });

    try {
      const [brandSettings, corrections] = await Promise.all([
        loadBrandSettings(),
        loadApprovedPapiamentoCorrections(),
      ]);
      const approvedFacts = campaignFacts(brandSettings);
      const generated = await generateCampaignStrategy({
        session,
        assets: assets.slice(0, 5),
        campaignType,
        approvedFacts,
        brandSettings,
        corrections,
      });
      const completedAt = new Date().toISOString();
      const campaignDocument = {
        id: sessionId,
        sessionId,
        status: "strategy_completed",
        campaignType: generated.strategy.campaignType,
        objective: generated.strategy.objective,
        angle: generated.strategy.angle,
        targetAction: generated.strategy.targetAction,
        heroAssetId: generated.strategy.heroAssetId,
        supportingAssetIds: generated.strategy.supportingAssetIds,
        copy: generated.strategy.copy,
        visualDirection: generated.strategy.visualDirection,
        factPolicy: generated.strategy.factPolicy,
        papiamentoValidationStatus: generated.validation.status,
        papiamentoUnknownWords: generated.validation.unknownWords,
        papiamentoRevisionAttempted: generated.validation.revisionAttempted,
        papiamentoVocabulary: generated.validation.vocabulary,
        approvedFactSnapshot: approvedFacts,
        model: STRATEGY_MODEL,
        createdAt: completedAt,
        updatedAt: completedAt,
        generatedByUserId: uid,
      };
      await campaignRef.set(campaignDocument, { merge: true });
      await sessionRef.set({
        campaignStrategyStatus: "completed",
        campaignStrategyId: sessionId,
        campaignStrategyCompletedAt: completedAt,
        campaignStrategyError: FieldValue.delete(),
        updatedAt: completedAt,
      }, { merge: true });

      return {
        ok: true,
        campaignId: sessionId,
        campaignType: campaignDocument.campaignType,
        heroAssetId: campaignDocument.heroAssetId,
        supportingAssetIds: campaignDocument.supportingAssetIds,
        copy: campaignDocument.copy,
        papiamentoValidationStatus: campaignDocument.papiamentoValidationStatus,
        papiamentoUnknownWords: campaignDocument.papiamentoUnknownWords,
      };
    } catch (error) {
      const message = String(error?.message || "Campaign strategy generation failed.").slice(0, 1_000);
      await sessionRef.set({
        campaignStrategyStatus: "failed",
        campaignStrategyError: message,
        campaignStrategyFailedAt: FieldValue.serverTimestamp(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      throw new HttpsError("internal", message);
    }
  },
);

exports.__marketingCampaignStrategyTest = {
  chooseCampaignType,
  papiamentoUnknownWords,
  clampStrategy,
};
