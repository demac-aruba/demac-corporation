const { randomUUID } = require('node:crypto');
const { getApp, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const sharp = require('sharp');
const {
  buildSkillContext,
  QA_SKILL,
  AMATEUR_ANTI_PATTERNS,
} = require('./marketingCreativeSkillsV3');
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
const BUILDER_VERSION = 'V3';
const OUTPUT_SIZE = 1080;
const FOOTER_RESERVED_PX = 156;
const EXPLORATION_COUNT = 12;
const SHORTLIST_COUNT = 4;
const REFINEMENT_COUNT = 2;
const CONCEPT_IDS = Array.from({ length: EXPLORATION_COUNT }, (_, index) => `concept_${String(index + 1).padStart(2, '0')}`);

const CONCEPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['strategyDiagnosis', 'benchmarkDefinition', 'concepts'],
  properties: {
    strategyDiagnosis: { type: 'string' },
    benchmarkDefinition: { type: 'string' },
    concepts: {
      type: 'array',
      minItems: EXPLORATION_COUNT,
      maxItems: EXPLORATION_COUNT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id', 'name', 'archetype', 'persuasionMechanism', 'thumbnailIdea', 'composition',
          'typographyDirection', 'graphicLanguage', 'photoTreatment', 'textStrategy', 'risk', 'whyItCouldWin',
        ],
        properties: {
          id: { type: 'string', enum: CONCEPT_IDS },
          name: { type: 'string' },
          archetype: { type: 'string' },
          persuasionMechanism: { type: 'string' },
          thumbnailIdea: { type: 'string' },
          composition: { type: 'string' },
          typographyDirection: { type: 'string' },
          graphicLanguage: { type: 'string' },
          photoTreatment: { type: 'string' },
          textStrategy: { type: 'string' },
          risk: { type: 'string' },
          whyItCouldWin: { type: 'string' },
        },
      },
    },
  },
};

const SHORTLIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['creativeNorthStar', 'selected'],
  properties: {
    creativeNorthStar: { type: 'string' },
    selected: {
      type: 'array',
      minItems: SHORTLIST_COUNT,
      maxItems: SHORTLIST_COUNT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'whySelected', 'contrastFromOthers'],
        properties: {
          id: { type: 'string', enum: CONCEPT_IDS },
          whySelected: { type: 'string' },
          contrastFromOthers: { type: 'string' },
        },
      },
    },
  },
};

const QA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'overallScore', 'benchmarkLevel', 'adSpendReady', 'visibleTextExact', 'inventedFacts',
    'creativeDirection', 'composition', 'typography', 'professionalFinish', 'brandDistinctiveness',
    'conversionClarity', 'authenticity', 'textFidelity', 'footerSafety', 'originality', 'thumbnailImpact',
    'amateurSignals', 'issues', 'revisionInstructions',
  ],
  properties: {
    overallScore: { type: 'integer', minimum: 0, maximum: 100 },
    benchmarkLevel: { type: 'string', enum: ['amateur', 'competent', 'professional', 'agency', 'top_tier'] },
    adSpendReady: { type: 'boolean' },
    visibleTextExact: { type: 'boolean' },
    inventedFacts: { type: 'boolean' },
    creativeDirection: { type: 'integer', minimum: 0, maximum: 100 },
    composition: { type: 'integer', minimum: 0, maximum: 100 },
    typography: { type: 'integer', minimum: 0, maximum: 100 },
    professionalFinish: { type: 'integer', minimum: 0, maximum: 100 },
    brandDistinctiveness: { type: 'integer', minimum: 0, maximum: 100 },
    conversionClarity: { type: 'integer', minimum: 0, maximum: 100 },
    authenticity: { type: 'integer', minimum: 0, maximum: 100 },
    textFidelity: { type: 'integer', minimum: 0, maximum: 100 },
    footerSafety: { type: 'integer', minimum: 0, maximum: 100 },
    originality: { type: 'integer', minimum: 0, maximum: 100 },
    thumbnailImpact: { type: 'integer', minimum: 0, maximum: 100 },
    amateurSignals: { type: 'array', maxItems: 10, items: { type: 'string' } },
    issues: { type: 'array', maxItems: 10, items: { type: 'string' } },
    revisionInstructions: { type: 'array', maxItems: 10, items: { type: 'string' } },
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

function safeString(value, max = 1200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanId(value, label = 'id') {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 220 || !/^[a-zA-Z0-9._-]+$/.test(id)) throw new HttpsError('invalid-argument', `Invalid ${label}.`);
  return id;
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

async function requireMarketingUser(uid) {
  const snapshot = await db.collection('users').doc(uid).get();
  const profile = snapshot.data() || {};
  if (!snapshot.exists || profile.active !== true || !ALLOWED_ROLES.has(profile.role)) {
    throw new HttpsError('permission-denied', 'Your DEMAC account does not have Marketing Agent access.');
  }
  return profile;
}

async function structuredResponse({ model, prompt, schemaName, schema, imageBuffers = [] }) {
  const content = [{ type: 'input_text', text: prompt }];
  for (const imageBuffer of imageBuffers) {
    const normalized = await normalizeSquare(imageBuffer, 1024);
    content.push({ type: 'input_image', image_url: `data:image/png;base64,${normalized.toString('base64')}`, detail: 'high' });
  }
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
  if (!response.ok) throw new Error(payload?.error?.message || text || `${model} HTTP ${response.status}`);
  const parsedText = outputText(payload);
  if (!parsedText) throw new Error(`${model} returned no structured output.`);
  return JSON.parse(parsedText);
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
  return {
    source,
    btu: `${btu} BTU`,
    price: `Afl. ${price}`,
    specs: [voltage, seer ? `SEER ${seer}` : '', inverter ? 'INVERTER' : ''].filter(Boolean).join(' • '),
  };
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
  const latestDoc = snapshot.docs.sort((a, b) => (Number(b.data()?.version) || 0) - (Number(a.data()?.version) || 0))[0];
  const latest = latestDoc?.data() || {};
  return [
    ...(Array.isArray(latest?.qa?.issues) ? latest.qa.issues : []),
    ...(Array.isArray(latest?.qa?.amateurSignals) ? latest.qa.amateurSignals : []),
  ].map((item) => safeString(item, 300)).filter(Boolean).slice(0, 10);
}

function explorationPrompt({ core, exact, issues }) {
  const { campaign, brand, hero } = core;
  const skills = buildSkillContext({ campaign, brand, previousIssues: issues });
  return [
    'You are the senior creative strategy board for a performance marketing agency.',
    'Your job is CONCEPT EXPLORATION, not final rendering. Think broadly before committing.',
    `Create exactly ${EXPLORATION_COUNT} genuinely different square paid-social concepts for DEMAC Professional Cooling Solutions in Aruba.`,
    'The concepts must differ at thumbnail level in composition, typography behavior, persuasion mechanism, crop, graphic language, and emotional tone.',
    'Do not create twelve variations of a blue left panel. Do not use app UI or dashboard components as a visual system.',
    'Use the real completed HVAC installation as proof. Respect all approved facts and do not invent copy, prices, warranty, specs, offers, or equipment.',
    'Explore territories such as editorial, cinematic, product hero, architectural, typography-led, documentary proof, minimal luxury, kinetic cooling, magazine-cover, offer-led when facts allow, or other original directions.',
    `Exact approved headline: ${JSON.stringify(exact.headline)}.`,
    `Exact approved supporting line: ${JSON.stringify(exact.subheadline)}.`,
    `Exact CTA: ${JSON.stringify(exact.cta)}.`,
    `Exact WhatsApp: ${JSON.stringify(exact.whatsapp)}.`,
    exact.offer ? `Approved offer: ${JSON.stringify(exact.offer)}.` : 'No approved offer is available; do not invent one.',
    exact.products.length ? `Approved product facts: ${JSON.stringify(exact.products)}.` : 'No approved product-price comparison is required for this campaign.',
    `Photo analysis: ${safeString(hero.analysisSummary, 900)}.`,
    '',
    skills,
    '',
    'Return concise but concrete art-direction concepts. The benchmarkDefinition must describe what would make the final work worthy of real paid-media spend.',
  ].join('\n');
}

async function createExploration(core, exact, heroBuffer, issues) {
  const result = await structuredResponse({
    model: ART_DIRECTOR_MODEL,
    prompt: explorationPrompt({ core, exact, issues }),
    schemaName: 'demac_creative_v3_exploration',
    schema: CONCEPT_SCHEMA,
    imageBuffers: [heroBuffer],
  });
  const byId = new Map((result.concepts || []).map((item) => [item.id, item]));
  result.concepts = CONCEPT_IDS.map((id) => byId.get(id)).filter(Boolean);
  if (result.concepts.length !== EXPLORATION_COUNT) throw new Error('V3 exploration did not return all required concepts.');
  return result;
}

function shortlistPrompt({ exploration, core, issues }) {
  const skills = buildSkillContext({ campaign: core.campaign, brand: core.brand, previousIssues: issues });
  return [
    'You are now the executive creative director reviewing a wall of rough concepts.',
    `Select exactly ${SHORTLIST_COUNT} concepts from the ${EXPLORATION_COUNT} candidates below for expensive final rendering.`,
    'Do NOT simply select the safest four. Select a portfolio with real visual contrast and strong paid-social potential.',
    'Reject concepts that are likely to become generic flyers, UI cards over a photo, or minor variations of one another.',
    'At least one selection should be a bold or unexpected visual territory while remaining credible for a professional HVAC company.',
    `Benchmark: ${exploration.benchmarkDefinition}`,
    '',
    skills,
    '',
    `CONCEPTS:\n${JSON.stringify(exploration.concepts)}`,
  ].join('\n');
}

async function createShortlist(exploration, core, issues) {
  const result = await structuredResponse({
    model: ART_DIRECTOR_MODEL,
    prompt: shortlistPrompt({ exploration, core, issues }),
    schemaName: 'demac_creative_v3_shortlist',
    schema: SHORTLIST_SCHEMA,
  });
  const conceptMap = new Map(exploration.concepts.map((item) => [item.id, item]));
  const ids = [...new Set((result.selected || []).map((item) => item.id))];
  if (ids.length !== SHORTLIST_COUNT || ids.some((id) => !conceptMap.has(id))) throw new Error('V3 shortlist must contain four distinct explored concepts.');
  return {
    creativeNorthStar: safeString(result.creativeNorthStar, 1200),
    selected: result.selected.map((selection) => ({
      ...conceptMap.get(selection.id),
      whySelected: safeString(selection.whySelected, 600),
      contrastFromOthers: safeString(selection.contrastFromOthers, 600),
    })),
  };
}

function productText(exact) {
  if (!exact.products.length) return '';
  return exact.products.map((item) => `${item.btu} — ${item.price}${item.specs ? ` — ${item.specs}` : ''}`).join(' | ');
}

function fullDesignPrompt({ concept, core, exact }) {
  const { campaign, brand, hero } = core;
  const skills = buildSkillContext({ campaign, brand });
  const footerPercent = Math.ceil((FOOTER_RESERVED_PX / OUTPUT_SIZE) * 100);
  return [
    'Create a COMPLETE premium 1:1 Facebook/Instagram paid advertisement by EDITING the supplied real DEMAC HVAC installation photograph.',
    'You are responsible for the whole visual composition: photography treatment, typography, hierarchy, graphic devices, depth, crop, CTA treatment, and commercial polish.',
    'This is NOT a background for later UI overlays. Do not leave generic boxes for another compositor. The finished image itself must look art-directed and campaign-ready.',
    'Preserve the real installed air conditioner, architecture, mounting workmanship, labels, and scene identity. Improve cleanliness, light, sharpness, color separation, and premium finish without fabricating equipment.',
    'Typography must behave like graphic design, not like an app interface. Use deliberate scale, spacing, alignment, contrast, and integration with the photograph.',
    'FORBIDDEN VISUAL LANGUAGE: dashboard cards, SaaS widgets, checklist cards, generic rounded white boxes, pill-heavy UI, web landing-page hero layouts, progress bars, or a large dark rectangle containing all text.',
    'Use one strong visual idea. Graphic elements may include editorial rules, intentional masking, crop tension, typographic scale contrast, integrated cooling light, architectural framing, premium custom tags, or other campaign-specific devices.',
    `The bottom ${footerPercent}% must be completely free of text, CTA, badges, prices, or important imagery because DEMAC's original footer will be added later. Do not recreate the DEMAC footer.`,
    '',
    `CONCEPT NAME: ${concept.name}`,
    `ARCHETYPE: ${concept.archetype}`,
    `PERSUASION: ${concept.persuasionMechanism}`,
    `THUMBNAIL IDEA: ${concept.thumbnailIdea}`,
    `COMPOSITION: ${concept.composition}`,
    `TYPOGRAPHY: ${concept.typographyDirection}`,
    `GRAPHIC LANGUAGE: ${concept.graphicLanguage}`,
    `PHOTO TREATMENT: ${concept.photoTreatment}`,
    `TEXT STRATEGY: ${concept.textStrategy}`,
    `WHY IT COULD WIN: ${concept.whyItCouldWin}`,
    '',
    'EXACT CUSTOMER-FACING TEXT — render these strings exactly and do not paraphrase:',
    `HEADLINE: ${JSON.stringify(exact.headline)}`,
    exact.subheadline ? `SUPPORTING LINE: ${JSON.stringify(exact.subheadline)}` : 'No supporting line is required.',
    `CTA: ${JSON.stringify(exact.cta)}`,
    `WHATSAPP: ${JSON.stringify(exact.whatsapp)}`,
    exact.offer ? `APPROVED OFFER: ${JSON.stringify(exact.offer)}` : 'NO OFFER TEXT.',
    exact.products.length ? `APPROVED PRODUCT COMPARISON: ${JSON.stringify(productText(exact))}` : 'NO PRICE OR PRODUCT-SPEC CARDS.',
    `BRAND NAME if needed: ${JSON.stringify(exact.brandName)}. Do not invent a logo.`,
    'Do not add any other claim, warranty, price, BTU, SEER, voltage, discount, phone number, slogan, or technical statement.',
    `Campaign objective: ${safeString(campaign.objective, 500)}.`,
    `Campaign angle: ${safeString(campaign.angle, 500)}.`,
    `Brand style: ${safeString(brand.style, 500)}.`,
    `Photo analysis: ${safeString(hero.analysisSummary, 700)}.`,
    '',
    skills,
    '',
    'Final quality bar: senior agency art direction suitable for spending real paid-media budget, not a Canva-beginner flyer or an AI mockup.',
  ].filter(Boolean).join('\n');
}

async function enforceFooterReserve(buffer) {
  const base = await sharp(buffer).rotate().resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover', position: 'attention' }).png().toBuffer();
  const footer = Buffer.from(`<svg width="${OUTPUT_SIZE}" height="${FOOTER_RESERVED_PX}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#ffffff"/></svg>`);
  return sharp(base).composite([{ input: footer, left: 0, top: OUTPUT_SIZE - FOOTER_RESERVED_PX }]).png().toBuffer();
}

function qaPrompt({ exact, campaign, concept, hard, stage }) {
  return [
    'You are a ruthless executive creative director and paid-social reviewer.',
    'Evaluate the supplied DEMAC ad against PROFESSIONAL PAID-SOCIAL AGENCY WORK, not against other AI drafts.',
    'The business owner will spend real money promoting this image. adSpendReady must be true only when you would confidently authorize media spend without apologizing for the design.',
    'First judge it at thumbnail size: does it look intentionally art-directed, distinctive, and immediately understandable?',
    'Then inspect typography, composition, craft, authenticity, brand distinctiveness, conversion clarity, exact copy, and footer safety.',
    'A technically correct design that still looks amateur MUST fail.',
    'Explicitly flag UI/dashboard aesthetics, generic white cards, pills, checklist modules, large dark copy rectangles, template-like symmetry, weak typography, or decorative overlays with no conceptual purpose.',
    `Expected exact headline: ${JSON.stringify(exact.headline)}.`,
    exact.subheadline ? `Expected supporting line: ${JSON.stringify(exact.subheadline)}.` : '',
    `Expected CTA: ${JSON.stringify(exact.cta)}.`,
    `Expected WhatsApp: ${JSON.stringify(exact.whatsapp)}.`,
    exact.offer ? `Only approved offer: ${JSON.stringify(exact.offer)}.` : 'No offer is approved.',
    exact.products.length ? `Only approved product facts: ${JSON.stringify(exact.products)}.` : 'No price/spec product facts are approved for this creative.',
    `Campaign type: ${safeString(campaign.campaignType, 100)}.`,
    `Concept intent: ${safeString(concept.name, 180)} — ${safeString(concept.thumbnailIdea, 500)}.`,
    `Evaluation stage: ${stage}.`,
    `Hard factual checks before vision QA: ${JSON.stringify(hard)}.`,
    '',
    ...QA_SKILL.map((item) => `- ${item}`),
    '',
    'Known amateur anti-patterns:',
    ...AMATEUR_ANTI_PATTERNS.map((item) => `- ${item}`),
    '',
    'Revision instructions must name concrete changes to composition, type, crop, hierarchy, graphic language, or factual repair.',
  ].filter(Boolean).join('\n');
}

function normalizeQa(parsed, hard) {
  const metrics = {};
  for (const key of [
    'overallScore', 'creativeDirection', 'composition', 'typography', 'professionalFinish',
    'brandDistinctiveness', 'conversionClarity', 'authenticity', 'textFidelity', 'footerSafety',
    'originality', 'thumbnailImpact',
  ]) metrics[key] = Number(parsed[key]) || 0;
  const amateurSignals = Array.isArray(parsed.amateurSignals)
    ? parsed.amateurSignals.map((item) => safeString(item, 320)).filter(Boolean).slice(0, 10)
    : [];
  const benchmarkPass = parsed.benchmarkLevel === 'agency' || parsed.benchmarkLevel === 'top_tier';
  const scorePass = metrics.overallScore >= 90
    && metrics.creativeDirection >= 88
    && metrics.composition >= 88
    && metrics.typography >= 86
    && metrics.professionalFinish >= 88
    && metrics.brandDistinctiveness >= 82
    && metrics.conversionClarity >= 84
    && metrics.authenticity >= 90
    && metrics.textFidelity >= 92
    && metrics.footerSafety >= 98
    && metrics.thumbnailImpact >= 86;
  const pass = hard.allPassed
    && parsed.adSpendReady === true
    && parsed.visibleTextExact === true
    && parsed.inventedFacts === false
    && benchmarkPass
    && amateurSignals.length === 0
    && scorePass;
  const baseSelection = Math.round(
    metrics.creativeDirection * 0.16
    + metrics.composition * 0.14
    + metrics.typography * 0.12
    + metrics.professionalFinish * 0.14
    + metrics.brandDistinctiveness * 0.10
    + metrics.conversionClarity * 0.10
    + metrics.thumbnailImpact * 0.10
    + metrics.originality * 0.06
    + metrics.authenticity * 0.04
    + metrics.textFidelity * 0.02
    + metrics.footerSafety * 0.02,
  );
  const benchmarkBonus = parsed.benchmarkLevel === 'top_tier' ? 8 : parsed.benchmarkLevel === 'agency' ? 4 : parsed.benchmarkLevel === 'professional' ? 0 : -12;
  const amateurPenalty = amateurSignals.length ? Math.min(30, amateurSignals.length * 8) : 0;
  const selectionScore = Math.max(0, Math.min(100, baseSelection + benchmarkBonus - amateurPenalty));
  return {
    source: 'openai_vision_v3_benchmark',
    status: pass ? 'passed' : 'failed',
    score: metrics.overallScore,
    overallScore: metrics.overallScore,
    selectionScore,
    benchmarkLevel: parsed.benchmarkLevel,
    adSpendReady: Boolean(parsed.adSpendReady),
    visibleTextExact: Boolean(parsed.visibleTextExact),
    inventedFacts: Boolean(parsed.inventedFacts),
    ...metrics,
    amateurSignals,
    issues: Array.isArray(parsed.issues) ? parsed.issues.map((item) => safeString(item, 320)).filter(Boolean).slice(0, 10) : [],
    revisionInstructions: Array.isArray(parsed.revisionInstructions) ? parsed.revisionInstructions.map((item) => safeString(item, 360)).filter(Boolean).slice(0, 10) : [],
    hardChecks: hard,
  };
}

async function visualQa(buffer, exact, campaign, concept, hard, stage) {
  const parsed = await structuredResponse({
    model: QA_MODEL,
    prompt: qaPrompt({ exact, campaign, concept, hard, stage }),
    schemaName: `demac_creative_v3_qa_${stage.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
    schema: QA_SCHEMA,
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

async function renderShortlistedConcept({ concept, core, exact, heroBuffer, hard, sessionId, creativeId, index }) {
  const raw = await generateFullDesign({ sourceBuffer: heroBuffer, prompt: fullDesignPrompt({ concept, core, exact }) });
  const rendered = await enforceFooterReserve(raw);
  const qa = await visualQa(rendered, exact, core.campaign, concept, hard, 'shortlist');
  const id = `final_${index + 1}_${concept.id}`;
  const uploaded = await saveImage(`marketing/generated/${sessionId}/${creativeId}-${id}.png`, rendered, {
    sessionId,
    assetId: creativeId,
    variant: id,
    stage: 'shortlist',
    sourceHeroAssetId: core.hero.id,
    imageModel: OPENAI_IMAGE_MODEL,
    builderVersion: BUILDER_VERSION,
  });
  return {
    id,
    conceptId: concept.id,
    name: safeString(concept.name, 180),
    rationale: safeString(concept.whySelected || concept.whyItCouldWin, 900),
    stage: 'shortlist',
    parentVariantId: '',
    imageStoragePath: uploaded.path,
    imageUrl: uploaded.url,
    imageModel: OPENAI_IMAGE_MODEL,
    selectionScore: qa.selectionScore,
    revised: false,
    layout: {
      compositionTemplate: safeString(concept.archetype, 120),
      graphicLanguage: safeString(concept.graphicLanguage, 300),
      typographyDirection: safeString(concept.typographyDirection, 300),
      persuasionMechanism: safeString(concept.persuasionMechanism, 300),
      thumbnailIdea: safeString(concept.thumbnailIdea, 400),
    },
    qa,
    _buffer: rendered,
    _concept: concept,
  };
}

function refinementPrompt({ candidate, exact }) {
  const issues = [...(candidate.qa.amateurSignals || []), ...(candidate.qa.issues || [])].slice(0, 12);
  const instructions = (candidate.qa.revisionInstructions || []).slice(0, 10);
  return [
    'Refine this existing DEMAC paid-social advertisement as a senior art director doing the final agency polish pass.',
    'Keep the successful core concept and real installation, but substantially fix every weakness identified by QA.',
    'Do not regress into UI cards, dashboard components, generic rounded rectangles, or a simple overlay-on-photo composition.',
    'Preserve or improve typographic craft, scale contrast, integrated graphic language, crop, depth, and paid-social thumbnail impact.',
    'All visible customer-facing text must remain exact. Remove corrupted or invented text rather than improvising.',
    `HEADLINE: ${JSON.stringify(exact.headline)}.`,
    exact.subheadline ? `SUPPORTING LINE: ${JSON.stringify(exact.subheadline)}.` : '',
    `CTA: ${JSON.stringify(exact.cta)}.`,
    `WHATSAPP: ${JSON.stringify(exact.whatsapp)}.`,
    exact.offer ? `APPROVED OFFER: ${JSON.stringify(exact.offer)}.` : 'NO OFFER TEXT.',
    exact.products.length ? `APPROVED PRODUCTS: ${JSON.stringify(productText(exact))}.` : 'NO PRICE OR SPEC CARDS.',
    `Keep the bottom ${Math.ceil((FOOTER_RESERVED_PX / OUTPUT_SIZE) * 100)}% completely free for the original footer.`,
    issues.length ? `QA problems to eliminate: ${issues.join('; ')}.` : 'No blocking issue list was returned; improve the professional finish and distinctiveness further.',
    instructions.length ? `Specific revision instructions: ${instructions.join('; ')}.` : '',
    'The output must look like a final campaign asset that a senior marketer would approve for paid media.',
  ].filter(Boolean).join('\n');
}

async function refineCandidate({ candidate, core, exact, hard, sessionId, creativeId, index }) {
  const raw = await refineFullDesign({ currentBuffer: candidate._buffer, prompt: refinementPrompt({ candidate, exact }) });
  const rendered = await enforceFooterReserve(raw);
  const qa = await visualQa(rendered, exact, core.campaign, candidate._concept, hard, 'refinement');
  const id = `refined_${index + 1}_${candidate.conceptId}`;
  const uploaded = await saveImage(`marketing/generated/${sessionId}/${creativeId}-${id}.png`, rendered, {
    sessionId,
    assetId: creativeId,
    variant: id,
    stage: 'refined',
    parentVariantId: candidate.id,
    sourceHeroAssetId: core.hero.id,
    imageModel: OPENAI_IMAGE_MODEL,
    builderVersion: BUILDER_VERSION,
  });
  return {
    id,
    conceptId: candidate.conceptId,
    name: `${candidate.name} · Refined`,
    rationale: candidate.rationale,
    stage: 'refined',
    parentVariantId: candidate.id,
    imageStoragePath: uploaded.path,
    imageUrl: uploaded.url,
    imageModel: OPENAI_IMAGE_MODEL,
    selectionScore: qa.selectionScore,
    revised: true,
    layout: candidate.layout,
    qa,
    _buffer: rendered,
    _concept: candidate._concept,
  };
}

async function finalJury(a, b, exact, campaign) {
  const prompt = [
    'You are the final executive creative director choosing between two finished DEMAC paid-social ads.',
    'Image 1 is Candidate A. Image 2 is Candidate B.',
    'Choose the one you would actually spend media budget on, using professional agency standards rather than rubric averaging.',
    'Prioritize thumbnail impact, art direction, typography, composition, authenticity, conversion clarity, exact text, and absence of amateur/template signals.',
    `Campaign objective: ${safeString(campaign.objective, 500)}.`,
    `Required headline: ${JSON.stringify(exact.headline)}; CTA: ${JSON.stringify(exact.cta)}; WhatsApp: ${JSON.stringify(exact.whatsapp)}.`,
    `Candidate A QA: ${JSON.stringify({ score: a.qa.score, benchmark: a.qa.benchmarkLevel, spendReady: a.qa.adSpendReady, amateurSignals: a.qa.amateurSignals })}.`,
    `Candidate B QA: ${JSON.stringify({ score: b.qa.score, benchmark: b.qa.benchmarkLevel, spendReady: b.qa.adSpendReady, amateurSignals: b.qa.amateurSignals })}.`,
    'Do not choose an image with corrupted required text or invented facts unless both candidates fail; explain the deciding weakness.',
  ].join('\n');
  const jury = await structuredResponse({
    model: ART_DIRECTOR_MODEL,
    prompt,
    schemaName: 'demac_creative_v3_final_jury',
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
  const { _buffer, _concept, ...safe } = candidate;
  return safe;
}

async function buildCreative({ sessionId, uid, profile }) {
  const core = await loadCore(sessionId);
  const { campaign, brand, hero } = core;
  if (campaign.papiamentoValidationStatus !== 'passed') {
    throw new HttpsError('failed-precondition', 'Papiamento copy must pass validation before creative generation.');
  }
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

  await setProgress(sessionId, 'prepare', 4, 'Preparing V3 campaign facts, real photo, and design skills…');
  const heroBuffer = await fetchImageBuffer(hero.downloadUrl);
  const issues = await previousIssues(sessionId);

  await setProgress(sessionId, 'explore', 10, `GPT-5.6 Sol is exploring ${EXPLORATION_COUNT} distinct creative territories…`);
  const exploration = await createExploration(core, exact, heroBuffer, issues);

  await setProgress(sessionId, 'shortlist', 20, `Creative Director is shortlisting ${SHORTLIST_COUNT} materially different concepts…`);
  const shortlist = await createShortlist(exploration, core, issues);

  await setProgress(sessionId, 'render_shortlist', 28, `Rendering ${SHORTLIST_COUNT} complete agency concepts with GPT Image 2…`, { totalVariants: SHORTLIST_COUNT });
  const initial = await Promise.all(shortlist.selected.map((concept, index) => renderShortlistedConcept({
    concept,
    core,
    exact,
    heroBuffer,
    hard,
    sessionId,
    creativeId,
    index,
  })));

  initial.sort((a, b) => b.selectionScore - a.selectionScore);
  const topTwo = initial.slice(0, REFINEMENT_COUNT);
  await setProgress(sessionId, 'refine', 70, `Refining the top ${REFINEMENT_COUNT} concepts from benchmark QA feedback…`, { completedVariants: initial.length });
  const refined = await Promise.all(topTwo.map((candidate, index) => refineCandidate({
    candidate,
    core,
    exact,
    hard,
    sessionId,
    creativeId,
    index,
  })));

  await setProgress(sessionId, 'jury', 90, 'Executive Creative Director is choosing the final paid-media winner…');
  refined.sort((a, b) => b.selectionScore - a.selectionScore);
  const jury = refined.length >= 2
    ? await finalJury(refined[0], refined[1], exact, campaign)
    : { winner: refined[0] || initial[0], spendConfidence: 0, reason: 'Single finalist.', loserWeakness: '' };
  let selected = jury.winner;
  if (!selected) throw new HttpsError('internal', 'Creative Engine V3 did not produce a final candidate.');

  // If the jury chose a clearly invalid finalist, prefer any candidate that actually passed the hard V3 benchmark gate.
  const allCandidates = [...initial, ...refined];
  const passedCandidates = allCandidates.filter((item) => item.qa.status === 'passed').sort((a, b) => b.selectionScore - a.selectionScore);
  if (selected.qa.status !== 'passed' && passedCandidates.length) selected = passedCandidates[0];

  await setProgress(sessionId, 'finalize', 97, 'Finalizing V3 winner and preserving the complete creative exploration…');
  const now = new Date().toISOString();
  const status = selected.qa.status === 'passed' ? 'qa_passed' : 'qa_failed';
  const variants = allCandidates.map(publicVariant);
  const record = {
    id: creativeId,
    sessionId,
    campaignId: campaign.id,
    campaignType: campaign.campaignType,
    version,
    status,
    builderVersion: BUILDER_VERSION,
    heroAssetId: hero.id,
    imageStoragePath: selected.imageStoragePath,
    imageUrl: selected.imageUrl,
    width: OUTPUT_SIZE,
    height: OUTPUT_SIZE,
    reservedFooterPx: FOOTER_RESERVED_PX,
    renderTemplate: safeString(selected.layout?.compositionTemplate, 120) || 'v3_full_design',
    renderMode: 'ai_full_design_v3_explore_shortlist_refine',
    artDirectorModel: ART_DIRECTOR_MODEL,
    imageModel: OPENAI_IMAGE_MODEL,
    qaModel: QA_MODEL,
    providerManifest: providerManifest(),
    designIntelligence: {
      explorationCount: EXPLORATION_COUNT,
      shortlistCount: SHORTLIST_COUNT,
      refinementCount: REFINEMENT_COUNT,
      strategyDiagnosis: safeString(exploration.strategyDiagnosis, 1200),
      benchmarkDefinition: safeString(exploration.benchmarkDefinition, 1200),
      creativeNorthStar: safeString(shortlist.creativeNorthStar, 1200),
      exploredConcepts: exploration.concepts.map((item) => ({
        id: item.id,
        name: safeString(item.name, 180),
        archetype: safeString(item.archetype, 180),
        thumbnailIdea: safeString(item.thumbnailIdea, 500),
        whyItCouldWin: safeString(item.whyItCouldWin, 600),
      })),
      finalJury: {
        spendConfidence: jury.spendConfidence,
        reason: jury.reason,
        loserWeakness: jury.loserWeakness,
      },
    },
    artDirection: {
      campaignSummary: safeString(exploration.strategyDiagnosis, 1000),
      creativeNorthStar: safeString(shortlist.creativeNorthStar, 1000),
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
        ? 'V3 agency creative selected and ad-spend benchmark passed.'
        : 'V3 exploration completed; best candidate still does not meet the paid-media benchmark.',
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
    console.error('Marketing Creative Engine V3 failed', error);
    throw new HttpsError('internal', message);
  }
});

exports.approveMarketingCreative = onCall({ region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Firebase authentication is required.');
  const profile = await requireMarketingUser(request.auth.uid);
  const creativeId = cleanId(request.data?.creativeId, 'creative id');
  const ref = db.collection('marketingCreatives').doc(creativeId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Creative was not found.');
  const creative = { id: snapshot.id, ...snapshot.data() };
  if (creative.status === 'approved' && creative.approvedUrl) return { creativeId, status: 'approved', approvedUrl: creative.approvedUrl };
  if (creative.qa?.status !== 'passed' || creative.status !== 'qa_passed' || creative.qa?.adSpendReady !== true) {
    throw new HttpsError('failed-precondition', 'Creative must pass V3 paid-media benchmark QA before approval.');
  }
  if (creative.papiamentoValidationStatus !== 'passed') throw new HttpsError('failed-precondition', 'Papiamento copy must pass validation before approval.');
  const bucket = storage.bucket();
  const source = bucket.file(creative.imageStoragePath);
  const approvedPath = `marketing/approved/${creative.sessionId}/${creativeId}.png`;
  const destination = bucket.file(approvedPath);
  await source.copy(destination);
  const token = randomUUID();
  await destination.setMetadata({
    contentType: 'image/png',
    cacheControl: 'private,max-age=3600',
    metadata: {
      firebaseStorageDownloadTokens: token,
      sessionId: creative.sessionId,
      assetId: creativeId,
      uploadedByUid: request.auth.uid,
      variant: 'approved',
      builderVersion: creative.builderVersion || BUILDER_VERSION,
    },
  });
  const approvedUrl = storageDownloadUrl(bucket.name, approvedPath, token);
  const now = new Date().toISOString();
  await ref.set({
    status: 'approved',
    approvedStoragePath: approvedPath,
    approvedUrl,
    approvedAt: now,
    approvedByUserId: request.auth.uid,
    approvedByName: safeString(profile.name || profile.displayName || profile.email, 160),
    updatedAt: now,
  }, { merge: true });
  return { creativeId, status: 'approved', approvedUrl };
});

exports.__marketingCreativeBuilderV3Test = {
  ART_DIRECTOR_MODEL,
  QA_MODEL,
  IMAGE_MODEL: OPENAI_IMAGE_MODEL,
  BUILDER_VERSION,
  EXPLORATION_COUNT,
  SHORTLIST_COUNT,
  REFINEMENT_COUNT,
  FOOTER_RESERVED_PX,
};
