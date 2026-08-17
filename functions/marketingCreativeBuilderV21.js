const { randomUUID } = require('node:crypto');
const { getApp, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { defineSecret } = require('firebase-functions/params');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const sharp = require('sharp');

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const storage = getStorage(app);
const openAiApiKey = defineSecret('OPENAI_API_KEY');

const ALLOWED_ROLES = new Set(['admin', 'office']);
const ART_DIRECTOR_MODEL = 'gpt-5.6-sol';
const QA_MODEL = 'gpt-5.6-sol';
const IMAGE_MODEL = 'gpt-image-2';
const BUILDER_VERSION = 'V2.1';
const OUTPUT_SIZE = 1080;
const FOOTER_RESERVED_PX = 156;
const VARIANT_IDS = ['premium_clean', 'sales_impact', 'social_proof'];

const ART_DIRECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['campaignSummary', 'creativeNorthStar', 'concepts'],
  properties: {
    campaignSummary: { type: 'string' },
    creativeNorthStar: { type: 'string' },
    concepts: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'rationale', 'imagePrompt', 'photoFocus', 'imageTreatment', 'safeTextSide', 'visualEnergy', 'avoid'],
        properties: {
          id: { type: 'string', enum: VARIANT_IDS },
          name: { type: 'string' },
          rationale: { type: 'string' },
          imagePrompt: { type: 'string' },
          photoFocus: { type: 'string', enum: ['equipment', 'installation', 'environment', 'people'] },
          imageTreatment: { type: 'string' },
          safeTextSide: { type: 'string', enum: ['left', 'right', 'center'] },
          visualEnergy: { type: 'string', enum: ['restrained', 'balanced', 'bold'] },
          avoid: { type: 'array', maxItems: 10, items: { type: 'string' } },
        },
      },
    },
  },
};

const QA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'overallScore', 'mobileLegibility', 'visualHierarchy', 'contrast', 'footerClearance',
    'authenticity', 'professionalism', 'creativeQuality', 'scrollStoppingPower', 'agencyFeel',
    'photoIntegration', 'ctaProminence', 'visualSophistication', 'commercialCompleteness',
    'layoutRichness', 'brandSystemCoherence', 'offerClarity', 'pass', 'issues', 'revisionInstructions',
  ],
  properties: {
    overallScore: { type: 'integer', minimum: 0, maximum: 100 },
    mobileLegibility: { type: 'integer', minimum: 0, maximum: 100 },
    visualHierarchy: { type: 'integer', minimum: 0, maximum: 100 },
    contrast: { type: 'integer', minimum: 0, maximum: 100 },
    footerClearance: { type: 'integer', minimum: 0, maximum: 100 },
    authenticity: { type: 'integer', minimum: 0, maximum: 100 },
    professionalism: { type: 'integer', minimum: 0, maximum: 100 },
    creativeQuality: { type: 'integer', minimum: 0, maximum: 100 },
    scrollStoppingPower: { type: 'integer', minimum: 0, maximum: 100 },
    agencyFeel: { type: 'integer', minimum: 0, maximum: 100 },
    photoIntegration: { type: 'integer', minimum: 0, maximum: 100 },
    ctaProminence: { type: 'integer', minimum: 0, maximum: 100 },
    visualSophistication: { type: 'integer', minimum: 0, maximum: 100 },
    commercialCompleteness: { type: 'integer', minimum: 0, maximum: 100 },
    layoutRichness: { type: 'integer', minimum: 0, maximum: 100 },
    brandSystemCoherence: { type: 'integer', minimum: 0, maximum: 100 },
    offerClarity: { type: 'integer', minimum: 0, maximum: 100 },
    pass: { type: 'boolean' },
    issues: { type: 'array', maxItems: 10, items: { type: 'string' } },
    revisionInstructions: { type: 'array', maxItems: 8, items: { type: 'string' } },
  },
};

function cleanId(value, label = 'id') {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 220 || !/^[a-zA-Z0-9._-]+$/.test(id)) throw new HttpsError('invalid-argument', `Invalid ${label}.`);
  return id;
}

function safeString(value, max = 1200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

function sentenceParts(value) {
  return safeString(value, 900)
    .split(/(?<=[.!?])\s+|\s+[•|]\s+/)
    .map((part) => part.trim().replace(/[.!?]+$/, ''))
    .filter(Boolean);
}

function exactTextForCreative(campaign, brand) {
  const headline = safeString(campaign.copy?.headline, 100) || 'DEMAC Professional Cooling Solutions';
  const subheadline = safeString(campaign.copy?.subheadline, 180);
  const primaryText = safeString(campaign.copy?.primaryText, 700);
  const cta = safeString(campaign.copy?.cta, 80) || 'WhatsApp nos awe mes';
  const whatsapp = safeString(brand.whatsapp, 40);
  const products = campaign.campaignType === 'airco_sales'
    ? (Array.isArray(brand.approvedProducts) ? brand.approvedProducts : []).map(parseApprovedProduct).filter(Boolean).slice(0, 3)
    : [];
  const offer = campaign.factPolicy?.priceOrPromoIncluded === true && Array.isArray(brand.approvedOffers) && brand.approvedOffers.length
    ? safeString(brand.approvedOffers[0], 160)
    : '';
  const candidates = [...sentenceParts(subheadline), ...sentenceParts(primaryText)]
    .filter((item) => !/whatsapp/i.test(item))
    .filter((item) => item.toLocaleLowerCase('en-US') !== headline.toLocaleLowerCase('en-US'));
  const supportPoints = [...new Set(candidates)].slice(0, 3).map((item) => safeString(item, 130));
  return {
    headline,
    subheadline,
    primaryText,
    cta,
    whatsapp,
    products,
    offer,
    eyebrow: safeString(brand.brandName || 'DEMAC', 80) || 'DEMAC',
    proofLabel: campaign.campaignType === 'otro_cliente_contento' ? 'OTRO CLIENTE CONTENTO' : safeString(brand.brandName || 'DEMAC', 80) || 'DEMAC',
    supportPoints,
  };
}

function hardChecks({ campaign, brand, exact }) {
  const approvedProducts = new Set(Array.isArray(brand.approvedProducts) ? brand.approvedProducts : []);
  const productFactsApproved = exact.products.every((product) => approvedProducts.has(product.source));
  const exactWhatsapp = exact.whatsapp === safeString(brand.whatsapp, 40);
  const languagePassed = campaign.papiamentoValidationStatus === 'passed';
  const footerReserved = FOOTER_RESERVED_PX >= 140;
  return {
    brandCenterLive: true,
    languagePassed,
    exactWhatsapp,
    productFactsApproved,
    footerReserved,
    allPassed: languagePassed && exactWhatsapp && productFactsApproved && footerReserved,
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

async function fetchImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new HttpsError('failed-precondition', `Hero image could not be downloaded (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) throw new HttpsError('failed-precondition', 'Hero image is empty or too large.');
  return buffer;
}

async function normalizeHero(buffer) {
  return sharp(buffer).rotate().resize(1024, 1024, { fit: 'cover', position: 'attention' }).png().toBuffer();
}

async function structuredResponse({ model, prompt, schemaName, schema, imageBuffer }) {
  const content = [{ type: 'input_text', text: prompt }];
  if (imageBuffer) content.push({ type: 'input_image', image_url: `data:image/png;base64,${imageBuffer.toString('base64')}`, detail: 'high' });
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

function artDirectorPrompt({ campaign, brand, hero, previousIssues }) {
  return [
    'You are the senior paid-social art director for DEMAC Professional Cooling Solutions in Aruba.',
    'Direct three materially different premium Facebook/Instagram square advertising backgrounds around the supplied REAL DEMAC work photo.',
    'The photo enhancement quality is already important and must be preserved: clean the scene, improve light, color separation, crispness and commercial polish while keeping the real installation authentic.',
    'The deterministic compositor will add a complete commercial design system afterward: brand kicker, headline, support/proof modules, CTA, and when applicable three approved product/price cards.',
    'Therefore create purposeful negative space for those modules instead of generating a finished text layout yourself.',
    'Never generate words, letters, numbers, prices, phone numbers, logos, badges, labels or pseudo-text.',
    'Never solve the design as one large dark rectangle over the photo. The background should already feel art-directed through lighting, depth, framing, subtle royal-blue energy and visual flow.',
    `Keep the bottom ${FOOTER_RESERVED_PX}px of 1080px visually quiet for the original DEMAC footer.`,
    'Create exactly three distinct concepts:',
    'premium_clean = editorial premium composition, elegant depth, aspirational HVAC campaign, sophisticated negative space.',
    'sales_impact = bold conversion composition with more energy and strong space for modular offer/benefit cards, still premium and not cheap.',
    'social_proof = authentic completed-work storytelling; the real installation remains dominant and credible while design framing makes it campaign-ready.',
    `Campaign type: ${safeString(campaign.campaignType, 80)}.`,
    `Objective: ${safeString(campaign.objective, 500)}.`,
    `Angle: ${safeString(campaign.angle, 500)}.`,
    `Existing visual direction: ${safeString(campaign.visualDirection?.heroTreatment, 500)}.`,
    `Brand style: ${safeString(brand.style, 500)}.`,
    `Brand colors: ${safeString(brand.primaryColor, 80)} and ${safeString(brand.secondaryColor, 80)}.`,
    `Photo analysis: ${safeString(hero.analysisSummary, 700)}.`,
    previousIssues?.length ? `Previous rejected-creative feedback: ${previousIssues.join('; ')}.` : '',
    'Return practical art direction for GPT Image 2 only. Do not write customer-facing copy.',
  ].filter(Boolean).join('\n');
}

async function createArtDirection(core, heroBuffer, previousIssues) {
  const normalized = await normalizeHero(heroBuffer);
  const direction = await structuredResponse({
    model: ART_DIRECTOR_MODEL,
    prompt: artDirectorPrompt({ ...core, previousIssues }),
    schemaName: 'demac_marketing_art_direction_v21',
    schema: ART_DIRECTION_SCHEMA,
    imageBuffer: normalized,
  });
  const byId = new Map((direction.concepts || []).map((concept) => [concept.id, concept]));
  direction.concepts = VARIANT_IDS.map((id) => byId.get(id)).filter(Boolean);
  if (direction.concepts.length !== 3) throw new Error('Art Director did not return all three required V2.1 concepts.');
  return direction;
}

function compositionInstruction(conceptId) {
  if (conceptId === 'sales_impact') {
    return 'Build a more energetic paid-ad background: strong upper visual frame, premium royal-blue directional light, clean central/right product focus, and clear empty zones around the middle-lower area for three modular commercial cards. Avoid clutter.';
  }
  if (conceptId === 'social_proof') {
    return 'Keep the real job photograph dominant and believable. Use elegant edge framing, depth, subtle cooling highlights and clean left/top negative space for a proof badge and headline. Preserve a documentary completed-work feeling with premium advertising polish.';
  }
  return 'Build an editorial premium background with restrained royal-blue light shaping, crisp clean detail, sophisticated depth, and elegant left/top negative space for typography and trust modules. Keep the installed equipment visually important.';
}

function imagePrompt({ concept, campaign, brand, hero, revisionInstructions = [] }) {
  return [
    'Edit this real DEMAC HVAC installation photo into a premium agency-quality square advertising BACKGROUND.',
    'Preserve the actual installed air conditioner, architecture, people and scene identity with high fidelity. Do not invent or duplicate HVAC equipment, alter faces, replace labels, or fabricate installations.',
    'Improve the real photo: cleaner color, higher perceived sharpness, commercial lighting, controlled contrast, realistic fresh-air atmosphere and premium depth.',
    compositionInstruction(concept.id),
    'Generate NO words, letters, numbers, prices, phone numbers, logos, badges, fake labels or pseudo-text. Exact advertising modules are added after this image edit by deterministic code.',
    `Keep the bottom ${Math.round((FOOTER_RESERVED_PX / OUTPUT_SIZE) * 100)} percent visually quiet and uncluttered for the original DEMAC footer.`,
    `Concept: ${safeString(concept.name, 120)}.`,
    `Concept rationale: ${safeString(concept.rationale, 500)}.`,
    `Creative direction: ${safeString(concept.imagePrompt, 1200)}.`,
    `Image treatment: ${safeString(concept.imageTreatment, 700)}.`,
    `Photo focus: ${safeString(concept.photoFocus, 80)}.`,
    `Safe text side: ${safeString(concept.safeTextSide, 30)}.`,
    `Visual energy: ${safeString(concept.visualEnergy, 30)}.`,
    `Campaign objective: ${safeString(campaign.objective, 500)}.`,
    `Campaign angle: ${safeString(campaign.angle, 500)}.`,
    `Brand style: ${safeString(brand.style, 500)}.`,
    `Photo analysis: ${safeString(hero.analysisSummary, 700)}.`,
    Array.isArray(concept.avoid) && concept.avoid.length ? `Avoid: ${concept.avoid.join('; ')}.` : '',
    revisionInstructions.length ? `QA revision requirements: ${revisionInstructions.join('; ')}.` : '',
    'The background must already look like premium campaign photography before text is composited.',
  ].filter(Boolean).join('\n');
}

async function generateGptImage2(heroBuffer, prompt) {
  const normalized = await normalizeHero(heroBuffer);
  const form = new FormData();
  form.append('model', IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('image', new Blob([normalized], { type: 'image/png' }), 'demac-real-installation.png');
  form.append('size', '1024x1024');
  form.append('quality', 'high');
  form.append('output_format', 'png');
  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openAiApiKey.value()}` },
    body: form,
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {}
  const result = payload?.data?.[0]?.b64_json;
  if (!response.ok || !result) throw new Error(`GPT Image 2 failed (${response.status}): ${payload?.error?.message || text || 'No image returned.'}`);
  return Buffer.from(result, 'base64');
}

function wrapText(value, maxChars, maxLines) {
  const words = safeString(value, 600).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  return lines.slice(0, maxLines);
}

function textLines(lines, x, y, lineHeight, className, anchor = 'start') {
  return lines.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" class="${className}" text-anchor="${anchor}">${escapeXml(line)}</text>`).join('');
}

function commonDefs() {
  return `<defs>
    <linearGradient id="blueFade" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#071d3b" stop-opacity=".96"/><stop offset="68%" stop-color="#0c3d78" stop-opacity=".66"/><stop offset="100%" stop-color="#1769e0" stop-opacity="0"/></linearGradient>
    <linearGradient id="blueBand" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#061a37" stop-opacity=".94"/><stop offset="55%" stop-color="#0d4a97" stop-opacity=".88"/><stop offset="100%" stop-color="#1f78e8" stop-opacity=".62"/></linearGradient>
    <linearGradient id="goldCard" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fff6ce"/><stop offset="18%" stop-color="#e9c65a"/><stop offset="19%" stop-color="#0a2142"/><stop offset="100%" stop-color="#06172f"/></linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#00152c" flood-opacity=".30"/></filter>
    <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#00152c" flood-opacity=".22"/></filter>
  </defs>`;
}

function baseStyles() {
  return `<style>
    .kicker{font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:17px;letter-spacing:2.1px;fill:#fff}
    .headline{font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:62px;letter-spacing:-1.8px;fill:#fff;paint-order:stroke;stroke:#00152c;stroke-opacity:.18;stroke-width:2}
    .headlineDark{font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:60px;letter-spacing:-1.6px;fill:#082348}
    .sub{font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:27px;fill:#eef7ff}
    .subDark{font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:25px;fill:#294765}
    .support{font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:20px;fill:#102c4c}
    .supportSmall{font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:17px;fill:#37536f}
    .ctaLabel{font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:17px;fill:#dff9ec;letter-spacing:.4px}
    .ctaMain{font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:29px;fill:#fff}
    .tagBtu{font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:18px;fill:#06172f}
    .tagPrice{font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:35px;fill:#fff}
    .tagSpec{font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:13px;fill:#d6e8ff}
    .offer{font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:20px;fill:#0b294b}
  </style>`;
}

function kickerSvg(text, x, y, width = 170, dark = true) {
  return `<g filter="url(#softShadow)"><rect x="${x}" y="${y}" width="${width}" height="42" rx="21" fill="${dark ? '#0b4da4' : '#ffffff'}" fill-opacity=".96"/><text x="${x + width / 2}" y="${y + 28}" class="kicker" text-anchor="middle" ${dark ? '' : 'style="fill:#0b4da4"'}>${escapeXml(text)}</text></g>`;
}

function checkMark(x, y) {
  return `<g><circle cx="${x}" cy="${y}" r="13" fill="#1769e0"/><path d="M${x - 6} ${y} l4 5 l9 -11" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

function supportCardSvg(text, x, y, w = 310, h = 92, style = 'light') {
  const lines = wrapText(text, Math.max(21, Math.floor(w / 12)), 2);
  const dark = style === 'dark';
  return `<g filter="url(#softShadow)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${dark ? '#08264c' : '#ffffff'}" fill-opacity="${dark ? '.88' : '.94'}" stroke="${dark ? '#6eb7ff' : '#d8e7f7'}" stroke-opacity=".7"/><rect x="${x}" y="${y}" width="6" height="${h}" rx="3" fill="#2d8cff"/>${checkMark(x + 31, y + 32)}${textLines(lines, x + 55, y + 32, 25, dark ? 'supportSmall' : 'support', 'start').replaceAll('class="supportSmall"', 'class="supportSmall" style="fill:#eff7ff"')}</g>`;
}

function priceCardSvg(product, x, y, w = 302) {
  return `<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${w}" height="142" rx="24" fill="url(#goldCard)" stroke="#f5cf61" stroke-width="3"/><text x="${x + w / 2}" y="${y + 29}" class="tagBtu" text-anchor="middle">${escapeXml(product.btu)}</text><line x1="${x + 18}" y1="${y + 43}" x2="${x + w - 18}" y2="${y + 43}" stroke="#f0ca59" stroke-opacity=".55"/><text x="${x + w / 2}" y="${y + 92}" class="tagPrice" text-anchor="middle">${escapeXml(product.price)}</text><text x="${x + w / 2}" y="${y + 122}" class="tagSpec" text-anchor="middle">${escapeXml(product.specs)}</text></g>`;
}

function offerSvg(text, x, y, w = 610) {
  if (!text) return '';
  return `<g filter="url(#softShadow)"><rect x="${x}" y="${y}" width="${w}" height="54" rx="27" fill="#fff7d6" stroke="#e9c65a"/><text x="${x + 28}" y="${y + 35}" class="offer">${escapeXml(text)}</text></g>`;
}

function ctaSvg(exact, x, y, w = 700) {
  const ctaLine = safeString(exact.cta, 70);
  const phone = safeString(exact.whatsapp, 40);
  return `<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${w}" height="82" rx="30" fill="#10a766"/><circle cx="${x + 43}" cy="${y + 41}" r="23" fill="#fff"/><path d="M${x + 33} ${y + 31} c4 -4 8 -4 11 0 l4 5 c2 3 1 6 -2 8 l-3 2 c4 7 9 12 16 16 l2 -3 c2 -3 5 -4 8 -2 l5 4 c4 3 4 7 0 11 c-4 4 -10 6 -16 4 c-14 -5 -29 -20 -34 -34 c-2 -5 1 -8 9 -11z" fill="#10a766" transform="scale(.56) translate(${x * .79 + 32} ${y * .79 + 34})" opacity="0"/><text x="${x + 82}" y="${y + 30}" class="ctaLabel">${escapeXml(ctaLine)}</text><text x="${x + 82}" y="${y + 63}" class="ctaMain">${escapeXml(phone)}</text></g>`;
}

function footerSvg() {
  return `<rect x="0" y="${OUTPUT_SIZE - FOOTER_RESERVED_PX}" width="1080" height="${FOOTER_RESERVED_PX}" fill="#fff"/>`;
}

function salesModules(exact, y) {
  if (exact.products.length) return exact.products.slice(0, 3).map((product, index) => priceCardSvg(product, 47 + index * 329, y, 300)).join('');
  const points = exact.supportPoints.length ? exact.supportPoints : [exact.subheadline].filter(Boolean);
  const modules = [
    { title: exact.eyebrow, body: safeString(exact.primaryText || exact.subheadline, 95) },
    { title: points[0] || exact.headline, body: points[1] || safeString(exact.subheadline, 95) },
    { title: 'WhatsApp', body: exact.whatsapp },
  ];
  return modules.map((item, index) => {
    const x = 47 + index * 329;
    const titleLines = wrapText(item.title, 19, 1);
    const bodyLines = wrapText(item.body, 28, 2);
    return `<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="300" height="142" rx="24" fill="#fff" fill-opacity=".95" stroke="#d4e7fb"/><rect x="${x}" y="${y}" width="300" height="9" rx="4" fill="#1769e0"/>${textLines(titleLines, x + 24, y + 44, 24, 'support', 'start')}${textLines(bodyLines, x + 24, y + 78, 23, 'supportSmall', 'start')}</g>`;
  }).join('');
}

function premiumOverlay(exact) {
  const headline = wrapText(exact.headline, 24, 2);
  const sub = wrapText(exact.subheadline, 38, 2);
  const support = exact.supportPoints.slice(0, 2);
  const supportY = 436;
  const productY = 632;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">${commonDefs()}${baseStyles()}<path d="M0 0 H700 C625 170 690 320 590 470 C510 590 415 630 0 690 Z" fill="url(#blueFade)"/>${kickerSvg(exact.eyebrow, 56, 52, 170, true)}${textLines(headline, 56, 154, 68, 'headline')}${textLines(sub, 58, 310, 37, 'sub')}<line x1="58" y1="397" x2="220" y2="397" stroke="#58b4ff" stroke-width="7" stroke-linecap="round"/>${support.map((item, index) => supportCardSvg(item, 56, supportY + index * 103, 430, 90, 'light')).join('')}${exact.products.length ? salesModules(exact, productY) : ''}${exact.offer ? offerSvg(exact.offer, 56, exact.products.length ? 786 : 650, 640) : ''}${ctaSvg(exact, 56, 818, 700)}${footerSvg()}</svg>`;
}

function impactOverlay(exact) {
  const headline = wrapText(exact.headline, 26, 2);
  const sub = wrapText(exact.subheadline, 42, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">${commonDefs()}${baseStyles()}<path d="M0 0 H1080 V290 L850 352 L0 310 Z" fill="url(#blueBand)"/><path d="M0 312 L1080 292" stroke="#f0c95b" stroke-width="7" stroke-opacity=".9"/>${kickerSvg(exact.eyebrow, 55, 42, 170, false)}${textLines(headline, 55, 132, 66, 'headline')}${textLines(sub, 57, 270, 35, 'sub')}${salesModules(exact, 627)}${exact.offer ? offerSvg(exact.offer, 60, 786, 610) : ''}${ctaSvg(exact, 60, 818, 770)}${footerSvg()}</svg>`;
}

function socialOverlay(exact) {
  const headline = wrapText(exact.headline, 25, 2);
  const sub = wrapText(exact.subheadline, 36, 2);
  const firstSupport = exact.supportPoints[0] || exact.subheadline;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">${commonDefs()}${baseStyles()}<rect x="24" y="24" width="1032" height="872" rx="34" fill="none" stroke="#fff" stroke-opacity=".72" stroke-width="3"/><path d="M0 0 H600 C535 130 570 245 492 375 C425 485 325 520 0 560 Z" fill="url(#blueFade)"/>${kickerSvg(exact.proofLabel, 54, 52, exact.proofLabel.length > 16 ? 260 : 170, true)}${textLines(headline, 54, 150, 66, 'headline')}${textLines(sub, 56, 300, 35, 'sub')}${firstSupport ? supportCardSvg(firstSupport, 56, 430, 390, 92, 'light') : ''}<g filter="url(#softShadow)"><rect x="735" y="642" width="285" height="112" rx="26" fill="#08264c" fill-opacity=".88"/><text x="760" y="679" class="kicker" style="font-size:14px">${escapeXml(exact.eyebrow)}</text><text x="760" y="718" class="ctaMain" style="font-size:24px">${escapeXml(exact.whatsapp)}</text></g>${ctaSvg(exact, 56, 818, 700)}${footerSvg()}</svg>`;
}

function overlaySvg(exact, concept) {
  if (concept.id === 'sales_impact') return Buffer.from(impactOverlay(exact));
  if (concept.id === 'social_proof') return Buffer.from(socialOverlay(exact));
  return Buffer.from(premiumOverlay(exact));
}

async function renderCreative(backgroundBuffer, exact, concept) {
  const background = await sharp(backgroundBuffer).rotate().resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover', position: 'attention' }).png().toBuffer();
  return sharp(background).composite([{ input: overlaySvg(exact, concept), top: 0, left: 0 }]).png({ compressionLevel: 8 }).toBuffer();
}

function qaPrompt(exact, campaign, concept) {
  const salesRequirement = campaign.campaignType === 'airco_sales' && exact.products.length
    ? 'Because this is an airco sales campaign with approved products, the ad must visibly contain three coherent product/price cards with BTU, price and specifications.'
    : 'Because this is not a product-price campaign, the ad still needs multiple useful commercial modules: brand/proof treatment, supporting benefit/trust information and a strong WhatsApp CTA.';
  return [
    'You are the uncompromising executive creative director reviewing a paid social advertisement for DEMAC Professional Cooling Solutions.',
    'Judge the visible ad as if a professional agency were about to spend real Meta Ads budget on it.',
    'This V2.1 review specifically tests COMMERCIAL COMPOSITION, not only readability.',
    'Automatic fail: a photo with one large dark rectangle plus headline/subheadline and a basic CTA, even if clean and readable.',
    'A PASS requires a complete advertising system: strong visual hierarchy, integrated brand cue, intentional support/proof/offer modules, obvious conversion path, premium spacing, controlled density, professional modular design and real-photo integration.',
    salesRequirement,
    'The commercial modules must feel intentionally designed rather than pasted-on generic boxes. Reward layered hierarchy, varied scale, coherent shapes, depth and visual rhythm.',
    'Preserve authenticity: the real HVAC installation must remain believable and recognizable without obvious AI distortions.',
    `The bottom ${FOOTER_RESERVED_PX}px must be fully blank white and free of content.`,
    'Exact phone/prices/BTU are verified by deterministic code, so do not penalize OCR uncertainty.',
    'commercialCompleteness measures whether the ad contains enough useful customer-facing commercial information for its campaign type.',
    'layoutRichness measures whether the composition uses a professional multi-module design system instead of one rectangle/text block.',
    'brandSystemCoherence measures whether shapes, typography hierarchy, accents and CTA feel like one premium campaign system.',
    'offerClarity measures whether the viewer understands what DEMAC wants them to do and why within a few seconds.',
    `Expected headline: ${exact.headline}.`,
    `Expected CTA family: ${exact.cta}.`,
    `Campaign type: ${safeString(campaign.campaignType, 80)}.`,
    `Concept intent: ${safeString(concept.name, 100)} — ${safeString(concept.rationale, 400)}.`,
  ].join('\n');
}

async function visualQa(imageBuffer, hard, exact, campaign, concept) {
  const parsed = await structuredResponse({
    model: QA_MODEL,
    prompt: qaPrompt(exact, campaign, concept),
    schemaName: 'demac_marketing_creative_qa_v21',
    schema: QA_SCHEMA,
    imageBuffer,
  });
  const metrics = {};
  for (const key of [
    'overallScore', 'mobileLegibility', 'visualHierarchy', 'contrast', 'footerClearance', 'authenticity',
    'professionalism', 'creativeQuality', 'scrollStoppingPower', 'agencyFeel', 'photoIntegration',
    'ctaProminence', 'visualSophistication', 'commercialCompleteness', 'layoutRichness', 'brandSystemCoherence', 'offerClarity',
  ]) metrics[key] = Number(parsed[key]) || 0;
  const scorePass = metrics.overallScore >= 88
    && metrics.mobileLegibility >= 80
    && metrics.footerClearance >= 92
    && metrics.professionalism >= 85
    && metrics.creativeQuality >= 86
    && metrics.agencyFeel >= 85
    && metrics.scrollStoppingPower >= 82
    && metrics.photoIntegration >= 84
    && metrics.ctaProminence >= 82
    && metrics.commercialCompleteness >= 84
    && metrics.layoutRichness >= 82
    && metrics.brandSystemCoherence >= 82
    && metrics.offerClarity >= 84;
  const selectionScore = Math.round(
    metrics.creativeQuality * 0.16
    + metrics.agencyFeel * 0.13
    + metrics.commercialCompleteness * 0.13
    + metrics.layoutRichness * 0.11
    + metrics.scrollStoppingPower * 0.10
    + metrics.photoIntegration * 0.10
    + metrics.brandSystemCoherence * 0.09
    + metrics.visualSophistication * 0.06
    + metrics.offerClarity * 0.06
    + metrics.ctaProminence * 0.04
    + metrics.professionalism * 0.02,
  );
  return {
    source: 'openai_vision_v21',
    status: hard.allPassed && parsed.pass === true && scorePass ? 'passed' : 'failed',
    score: metrics.overallScore,
    selectionScore,
    ...metrics,
    issues: Array.isArray(parsed.issues) ? parsed.issues.map((item) => safeString(item, 300)).filter(Boolean).slice(0, 10) : [],
    revisionInstructions: Array.isArray(parsed.revisionInstructions) ? parsed.revisionInstructions.map((item) => safeString(item, 300)).filter(Boolean).slice(0, 8) : [],
    hardChecks: hard,
  };
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

async function nextVersion(sessionId) {
  const snapshot = await db.collection('marketingCreatives').where('sessionId', '==', sessionId).get();
  let max = 0;
  for (const doc of snapshot.docs) max = Math.max(max, Number(doc.data()?.version) || 0);
  return max + 1;
}

async function previousIssues(sessionId) {
  const snapshot = await db.collection('marketingCreatives').where('sessionId', '==', sessionId).get();
  const latest = snapshot.docs.sort((a, b) => (Number(b.data()?.version) || 0) - (Number(a.data()?.version) || 0))[0]?.data();
  return Array.isArray(latest?.qa?.issues) ? latest.qa.issues.slice(0, 8) : [];
}

async function renderVariant({ sessionId, creativeId, concept, heroBuffer, exact, hard, core, variantIndex, revisionInstructions = [], suffix = '', reportProgress = true }) {
  const progressBase = 24 + variantIndex * 18;
  if (reportProgress) await setProgress(sessionId, `render_${concept.id}${suffix}`, progressBase, `Generating ${concept.name}${suffix ? ' revision' : ''} with GPT Image 2…`, { currentVariant: concept.id });
  const generated = await generateGptImage2(heroBuffer, imagePrompt({ concept, ...core, revisionInstructions }));
  if (reportProgress) await setProgress(sessionId, `layout_${concept.id}${suffix}`, progressBase + 8, `Building V2.1 commercial composition for ${concept.name}…`, { currentVariant: concept.id });
  const rendered = await renderCreative(generated, exact, concept);
  if (reportProgress) await setProgress(sessionId, `qa_${concept.id}${suffix}`, progressBase + 13, `Running V2.1 commercial QA on ${concept.name}…`, { currentVariant: concept.id });
  const qa = await visualQa(rendered, hard, exact, core.campaign, concept);
  const variantId = suffix ? `${concept.id}${suffix}` : concept.id;
  const path = `marketing/generated/${sessionId}/${creativeId}-${variantId}.png`;
  const uploaded = await saveImage(path, rendered, { sessionId, assetId: creativeId, variant: variantId, sourceHeroAssetId: core.hero.id, imageModel: IMAGE_MODEL, builderVersion: BUILDER_VERSION });
  return {
    id: variantId,
    conceptId: concept.id,
    name: suffix ? `${concept.name} · Revised` : concept.name,
    rationale: safeString(concept.rationale, 800),
    imageStoragePath: uploaded.path,
    imageUrl: uploaded.url,
    imageModel: IMAGE_MODEL,
    layout: {
      headlineZone: concept.id === 'sales_impact' ? 'top_left' : 'upper_left',
      ctaZone: 'lower_left',
      textPanelStyle: 'modular_commercial_system',
      textAlign: 'left',
      accentStyle: concept.id === 'sales_impact' ? 'blue_gold_energy' : concept.id === 'social_proof' ? 'proof_frame' : 'editorial_blue',
      photoFocus: concept.photoFocus,
      compositionTemplate: concept.id,
      visualEnergy: concept.visualEnergy,
    },
    qa,
    selectionScore: qa.selectionScore,
    revised: Boolean(suffix),
  };
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
    creativeStatus: 'processing', creativeRequestedAt: FieldValue.serverTimestamp(), creativeError: FieldValue.delete(), updatedAt: new Date().toISOString(),
  }, { merge: true });
  await setProgress(sessionId, 'prepare', 5, 'Preparing campaign and real source photo…');
  const heroBuffer = await fetchImageBuffer(hero.downloadUrl);
  const issues = await previousIssues(sessionId);
  await setProgress(sessionId, 'art_direction', 12, 'GPT-5.6 Sol is creating three V2.1 commercial art directions…');
  const artDirection = await createArtDirection(core, heroBuffer, issues);
  await setProgress(sessionId, 'concepts_ready', 20, 'V2.1 art direction ready. Starting three commercial compositions…');
  await setProgress(sessionId, 'render_variants_parallel', 24, 'Generating three premium GPT Image 2 backgrounds in parallel…', { totalVariants: artDirection.concepts.length });

  const variants = await Promise.all(artDirection.concepts.map((concept, index) => renderVariant({
    sessionId, creativeId, concept, heroBuffer, exact, hard, core, variantIndex: index, reportProgress: false,
  })));

  await setProgress(sessionId, 'compare', 80, 'Three V2.1 variants ready. Comparing commercial completeness and agency quality…', { completedVariants: variants.length });
  variants.sort((a, b) => b.selectionScore - a.selectionScore);
  let selected = variants.find((variant) => variant.qa.status === 'passed') || variants[0];
  let autoRevised = false;
  if (selected && selected.qa.status !== 'passed') {
    autoRevised = true;
    const concept = artDirection.concepts.find((item) => item.id === selected.conceptId) || artDirection.concepts[0];
    await setProgress(sessionId, 'auto_revision', 87, `Auto-revising ${concept.name} from V2.1 QA feedback…`, { currentVariant: concept.id });
    const revised = await renderVariant({
      sessionId,
      creativeId,
      concept,
      heroBuffer,
      exact,
      hard,
      core,
      variantIndex: 3,
      revisionInstructions: selected.qa.revisionInstructions,
      suffix: '_revision',
    });
    variants.push(revised);
    variants.sort((a, b) => b.selectionScore - a.selectionScore);
    selected = variants.find((variant) => variant.qa.status === 'passed') || variants[0];
  }

  if (!selected) throw new HttpsError('internal', 'Creative Builder V2.1 did not produce a candidate.');
  await setProgress(sessionId, 'finalize', 96, 'Finalizing the strongest V2.1 variant and preserving all alternatives…');
  const now = new Date().toISOString();
  const status = selected.qa.status === 'passed' ? 'qa_passed' : 'qa_failed';
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
    renderTemplate: selected.conceptId,
    renderMode: 'ai_multivariant_v21_commercial',
    artDirectorModel: ART_DIRECTOR_MODEL,
    imageModel: IMAGE_MODEL,
    qaModel: QA_MODEL,
    artDirection: {
      campaignSummary: safeString(artDirection.campaignSummary, 1000),
      creativeNorthStar: safeString(artDirection.creativeNorthStar, 1000),
    },
    selectedVariantId: selected.id,
    variantCount: variants.length,
    variants,
    autoRevised,
    exactText: {
      headline: exact.headline,
      subheadline: exact.subheadline,
      primaryText: exact.primaryText,
      cta: exact.cta,
      whatsapp: exact.whatsapp,
      offer: exact.offer,
      eyebrow: exact.eyebrow,
      proofLabel: exact.proofLabel,
      supportPoints: exact.supportPoints,
      products: exact.products,
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
    creativeProgress: { stage: 'completed', percent: 100, label: status === 'qa_passed' ? 'V2.1 commercial creative selected and QA passed.' : 'V2.1 variants generated; best candidate still needs review.', updatedAt: now },
    updatedAt: now,
  }, { merge: true });
  return record;
}

exports.requestMarketingCreativeBuild = onCall({ region: 'us-central1', timeoutSeconds: 900, memory: '2GiB', secrets: [openAiApiKey] }, async (request) => {
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
    console.error('Marketing Creative Builder V2.1 failed', error);
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
  if (creative.qa?.status !== 'passed' || creative.status !== 'qa_passed') throw new HttpsError('failed-precondition', 'Creative must pass V2.1 commercial Visual QA before approval.');
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
    metadata: { firebaseStorageDownloadTokens: token, sessionId: creative.sessionId, assetId: creativeId, uploadedByUid: request.auth.uid, variant: 'approved', builderVersion: creative.builderVersion || BUILDER_VERSION },
  });
  const approvedUrl = storageDownloadUrl(bucket.name, approvedPath, token);
  const now = new Date().toISOString();
  await ref.set({ status: 'approved', approvedStoragePath: approvedPath, approvedUrl, approvedAt: now, approvedByUserId: request.auth.uid, approvedByName: safeString(profile.name || profile.displayName || profile.email, 160), updatedAt: now }, { merge: true });
  return { creativeId, status: 'approved', approvedUrl };
});

exports.__marketingCreativeBuilderV2Test = {
  IMAGE_MODEL,
  ART_DIRECTOR_MODEL,
  QA_MODEL,
  BUILDER_VERSION,
  VARIANT_IDS,
  FOOTER_RESERVED_PX,
};
