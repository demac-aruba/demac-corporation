const { randomUUID } = require("node:crypto");
const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { defineSecret } = require("firebase-functions/params");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const sharp = require("sharp");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const storage = getStorage(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");

const ALLOWED_ROLES = new Set(["admin", "office"]);
const QA_MODEL = "gpt-5.6-terra";
const IMAGE_MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"];
const OUTPUT_SIZE = 1080;
const FOOTER_RESERVED_PX = 156;
const MAX_RENDER_ATTEMPTS = 2;

const QA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "overallScore",
    "mobileLegibility",
    "visualHierarchy",
    "contrast",
    "footerClearance",
    "authenticity",
    "professionalism",
    "pass",
    "issues",
    "revisionInstructions",
  ],
  properties: {
    overallScore: { type: "integer", minimum: 0, maximum: 100 },
    mobileLegibility: { type: "integer", minimum: 0, maximum: 100 },
    visualHierarchy: { type: "integer", minimum: 0, maximum: 100 },
    contrast: { type: "integer", minimum: 0, maximum: 100 },
    footerClearance: { type: "integer", minimum: 0, maximum: 100 },
    authenticity: { type: "integer", minimum: 0, maximum: 100 },
    professionalism: { type: "integer", minimum: 0, maximum: 100 },
    pass: { type: "boolean" },
    issues: {
      type: "array",
      maxItems: 10,
      items: { type: "string" },
    },
    revisionInstructions: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
  },
};

function cleanId(value, label = "id") {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 220 || !/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new HttpsError("invalid-argument", `Invalid ${label}.`);
  }
  return id;
}

function safeString(value, max = 1200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(value, maxChars, maxLines) {
  const words = safeString(value, 500).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (words.length && lines.length === maxLines) {
    const consumed = lines.join(" ").split(/\s+/).length;
    if (consumed < words.length) {
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.…]+$/, "")}…`;
    }
  }
  return lines.slice(0, maxLines);
}

function textLines(lines, x, y, lineHeight, className, anchor = "start") {
  return lines
    .map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" class="${className}" text-anchor="${anchor}">${escapeXml(line)}</text>`)
    .join("");
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

async function loadCore(sessionId) {
  const [sessionSnap, campaignSnap, brandSnap, assetsSnap] = await Promise.all([
    db.collection("marketingUploadSessions").doc(sessionId).get(),
    db.collection("marketingCampaigns").doc(sessionId).get(),
    db.collection("marketingBrandSettings").doc("default").get(),
    db.collection("marketingAssets").where("sessionId", "==", sessionId).get(),
  ]);

  if (!sessionSnap.exists) throw new HttpsError("not-found", "Marketing upload session was not found.");
  if (!campaignSnap.exists) throw new HttpsError("failed-precondition", "Generate Campaign Strategy before building a creative.");
  if (!brandSnap.exists) throw new HttpsError("failed-precondition", "Save Brand Center before building a creative.");

  const session = { id: sessionSnap.id, ...sessionSnap.data() };
  const campaign = { id: campaignSnap.id, ...campaignSnap.data() };
  const brand = { id: brandSnap.id, ...brandSnap.data() };
  const assets = assetsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const hero = assets.find((asset) => asset.id === campaign.heroAssetId)
    || assets.find((asset) => asset.id === session.primaryAssetId)
    || assets.find((asset) => asset.doNotUse !== true && asset.downloadUrl);

  if (!hero?.downloadUrl) throw new HttpsError("failed-precondition", "No usable hero image is available for this campaign.");

  return { session, campaign, brand, assets, hero };
}

function parseApprovedProduct(line) {
  const source = safeString(line, 500);
  const btu = source.match(/(\d[\d,.\s]*)\s*BTU/i)?.[1]?.replace(/\s+/g, "") || "";
  const price = source.match(/Afl\.?\s*([\d,.]+)/i)?.[1] || "";
  const voltage = source.match(/\b(\d{3}V)\b/i)?.[1]?.toUpperCase() || "";
  const seer = source.match(/\bSEER\s*([0-9.]+)/i)?.[1] || "";
  const inverter = /\bINVERTER\b/i.test(source);
  if (!btu || !price) return null;
  return {
    source,
    btu: `${btu} BTU`,
    price: `Afl. ${price}`,
    specs: [voltage, seer ? `SEER ${seer}` : "", inverter ? "INVERTER" : ""].filter(Boolean).join(" • "),
  };
}

function exactTextForCreative(campaign, brand) {
  const headline = safeString(campaign.copy?.headline, 100) || "DEMAC Professional Cooling Solutions";
  const subheadline = safeString(campaign.copy?.subheadline, 180);
  const cta = safeString(campaign.copy?.cta, 80) || "WhatsApp nos awe mes";
  const whatsapp = safeString(brand.whatsapp, 40);
  const products = campaign.campaignType === "airco_sales"
    ? (Array.isArray(brand.approvedProducts) ? brand.approvedProducts : [])
      .map(parseApprovedProduct)
      .filter(Boolean)
      .slice(0, 3)
    : [];
  const offer = Array.isArray(brand.approvedOffers) && brand.approvedOffers.length
    ? safeString(brand.approvedOffers[0], 160)
    : "";
  return {
    headline,
    subheadline,
    cta,
    whatsapp,
    products,
    offer,
  };
}

function imagePrompt({ campaign, brand, hero, previousIssues = [] }) {
  const issueText = previousIssues.length
    ? `Previous QA feedback to improve: ${previousIssues.join("; ")}.`
    : "";
  return [
    "Edit this real DEMAC HVAC installation/customer photo into a premium square Facebook/Instagram advertising background.",
    "Preserve the real installation, people, equipment, environment, proportions, and recognizable identity faithfully. Do not invent extra people, duplicate equipment, change faces, replace the installed air conditioner, or fabricate company branding.",
    "Use a modern professional commercial art direction with royal-blue and clean white accents, subtle fresh-air atmosphere, controlled contrast, and realistic lighting.",
    "IMPORTANT: Do not generate any words, letters, numbers, logos, prices, badges, phone numbers, CTA text, or fake signage. All exact advertising text will be added separately by a deterministic renderer.",
    "Create generous clean text-safe space in the upper and middle portions while keeping the real HVAC work clearly visible.",
    "Keep the bottom approximately 15 percent visually clean and quiet because DEMAC will add its original company footer later. Do not place objects, text, logos, price tags, or decorative clutter in that bottom zone.",
    `Campaign type: ${safeString(campaign.campaignType, 80)}.`,
    `Campaign objective: ${safeString(campaign.objective, 350)}.`,
    `Campaign angle: ${safeString(campaign.angle, 450)}.`,
    `Hero treatment guidance: ${safeString(campaign.visualDirection?.heroTreatment, 500)}.`,
    `Brand style: ${safeString(brand.style, 500) || "premium, modern, clean, professional, high contrast, mobile-first"}.`,
    `Photo analysis: ${safeString(hero.analysisSummary, 700)}.`,
    issueText,
  ].filter(Boolean).join("\n");
}

async function normalizeHero(buffer) {
  return sharp(buffer)
    .rotate()
    .resize(1024, 1024, { fit: "cover", position: "attention" })
    .png()
    .toBuffer();
}

async function generateAiBackground(heroBuffer, prompt) {
  const normalized = await normalizeHero(heroBuffer);
  const errors = [];
  for (const model of IMAGE_MODELS) {
    try {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("image", new Blob([normalized], { type: "image/png" }), "demac-hero.png");
      form.append("size", "1024x1024");
      form.append("quality", "high");
      form.append("input_fidelity", "high");
      form.append("output_format", "png");

      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${openAiApiKey.value()}` },
        body: form,
      });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { /* handled below */ }
      const result = payload?.data?.[0]?.b64_json;
      if (!response.ok || !result) {
        errors.push(`${model}: ${payload?.error?.message || text || `HTTP ${response.status}`}`);
        continue;
      }
      return {
        buffer: Buffer.from(result, "base64"),
        mode: "ai_edit",
        imageModel: model,
        imageGenerationError: "",
      };
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    buffer: heroBuffer,
    mode: "deterministic_fallback",
    imageModel: "",
    imageGenerationError: errors.join(" | ").slice(0, 1800),
  };
}

async function fallbackBackground(heroBuffer) {
  const base = await sharp(heroBuffer)
    .rotate()
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover", position: "attention" })
    .modulate({ brightness: 0.88, saturation: 0.9 })
    .blur(0.15)
    .png()
    .toBuffer();
  return base;
}

function priceTagSvg(product, x, y, width = 250) {
  return `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="112" rx="20" fill="#ffffff" fill-opacity="0.96"/>
      <rect x="${x}" y="${y}" width="7" height="112" rx="4" fill="#1769e0"/>
      <text x="${x + 20}" y="${y + 34}" class="tag-btu">${escapeXml(product.btu)}</text>
      <text x="${x + 20}" y="${y + 73}" class="tag-price">${escapeXml(product.price)}</text>
      <text x="${x + 20}" y="${y + 98}" class="tag-spec">${escapeXml(product.specs)}</text>
    </g>`;
}

function overlaySvg(exact, template) {
  const headline = wrapText(exact.headline, template === "minimal_center" ? 27 : 25, 2);
  const subheadline = wrapText(exact.subheadline, 42, 2);
  const hasProducts = exact.products.length > 0;
  const contentBottom = OUTPUT_SIZE - FOOTER_RESERVED_PX;
  const ctaY = hasProducts ? 790 : 820;

  let textBlock = "";
  if (template === "minimal_center") {
    textBlock = `
      <rect x="80" y="74" width="920" height="${hasProducts ? 285 : 330}" rx="34" fill="#092243" fill-opacity="0.82"/>
      ${textLines(headline, 540, 150, 68, "headline center", "middle")}
      ${textLines(subheadline, 540, 272, 38, "sub center", "middle")}
    `;
  } else if (template === "high_contrast") {
    textBlock = `
      <rect x="0" y="0" width="650" height="${hasProducts ? 390 : 515}" fill="#071a33" fill-opacity="0.88"/>
      <rect x="0" y="0" width="18" height="${hasProducts ? 390 : 515}" fill="#3184f5"/>
      ${textLines(headline, 58, 112, 70, "headline", "start")}
      ${textLines(subheadline, 60, 260, 38, "sub", "start")}
    `;
  } else {
    textBlock = `
      <defs>
        <linearGradient id="leftFade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#071a33" stop-opacity="0.9"/>
          <stop offset="72%" stop-color="#0b2a52" stop-opacity="0.58"/>
          <stop offset="100%" stop-color="#0b2a52" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="780" height="${hasProducts ? 420 : 560}" fill="url(#leftFade)"/>
      ${textLines(headline, 60, 115, 70, "headline", "start")}
      ${textLines(subheadline, 60, 272, 38, "sub", "start")}
    `;
  }

  const productBlock = hasProducts
    ? exact.products.map((product, index) => priceTagSvg(product, 50 + index * 342, 535, 315)).join("")
    : "";

  const offer = exact.offer
    ? `<g><rect x="60" y="${hasProducts ? 675 : 590}" width="620" height="54" rx="27" fill="#ffffff" fill-opacity="0.94"/><text x="84" y="${hasProducts ? 711 : 626}" class="offer">${escapeXml(exact.offer)}</text></g>`
    : "";

  const ctaText = exact.whatsapp ? `${exact.cta} · ${exact.whatsapp}` : exact.cta;
  const ctaWidth = Math.min(880, Math.max(520, 280 + ctaText.length * 10));
  const ctaX = 60;
  const cta = `
    <g>
      <rect x="${ctaX}" y="${ctaY}" width="${ctaWidth}" height="86" rx="30" fill="#19a86b"/>
      <text x="${ctaX + 34}" y="${ctaY + 55}" class="cta">${escapeXml(ctaText)}</text>
    </g>`;

  return Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${OUTPUT_SIZE}" height="${OUTPUT_SIZE}">
    <style>
      .headline { font-family: Arial, Helvetica, sans-serif; font-weight: 900; font-size: 60px; fill: #ffffff; letter-spacing: -1px; }
      .sub { font-family: Arial, Helvetica, sans-serif; font-weight: 700; font-size: 30px; fill: #eaf3ff; }
      .center { text-anchor: middle; }
      .tag-btu { font-family: Arial, Helvetica, sans-serif; font-weight: 800; font-size: 19px; fill: #1769e0; }
      .tag-price { font-family: Arial, Helvetica, sans-serif; font-weight: 900; font-size: 34px; fill: #102038; }
      .tag-spec { font-family: Arial, Helvetica, sans-serif; font-weight: 700; font-size: 13px; fill: #65758b; }
      .offer { font-family: Arial, Helvetica, sans-serif; font-weight: 800; font-size: 21px; fill: #102038; }
      .cta { font-family: Arial, Helvetica, sans-serif; font-weight: 900; font-size: 26px; fill: #ffffff; }
    </style>
    <rect x="0" y="0" width="${OUTPUT_SIZE}" height="${OUTPUT_SIZE}" fill="transparent"/>
    ${textBlock}
    ${productBlock}
    ${offer}
    ${cta}
    <rect x="0" y="${contentBottom}" width="${OUTPUT_SIZE}" height="${FOOTER_RESERVED_PX}" fill="#ffffff"/>
  </svg>`);
}

async function renderCreative(backgroundBuffer, exact, template) {
  const background = await sharp(backgroundBuffer)
    .rotate()
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover", position: "attention" })
    .png()
    .toBuffer();

  return sharp(background)
    .composite([{ input: overlaySvg(exact, template), top: 0, left: 0 }])
    .png({ compressionLevel: 8 })
    .toBuffer();
}

function hardChecks({ campaign, brand, exact, selectedProducts }) {
  const approvedProducts = new Set(Array.isArray(brand.approvedProducts) ? brand.approvedProducts : []);
  const productFactsApproved = selectedProducts.every((product) => approvedProducts.has(product.source));
  const whatsappExact = exact.whatsapp === safeString(brand.whatsapp, 40);
  const languagePassed = campaign.papiamentoValidationStatus === "passed";
  const footerReserved = FOOTER_RESERVED_PX >= 140;
  return {
    brandCenterLive: true,
    languagePassed,
    exactWhatsapp: whatsappExact,
    productFactsApproved,
    footerReserved,
    allPassed: languagePassed && whatsappExact && productFactsApproved && footerReserved,
  };
}

async function visualQa(imageBuffer, hard, exact, campaign) {
  const prompt = [
    "You are the final visual quality-control reviewer for a premium DEMAC Professional Cooling Solutions Facebook/Instagram square advertisement.",
    "Evaluate only the visible design quality of this rendered ad: mobile legibility, hierarchy, contrast, spacing, premium/professional feel, preservation of the real HVAC photo, and whether the bottom footer-reserved zone is clean and free of content.",
    "Do not invent or correct commercial facts. Exact phone/prices/BTU are checked deterministically by code, not by your OCR.",
    `Expected visible headline: ${exact.headline}`,
    `Expected CTA family: ${exact.cta}`,
    `Campaign type: ${safeString(campaign.campaignType, 80)}`,
    "A pass requires the ad to look commercially usable on a phone at a glance, with a clearly blank lower footer zone and no obvious AI distortion of people/equipment.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: QA_MODEL,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: `data:image/png;base64,${imageBuffer.toString("base64")}`, detail: "high" },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "demac_marketing_creative_qa",
          strict: true,
          schema: QA_SCHEMA,
        },
      },
    }),
  });

  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { /* handled below */ }
  if (!response.ok) {
    throw new Error(payload?.error?.message || text || `OpenAI QA HTTP ${response.status}`);
  }
  const parsedText = outputText(payload);
  if (!parsedText) throw new Error("Visual QA returned no structured output.");
  const parsed = JSON.parse(parsedText);

  const scorePass = Number(parsed.overallScore) >= 82
    && Number(parsed.mobileLegibility) >= 80
    && Number(parsed.footerClearance) >= 85
    && Number(parsed.professionalism) >= 80;

  return {
    source: "openai_vision",
    status: hard.allPassed && parsed.pass === true && scorePass ? "passed" : "failed",
    score: Number(parsed.overallScore) || 0,
    mobileLegibility: Number(parsed.mobileLegibility) || 0,
    visualHierarchy: Number(parsed.visualHierarchy) || 0,
    contrast: Number(parsed.contrast) || 0,
    footerClearance: Number(parsed.footerClearance) || 0,
    authenticity: Number(parsed.authenticity) || 0,
    professionalism: Number(parsed.professionalism) || 0,
    issues: Array.isArray(parsed.issues) ? parsed.issues.map((item) => safeString(item, 300)).filter(Boolean).slice(0, 10) : [],
    revisionInstructions: Array.isArray(parsed.revisionInstructions)
      ? parsed.revisionInstructions.map((item) => safeString(item, 300)).filter(Boolean).slice(0, 8)
      : [],
    hardChecks: hard,
  };
}

function qaFallback(error, hard) {
  return {
    source: "deterministic_fallback",
    status: "needs_review",
    score: hard.allPassed ? 75 : 45,
    mobileLegibility: 0,
    visualHierarchy: 0,
    contrast: 0,
    footerClearance: hard.footerReserved ? 100 : 0,
    authenticity: 0,
    professionalism: 0,
    issues: [`Automated visual QA could not complete: ${safeString(error instanceof Error ? error.message : String(error), 500)}`],
    revisionInstructions: [],
    hardChecks: hard,
  };
}

async function fetchImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new HttpsError("failed-precondition", `Hero image could not be downloaded (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) {
    throw new HttpsError("failed-precondition", "Hero image is empty or too large.");
  }
  return buffer;
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
    contentType: "image/png",
    metadata: {
      cacheControl: "private,max-age=3600",
      metadata: {
        firebaseStorageDownloadTokens: token,
        ...metadata,
      },
    },
  });
  return {
    path,
    url: storageDownloadUrl(bucket.name, path, token),
  };
}

async function nextVersion(sessionId) {
  const snapshot = await db.collection("marketingCreatives").where("sessionId", "==", sessionId).get();
  let max = 0;
  for (const doc of snapshot.docs) {
    max = Math.max(max, Number(doc.data()?.version) || 0);
  }
  return max + 1;
}

async function buildCreative({ sessionId, uid, profile }) {
  const core = await loadCore(sessionId);
  const { campaign, brand, hero } = core;
  const version = await nextVersion(sessionId);
  const creativeId = `${sessionId}-v${version}-${randomUUID().slice(0, 8)}`;
  const exact = exactTextForCreative(campaign, brand);
  const hard = hardChecks({ campaign, brand, exact, selectedProducts: exact.products });

  await db.collection("marketingUploadSessions").doc(sessionId).set({
    creativeStatus: "processing",
    creativeRequestedAt: FieldValue.serverTimestamp(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  const heroBuffer = await fetchImageBuffer(hero.downloadUrl);
  const previousSnap = await db.collection("marketingCreatives")
    .where("sessionId", "==", sessionId)
    .get();
  const previousIssues = previousSnap.docs
    .sort((a, b) => (Number(b.data()?.version) || 0) - (Number(a.data()?.version) || 0))[0]
    ?.data()?.qa?.issues || [];

  const prompt = imagePrompt({ campaign, brand, hero, previousIssues });
  const generated = await generateAiBackground(heroBuffer, prompt);
  const baseBuffer = generated.mode === "ai_edit"
    ? generated.buffer
    : await fallbackBackground(generated.buffer);

  const templates = version % 2 === 0
    ? ["high_contrast", "premium_left"]
    : ["premium_left", "minimal_center"];

  let finalImage = null;
  let finalQa = null;
  let finalTemplate = templates[0];

  for (let attempt = 0; attempt < Math.min(MAX_RENDER_ATTEMPTS, templates.length); attempt += 1) {
    const template = templates[attempt];
    const rendered = await renderCreative(baseBuffer, exact, template);
    let qa;
    try {
      qa = await visualQa(rendered, hard, exact, campaign);
    } catch (error) {
      qa = qaFallback(error, hard);
    }
    finalImage = rendered;
    finalQa = { ...qa, attempt: attempt + 1 };
    finalTemplate = template;
    if (qa.status === "passed") break;
    if (qa.status === "needs_review") break;
  }

  if (!finalImage || !finalQa) throw new HttpsError("internal", "Creative renderer did not produce an output.");

  const storagePath = `marketing/generated/${sessionId}/${creativeId}.png`;
  const uploaded = await saveImage(storagePath, finalImage, {
    sessionId,
    assetId: creativeId,
    uploadedByUid: uid,
    variant: "generated",
    sourceHeroAssetId: hero.id,
  });

  const now = new Date().toISOString();
  const status = finalQa.status === "passed" ? "qa_passed" : finalQa.status === "failed" ? "qa_failed" : "needs_review";
  const record = {
    id: creativeId,
    sessionId,
    campaignId: campaign.id,
    campaignType: campaign.campaignType,
    version,
    status,
    heroAssetId: hero.id,
    imageStoragePath: uploaded.path,
    imageUrl: uploaded.url,
    width: OUTPUT_SIZE,
    height: OUTPUT_SIZE,
    reservedFooterPx: FOOTER_RESERVED_PX,
    renderTemplate: finalTemplate,
    renderMode: generated.mode,
    imageModel: generated.imageModel || null,
    imageGenerationError: generated.imageGenerationError || null,
    exactText: {
      headline: exact.headline,
      subheadline: exact.subheadline,
      cta: exact.cta,
      whatsapp: exact.whatsapp,
      offer: exact.offer,
      products: exact.products,
    },
    captionText: safeString(campaign.copy?.primaryText, 700),
    qa: finalQa,
    papiamentoValidationStatus: campaign.papiamentoValidationStatus || "needs_review",
    createdAt: now,
    updatedAt: now,
    createdByUserId: uid,
    createdByName: safeString(profile.name || profile.displayName || profile.email, 160),
  };

  await db.collection("marketingCreatives").doc(creativeId).set(record);
  await db.collection("marketingUploadSessions").doc(sessionId).set({
    creativeStatus: status,
    latestCreativeId: creativeId,
    creativeCompletedAt: FieldValue.serverTimestamp(),
    updatedAt: now,
  }, { merge: true });

  return record;
}

exports.requestMarketingCreativeBuild = onCall({
  region: "us-central1",
  timeoutSeconds: 540,
  memory: "1GiB",
  secrets: [openAiApiKey],
}, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Firebase authentication is required.");
  const profile = await requireMarketingUser(request.auth.uid);
  const sessionId = cleanId(request.data?.sessionId, "marketing session id");
  try {
    const creative = await buildCreative({ sessionId, uid: request.auth.uid, profile });
    return {
      creativeId: creative.id,
      version: creative.version,
      status: creative.status,
      imageUrl: creative.imageUrl,
      qa: creative.qa,
      renderMode: creative.renderMode,
    };
  } catch (error) {
    await db.collection("marketingUploadSessions").doc(sessionId).set({
      creativeStatus: "failed",
      creativeError: safeString(error instanceof Error ? error.message : String(error), 1200),
      updatedAt: new Date().toISOString(),
    }, { merge: true }).catch(() => undefined);
    if (error instanceof HttpsError) throw error;
    console.error("Marketing creative build failed", error);
    throw new HttpsError("internal", safeString(error instanceof Error ? error.message : String(error), 1200) || "Creative build failed.");
  }
});

exports.approveMarketingCreative = onCall({
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "512MiB",
}, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Firebase authentication is required.");
  const profile = await requireMarketingUser(request.auth.uid);
  const creativeId = cleanId(request.data?.creativeId, "creative id");

  const ref = db.collection("marketingCreatives").doc(creativeId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Creative was not found.");
  const creative = { id: snapshot.id, ...snapshot.data() };

  if (creative.status === "approved" && creative.approvedUrl) {
    return { creativeId, status: "approved", approvedUrl: creative.approvedUrl };
  }
  if (creative.qa?.status !== "passed" || creative.status !== "qa_passed") {
    throw new HttpsError("failed-precondition", "Creative must pass Visual QA before approval.");
  }
  if (creative.papiamentoValidationStatus !== "passed") {
    throw new HttpsError("failed-precondition", "Papiamento copy must pass validation before approval.");
  }

  const bucket = storage.bucket();
  const source = bucket.file(creative.imageStoragePath);
  const approvedPath = `marketing/approved/${creative.sessionId}/${creativeId}.png`;
  const destination = bucket.file(approvedPath);
  await source.copy(destination);
  const token = randomUUID();
  await destination.setMetadata({
    contentType: "image/png",
    cacheControl: "private,max-age=3600",
    metadata: {
      firebaseStorageDownloadTokens: token,
      sessionId: creative.sessionId,
      assetId: creativeId,
      uploadedByUid: request.auth.uid,
      variant: "approved",
    },
  });
  const approvedUrl = storageDownloadUrl(bucket.name, approvedPath, token);
  const now = new Date().toISOString();

  await ref.set({
    status: "approved",
    approvedStoragePath: approvedPath,
    approvedUrl,
    approvedAt: now,
    approvedByUserId: request.auth.uid,
    approvedByName: safeString(profile.name || profile.displayName || profile.email, 160),
    updatedAt: now,
  }, { merge: true });

  return { creativeId, status: "approved", approvedUrl };
});
