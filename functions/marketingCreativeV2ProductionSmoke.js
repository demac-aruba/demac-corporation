const https = require('node:https');
const { randomUUID } = require('node:crypto');
const { cert, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldPath, getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const sharp = require('sharp');

const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
initializeApp({
  credential: cert(credentials),
  projectId: 'demac-corporation',
  storageBucket: 'demac-corporation.firebasestorage.app',
});

const auth = getAuth();
const db = getFirestore();
const bucket = getStorage().bucket();
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
const CREATIVE_URL = process.env.CREATIVE_URL;
const READ_URL = process.env.READ_URL;
const SMOKE_PREFIX = 'marketing-v2-smoke-';
const REQUEST_TIMEOUT_MS = 16 * 60 * 1000;

function nativeRequest(urlString, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      timeout: REQUEST_TIMEOUT_MS,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        buffer: Buffer.concat(chunks),
      }));
    });
    request.on('timeout', () => request.destroy(new Error(`HTTPS request exceeded ${REQUEST_TIMEOUT_MS}ms.`)));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function exchangeCustomToken(customToken) {
  const body = JSON.stringify({ token: customToken, returnSecureToken: true });
  const response = await nativeRequest(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(WEB_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body,
  });
  const payload = JSON.parse(response.buffer.toString('utf8') || '{}');
  if (response.status < 200 || response.status >= 300 || !payload.idToken) {
    throw new Error(`Token exchange failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload.idToken;
}

async function callCallable(url, idToken, data) {
  const body = JSON.stringify({ data });
  const response = await nativeRequest(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
  const text = response.buffer.toString('utf8');
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {}
  if (response.status < 200 || response.status >= 300 || payload.error) {
    throw new Error(`Callable failed (${response.status}): ${payload?.error?.message || text}`);
  }
  return payload.result ?? payload.data ?? payload;
}

async function makeSyntheticHvac() {
  const svg = Buffer.from(`<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5f7f8"/><stop offset="1" stop-color="#c7d4dc"/></linearGradient></defs>
    <rect width="1024" height="1024" fill="url(#wall)"/>
    <rect y="720" width="1024" height="304" fill="#8ba36e"/>
    <rect x="85" y="90" width="854" height="630" rx="12" fill="#f8f8f4"/>
    <rect x="635" y="155" width="210" height="270" fill="#9dc3d3"/>
    <rect x="305" y="505" width="390" height="255" rx="20" fill="#fbfcfd" stroke="#7b8993" stroke-width="12"/>
    <circle cx="500" cy="632" r="91" fill="#d8e0e5" stroke="#7f8d97" stroke-width="10"/>
    <g stroke="#8797a1" stroke-width="7"><line x1="500" y1="566" x2="500" y2="698"/><line x1="434" y1="632" x2="566" y2="632"/><line x1="454" y1="586" x2="546" y2="678"/><line x1="546" y1="586" x2="454" y2="678"/></g>
    <path d="M695 570 C790 535 842 475 878 385" fill="none" stroke="#dfe6e9" stroke-width="24"/>
    <g fill="#527f45"><ellipse cx="180" cy="825" rx="95" ry="28" transform="rotate(-18 180 825)"/><ellipse cx="820" cy="830" rx="105" ry="29" transform="rotate(16 820 830)"/></g>
  </svg>`);
  return sharp(svg).png().toBuffer();
}

async function deleteQuery(collectionName, field = 'syntheticSmokeTest', value = true) {
  const snapshot = await db.collection(collectionName).where(field, '==', value).get().catch(() => null);
  if (!snapshot) return 0;
  await Promise.allSettled(snapshot.docs.map((doc) => doc.ref.delete()));
  return snapshot.size;
}

async function cleanupSynthetic() {
  const creativeSnap = await db.collection('marketingCreatives').get().catch(() => null);
  if (creativeSnap) {
    await Promise.allSettled(creativeSnap.docs
      .filter((doc) => String(doc.data()?.sessionId || '').startsWith(SMOKE_PREFIX))
      .map((doc) => doc.ref.delete()));
  }
  for (const collection of ['marketingCampaigns', 'marketingUploadSessions', 'marketingAssets', 'users']) {
    await deleteQuery(collection);
  }
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken).catch(() => ({ users: [], pageToken: undefined }));
    const smokeUsers = page.users.filter((user) => String(user.email || '').startsWith(SMOKE_PREFIX));
    await Promise.allSettled(smokeUsers.map((user) => auth.deleteUser(user.uid)));
    pageToken = page.pageToken;
  } while (pageToken);
  for (const prefix of ['marketing/originals/marketing-v2-smoke-', 'marketing/generated/marketing-v2-smoke-', 'marketing/approved/marketing-v2-smoke-']) {
    const [files] = await bucket.getFiles({ prefix }).catch(() => [[]]);
    await Promise.allSettled((files || []).map((file) => file.delete()));
  }
}

(async () => {
  await cleanupSynthetic();
  console.log('Pre-smoke synthetic cleanup complete.');

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${SMOKE_PREFIX}${stamp}@demac-smoke.test`;
  const sessionId = `${SMOKE_PREFIX}${stamp}`;
  const assetId = `marketing-v2-hero-${stamp}`;
  const originalPath = `marketing/originals/${sessionId}/synthetic-hvac.png`;
  let uid;

  const sessionRef = db.collection('marketingUploadSessions').doc(sessionId);
  const campaignRef = db.collection('marketingCampaigns').doc(sessionId);
  const assetRef = db.collection('marketingAssets').doc(assetId);

  try {
    const brand = await db.collection('marketingBrandSettings').doc('default').get();
    if (!brand.exists) throw new Error('Live Brand Center default is missing.');

    const user = await auth.createUser({ email, emailVerified: true, displayName: 'Marketing Creative V2 smoke' });
    uid = user.uid;
    const now = new Date().toISOString();
    await db.collection('users').doc(uid).set({
      id: uid, name: 'Marketing Creative V2 smoke', displayName: 'Marketing Creative V2 smoke', email,
      active: true, role: 'admin', createdAt: now, updatedAt: now, syntheticSmokeTest: true,
    });

    const image = await makeSyntheticHvac();
    const token = randomUUID();
    await bucket.file(originalPath).save(image, {
      resumable: false,
      contentType: 'image/png',
      metadata: { metadata: { firebaseStorageDownloadTokens: token, syntheticSmokeTest: 'true' } },
    });
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(originalPath)}?alt=media&token=${encodeURIComponent(token)}`;

    await sessionRef.set({
      id: sessionId, name: 'Creative V2 production smoke', campaignType: 'installation', status: 'ready',
      expectedAssetCount: 1, uploadedAssetCount: 1, failedAssetCount: 0,
      analysisStatus: 'completed', analyzedAssetCount: 1, usableAssetCount: 1, primaryAssetId: assetId,
      bestAssetIds: [assetId], recommendedCampaignType: 'installation', campaignStrategyStatus: 'completed',
      campaignStrategyId: sessionId, createdAt: now, updatedAt: now, createdByUserId: uid,
      createdByName: 'Marketing Creative V2 smoke', syntheticSmokeTest: true,
    });
    await assetRef.set({
      id: assetId, sessionId, originalFileName: 'synthetic-hvac.png', contentType: 'image/png', sizeBytes: image.length,
      storagePath: originalPath, downloadUrl, status: 'uploaded', analysisStatus: 'completed', rank: 1,
      rankingScore: 94, marketingSuitabilityScore: 95, qualityScore: 91, brandSafetyScore: 100,
      shotType: 'completed_outdoor_installation', recommendedCampaignType: 'installation',
      strengths: ['Clear installed condenser', 'Completed residential HVAC installation', 'Clean outdoor environment'],
      issues: [], recommendedUse: 'Synthetic installation hero for production smoke.',
      analysisSummary: 'A clean completed residential outdoor HVAC condenser installation against a light wall with landscaping and a visible window. No people and no sensitive information.',
      containsPerson: false, containsReadableSensitiveData: false, doNotUse: false,
      createdAt: now, updatedAt: now, uploadedByUserId: uid, syntheticSmokeTest: true,
    });
    await campaignRef.set({
      id: sessionId, sessionId, status: 'strategy_completed', campaignType: 'installation',
      objective: 'Generate WhatsApp inquiries by presenting a clean completed air-conditioning installation as proof of professional DEMAC workmanship.',
      angle: 'Real completed installation, premium cooling comfort and professional workmanship.',
      targetAction: 'WhatsApp inquiry', heroAssetId: assetId, supportingAssetIds: [],
      copy: {
        language: 'pap_aw', headline: 'Instala bo Airco Nobo', subheadline: 'Trabou profesional cu cuidado pa detaye.',
        primaryText: 'Confia riba DEMAC pa instala bo airco cu trabou limpi y profesional. WhatsApp nos awe mes.',
        cta: 'WhatsApp nos awe mes',
      },
      visualDirection: {
        heroTreatment: 'Make the real installed condenser the proof-of-work hero while creating a premium cooling advertising composition.',
        hierarchy: ['real installation', 'headline', 'CTA'],
        overlayNotes: ['Premium royal-blue and white commercial treatment', 'Keep equipment visible'],
        footerInstruction: 'Reserve blank bottom area for original DEMAC footer.',
      },
      factPolicy: { priceOrPromoIncluded: false, factNotes: ['No active promotion'] },
      papiamentoValidationStatus: 'passed', papiamentoUnknownWords: [], papiamentoForbiddenWords: [],
      papiamentoRevisionAttempted: false, createdAt: now, updatedAt: now, syntheticSmokeTest: true,
    });

    const idToken = await exchangeCustomToken(await auth.createCustomToken(uid));
    console.log(`Calling production Creative Builder V2 for ${sessionId}; native HTTPS timeout is 16 minutes...`);
    const startedAt = Date.now();
    const result = await callCallable(CREATIVE_URL, idToken, { sessionId });
    console.log(`Creative callable returned after ${Math.round((Date.now() - startedAt) / 1000)}s.`);

    const creativeSnap = await db.collection('marketingCreatives').doc(result.creativeId).get();
    if (!creativeSnap.exists) throw new Error('Creative record missing after callable result.');
    const creative = creativeSnap.data();
    const variants = Array.isArray(creative.variants) ? creative.variants : [];

    if (creative.builderVersion !== 'V2') throw new Error(`builderVersion=${creative.builderVersion}`);
    if (creative.renderMode !== 'ai_multivariant_v2') throw new Error(`renderMode=${creative.renderMode}`);
    if (creative.artDirectorModel !== 'gpt-5.6-sol') throw new Error(`artDirectorModel=${creative.artDirectorModel}`);
    if (creative.imageModel !== 'gpt-image-2') throw new Error(`imageModel=${creative.imageModel}`);
    if (creative.qaModel !== 'gpt-5.6-sol') throw new Error(`qaModel=${creative.qaModel}`);
    if (variants.length < 3) throw new Error(`Expected >=3 variants, got ${variants.length}`);
    for (const required of ['premium_clean', 'sales_impact', 'social_proof']) {
      if (!variants.some((variant) => variant.conceptId === required)) throw new Error(`Missing base concept ${required}`);
    }
    if (variants.some((variant) => variant.imageModel !== 'gpt-image-2')) throw new Error('A variant did not use gpt-image-2.');
    if (!creative.selectedVariantId || !variants.some((variant) => variant.id === creative.selectedVariantId)) throw new Error('Selected variant missing.');
    if (!creative.qa || typeof creative.qa.creativeQuality !== 'number' || typeof creative.qa.agencyFeel !== 'number' || typeof creative.qa.scrollStoppingPower !== 'number' || typeof creative.qa.photoIntegration !== 'number') {
      throw new Error('Strict V2 QA metrics missing.');
    }

    const imageResponse = await nativeRequest(creative.imageUrl);
    if (imageResponse.status < 200 || imageResponse.status >= 300) throw new Error(`Selected image download failed: ${imageResponse.status}`);
    const metadata = await sharp(imageResponse.buffer).metadata();
    if (metadata.width !== 1080 || metadata.height !== 1080) throw new Error(`Unexpected PNG dimensions ${metadata.width}x${metadata.height}`);
    const footerBuffer = await sharp(imageResponse.buffer).extract({ left: 0, top: 1080 - 156, width: 1080, height: 156 }).png().toBuffer();
    const stats = await sharp(footerBuffer).stats();
    const rgb = stats.channels.slice(0, 3).map((channel) => channel.mean);
    if (rgb.some((value) => value < 250)) throw new Error(`Footer is not clean white: ${rgb.join(',')}`);

    const readState = await callCallable(READ_URL, idToken, { sessionId });
    if (!Array.isArray(readState.creatives) || !readState.creatives.some((item) => item.id === creativeSnap.id)) {
      throw new Error('Authenticated creative read did not return V2 creative.');
    }
    const sessionAfter = (await sessionRef.get()).data() || {};
    if (!['qa_passed', 'qa_failed'].includes(sessionAfter.creativeStatus)) throw new Error(`Unexpected creativeStatus=${sessionAfter.creativeStatus}`);
    if (Number(sessionAfter.creativeProgress?.percent) !== 100) throw new Error(`Progress did not reach 100: ${JSON.stringify(sessionAfter.creativeProgress)}`);

    console.log('CREATIVE_V2_PRODUCTION_SMOKE_PASS', JSON.stringify({
      builderVersion: creative.builderVersion,
      artDirectorModel: creative.artDirectorModel,
      imageModel: creative.imageModel,
      qaModel: creative.qaModel,
      variantIds: variants.map((variant) => variant.id),
      selectedVariantId: creative.selectedVariantId,
      selectedStatus: creative.qa.status,
      qa: {
        overall: creative.qa.score,
        creativeQuality: creative.qa.creativeQuality,
        agencyFeel: creative.qa.agencyFeel,
        scrollStoppingPower: creative.qa.scrollStoppingPower,
        photoIntegration: creative.qa.photoIntegration,
        ctaProminence: creative.qa.ctaProminence,
      },
      dimensions: `${metadata.width}x${metadata.height}`,
      footerRgb: rgb.map((value) => Number(value.toFixed(2))),
      progress: sessionAfter.creativeProgress,
      autoRevised: creative.autoRevised,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    }));
  } finally {
    await cleanupSynthetic();
    console.log('Post-smoke synthetic cleanup complete.');
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
