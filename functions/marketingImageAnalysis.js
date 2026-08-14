const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");

const MARKETING_ANALYSIS_MODEL = "gpt-5.6-terra";
const MAX_ASSETS_PER_SESSION = 64;
const ANALYSIS_BATCH_SIZE = 8;

const CAMPAIGN_TYPES = [
  "otro_cliente_contento",
  "airco_sales",
  "installation",
  "service",
  "seasonal_heat",
  "other",
  "do_not_use",
];

const SHOT_TYPES = [
  "customer_handoff",
  "installed_unit",
  "technician_at_work",
  "before_after",
  "equipment_detail",
  "team",
  "vehicle",
  "property",
  "product",
  "unclear",
  "other",
];

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assets"],
  properties: {
    assets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "assetId",
          "qualityScore",
          "marketingSuitabilityScore",
          "compositionScore",
          "lightingScore",
          "sharpnessScore",
          "subjectClarityScore",
          "brandSafetyScore",
          "recommendedCampaignType",
          "shotType",
          "strengths",
          "issues",
          "recommendedUse",
          "doNotUse",
          "rejectionReason",
          "containsPerson",
          "personUsageNote",
          "containsReadableSensitiveData",
          "sensitiveDataNote",
          "analysisSummary",
        ],
        properties: {
          assetId: { type: "string" },
          qualityScore: { type: "integer" },
          marketingSuitabilityScore: { type: "integer" },
          compositionScore: { type: "integer" },
          lightingScore: { type: "integer" },
          sharpnessScore: { type: "integer" },
          subjectClarityScore: { type: "integer" },
          brandSafetyScore: { type: "integer" },
          recommendedCampaignType: { type: "string", enum: CAMPAIGN_TYPES },
          shotType: { type: "string", enum: SHOT_TYPES },
          strengths: { type: "array", items: { type: "string" } },
          issues: { type: "array", items: { type: "string" } },
          recommendedUse: { type: "string" },
          doNotUse: { type: "boolean" },
          rejectionReason: { type: "string" },
          containsPerson: { type: "boolean" },
          personUsageNote: { type: "string" },
          containsReadableSensitiveData: { type: "boolean" },
          sensitiveDataNote: { type: "string" },
          analysisSummary: { type: "string" },
        },
      },
    },
  },
};

function comparableValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value.toMillis === "function") return String(value.toMillis());
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return String(value);
}

function analysisRequested(before, after) {
  if (!after.analysisRequestedAt) return false;
  if (!["ready", "partial"].includes(after.status)) return false;
  return comparableValue(after.analysisRequestedAt) !== comparableValue(before.analysisRequestedAt);
}

function analysisRunKey(session) {
  return `request:${comparableValue(session.analysisRequestedAt)}`;
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

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function cleanString(value, maxLength = 800) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanStringArray(value, limit = 5) {
  return Array.isArray(value)
    ? value.map((item) => cleanString(item, 240)).filter(Boolean).slice(0, limit)
    : [];
}

function normalizeResult(raw, allowedAssetIds) {
  const assetId = cleanString(raw?.assetId, 200);
  if (!allowedAssetIds.has(assetId)) throw new Error(`OpenAI returned an unknown marketing asset id: ${assetId || "empty"}`);

  const qualityScore = clampScore(raw.qualityScore);
  const marketingSuitabilityScore = clampScore(raw.marketingSuitabilityScore);
  const brandSafetyScore = clampScore(raw.brandSafetyScore);
  const doNotUse = Boolean(raw.doNotUse);
  const containsReadableSensitiveData = Boolean(raw.containsReadableSensitiveData);
  let rankingScore = Math.round(
    (marketingSuitabilityScore * 0.55)
    + (qualityScore * 0.25)
    + (brandSafetyScore * 0.20),
  );
  if (doNotUse) rankingScore = Math.min(rankingScore, 20);
  if (containsReadableSensitiveData) rankingScore = Math.min(rankingScore, 45);

  const recommendedCampaignType = CAMPAIGN_TYPES.includes(raw.recommendedCampaignType)
    ? raw.recommendedCampaignType
    : "other";
  const shotType = SHOT_TYPES.includes(raw.shotType) ? raw.shotType : "other";

  return {
    assetId,
    analysisStatus: "completed",
    analysisModel: MARKETING_ANALYSIS_MODEL,
    qualityScore,
    marketingSuitabilityScore,
    compositionScore: clampScore(raw.compositionScore),
    lightingScore: clampScore(raw.lightingScore),
    sharpnessScore: clampScore(raw.sharpnessScore),
    subjectClarityScore: clampScore(raw.subjectClarityScore),
    brandSafetyScore,
    rankingScore,
    recommendedCampaignType,
    shotType,
    strengths: cleanStringArray(raw.strengths),
    issues: cleanStringArray(raw.issues),
    recommendedUse: cleanString(raw.recommendedUse),
    doNotUse,
    rejectionReason: cleanString(raw.rejectionReason),
    containsPerson: Boolean(raw.containsPerson),
    personUsageNote: cleanString(raw.personUsageNote),
    containsReadableSensitiveData,
    sensitiveDataNote: cleanString(raw.sensitiveDataNote),
    analysisSummary: cleanString(raw.analysisSummary),
    analyzedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function requestBatchAnalysis(session, assets) {
  const content = [{
    type: "input_text",
    text: [
      "Analyze the following DEMAC Professional Cooling Solutions photographs for marketing use in Aruba.",
      `The upload session target campaign is: ${session.campaignType || "other"}.`,
      "Score each image from 0 to 100 for technical image quality and practical marketing suitability.",
      "Judge composition, lighting, sharpness, subject clarity, and brand safety separately.",
      "Be conservative: a technically acceptable photo is not automatically a strong marketing photo.",
      "Identify privacy/safety risks such as readable customer addresses, phone numbers, license plates, documents, screens, or other sensitive details.",
      "Do not identify people, infer identity, age, ethnicity, health, or other sensitive personal attributes.",
      "If a person is present, only note whether the image is operationally usable without making identity claims.",
      "Prefer authentic HVAC work, clearly visible installed equipment, clean workmanship, customer handoff moments, technicians at work, and strong before/after evidence.",
      "Mark doNotUse=true for unsafe, unusable, severely blurry, misleading, privacy-sensitive, or clearly unprofessional images.",
      "Return exactly one result for every ASSET_ID below and preserve each ASSET_ID exactly.",
    ].join(" "),
  }];

  for (const asset of assets) {
    content.push({
      type: "input_text",
      text: `ASSET_ID=${asset.id}; file=${String(asset.originalFileName || "image").slice(0, 200)}`,
    });
    content.push({
      type: "input_image",
      image_url: asset.downloadUrl,
      detail: "high",
    });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MARKETING_ANALYSIS_MODEL,
      reasoning: { effort: "low" },
      max_output_tokens: 5_000,
      instructions: "You are DEMAC's visual marketing analyst. Evaluate only visible evidence. Return concise, factual structured results and never invent customer facts.",
      input: [{ role: "user", content }],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "demac_marketing_image_analysis",
          strict: true,
          schema: ANALYSIS_SCHEMA,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI returned HTTP ${response.status}`;
    const error = new Error(message);
    error.code = payload?.error?.code || response.status;
    throw error;
  }

  const text = outputText(payload);
  if (!text) throw new Error("OpenAI returned no marketing image analysis output.");
  const parsed = JSON.parse(text);
  const rawResults = Array.isArray(parsed?.assets) ? parsed.assets : [];
  if (rawResults.length !== assets.length) {
    throw new Error(`OpenAI analyzed ${rawResults.length} of ${assets.length} expected assets.`);
  }

  const allowedAssetIds = new Set(assets.map((asset) => asset.id));
  const normalized = rawResults.map((item) => normalizeResult(item, allowedAssetIds));
  if (new Set(normalized.map((item) => item.assetId)).size !== assets.length) {
    throw new Error("OpenAI returned duplicate marketing asset ids.");
  }
  return normalized;
}

async function markAssetsProcessing(assets, runKey) {
  for (let offset = 0; offset < assets.length; offset += 400) {
    const batch = db.batch();
    for (const asset of assets.slice(offset, offset + 400)) {
      batch.set(asset.ref, {
        analysisStatus: "processing",
        analysisSourceKey: runKey,
        analysisError: FieldValue.delete(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
    await batch.commit();
  }
}

async function saveAnalysisResults(assetRefById, results, runKey) {
  const batch = db.batch();
  for (const result of results) {
    const ref = assetRefById.get(result.assetId);
    if (!ref) continue;
    const { assetId, ...changes } = result;
    batch.set(ref, {
      ...changes,
      analysisSourceKey: runKey,
      analysisError: FieldValue.delete(),
    }, { merge: true });
  }
  await batch.commit();
}

async function saveRanks(assetRefById, ranked) {
  const batch = db.batch();
  ranked.forEach((result, index) => {
    const ref = assetRefById.get(result.assetId);
    if (!ref) return;
    batch.set(ref, { rank: index + 1, updatedAt: new Date().toISOString() }, { merge: true });
  });
  await batch.commit();
}

exports.analyzeMarketingUploadSession = onDocumentUpdated(
  {
    document: "marketingUploadSessions/{sessionId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
    secrets: [openAiApiKey],
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (!analysisRequested(before, after)) return;

    const sessionRef = event.data.after.ref;
    const runKey = analysisRunKey(after);
    const claimed = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(sessionRef);
      const current = snapshot.data() || {};
      if (current.analysisStatus === "processing" && current.analysisSourceKey === runKey) return false;
      if (current.analysisStatus === "completed" && current.analysisSourceKey === runKey) return false;
      transaction.set(sessionRef, {
        analysisStatus: "processing",
        analysisSourceKey: runKey,
        analysisModel: MARKETING_ANALYSIS_MODEL,
        analysisError: FieldValue.delete(),
        analysisStartedAt: FieldValue.serverTimestamp(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return true;
    });
    if (!claimed) return;

    try {
      const assetSnapshot = await db.collection("marketingAssets")
        .where("sessionId", "==", event.params.sessionId)
        .get();
      const assets = assetSnapshot.docs
        .map((snapshot) => ({ id: snapshot.id, ref: snapshot.ref, ...snapshot.data() }))
        .filter((asset) => asset.downloadUrl && asset.status !== "rejected");

      if (!assets.length) throw new Error("This marketing session contains no analyzable images.");
      if (assets.length > MAX_ASSETS_PER_SESSION) {
        throw new Error(`This session contains ${assets.length} images. Split it into sessions of ${MAX_ASSETS_PER_SESSION} images or fewer for analysis.`);
      }

      await markAssetsProcessing(assets, runKey);
      const assetRefById = new Map(assets.map((asset) => [asset.id, asset.ref]));
      const results = [];

      for (let offset = 0; offset < assets.length; offset += ANALYSIS_BATCH_SIZE) {
        const group = assets.slice(offset, offset + ANALYSIS_BATCH_SIZE);
        const groupResults = await requestBatchAnalysis(after, group);
        await saveAnalysisResults(assetRefById, groupResults, runKey);
        results.push(...groupResults);
      }

      const ranked = [...results].sort((first, second) => {
        if (first.doNotUse !== second.doNotUse) return first.doNotUse ? 1 : -1;
        return second.rankingScore - first.rankingScore;
      });
      await saveRanks(assetRefById, ranked);

      const usable = ranked.filter((item) => !item.doNotUse);
      const best = usable.slice(0, 5);
      const primary = best[0] || ranked[0];
      const recommendedCampaignType = primary?.recommendedCampaignType === "do_not_use"
        ? (after.campaignType || "other")
        : (primary?.recommendedCampaignType || after.campaignType || "other");

      await sessionRef.set({
        analysisStatus: "completed",
        analysisSourceKey: runKey,
        analysisModel: MARKETING_ANALYSIS_MODEL,
        analysisError: FieldValue.delete(),
        analyzedAssetCount: results.length,
        usableAssetCount: usable.length,
        primaryAssetId: primary?.assetId || null,
        bestAssetIds: best.map((item) => item.assetId),
        recommendedCampaignType,
        analysisCompletedAt: FieldValue.serverTimestamp(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      logger.info("Marketing image analysis completed.", {
        sessionId: event.params.sessionId,
        assetCount: results.length,
        usableAssetCount: usable.length,
        model: MARKETING_ANALYSIS_MODEL,
      });
    } catch (error) {
      logger.error("Marketing image analysis failed.", error);
      await sessionRef.set({
        analysisStatus: "failed",
        analysisSourceKey: runKey,
        analysisError: String(error?.message || "Unknown marketing analysis error").slice(0, 1_000),
        analysisFailedAt: FieldValue.serverTimestamp(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      throw error;
    }
  },
);
