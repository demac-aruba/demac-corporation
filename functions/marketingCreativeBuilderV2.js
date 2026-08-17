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
        required: [
          'id', 'name', 'rationale', 'imagePrompt', 'headlineZone', 'ctaZone',
          'textPanelStyle', 'textAlign', 'accentStyle', 'photoFocus', 'imageTreatment', 'avoid',
        ],
        properties: {
          id: { type: 'string', enum: VARIANT_IDS },
          name: { type: 'string' },
          rationale: { type: 'string' },
          imagePrompt: { type: 'string' },
          headlineZone: { type: 'string', enum: ['top_left', 'top_center', 'upper_left', 'middle_left', 'upper_right'] },
          ctaZone: { type: 'string', enum: ['lower_left', 'lower_center', 'lower_right'] },
          textPanelStyle: { type: 'string', enum: ['glass', 'soft_gradient', 'floating_card', 'none'] },
          textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
          accentStyle: { type: 'string', enum: ['cool_glow', 'airflow', 'blue_ribbon', 'clean_lines', 'none'] },
          photoFocus: { type: 'string', enum: ['equipment', 'installation', 'environment', 'people'] },
          imageTreatment: { type: 'string' },
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
    'photoIntegration', 'ctaProminence', 'visualSophistication', 'pass', 'issues', 'revisionInstructions',
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
    pass: { type: 'boolean' },
    issues: { type: 'array', maxItems: 10, items: { type: 'string' } },
    revisionInstructions: { type: 'array', maxItems: 8, items: { type: 'string' } },
  },
};

function cleanId(value, label = 'id') {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 220 || !/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new HttpsError('invalid-argument', `Invalid ${label}.`);
  }
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

function exactTextForCreative(campaign, brand) {
  const products = campaign.campaignType === 'airco_sales'
    ? (Array.isArray(brand.approvedProducts) ? brand.approvedProducts : []).map(parseApprovedProduct).filter(Boolean).slice(0, 3)
    : [];
  return {
    headline: safeString(campaign.copy?.headline, 100) || 'DEMAC Professional Cooling Solutions',
    subheadline: safeString(campaign.copy?.subheadline, 180),
    cta: safeString(campaign.copy?.cta, 80) || 'WhatsApp nos awe mes',
    whatsapp: safeString(brand.whatsapp, 40),
    products,
    offer: Array.isArray(brand.approvedOffers) && brand.approvedOffers.length ? safeString(brand.approvedOffers[0], 160) : '',
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
    'You are the senior advertising art director for DEMAC Professional Cooling Solutions in Aruba.',
    'Your job is to direct three materially different, premium, scroll-stopping Facebook/Instagram square ad concepts around the supplied REAL DEMAC installation photo.',
    'The final visual must feel like an agency campaign, not a flyer, not a template, and never merely a dark rectangle placed over a photo.',
    'Think in terms of commercial photography, premium HVAC advertising, depth, lighting, framing, cooling atmosphere, subtle graphic systems, product focus, and intentional negative space.',
    'The real customer photo is proof of work. Preserve equipment, people, proportions, surroundings, and authenticity. Do not fabricate extra HVAC equipment or alter faces.',
    'GPT Image will create the visual background. Exact words, prices, BTU, phone numbers and CTA are added later by deterministic code, so the image concepts must create elegant EMPTY typography zones but NO generated text.',
    `Reserve the bottom ${FOOTER_RESERVED_PX}px of a 1080px square as a clean blank footer zone. No objects or decorative elements there.`,
    'Create exactly these three concepts: premium_clean, sales_impact, social_proof. Make them visually distinct, not small variations of one template.',
    'premium_clean: sophisticated, aspirational, spacious, premium brand campaign.',
    'sales_impact: stronger visual energy and conversion focus, without looking cheap or cluttered.',
    'social_proof: authentic real-work storytelling, emphasizing that this is a completed DEMAC installation.',
    `Campaign type: ${safeString(campaign.campaignType, 80)}.`,
    `Objective: ${safeString(campaign.objective, 500)}.`,
    `Angle: ${safeString(campaign.angle, 500)}.`,
    `Existing visual direction: ${safeString(campaign.visualDirection?.heroTreatment, 500)}.`,
    `Brand style: ${safeString(brand.style, 500)}.`,
    `Brand colors: ${safeString(brand.primaryColor, 80)} and ${safeString(brand.secondaryColor, 80)}.`,
    `Photo analysis: ${safeString(hero.analysisSummary, 700)}.`,
    previousIssues?.length ? `Previous rejected-creative feedback: ${previousIssues.join('; ')}.` : '',
    'Return practical art direction for GPT Image plus dynamic text placement. Do not include ad copy itself.',
  ].filter(Boolean).join('\n');
}

async function createArtDirection(core, heroBuffer, previousIssues) {
  const normalized = await normalizeHero(heroBuffer);
  const direction = await structuredResponse({
    model: ART_DIRECTOR_MODEL,
    prompt: artDirectorPrompt({ ...core, previousIssues }),
    schemaName: 'demac_marketing_art_direction_v2',
    schema: ART_DIRECTION_SCHEMA,
    imageBuffer: normalized,
  });
  const byId = new Map((direction.concepts || []).map((concept) => [concept.id, concept]));
  direction.concepts = VARIANT_IDS.map((id) => byId.get(id)).filter(Boolean);
  if (direction.concepts.length !== 3) throw new Error('Art Director did not return all three required concepts.');
  return direction;
}

function imagePrompt({ concept, campaign, brand, hero, revisionInstructions = [] }) {
  return [
    'Create a premium agency-quality square advertising VISUAL using this real DEMAC HVAC installation photo as the authentic source.',
    'Preserve the actual installed air conditioner, people, architecture and scene identity with high fidelity. Do not invent extra equipment, duplicate units, change faces, or replace the real installation.',
    'This is not a generic photo enhancement. Build an intentional commercial advertising composition with sophisticated lighting, depth, tasteful graphic shapes, cooling atmosphere, premium contrast and visual storytelling.',
    'IMPORTANT: generate NO words, letters, numbers, prices, phone numbers, logos, badges, fake labels or pseudo-text. Leave intentional clean zones for exact typography that will be added afterward.',
    'Do not place a big generic dark rectangle over the photo. Any panel, glass effect, gradient, ribbon or graphic device must feel integrated into the photography and art direction.',
    `The bottom ${Math.round((FOOTER_RESERVED_PX / OUTPUT_SIZE) * 100)} percent must remain visually quiet and uncluttered for an external company footer.`,
    `Concept: ${safeString(concept.name, 120)}.`,
    `Concept rationale: ${safeString(concept.rationale, 500)}.`,
    `Creative direction: ${safeString(concept.imagePrompt, 1200)}.`,
    `Image treatment: ${safeString(concept.imageTreatment, 700)}.`,
    `Accent style: ${safeString(concept.accentStyle, 80)}.`,
    `Photo focus: ${safeString(concept.photoFocus, 80)}.`,
    `Campaign objective: ${safeString(campaign.objective, 500)}.`,
    `Campaign angle: ${safeString(campaign.angle, 500)}.`,
    `Brand style: ${safeString(brand.style, 500)}.`,
    `Photo analysis: ${safeString(hero.analysisSummary, 700)}.`,
    Array.isArray(concept.avoid) && concept.avoid.length ? `Avoid: ${concept.avoid.join('; ')}.` : '',
    revisionInstructions.length ? `QA revision requirements: ${revisionInstructions.join('; ')}.` : '',
    'The result should look ready for a professional paid social campaign even before exact text is composited.',
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
  form.append('input_fidelity', 'high');
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
  if (!response.ok || !result) {
    throw new Error(`GPT Image 2 failed (${response.status}): ${payload?.error?.message || text || 'No image returned.'}`);
  }
  return Buffer.from(result, 'base64');
}

function wrapText(value, maxChars, maxLines) {
  const words = safeString(value, 500).split(/\s+/).filter(Boolean);
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

function headlineLayout(concept) {
  const zone = concept.headlineZone;
  if (zone === 'top_center') return { x: 540, y: 106, anchor: 'middle', maxChars: 30, panel: { x: 110, y: 52, w: 860, h: 260 } };
  if (zone === 'upper_right') return { x: 1015, y: 120, anchor: 'end', maxChars: 27, panel: { x: 390, y: 58, w: 650, h: 275 } };
  if (zone === 'middle_left') return { x: 64, y: 360, anchor: 'start', maxChars: 25, panel: { x: 36, y: 290, w: 640, h: 310 } };
  if (zone === 'upper_left') return { x: 64, y: 170, anchor: 'start', maxChars: 27, panel: { x: 36, y: 100, w: 650, h: 300 } };
  return { x: 64, y: 115, anchor: 'start', maxChars: 27, panel: { x: 36, y: 48, w: 650, h: 295 } };
}

function ctaLayout(concept, textLength) {
  const width = Math.min(820, Math.max(470, 250 + textLength * 9));
  if (concept.ctaZone === 'lower_center') return { x: (1080 - width) / 2, y: 812, w: width, anchorX: 540, textAnchor: 'middle' };
  if (concept.ctaZone === 'lower_right') return { x: 1020 - width, y: 812, w: width, anchorX: 1020 - width + 30, textAnchor: 'start' };
  return { x: 60, y: 812, w: width, anchorX: 90, textAnchor: 'start' };
}

function panelSvg(style, panel) {
  if (style === 'none') return '';
  if (style === 'soft_gradient') {
    return `<defs><linearGradient id="panelFade" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#061b36" stop-opacity="0.82"/><stop offset="72%" stop-color="#0b2b55" stop-opacity="0.44"/><stop offset="100%" stop-color="#0b2b55" stop-opacity="0"/></linearGradient></defs><rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="36" fill="url(#panelFade)"/>`;
  }
  if (style === 'floating_card') return `<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="34" fill="#ffffff" fill-opacity="0.92"/><rect x="${panel.x}" y="${panel.y}" width="8" height="${panel.h}" rx="4" fill="#1769e0"/>`;
  return `<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="38" fill="#07264c" fill-opacity="0.62" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2"/>`;
}

function productTagSvg(product, x, y) {
  return `<g><rect x="${x}" y="${y}" width="302" height="108" rx="24" fill="#ffffff" fill-opacity="0.95"/><rect x="${x}" y="${y}" width="8" height="108" rx="4" fill="#1769e0"/><text x="${x + 24}" y="${y + 31}" class="tagBtu">${escapeXml(product.btu)}</text><text x="${x + 24}" y="${y + 70}" class="tagPrice">${escapeXml(product.price)}</text><text x="${x + 24}" y="${y + 96}" class="tagSpec">${escapeXml(product.specs)}</text></g>`;
}

function overlaySvg(exact, concept) {
  const layout = headlineLayout(concept);
  const isLightPanel = concept.textPanelStyle === 'floating_card';
  const headlineClass = isLightPanel ? 'headline dark' : 'headline';
  const subClass = isLightPanel ? 'sub darkSub' : 'sub';
  const headline = wrapText(exact.headline, layout.maxChars, 2);
  const subheadline = wrapText(exact.subheadline, layout.maxChars + 11, 2);
  const ctaText = exact.whatsapp ? `${exact.cta} · ${exact.whatsapp}` : exact.cta;
  const cta = ctaLayout(concept, ctaText.length);
  const products = exact.products.length ? exact.products.map((product, index) => productTagSvg(product, 48 + index * 342, 645)).join('') : '';
  const offerY = exact.products.length ? 766 : 680;
  const offer = exact.offer ? `<g><rect x="60" y="${offerY}" width="610" height="54" rx="27" fill="#ffffff" fill-opacity="0.94"/><text x="88" y="${offerY + 36}" class="offer">${escapeXml(exact.offer)}</text></g>` : '';
  const panel = panelSvg(concept.textPanelStyle, layout.panel);
  const accent = concept.accentStyle === 'blue_ribbon'
    ? `<rect x="${layout.panel.x}" y="${layout.panel.y - 14}" width="190" height="12" rx="6" fill="#2d8cff"/>`
    : concept.accentStyle === 'clean_lines'
      ? `<line x1="${layout.panel.x}" y1="${layout.panel.y - 12}" x2="${layout.panel.x + 180}" y2="${layout.panel.y - 12}" stroke="#56b6ff" stroke-width="6" stroke-linecap="round"/>`
      : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><style>.headline{font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:58px;fill:#fff;letter-spacing:-1px;paint-order:stroke;stroke:#00162e;stroke-opacity:.16;stroke-width:2}.sub{font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:29px;fill:#eef7ff}.dark{fill:#0b2442;stroke:none}.darkSub{fill:#31506f}.cta{font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:25px;fill:#fff}.tagBtu{font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:18px;fill:#1769e0}.tagPrice{font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:32px;fill:#102038}.tagSpec{font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:13px;fill:#65758b}.offer{font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:20px;fill:#102038}</style>${panel}${accent}${textLines(headline, layout.x, layout.y, 66, headlineClass, layout.anchor)}${textLines(subheadline, layout.x, layout.y + 142, 38, subClass, layout.anchor)}${products}${offer}<g><rect x="${cta.x}" y="${cta.y}" width="${cta.w}" height="82" rx="30" fill="#14aa68"/><text x="${cta.anchorX}" y="${cta.y + 53}" class="cta" text-anchor="${cta.textAnchor}">${escapeXml(ctaText)}</text></g><rect x="0" y="${OUTPUT_SIZE - FOOTER_RESERVED_PX}" width="1080" height="${FOOTER_RESERVED_PX}" fill="#fff"/></svg>`);
}

async function renderCreative(backgroundBuffer, exact, concept) {
  const background = await sharp(backgroundBuffer).rotate().resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover', position: 'attention' }).png().toBuffer();
  const rendered = await sharp(background).composite([{ input: overlaySvg(exact, concept), top: 0, left: 0 }]).png({ compressionLevel: 8 }).toBuffer();
  const footer = await sharp({ create: { width: OUTPUT_SIZE, height: FOOTER_RESERVED_PX, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
  return sharp(rendered).composite([{ input: footer, top: OUTPUT_SIZE - FOOTER_RESERVED_PX, left: 0 }]).png({ compressionLevel: 8 }).toBuffer();
}

function qaPrompt(exact, campaign, concept) {
  return [
    'You are the uncompromising creative director reviewing a paid social advertisement for DEMAC Professional Cooling Solutions.',
    'Judge the visible ad as if a professional advertising agency were about to spend real Meta Ads budget on it.',
    'A technically readable design is NOT enough. Reject generic flyers, template-looking layouts, a photo with a large rectangle on top, weak visual storytelling, flat composition, or anything that would not stop a user scrolling on a phone.',
    'A PASS requires premium commercial polish, deliberate art direction, strong product/photo integration, convincing depth, professional hierarchy, attractive CTA prominence and an agency-quality look.',
    'If the design looks like a basic photo plus boxes/text, creativeQuality and agencyFeel must be 65 or lower and pass must be false.',
    'Preserve authenticity: the real HVAC installation should still look believable and recognizable without obvious AI distortions.',
    `The bottom ${FOOTER_RESERVED_PX}px must be fully blank white and free of content.`,
    'Exact phone/prices/BTU are verified by deterministic code, so do not penalize OCR uncertainty.',
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
    schemaName: 'demac_marketing_creative_qa_v2',
    schema: QA_SCHEMA,
    imageBuffer,
  });
  const metrics = {
    overallScore: Number(parsed.overallScore) || 0,
    mobileLegibility: Number(parsed.mobileLegibility) || 0,
    visualHierarchy: Number(parsed.visualHierarchy) || 0,
    contrast: Number(parsed.contrast) || 0,
    footerClearance: Number(parsed.footerClearance) || 0,
    authenticity: Number(parsed.authenticity) || 0,
    professionalism: Number(parsed.professionalism) || 0,
    creativeQuality: Number(parsed.creativeQuality) || 0,
    scrollStoppingPower: Number(parsed.scrollStoppingPower) || 0,
    agencyFeel: Number(parsed.agencyFeel) || 0,
    photoIntegration: Number(parsed.photoIntegration) || 0,
    ctaProminence: Number(parsed.ctaProminence) || 0,
    visualSophistication: Number(parsed.visualSophistication) || 0,
  };
  const scorePass = metrics.overallScore >= 88
    && metrics.mobileLegibility >= 80
    && metrics.footerClearance >= 92
    && metrics.professionalism >= 85
    && metrics.creativeQuality >= 86
    && metrics.agencyFeel >= 85
    && metrics.scrollStoppingPower >= 82
    && metrics.photoIntegration >= 84
    && metrics.ctaProminence >= 80;
  const selectionScore = Math.round(
    metrics.creativeQuality * 0.24
    + metrics.agencyFeel * 0.18
    + metrics.scrollStoppingPower * 0.15
    + metrics.photoIntegration * 0.14
    + metrics.visualSophistication * 0.10
    + metrics.professionalism * 0.08
    + metrics.overallScore * 0.07
    + metrics.ctaProminence * 0.04,
  );
  return {
    source: 'openai_vision_v2',
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
  if (reportProgress) await setProgress(sessionId, `layout_${concept.id}${suffix}`, progressBase + 8, `Applying exact DEMAC typography to ${concept.name}…`, { currentVariant: concept.id });
  const rendered = await renderCreative(generated, exact, concept);
  if (reportProgress) await setProgress(sessionId, `qa_${concept.id}${suffix}`, progressBase + 13, `Running agency-quality QA on ${concept.name}…`, { currentVariant: concept.id });
  const qa = await visualQa(rendered, hard, exact, core.campaign, concept);
  const variantId = suffix ? `${concept.id}${suffix}` : concept.id;
  const path = `marketing/generated/${sessionId}/${creativeId}-${variantId}.png`;
  const uploaded = await saveImage(path, rendered, { sessionId, assetId: creativeId, variant: variantId, sourceHeroAssetId: core.hero.id, imageModel: IMAGE_MODEL });
  return {
    id: variantId,
    conceptId: concept.id,
    name: suffix ? `${concept.name} · Revised` : concept.name,
    rationale: safeString(concept.rationale, 800),
    imageStoragePath: uploaded.path,
    imageUrl: uploaded.url,
    imageModel: IMAGE_MODEL,
    layout: {
      headlineZone: concept.headlineZone,
      ctaZone: concept.ctaZone,
      textPanelStyle: concept.textPanelStyle,
      textAlign: concept.textAlign,
      accentStyle: concept.accentStyle,
      photoFocus: concept.photoFocus,
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
  await setProgress(sessionId, 'art_direction', 12, 'GPT-5.6 Sol is creating three agency art directions…');
  const artDirection = await createArtDirection(core, heroBuffer, issues);
  await setProgress(sessionId, 'concepts_ready', 20, 'Art direction ready. Starting three premium variants…');

  await setProgress(
    sessionId,
    'render_variants_parallel',
    24,
    'Generating three premium GPT Image 2 variants in parallel…',
    { totalVariants: artDirection.concepts.length },
  );
  const variants = await Promise.all(
    artDirection.concepts.map((concept, index) => renderVariant({
      sessionId,
      creativeId,
      concept,
      heroBuffer,
      exact,
      hard,
      core,
      variantIndex: index,
      reportProgress: false,
    })),
  );

  await setProgress(
    sessionId,
    'compare',
    80,
    'Three variants ready. Comparing creative quality, agency feel and scroll-stopping power…',
    { completedVariants: variants.length },
  );
  variants.sort((a, b) => b.selectionScore - a.selectionScore);
  let selected = variants.find((variant) => variant.qa.status === 'passed') || variants[0];
  let autoRevised = false;
  if (selected && selected.qa.status !== 'passed') {
    autoRevised = true;
    const concept = artDirection.concepts.find((item) => item.id === selected.conceptId) || artDirection.concepts[0];
    await setProgress(sessionId, 'auto_revision', 87, `Auto-revising ${concept.name} from QA feedback…`, { currentVariant: concept.id });
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

  if (!selected) throw new HttpsError('internal', 'Creative Builder V2 did not produce a candidate.');
  await setProgress(sessionId, 'finalize', 96, 'Finalizing the best variant and preserving all alternatives…');
  const now = new Date().toISOString();
  const status = selected.qa.status === 'passed' ? 'qa_passed' : 'qa_failed';
  const record = {
    id: creativeId,
    sessionId,
    campaignId: campaign.id,
    campaignType: campaign.campaignType,
    version,
    status,
    builderVersion: 'V2',
    heroAssetId: hero.id,
    imageStoragePath: selected.imageStoragePath,
    imageUrl: selected.imageUrl,
    width: OUTPUT_SIZE,
    height: OUTPUT_SIZE,
    reservedFooterPx: FOOTER_RESERVED_PX,
    renderTemplate: selected.conceptId,
    renderMode: 'ai_multivariant_v2',
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
      cta: exact.cta,
      whatsapp: exact.whatsapp,
      offer: exact.offer,
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
    creativeProgress: { stage: 'completed', percent: 100, label: status === 'qa_passed' ? 'Best creative selected and QA passed.' : 'Creative variants generated; best candidate still needs review.', updatedAt: now },
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
    console.error('Marketing Creative Builder V2 failed', error);
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
  if (creative.qa?.status !== 'passed' || creative.status !== 'qa_passed') throw new HttpsError('failed-precondition', 'Creative must pass the stricter V2 Visual QA before approval.');
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
    metadata: { firebaseStorageDownloadTokens: token, sessionId: creative.sessionId, assetId: creativeId, uploadedByUid: request.auth.uid, variant: 'approved', builderVersion: creative.builderVersion || 'V1' },
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
  VARIANT_IDS,
  FOOTER_RESERVED_PX,
};
