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
const MAX_LANGUAGE_REVISIONS = 2;

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
    campaignType: { type: "string", enum: ["otro_cliente_contento", "airco_sales", "installation", "service", "seasonal_heat", "other"] },
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
const DEFAULT_APPROVED_ARUBA_PHRASES = [
  "WhatsApp nos awe mes",
  "Traha bo Cita Awe mes",
  "Service bo Airco",
  "Instala bo Airco Nobo",
  "Stop di drumi den Calor.",
  "Cumpra bo Airco awe mes.",
  "Otro Cliente Contento",
];
const PAPIAMENTO_ALLOWED_WORDS = new Set([
  "demac", "airco", "aircos", "btu", "hvac", "split", "cassette", "inverter", "seer", "r32", "r410a", "r22",
  "whatsapp", "facebook", "instagram", "premium", "service", "installation", "instalacion", "high", "efficiency",
  "royal", "blue", "cta", "professional", "cooling", "solutions",
]);
for (const phrase of DEFAULT_APPROVED_ARUBA_PHRASES) {
  for (const token of phrase.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []) {
    PAPIAMENTO_ALLOWED_WORDS.add(token.toLocaleLowerCase("en-US"));
  }
}

const ARUBA_MARKETING_WORD_CANDIDATES = [
  "awe", "airco", "aruba", "bo", "calor", "calidad", "cambia", "cas", "casa", "cliente", "contento",
  "confiabel", "confort", "cu", "cada", "detaye", "experiencia", "fresco", "garantia", "haci", "instala",
  "instalacion", "limpi", "mantenemento", "nobo", "nos", "pa", "profesional", "servicio", "trabou", "tecnico",
  "tecniconan", "yuda", "cita", "cumpra", "drumi", "aña", "riba", "mes", "segur", "rapido", "ambiente",
  "calor", "comodidad", "confiansa", "equipo", "sistema", "aire", "frio", "mantene", "cuida", "cuidado",
];
const VERIFIED_ARUBA_MARKETING_WORDS = [...new Set(ARUBA_MARKETING_WORD_CANDIDATES.filter((word) => PAPIAMENTO_WORDS.has(word)))];

const CURACAO_TO_ARUBA_CANDIDATES = new Map([
  ["ku", "cu"],
  ["hasi", "haci"],
  ["kada", "cada"],
  ["atenshon", "atencion"],
  ["konfiabel", "confiabel"],
  ["profeshonal", "profesional"],
]);
const VERIFIED_CURACAO_REPLACEMENTS = new Map(
  [...CURACAO_TO_ARUBA_CANDIDATES.entries()].filter(([, arubaWord]) => PAPIAMENTO_WORDS.has(arubaWord)),
);

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

function tokens(value) {
  return String(value || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
}

function normalizeToken(value) {
  return String(value || "").toLocaleLowerCase("en-US").replace(/^[’']+|[’']+$/g, "");
}

function copyText(strategy) {
  return [strategy?.copy?.headline, strategy?.copy?.subheadline, strategy?.copy?.primaryText, strategy?.copy?.cta]
    .filter(Boolean)
    .join("\n");
}

function preserveCase(original, replacement) {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (/^[A-ZÁÉÍÓÚÑÜ]/.test(original)) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
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
  const snapshot = await db.collection("papiamentoCorrections").where("active", "==", true).limit(100).get();
  return snapshot.docs.map((document) => {
    const correction = document.data() || {};
    return {
      section: safeString(correction.sectionKey, 120),
      spanishSource: safeString(correction.sourceText, 600),
      previousTranslation: safeString(correction.generatedText, 600),
      approvedCorrection: safeString(correction.correctedText, 1_500),
    };
  });
}

function approvedCorrectionWords(corrections) {
  const words = new Set();
  for (const correction of corrections) {
    for (const token of tokens(correction.approvedCorrection)) words.add(normalizeToken(token));
  }
  return words;
}

function approvedPhraseBank(brandSettings, corrections) {
  const bank = [
    ...(Array.isArray(brandSettings.approvedPapiamentoPhrases) ? brandSettings.approvedPapiamentoPhrases : []),
    ...corrections.flatMap((correction) => safeString(correction.approvedCorrection, 1_500).split(/\r?\n/)),
    ...DEFAULT_APPROVED_ARUBA_PHRASES,
  ].map((item) => safeString(item, 220)).filter(Boolean);
  return [...new Set(bank)].slice(0, 80);
}

function applyVerifiedArubaReplacements(strategy) {
  const replaceText = (value) => String(value || "").replace(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu, (original) => {
    const replacement = VERIFIED_CURACAO_REPLACEMENTS.get(normalizeToken(original));
    return replacement ? preserveCase(original, replacement) : original;
  });
  return {
    ...strategy,
    copy: {
      language: "pap_aw",
      headline: replaceText(strategy?.copy?.headline),
      subheadline: replaceText(strategy?.copy?.subheadline),
      primaryText: replaceText(strategy?.copy?.primaryText),
      cta: replaceText(strategy?.copy?.cta),
    },
  };
}

function papiamentoUnknownWords(strategy, corrections) {
  const correctionWords = approvedCorrectionWords(corrections);
  const unknown = new Set();
  for (const originalToken of tokens(copyText(strategy))) {
    if (/^\d/.test(originalToken)) continue;
    const token = normalizeToken(originalToken);
    if (!token || token.length <= 1) continue;
    if (PAPIAMENTO_WORDS.has(token) || PAPIAMENTO_ALLOWED_WORDS.has(token) || correctionWords.has(token)) continue;
    if (/^(afl|usd|www|com|aw)$/i.test(token)) continue;
    unknown.add(originalToken);
  }
  return [...unknown].sort((a, b) => a.localeCompare(b)).slice(0, 40);
}

function papiamentoForbiddenWords(strategy) {
  const forbidden = new Set();
  for (const originalToken of tokens(copyText(strategy))) {
    const token = normalizeToken(originalToken);
    if (CURACAO_TO_ARUBA_CANDIDATES.has(token) || /shon/i.test(token)) forbidden.add(originalToken);
  }
  return [...forbidden].sort((a, b) => a.localeCompare(b)).slice(0, 40);
}

function papiamentoReviewWords(strategy, corrections) {
  return [...new Set([...papiamentoUnknownWords(strategy, corrections), ...papiamentoForbiddenWords(strategy)])]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 40);
}

async function loadBrandSettings() {
  const snapshot = await db.collection("marketingBrandSettings").doc("default").get();
  if (!snapshot.exists) return {};
  const source = snapshot.data() || {};
  const allowedKeys = [
    "companyName", "brandName", "whatsapp", "primaryContact", "approvedClaims", "approvedOffers", "approvedProducts",
    "approvedPapiamentoPhrases", "primaryColor", "secondaryColor", "style", "footerRule", "language", "campaignNotes",
    "defaultFormat", "realPhotoRule",
  ];
  const result = {};
  for (const key of allowedKeys) {
    const value = source[key];
    if (typeof value === "string") result[key] = safeString(value, 2_000);
    else if (Array.isArray(value)) result[key] = value.slice(0, 40).map((item) => safeString(item, 500)).filter(Boolean);
    else if (value && typeof value === "object") result[key] = value;
  }
  return result;
}

function campaignFacts(brandSettings) {
  return {
    companyName: brandSettings.companyName || brandSettings.brandName || "DEMAC Professional Cooling Solutions",
    primaryContact: brandSettings.primaryContact || "WhatsApp",
    whatsapp: brandSettings.whatsapp || null,
    approvedClaims: Array.isArray(brandSettings.approvedClaims) ? brandSettings.approvedClaims : [],
    approvedOffers: Array.isArray(brandSettings.approvedOffers) ? brandSettings.approvedOffers : [],
    approvedProducts: Array.isArray(brandSettings.approvedProducts) ? brandSettings.approvedProducts : [],
  };
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

function deterministicSafeCopy(strategy, campaignType, brandSettings, corrections) {
  const bank = approvedPhraseBank(brandSettings, corrections);
  const find = (pattern, fallback) => bank.find((phrase) => pattern.test(phrase)) || fallback;
  const headlineByType = {
    installation: find(/instala.*airco/i, "Instala bo Airco Nobo"),
    service: find(/service.*airco/i, "Service bo Airco"),
    airco_sales: find(/cumpra.*airco/i, "Cumpra bo Airco awe mes."),
    seasonal_heat: find(/calor/i, "Stop di drumi den Calor."),
    otro_cliente_contento: find(/otro.*cliente.*contento/i, "Otro Cliente Contento"),
    other: find(/whatsapp/i, "WhatsApp nos awe mes"),
  };
  const headline = headlineByType[campaignType] || "WhatsApp nos awe mes";
  const appointment = find(/cita/i, "Traha bo Cita Awe mes");
  const cta = find(/whatsapp/i, "WhatsApp nos awe mes");
  const primaryParts = [...new Set([headline, appointment, cta])];
  return {
    ...strategy,
    copy: {
      language: "pap_aw",
      headline,
      subheadline: appointment,
      primaryText: primaryParts.join(" "),
      cta,
    },
  };
}

function arubaReplacementGuide() {
  return [...VERIFIED_CURACAO_REPLACEMENTS.entries()].map(([curacao, aruba]) => `${curacao} → ${aruba}`);
}

async function callStrategyModel({ session, assets, campaignType, approvedFacts, brandSettings, corrections, revision, previousCopy }) {
  const hero = assets.find((asset) => asset.id === session.primaryAssetId) || assets[0];
  const allowedAssetIds = assets.map((asset) => asset.id);
  const approvedCommercialFacts = {
    ...approvedFacts,
    brandStyle: brandSettings.style || "premium, modern, clean, professional, high contrast, mobile-first",
    primaryColor: brandSettings.primaryColor || "royal blue",
    secondaryColor: brandSettings.secondaryColor || "white",
    defaultFormat: brandSettings.defaultFormat || "Facebook/Instagram square 1:1",
    footerRule: brandSettings.footerRule || "Reserve a sufficiently large blank bottom margin for the original DEMAC company footer; never generate or recreate the footer.",
    imageRule: brandSettings.realPhotoRule || "Use real DEMAC installation/work photos authentically; do not distort people, installations, or official branding.",
  };
  const phraseBank = approvedPhraseBank(brandSettings, corrections);
  const replacementGuide = arubaReplacementGuide();

  const instructions = [
    "You are the senior campaign strategist and advertising copywriter for DEMAC Professional Cooling Solutions in Aruba.",
    `Build ONE campaign strategy for campaign type ${campaignType}. ${CAMPAIGN_GUIDANCE[campaignType]}`,
    "Use only supplied analyzed image evidence and approvedCommercialFacts. Never invent price, discount, promotion, warranty, BTU, SEER, product specification, stock, installation inclusion, testimonial, rating, deadline, or scarcity.",
    "Write ONLY the customer-facing copy fields (headline, subheadline, primaryText, cta) in Papiamento di Aruba. Write objective, angle, targetAction, visualDirection and factPolicy notes in English so internal strategy text cannot contaminate the Papiamento copy.",
    "Aruba orthography is a hard requirement. Do NOT use Papiamentu di Curaçao phonetic spellings such as ku, hasi, kada, atenshon, konfiabel, profeshonal or other -shon forms.",
    `When relevant, use these verified Aruba replacements: ${replacementGuide.join(", ") || "use the official Aruba vocabulary only"}.`,
    "Treat verifiedArubaMarketingWords and approvedArubaPapiamentoPhrases in the input as authoritative lexical guidance. Prefer those exact spellings. If a desired idea requires uncertain vocabulary, simplify the sentence or reuse an approved phrase instead of inventing a spelling.",
    "Approved DEMAC Papiamento phrases may be reused verbatim. Preserve brands, product codes, BTU, SEER, refrigerants, WhatsApp and standard technical abbreviations.",
    "Keep the headline very short and mobile-readable. Keep the primary text concise. CTA should normally direct to WhatsApp.",
    "Choose heroAssetId only from allowedAssetIds. Prefer the highest-ranked photo unless another analyzed photo clearly supports the campaign better.",
    "Visual direction must preserve the real photo as dominant proof, premium royal-blue/white styling, strong hierarchy, mobile legibility, and the blank bottom footer area.",
    "Do not mention AI, internal analysis scores, privacy checks, validation, dictionaries, or internal workflow in customer-facing copy.",
    revision?.length ? `LANGUAGE REVISION REQUIRED. The previous copy contained these non-Aruba or unverified tokens: ${revision.join(", ")}. Rewrite the copy with simpler verified Aruba wording. Do not repeat any of those tokens unless they are exact DEMAC brand/product terms.` : "",
  ].filter(Boolean).join(" ");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiApiKey.value()}`, "Content-Type": "application/json" },
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
        papiamentoOrthographyReference: {
          language: "Papiamento di Aruba",
          source: papiamentoVocabulary.source || "Departamento di Enseñansa Aruba",
          referenceSite: papiamentoVocabulary.referenceSite || "https://papiamento.aw",
          orthographyVersion: papiamentoVocabulary.orthographyVersion || "2009",
          verifiedArubaMarketingWords: VERIFIED_ARUBA_MARKETING_WORDS,
          forbiddenCuracaoForms: replacementGuide,
        },
        approvedArubaPapiamentoPhrases: phraseBank.slice(0, 60),
        approvedPapiamentoCorrectionExamples: corrections.slice(0, 60),
        previousCopy: revision?.length ? previousCopy || null : null,
      }),
      text: {
        verbosity: "low",
        format: { type: "json_schema", name: "demac_marketing_campaign_strategy", strict: true, schema: STRATEGY_SCHEMA },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI returned HTTP ${response.status}`);
  const text = outputText(payload);
  if (!text) throw new Error("OpenAI did not return a campaign strategy.");
  return JSON.parse(text);
}

async function generateCampaignStrategy({ session, assets, campaignType, approvedFacts, brandSettings, corrections }) {
  const allowedAssetIds = new Set(assets.map((asset) => asset.id));
  const fallbackHero = assets.find((asset) => asset.id === session.primaryAssetId)?.id || assets[0].id;
  let strategy = applyVerifiedArubaReplacements(clampStrategy(
    await callStrategyModel({ session, assets, campaignType, approvedFacts, brandSettings, corrections }),
    allowedAssetIds,
    fallbackHero,
    campaignType,
  ));
  let reviewWords = papiamentoReviewWords(strategy, corrections);
  let revisionCount = 0;

  while (reviewWords.length && revisionCount < MAX_LANGUAGE_REVISIONS) {
    revisionCount += 1;
    const previousCopy = strategy.copy;
    strategy = applyVerifiedArubaReplacements(clampStrategy(
      await callStrategyModel({
        session,
        assets,
        campaignType,
        approvedFacts,
        brandSettings,
        corrections,
        revision: reviewWords,
        previousCopy,
      }),
      allowedAssetIds,
      fallbackHero,
      campaignType,
    ));
    reviewWords = papiamentoReviewWords(strategy, corrections);
  }

  let validationMode = "model_verified";
  if (reviewWords.length) {
    strategy = applyVerifiedArubaReplacements(deterministicSafeCopy(strategy, campaignType, brandSettings, corrections));
    reviewWords = papiamentoReviewWords(strategy, corrections);
    validationMode = "approved_phrase_fallback";
  }

  const forbiddenWords = papiamentoForbiddenWords(strategy);
  return {
    strategy,
    validation: {
      status: reviewWords.length ? "needs_review" : "passed",
      unknownWords: reviewWords,
      forbiddenWords,
      revisionAttempted: revisionCount > 0,
      revisionCount,
      mode: validationMode,
      vocabulary: {
        source: papiamentoVocabulary.source || "Papiamento Aruba vocabulary",
        sourceUrl: papiamentoVocabulary.sourceUrl || null,
        referenceSite: papiamentoVocabulary.referenceSite || "https://papiamento.aw",
        orthography: papiamentoVocabulary.orthography || "Papiamento di Aruba",
        orthographyVersion: papiamentoVocabulary.orthographyVersion || null,
        wordCount: papiamentoVocabulary.wordCount || PAPIAMENTO_WORDS.size,
        verifiedMarketingWordCount: VERIFIED_ARUBA_MARKETING_WORDS.length,
      },
    },
  };
}

exports.requestMarketingCampaignStrategy = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 540, secrets: [openAiApiKey] },
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
      const [brandSettings, corrections] = await Promise.all([loadBrandSettings(), loadApprovedPapiamentoCorrections()]);
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
        papiamentoForbiddenWords: generated.validation.forbiddenWords,
        papiamentoRevisionAttempted: generated.validation.revisionAttempted,
        papiamentoRevisionCount: generated.validation.revisionCount,
        papiamentoValidationMode: generated.validation.mode,
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
        papiamentoValidationMode: campaignDocument.papiamentoValidationMode,
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

exports.__marketingCampaignStrategyArubaTest = {
  applyVerifiedArubaReplacements,
  papiamentoUnknownWords,
  papiamentoForbiddenWords,
  papiamentoReviewWords,
  deterministicSafeCopy,
  verifiedArubaMarketingWords: VERIFIED_ARUBA_MARKETING_WORDS,
  verifiedCuracaoReplacements: [...VERIFIED_CURACAO_REPLACEMENTS.entries()],
};
