const { randomUUID } = require('node:crypto');
const { getApp, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const sharp = require('sharp');
const legacy = require('./marketingCreativeBuilderV3');
const {
  CREATIVE_MODES,
  HARD_FAILURES,
  buildV4SkillContext,
} = require('./marketingCreativeSkillsV4');
const {
  EXPLORATION_COUNT,
  SHORTLIST_COUNT,
  compileCampaignIntelligence,
  exploreTerritories,
  selectDiverseBlueprints,
  buildRenderDirection,
} = require('./marketingCreativeIntelligenceV4');
const {
  openAiApiKey,
  OPENAI_IMAGE_MODEL,
  generateFullDesign,
  refineFullDesign,
  providerManifest,
  normalizeSquare,
} = require('./marketingCreativeProvidersV3');

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const storage = getStorage(app);

const ALLOWED_ROLES = new Set(['admin', 'office']);
const ART_DIRECTOR_MODEL = 'gpt-5.6-sol';
const QA_MODEL = 'gpt-5.6-sol';
const BUILDER_VERSION = 'V4';
const OUTPUT_SIZE = 1080;
const FOOTER_RESERVED_PX = 156;
const REFINEMENT_COUNT = 2;

const V4_QA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'overallScore', 'adSpendReady', 'visibleTextExact', 'inventedFacts', 'hardFailure',
    'hardFailureReasons', 'visualReview', 'performanceReview', 'amateurSignals', 'issues', 'revisionInstructions',
  ],
  properties: {
    overallScore: { type: 'integer', minimum: 0, maximum: 100 },
    adSpendReady: { type: 'boolean' },
    visibleTextExact: { type: 'boolean' },
    inventedFacts: { type: 'boolean' },
    hardFailure: { type: 'boolean' },
    hardFailureReasons: { type: 'array', maxItems: 10, items: { type: 'string' } },
    visualReview: {
      type: 'object',
      additionalProperties: false,
      required: ['benchmarkLevel', 'composition', 'typography', 'professionalFinish', 'brandCoherence', 'photoAuthenticity', 'originality', 'mobileReadability'],
      properties: {
        benchmarkLevel: { type: 'string', enum: ['amateur', 'competent', 'professional', 'agency', 'top_tier_paid_social'] },
        composition: { type: 'integer', minimum: 0, maximum: 100 },
        typography: { type: 'integer', minimum: 0, maximum: 100 },
        professionalFinish: { type: 'integer', minimum: 0, maximum: 100 },
        brandCoherence: { type: 'integer', minimum: 0, maximum: 100 },
        photoAuthenticity: { type: 'integer', minimum: 0, maximum: 100 },
        originality: { type: 'integer', minimum: 0, maximum: 100 },
        mobileReadability: { type: 'integer', minimum: 0, maximum: 100 },
      },
    },
    performanceReview: {
      type: 'object',
      additionalProperties: false,
      required: ['benchmarkLevel', 'scrollStopping', 'promiseClarity', 'proofStrength', 'ctaProminence', 'conversionPath', 'audienceRelevance', 'modeFit', 'offerClarity'],
      properties: {
        benchmarkLevel: { type: 'string', enum: ['amateur', 'competent', 'professional', 'agency', 'top_tier_paid_social'] },
        scrollStopping: { type: 'integer', minimum: 0, maximum: 100 },
        promiseClarity: { type: 'integer', minimum: 0, maximum: 100 },
        proofStrength: { type: 'integer', minimum: 0, maximum: 100 },
        ctaProminence: { type: 'integer', minimum: 0, maximum: 100 },
        conversionPath: { type: 'integer', minimum: 0, maximum: 100 },
        audienceRelevance: { type: 'integer', minimum: 0, maximum: 100 },
        modeFit: { type: 'integer', minimum: 0, maximum: 100 },
        offerClarity: { type: 'integer', minimum: 0, maximum: 100 },
      },
    },
    amateurSignals: { type: 'array', maxItems: 10, items: { type: 'string' } },
    issues: { type: 'array', maxItems: 10, items: { type: 'string' } },
    revisionInstructions: { type: 'array', maxItems: 12, items: { type: 'string' } },
  },
};

const JURY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['winner', 'spendConfidence', 'reason', 'loserWeakness'],
  properties: {
    winner: { type: 'string', enum: ['A', 'B'] },
    spendConfidence: { type: 'integer', minimum: 0, maximum: 100 },
    reason: { type: 'string' },
    loserWeakness: { type: 'string' },
  },
};

function safeString(value, max = 1600) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanId(value, label = 'id') {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 220 || !/^[a-zA-Z0-9._-]+$/.test(id)) throw new HttpsError('invalid-argument', `Invalid ${label}.`);
  return id;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

async function structuredResponse({ model, prompt, schemaName, schema, imageBuffers = [] }) {
  const content = [{ type: 'input_text', text: prompt }];
  for (const imageBuffer of imageBuffers) {
    const normalized = await normalizeSquare(imageBuffer, 1024);
    content.push({ type: 'input_image', image_url: `data:image/png;base64,${normalized.toString('base64')}`, detail: 'high' });
  }
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAiApiKey.value()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          input: [{ role: 'user', content }],
          text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
        }),
      });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch {}
      if (!response.ok) {
        const message = payload?.error?.message || text || `${model} HTTP ${response.status}`;
        const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
        if (retryable && attempt < 4) {
          await sleep(Math.min(12000, 900 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 600)));
          continue;
        }
        throw new Error(message);
      }
      const parsedText = outputText(payload);
      if (!parsedText) throw new Error(`${model} returned no structured output.`);
      return JSON.parse(parsedText);
    } catch (error) {
      lastError = error;
      if (attempt >= 4) break;
      await sleep(Math.min(12000, 900 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 600)));
    }
  }
  throw lastError || new Error(`${model} structured response failed.`);
}

async function requireMarketingUser(uid) {
  const snapshot = await db.collection('users').doc(uid).get();
  const profile = snapshot.data() || {};
  if (!snapshot.exists || profile.active !== true || !ALLOWED_ROLES.has(profile.role)) {
    throw new HttpsError('permission-denied', 'Your DEMAC account does not have Marketing Agent access.');
  }
  return profile;
}

async function loadCore(sessionId) {
  const [sessionSnap, campaignSnap, brandSnap, assetsSnap] = await Promise.all([
    db.collection('marketingUploadSessions').doc(sessionId).get(),
    db.collection('marketingCampaigns').doc(sessionId).get(),
    db.collection('marketingBrandSettings').doc('default').get(),
    db.collection('marketingAssets').where('sessionId', '==', sessionId).get(),
  ]);
  if (!sessionSnap.exists) throw new HttpsError('not-found', 'Marketing upload session was not found.');
  if (!campaignSnap.exists) throw new HttpsError('failed-precondition', 'Generate Campaign Strategy before building a creative.');
  if (!brandSnap.exists) throw new HttpsError('failed-precondition', 'Save Brand Center before building a creative.');
  const session = { id: sessionSnap.id, ...sessionSnap.data() };
  const campaign = { id: campaignSnap.id, ...campaignSnap.data() };
  const brand = { id: brandSnap.id, ...brandSnap.data() };
  const assets = assetsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const hero = assets.find((asset) => asset.id === campaign.heroAssetId)
    || assets.find((asset) => asset.id === session.primaryAssetId)
    || assets.find((asset) => asset.doNotUse !== true && asset.downloadUrl);
  if (!hero?.downloadUrl) throw new HttpsError('failed-precondition', 'No usable hero image is available for this campaign.');
  return { session, campaign, brand, assets, hero };
}

async function fetchImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new HttpsError('failed-precondition', `Hero image could not be downloaded (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) throw new HttpsError('failed-precondition', 'Hero image is empty or too large.');
  return buffer;
}

function parseApprovedProduct(line) {
  const source = safeString(line, 500);
  const btu = source.match(/(\d[\d,.\s]*)\s*BTU/i)?.[1]?.replace(/\s+/g, '') || '';
  const price = source.match(/Afl\.?\s*([\d,.]+)/i)?.[1] || '';
  const voltage = source.match(/\b(\d{3}V)\b/i)?.[1]?.toUpperCase() || '';
  const seer = source.match(/\bSEER\s*([0-9.]+)/i)?.[1] || '';
  const inverter = /\bINVERTER\b/i.test(source);
  if (!btu || !price) return null;
  return { source, btu: `${btu} BTU`, price: `Afl. ${price}`, specs: [voltage, seer ? `SEER ${seer}` : '', inverter ? 'INVERTER' : ''].filter(Boolean).join(' • ') };
}

function exactTextForCreative(campaign, brand) {
  const headline = safeString(campaign.copy?.headline, 120);
  const subheadline = safeString(campaign.copy?.subheadline, 220);
  const primaryText = safeString(campaign.copy?.primaryText, 700);
  const cta = safeString(campaign.copy?.cta, 100) || 'WhatsApp nos awe mes';
  const whatsapp = safeString(brand.whatsapp, 60);
  const products = campaign.campaignType === 'airco_sales'
    ? (Array.isArray(brand.approvedProducts) ? brand.approvedProducts : []).map(parseApprovedProduct).filter(Boolean).slice(0, 3)
    : [];
  const offer = campaign.factPolicy?.priceOrPromoIncluded === true && Array.isArray(brand.approvedOffers) && brand.approvedOffers.length
    ? safeString(brand.approvedOffers[0], 180)
    : '';
  return {
    headline: headline || 'DEMAC Professional Cooling Solutions',
    subheadline,
    primaryText,
    cta,
    whatsapp,
    offer,
    products,
    brandName: safeString(brand.brandName || brand.companyName || 'DEMAC', 100) || 'DEMAC',
  };
}

function hardChecks({ campaign, brand, exact }) {
  const approvedProducts = new Set(Array.isArray(brand.approvedProducts) ? brand.approvedProducts : []);
  const productFactsApproved = exact.products.every((product) => approvedProducts.has(product.source));
  const exactWhatsapp = exact.whatsapp === safeString(brand.whatsapp, 60) && Boolean(exact.whatsapp);
  const languagePassed = campaign.papiamentoValidationStatus === 'passed';
  return {
    brandCenterLive: true,
    languagePassed,
    exactWhatsapp,
    productFactsApproved,
    footerReserved: FOOTER_RESERVED_PX >= 140,
    allPassed: languagePassed && exactWhatsapp && productFactsApproved && FOOTER_RESERVED_PX >= 140,
  };
}

async function setProgress(sessionId, stage, percent, label, extra = {}) {
  const now = new Date().toISOString();
  await db.collection('marketingUploadSessions').doc(sessionId).set({
    creativeStatus: percent >= 100 ? 'completed' : 'processing',
    creativeProgress: { stage, percent, label, updatedAt: now, ...extra },
    updatedAt: now,
  }, { merge: true });
}

async function nextVersion(sessionId) {
  const snapshot = await db.collection('marketingCreatives').where('sessionId', '==', sessionId).get();
  let max = 0;
  for (const doc of snapshot.docs) max = Math.max(max, Number(doc.data()?.version) || 0);
  return max + 1;
}

async function previousIssues(sessionId) {
  const snapshot = await db.collection('marketingCreatives').where('sessionId', '==', sessionId).get();
  const docs = snapshot.docs.sort((a, b) => (Number(b.data()?.version) || 0) - (Number(a.data()?.version) || 0)).slice(0, 5);
  const issues = [];
  for (const doc of docs) {
    const data = doc.data() || {};
    issues.push(...(Array.isArray(data?.qa?.issues) ? data.qa.issues : []));
    issues.push(...(Array.isArray(data?.qa?.amateurSignals) ? data.qa.amateurSignals : []));
    issues.push(...(Array.isArray(data?.qa?.hardFailureReasons) ? data.qa.hardFailureReasons : []));
  }
  return [...new Set(issues.map((item) => safeString(item, 320)).filter(Boolean))].slice(0, 14);
}

async function enforceFooterReserve(buffer) {
  const base = await sharp(buffer).rotate().resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover', position: 'attention' }).png().toBuffer();
  const footer = Buffer.from(`<svg width="${OUTPUT_SIZE}" height="${FOOTER_RESERVED_PX}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#ffffff"/></svg>`);
  return sharp(base).composite([{ input: footer, left: 0, top: OUTPUT_SIZE - FOOTER_RESERVED_PX }]).png().toBuffer();
}

function fullDesignPrompt({ brief, candidate, core, exact }) {
  const { campaign, brand, hero } = core;
  return [
    'Create a COMPLETE, finished 1:1 Facebook/Instagram paid advertisement by editing the supplied real DEMAC HVAC photograph.',
    'Act as a senior advertising art director, not a template engine. The output itself must be campaign-ready; no later UI compositor will add the design.',
    'The V4 campaign intelligence and layout blueprint below are binding strategy. Execute them as a coherent advertising composition, not as literal boxes.',
    buildRenderDirection({ brief, candidate, exact, footerReservedPx: FOOTER_RESERVED_PX, outputSize: OUTPUT_SIZE }),
    '',
    'PHOTO/AUTHENTICITY:',
    `Hero analysis: ${safeString(hero.analysisSummary, 900)}.`,
    'Preserve the actual installed condenser, architecture, mounting workmanship, labels, physical geometry, and scene identity. Improve cleanliness, light, color, and premium finish without inventing equipment.',
    brief.creativeMode === CREATIVE_MODES.PROOF ? 'Because this is a PROOF AD, the real completed work must remain the credibility hero. Do not replace it with a synthetic product shot or let giant typography overpower it.' : '',
    '',
    'GRAPHIC CRAFT:',
    'Use deliberate typographic hierarchy, custom advertising composition, crop tension, negative space, integrated brand color, and one strong graphic device.',
    'Do not use dashboard cards, SaaS widgets, checklist cards, app pills, generic rounded white boxes, landing-page hero structure, or one large dark translucent rectangle holding all copy.',
    'Do not add any customer-facing words beyond the exact approved strings and approved facts supplied above.',
    `Brand style: ${safeString(brand.style, 600)}. Campaign objective: ${safeString(campaign.objective, 600)}.`,
    '',
    buildV4SkillContext({ mode: brief.creativeMode, campaign, brand }),
    '',
    'Quality bar: the finished asset should look like senior agency paid-social work that a marketer could spend real media budget on today.',
  ].filter(Boolean).join('\n');
}

function qaPrompt({ brief, candidate, exact, hard, stage }) {
  return [
    'You are two senior reviewers sharing one evaluation: (1) an executive graphic-design/art-direction reviewer and (2) a performance-marketing creative reviewer.',
    'Evaluate the supplied ad against real professional paid-social work, not against the other AI candidates.',
    'A beautiful poster can fail performance. A clear sales flyer can fail design. Both visualReview and performanceReview must independently reach agency quality for approval.',
    `Campaign creative mode: ${brief.creativeMode}.`,
    `Creative North Star: ${brief.creativeNorthStar}.`,
    `Conversion goal: ${brief.conversionGoal}.`,
    `Primary promise: ${brief.primaryPromise}.`,
    `Supporting proof: ${JSON.stringify(brief.supportingProof)}.`,
    `Expected exact headline: ${JSON.stringify(exact.headline)}.`,
    exact.subheadline ? `Expected supporting line: ${JSON.stringify(exact.subheadline)}.` : '',
    `Expected CTA: ${JSON.stringify(exact.cta)}.`,
    `Expected WhatsApp: ${JSON.stringify(exact.whatsapp)}.`,
    exact.offer ? `Only approved offer: ${JSON.stringify(exact.offer)}.` : 'No offer is approved.',
    exact.products.length ? `Only approved product facts: ${JSON.stringify(exact.products)}.` : 'No price/spec product facts are approved.',
    `Candidate territory: ${candidate.name}; proof strategy: ${candidate.proofStrategy}; CTA strategy: ${candidate.ctaStrategy}.`,
    `Stage: ${stage}. Hard factual prechecks: ${JSON.stringify(hard)}.`,
    '',
    'VISUAL REVIEW: judge composition, typography, finish, brand coherence, authentic use of the real photo, originality, and mobile readability.',
    'PERFORMANCE REVIEW: judge scroll stopping, promise clarity, proof strength, CTA prominence, conversion path, audience relevance, fit to the selected creative mode, and offer clarity when applicable.',
    'Set hardFailure=true for any non-negotiable failure, even if the numeric average would otherwise be high.',
    'Non-negotiable hard failures include:',
    ...HARD_FAILURES.map((item) => `- ${item}`),
    '',
    'For PROOF ADS specifically: hard-fail if the authentic completed work stops being the credibility anchor or if the piece becomes mainly a typography poster.',
    'Revision instructions must be concrete art-direction or conversion actions: crop, type scale, hierarchy, proof treatment, CTA, brand integration, text repair, or removal of an amateur signal.',
  ].filter(Boolean).join('\n');
}

function benchmarkPass(level) {
  return level === 'agency' || level === 'top_tier_paid_social';
}

function normalizeQa(parsed, hard) {
  const visual = parsed.visualReview || {};
  const performance = parsed.performanceReview || {};
  const amateurSignals = Array.isArray(parsed.amateurSignals) ? parsed.amateurSignals.map((item) => safeString(item, 320)).filter(Boolean).slice(0, 10) : [];
  const hardFailureReasons = Array.isArray(parsed.hardFailureReasons) ? parsed.hardFailureReasons.map((item) => safeString(item, 340)).filter(Boolean).slice(0, 10) : [];
  const visualGate = benchmarkPass(visual.benchmarkLevel)
    && Number(visual.composition) >= 88
    && Number(visual.typography) >= 86
    && Number(visual.professionalFinish) >= 88
    && Number(visual.brandCoherence) >= 84
    && Number(visual.photoAuthenticity) >= 90
    && Number(visual.mobileReadability) >= 88;
  const performanceGate = benchmarkPass(performance.benchmarkLevel)
    && Number(performance.scrollStopping) >= 86
    && Number(performance.promiseClarity) >= 88
    && Number(performance.proofStrength) >= 86
    && Number(performance.ctaProminence) >= 86
    && Number(performance.conversionPath) >= 88
    && Number(performance.modeFit) >= 90;
  const pass = hard.allPassed
    && parsed.adSpendReady === true
    && parsed.visibleTextExact === true
    && parsed.inventedFacts === false
    && parsed.hardFailure !== true
    && hardFailureReasons.length === 0
    && amateurSignals.length === 0
    && Number(parsed.overallScore) >= 90
    && visualGate
    && performanceGate;
  const visualScore = Math.round([
    visual.composition, visual.typography, visual.professionalFinish, visual.brandCoherence,
    visual.photoAuthenticity, visual.originality, visual.mobileReadability,
  ].reduce((sum, value) => sum + (Number(value) || 0), 0) / 7);
  const performanceScore = Math.round([
    performance.scrollStopping, performance.promiseClarity, performance.proofStrength, performance.ctaProminence,
    performance.conversionPath, performance.audienceRelevance, performance.modeFit, performance.offerClarity,
  ].reduce((sum, value) => sum + (Number(value) || 0), 0) / 8);
  const selectionScore = Math.max(0, Math.min(100, Math.round(
    visualScore * 0.48 + performanceScore * 0.48 + (Number(parsed.overallScore) || 0) * 0.04
    - amateurSignals.length * 7 - hardFailureReasons.length * 15,
  )));
  return {
    source: 'openai_vision_v4_paired_benchmark',
    status: pass ? 'passed' : 'failed',
    score: Number(parsed.overallScore) || 0,
    overallScore: Number(parsed.overallScore) || 0,
    selectionScore,
    adSpendReady: Boolean(parsed.adSpendReady),
    visibleTextExact: Boolean(parsed.visibleTextExact),
    inventedFacts: Boolean(parsed.inventedFacts),
    hardFailure: Boolean(parsed.hardFailure) || hardFailureReasons.length > 0,
    hardFailureReasons,
    visualBenchmarkLevel: visual.benchmarkLevel || 'amateur',
    performanceBenchmarkLevel: performance.benchmarkLevel || 'amateur',
    visualScore,
    performanceScore,
    visualReview: visual,
    performanceReview: performance,
    amateurSignals,
    issues: Array.isArray(parsed.issues) ? parsed.issues.map((item) => safeString(item, 340)).filter(Boolean).slice(0, 10) : [],
    revisionInstructions: Array.isArray(parsed.revisionInstructions) ? parsed.revisionInstructions.map((item) => safeString(item, 380)).filter(Boolean).slice(0, 12) : [],
    hardChecks: hard,
  };
}

async function visualQa(buffer, brief, candidate, exact, hard, stage) {
  const parsed = await structuredResponse({
    model: QA_MODEL,
    prompt: qaPrompt({ brief, candidate, exact, hard, stage }),
    schemaName: `demac_creative_v4_qa_${stage.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
    schema: V4_QA_SCHEMA,
    imageBuffers: [buffer],
  });
  return normalizeQa(parsed, hard);
}

function storageDownloadUrl(bucketName, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
}

async function saveImage(path, buffer, metadata = {}) {
  const bucket = storage.bucket();
  const token = randomUUID();
  const file = bucket.file(path);
  await file.save(buffer, {
    resumable: false,
    contentType: 'image/png',
    metadata: { cacheControl: 'private,max-age=3600', metadata: { firebaseStorageDownloadTokens: token, ...metadata } },
  });
  return { path, url: storageDownloadUrl(bucket.name, path, token) };
}

async function renderCandidate({ candidate, brief, core, exact, heroBuffer, hard, sessionId, creativeId, index }) {
  const raw = await generateFullDesign({ sourceBuffer: heroBuffer, prompt: fullDesignPrompt({ brief, candidate, core, exact }) });
  const rendered = await enforceFooterReserve(raw);
  const qa = await visualQa(rendered, brief, candidate, exact, hard, 'shortlist');
  const id = `v4_final_${index + 1}_${candidate.id}`;
  const uploaded = await saveImage(`marketing/generated/${sessionId}/${creativeId}-${id}.png`, rendered, {
    sessionId,
    assetId: creativeId,
    variant: id,
    stage: 'shortlist',
    sourceHeroAssetId: core.hero.id,
    imageModel: OPENAI_IMAGE_MODEL,
    builderVersion: BUILDER_VERSION,
    creativeMode: brief.creativeMode,
  });
  return {
    id,
    conceptId: candidate.id,
    name: safeString(candidate.name, 180),
    rationale: safeString(candidate.whySelected || candidate.whyItMayConvert, 900),
    diversityRationale: safeString(candidate.diversityRationale, 700),
    stage: 'shortlist',
    parentVariantId: '',
    imageStoragePath: uploaded.path,
    imageUrl: uploaded.url,
    imageModel: OPENAI_IMAGE_MODEL,
    selectionScore: qa.selectionScore,
    revised: false,
    layout: {
      compositionTemplate: safeString(candidate.composition, 180),
      heroTreatment: safeString(candidate.heroTreatment, 300),
      typographyDirection: safeString(candidate.typographyBehavior, 300),
      graphicLanguage: safeString(candidate.graphicLanguage, 300),
      persuasionMechanism: safeString(candidate.persuasionMechanism, 300),
      proofStrategy: safeString(candidate.proofStrategy, 300),
      ctaStrategy: safeString(candidate.ctaStrategy, 300),
      blueprint: candidate.blueprint,
    },
    qa,
    _buffer: rendered,
    _candidate: candidate,
  };
}

function refinementPrompt({ candidate, brief, exact }) {
  const issues = [...(candidate.qa.hardFailureReasons || []), ...(candidate.qa.amateurSignals || []), ...(candidate.qa.issues || [])].slice(0, 16);
  const instructions = (candidate.qa.revisionInstructions || []).slice(0, 12);
  return [
    'Refine this existing DEMAC paid-social ad as a senior agency art director and performance creative lead.',
    'Keep the winning core concept and authentic installation, but fix every blocking visual and conversion weakness. This is an edit pass, not a random redesign.',
    `Creative mode: ${brief.creativeMode}. North Star: ${brief.creativeNorthStar}.`,
    `Primary promise: ${brief.primaryPromise}. Supporting proof: ${JSON.stringify(brief.supportingProof)}.`,
    `HEADLINE: ${JSON.stringify(exact.headline)}.`,
    exact.subheadline ? `SUPPORTING LINE: ${JSON.stringify(exact.subheadline)}.` : '',
    `CTA: ${JSON.stringify(exact.cta)}. WHATSAPP: ${JSON.stringify(exact.whatsapp)}.`,
    exact.offer ? `APPROVED OFFER: ${JSON.stringify(exact.offer)}.` : 'NO OFFER TEXT.',
    exact.products.length ? `APPROVED PRODUCT FACTS: ${JSON.stringify(exact.products)}.` : 'NO PRICE/SPEC FACTS.',
    `Keep the bottom ${Math.ceil((FOOTER_RESERVED_PX / OUTPUT_SIZE) * 100)}% visually clear for the original footer.`,
    brief.creativeMode === CREATIVE_MODES.PROOF ? 'Maintain the real completed work as the dominant credibility anchor; do not let typography or decoration become the hero.' : '',
    issues.length ? `BLOCKING QA FINDINGS TO ELIMINATE: ${issues.join('; ')}.` : '',
    instructions.length ? `DIRECTED REVISION ACTIONS: ${instructions.join('; ')}.` : '',
    'Do not regress into cards, UI, generic templates, or simple text-on-rectangle treatment. Preserve exact customer-facing copy and remove invented/corrupted text.',
  ].filter(Boolean).join('\n');
}

async function refineCandidate({ candidate, brief, core, exact, hard, sessionId, creativeId, index }) {
  const raw = await refineFullDesign({ currentBuffer: candidate._buffer, prompt: refinementPrompt({ candidate, brief, exact }) });
  const rendered = await enforceFooterReserve(raw);
  const qa = await visualQa(rendered, brief, candidate._candidate, exact, hard, 'refinement');
  const id = `v4_refined_${index + 1}_${candidate.conceptId}`;
  const uploaded = await saveImage(`marketing/generated/${sessionId}/${creativeId}-${id}.png`, rendered, {
    sessionId,
    assetId: creativeId,
    variant: id,
    stage: 'refined',
    parentVariantId: candidate.id,
    sourceHeroAssetId: core.hero.id,
    imageModel: OPENAI_IMAGE_MODEL,
    builderVersion: BUILDER_VERSION,
    creativeMode: brief.creativeMode,
  });
  return {
    ...candidate,
    id,
    name: `${candidate.name} · Refined`,
    stage: 'refined',
    parentVariantId: candidate.id,
    imageStoragePath: uploaded.path,
    imageUrl: uploaded.url,
    selectionScore: qa.selectionScore,
    revised: true,
    qa,
    _buffer: rendered,
  };
}

async function finalJury(a, b, brief, exact) {
  const prompt = [
    'You are the executive creative director making the final paid-media decision between two finished DEMAC ads.',
    'Image 1 is Candidate A; Image 2 is Candidate B.',
    `Creative mode: ${brief.creativeMode}. North Star: ${brief.creativeNorthStar}. Conversion goal: ${brief.conversionGoal}.`,
    'Choose the one that best combines agency-level visual craft and performance-marketing effectiveness. Do not reward a decorative poster that weakens proof or conversion.',
    `Required headline: ${JSON.stringify(exact.headline)}; CTA: ${JSON.stringify(exact.cta)}; WhatsApp: ${JSON.stringify(exact.whatsapp)}.`,
    `Candidate A QA: ${JSON.stringify({ visual: a.qa.visualBenchmarkLevel, performance: a.qa.performanceBenchmarkLevel, spendReady: a.qa.adSpendReady, hardFailure: a.qa.hardFailure, score: a.qa.selectionScore })}.`,
    `Candidate B QA: ${JSON.stringify({ visual: b.qa.visualBenchmarkLevel, performance: b.qa.performanceBenchmarkLevel, spendReady: b.qa.adSpendReady, hardFailure: b.qa.hardFailure, score: b.qa.selectionScore })}.`,
    'Never choose corrupted required text, invented facts, weak CTA, or a candidate that violates the selected creative mode unless both fail; state the deciding weakness.',
  ].join('\n');
  const jury = await structuredResponse({
    model: ART_DIRECTOR_MODEL,
    prompt,
    schemaName: 'demac_creative_v4_final_jury',
    schema: JURY_SCHEMA,
    imageBuffers: [a._buffer, b._buffer],
  });
  return {
    winner: jury.winner === 'B' ? b : a,
    spendConfidence: Number(jury.spendConfidence) || 0,
    reason: safeString(jury.reason, 900),
    loserWeakness: safeString(jury.loserWeakness, 900),
  };
}

function publicVariant(candidate) {
  const { _buffer, _candidate, ...safe } = candidate;
  return safe;
}

async function buildCreative({ sessionId, uid, profile }) {
  const core = await loadCore(sessionId);
  const { campaign, brand, hero } = core;
  if (campaign.papiamentoValidationStatus !== 'passed') throw new HttpsError('failed-precondition', 'Papiamento copy must pass validation before creative generation.');
  const version = await nextVersion(sessionId);
  const creativeId = `${sessionId}-v${version}-${randomUUID().slice(0, 8)}`;
  const exact = exactTextForCreative(campaign, brand);
  const hard = hardChecks({ campaign, brand, exact });
  if (!hard.allPassed) throw new HttpsError('failed-precondition', 'Creative hard checks did not pass before rendering.');

  await db.collection('marketingUploadSessions').doc(sessionId).set({
    creativeStatus: 'processing',
    creativeRequestedAt: FieldValue.serverTimestamp(),
    creativeError: FieldValue.delete(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  await setProgress(sessionId, 'prepare', 3, 'Preparing V4 campaign evidence, approved facts, and creative memory…');
  const heroBuffer = await fetchImageBuffer(hero.downloadUrl);
  const issues = await previousIssues(sessionId);

  await setProgress(sessionId, 'intelligence', 8, 'V4 is classifying the ad mode and compiling a performance creative brief…');
  const brief = await compileCampaignIntelligence({
    core, exact, heroBuffer, previousIssues: issues, footerReservedPx: FOOTER_RESERVED_PX,
    outputSize: OUTPUT_SIZE, structuredResponse, model: ART_DIRECTOR_MODEL,
  });

  await setProgress(sessionId, 'explore', 14, `V4 Creative Director is exploring ${EXPLORATION_COUNT} distinct territories for ${brief.creativeMode}…`);
  const exploration = await exploreTerritories({ brief, core, exact, previousIssues: issues, structuredResponse, model: ART_DIRECTOR_MODEL });

  await setProgress(sessionId, 'diversity', 23, `Diversity Gate is selecting ${SHORTLIST_COUNT} materially different directions and building layout blueprints…`);
  const portfolio = await selectDiverseBlueprints({
    brief, exploration, core, exact, footerReservedPx: FOOTER_RESERVED_PX, outputSize: OUTPUT_SIZE,
    previousIssues: issues, structuredResponse, model: ART_DIRECTOR_MODEL,
  });

  await setProgress(sessionId, 'render_shortlist', 30, `Rendering ${SHORTLIST_COUNT} complete V4 paid-social concepts with GPT Image 2…`, { totalVariants: SHORTLIST_COUNT });
  const initial = await Promise.all(portfolio.selected.map((candidate, index) => renderCandidate({
    candidate, brief, core, exact, heroBuffer, hard, sessionId, creativeId, index,
  })));
  initial.sort((a, b) => b.selectionScore - a.selectionScore);

  const topTwo = initial.slice(0, REFINEMENT_COUNT);
  await setProgress(sessionId, 'refine', 72, `Refining the top ${REFINEMENT_COUNT} candidates from V4 visual + performance benchmark feedback…`, { completedVariants: initial.length });
  const refined = await Promise.all(topTwo.map((candidate, index) => refineCandidate({
    candidate, brief, core, exact, hard, sessionId, creativeId, index,
  })));
  refined.sort((a, b) => b.selectionScore - a.selectionScore);

  await setProgress(sessionId, 'jury', 91, 'Executive Creative Director is choosing the final V4 paid-media winner…');
  const jury = refined.length >= 2
    ? await finalJury(refined[0], refined[1], brief, exact)
    : { winner: refined[0] || initial[0], spendConfidence: 0, reason: 'Single finalist.', loserWeakness: '' };
  let selected = jury.winner;
  if (!selected) throw new HttpsError('internal', 'Creative Engine V4 did not produce a final candidate.');

  const allCandidates = [...initial, ...refined];
  const passedCandidates = allCandidates.filter((item) => item.qa.status === 'passed').sort((a, b) => b.selectionScore - a.selectionScore);
  if (selected.qa.status !== 'passed' && passedCandidates.length) selected = passedCandidates[0];

  await setProgress(sessionId, 'finalize', 97, 'Finalizing V4 winner and preserving strategy, blueprints, renders, and benchmark evidence…');
  const now = new Date().toISOString();
  const status = selected.qa.status === 'passed' ? 'qa_passed' : 'qa_failed';
  const variants = allCandidates.map(publicVariant);
  const record = {
    id: creativeId,
    sessionId,
    campaignId: campaign.id,
    campaignType: campaign.campaignType,
    creativeMode: brief.creativeMode,
    version,
    status,
    builderVersion: BUILDER_VERSION,
    heroAssetId: hero.id,
    imageStoragePath: selected.imageStoragePath,
    imageUrl: selected.imageUrl,
    width: OUTPUT_SIZE,
    height: OUTPUT_SIZE,
    reservedFooterPx: FOOTER_RESERVED_PX,
    renderTemplate: safeString(selected.layout?.compositionTemplate, 180) || 'v4_performance_design',
    renderMode: 'ai_full_design_v4_mode_brief_diversity_blueprint',
    artDirectorModel: ART_DIRECTOR_MODEL,
    imageModel: OPENAI_IMAGE_MODEL,
    qaModel: QA_MODEL,
    providerManifest: providerManifest(),
    creativeBrief: brief,
    designIntelligence: {
      explorationCount: EXPLORATION_COUNT,
      shortlistCount: SHORTLIST_COUNT,
      refinementCount: REFINEMENT_COUNT,
      benchmarkDefinition: exploration.benchmarkDefinition,
      portfolioRationale: portfolio.portfolioRationale,
      exploredConcepts: exploration.territories.map((item) => ({
        id: item.id,
        name: item.name,
        persuasionMechanism: item.persuasionMechanism,
        heroTreatment: item.heroTreatment,
        composition: item.composition,
        proofStrategy: item.proofStrategy,
        ctaStrategy: item.ctaStrategy,
        whyItMayConvert: item.whyItMayConvert,
        distinctnessAxis: item.distinctnessAxis,
      })),
      selectedBlueprints: portfolio.selected.map((item) => ({ id: item.id, name: item.name, diversityRationale: item.diversityRationale, blueprint: item.blueprint })),
      finalJury: { spendConfidence: jury.spendConfidence, reason: jury.reason, loserWeakness: jury.loserWeakness },
    },
    artDirection: {
      campaignSummary: brief.primaryPromise,
      creativeNorthStar: brief.creativeNorthStar,
      creativeMode: brief.creativeMode,
    },
    selectedVariantId: selected.id,
    variantCount: variants.length,
    variants,
    autoRevised: true,
    exactText: {
      headline: exact.headline,
      subheadline: exact.subheadline,
      primaryText: exact.primaryText,
      cta: exact.cta,
      whatsapp: exact.whatsapp,
      offer: exact.offer,
      products: exact.products,
      eyebrow: exact.brandName,
      proofLabel: '',
      supportPoints: [],
    },
    captionText: safeString(campaign.copy?.primaryText, 700),
    qa: selected.qa,
    papiamentoValidationStatus: campaign.papiamentoValidationStatus,
    createdAt: now,
    updatedAt: now,
    createdByUserId: uid,
    createdByName: safeString(profile.name || profile.displayName || profile.email, 160),
  };

  await db.collection('marketingCreatives').doc(creativeId).set(record);
  await db.collection('marketingUploadSessions').doc(sessionId).set({
    creativeStatus: status,
    latestCreativeId: creativeId,
    creativeCompletedAt: FieldValue.serverTimestamp(),
    creativeProgress: {
      stage: 'completed',
      percent: 100,
      label: status === 'qa_passed'
        ? `V4 ${brief.creativeMode} creative passed visual + performance agency benchmark.`
        : `V4 ${brief.creativeMode} exploration completed; best candidate is still not ad-spend ready.`,
      updatedAt: now,
    },
    updatedAt: now,
  }, { merge: true });
  return record;
}

exports.requestMarketingCreativeBuild = onCall({
  region: 'us-central1',
  timeoutSeconds: 900,
  memory: '2GiB',
  secrets: [openAiApiKey],
}, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Firebase authentication is required.');
  const profile = await requireMarketingUser(request.auth.uid);
  const sessionId = cleanId(request.data?.sessionId, 'marketing session id');
  try {
    const creative = await buildCreative({ sessionId, uid: request.auth.uid, profile });
    return {
      creativeId: creative.id,
      version: creative.version,
      status: creative.status,
      imageUrl: creative.imageUrl,
      qa: creative.qa,
      renderMode: creative.renderMode,
      builderVersion: creative.builderVersion,
      creativeMode: creative.creativeMode,
      selectedVariantId: creative.selectedVariantId,
      variantCount: creative.variantCount,
    };
  } catch (error) {
    const message = safeString(error instanceof Error ? error.message : String(error), 1600) || 'Creative build failed.';
    await db.collection('marketingUploadSessions').doc(sessionId).set({
      creativeStatus: 'failed',
      creativeError: message,
      creativeProgress: { stage: 'failed', percent: 100, label: message, updatedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    }, { merge: true }).catch(() => undefined);
    if (error instanceof HttpsError) throw error;
    console.error('Marketing Creative Engine V4 failed', error);
    throw new HttpsError('internal', message);
  }
});

// Approval behavior remains stable and battle-tested; V4 changes the creative
// intelligence and evaluation pipeline, not approval semantics.
exports.approveMarketingCreative = legacy.approveMarketingCreative;

exports.__marketingCreativeBuilderV4Test = {
  BUILDER_VERSION,
  ART_DIRECTOR_MODEL,
  QA_MODEL,
  IMAGE_MODEL: OPENAI_IMAGE_MODEL,
  OUTPUT_SIZE,
  FOOTER_RESERVED_PX,
  EXPLORATION_COUNT,
  SHORTLIST_COUNT,
  REFINEMENT_COUNT,
  V4_QA_SCHEMA,
};