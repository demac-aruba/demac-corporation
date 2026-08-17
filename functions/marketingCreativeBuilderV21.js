const { randomUUID } = require('node:crypto');
const { getApp, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret('OPENAI_API_KEY');
const v2 = require('./marketingCreativeBuilderV2Compat');
const engine = v2.__marketingCreativeBuilderV2Internal;
const constants = v2.__marketingCreativeBuilderV2Test;

if (!engine) throw new Error('Marketing Creative Builder V2.1 requires V2 internal engine exports.');

const BUILD_COLLECTION = 'marketingCreativeBuilds';
const STAGE_META = {
  premium_clean: { index: 0, start: 26, done: 43, label: 'Premium Clean' },
  sales_impact: { index: 1, start: 46, done: 63, label: 'Sales Impact' },
  social_proof: { index: 2, start: 66, done: 83, label: 'Social Proof' },
};

function cleanId(value, label = 'id') {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 220 || !/^[a-zA-Z0-9._-]+$/.test(id)) throw new HttpsError('invalid-argument', `Invalid ${label}.`);
  return id;
}

function errorMessage(error) {
  return engine.safeString(error instanceof Error ? error.message : String(error), 1600) || 'Creative build stage failed.';
}

async function loadBuild(buildId, sessionId) {
  const snapshot = await db.collection(BUILD_COLLECTION).doc(buildId).get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Creative build was not found.');
  const build = { id: snapshot.id, ...snapshot.data() };
  if (build.sessionId !== sessionId) throw new HttpsError('permission-denied', 'Creative build does not belong to this session.');
  return build;
}

async function markStageError(sessionId, buildId, stage, error) {
  const message = errorMessage(error);
  const now = new Date().toISOString();
  await Promise.allSettled([
    db.collection(BUILD_COLLECTION).doc(buildId).set({
      status: 'stage_failed',
      lastError: message,
      lastFailedStage: stage,
      updatedAt: now,
    }, { merge: true }),
    db.collection('marketingUploadSessions').doc(sessionId).set({
      creativeStatus: 'failed',
      creativeError: message,
      creativeProgress: { stage: `${stage}_failed`, percent: 100, label: message, updatedAt: now },
      updatedAt: now,
    }, { merge: true }),
  ]);
  return message;
}

async function requestPlan(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Firebase authentication is required.');
  const profile = await engine.requireMarketingUser(request.auth.uid);
  const sessionId = cleanId(request.data?.sessionId, 'marketing session id');
  let buildId = '';
  try {
    const core = await engine.loadCore(sessionId);
    const { campaign, brand, hero } = core;
    if (campaign.papiamentoValidationStatus !== 'passed') throw new HttpsError('failed-precondition', 'Papiamento copy must pass validation before creative generation.');
    const exact = engine.exactTextForCreative(campaign, brand);
    const hard = engine.hardChecks({ campaign, brand, exact });
    if (!hard.allPassed) throw new HttpsError('failed-precondition', 'Creative hard checks did not pass before rendering.');

    const version = await engine.nextVersion(sessionId);
    buildId = `${sessionId}-build-${randomUUID().slice(0, 10)}`;
    const creativeId = `${sessionId}-v${version}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    await db.collection('marketingUploadSessions').doc(sessionId).set({
      creativeStatus: 'processing',
      activeCreativeBuildId: buildId,
      creativeRequestedAt: FieldValue.serverTimestamp(),
      creativeError: FieldValue.delete(),
      updatedAt: now,
    }, { merge: true });
    await engine.setProgress(sessionId, 'prepare', 5, 'Preparing campaign and real source photo…', { buildId });

    const heroBuffer = await engine.fetchImageBuffer(hero.downloadUrl);
    const issues = await engine.previousIssues(sessionId);
    await engine.setProgress(sessionId, 'art_direction', 12, 'GPT-5.6 Sol is creating three agency art directions…', { buildId });
    const artDirection = await engine.createArtDirection(core, heroBuffer, issues);

    await db.collection(BUILD_COLLECTION).doc(buildId).set({
      id: buildId,
      sessionId,
      creativeId,
      version,
      status: 'planned',
      builderVersion: 'V2.1',
      campaignId: campaign.id,
      campaignType: campaign.campaignType,
      heroAssetId: hero.id,
      artDirection,
      exactText: exact,
      hardChecks: hard,
      variants: {},
      createdAt: now,
      updatedAt: now,
      createdByUserId: request.auth.uid,
      createdByName: engine.safeString(profile.name || profile.displayName || profile.email, 160),
    });
    await engine.setProgress(sessionId, 'concepts_ready', 20, 'Art direction ready. Premium Clean is next.', { buildId, totalVariants: 3, completedVariants: 0 });
    return { buildId, creativeId, version, conceptIds: artDirection.concepts.map((concept) => concept.id), builderVersion: 'V2.1' };
  } catch (error) {
    if (buildId) await markStageError(sessionId, buildId, 'plan', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', errorMessage(error));
  }
}

async function requestVariant(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Firebase authentication is required.');
  await engine.requireMarketingUser(request.auth.uid);
  const sessionId = cleanId(request.data?.sessionId, 'marketing session id');
  const buildId = cleanId(request.data?.buildId, 'creative build id');
  const conceptId = cleanId(request.data?.conceptId, 'creative concept id');
  const meta = STAGE_META[conceptId];
  if (!meta) throw new HttpsError('invalid-argument', 'Unsupported creative concept.');
  try {
    const build = await loadBuild(buildId, sessionId);
    if (build.variants?.[conceptId]) return { buildId, conceptId, variant: build.variants[conceptId], reused: true };
    const core = await engine.loadCore(sessionId);
    const concept = build.artDirection?.concepts?.find((item) => item.id === conceptId);
    if (!concept) throw new HttpsError('failed-precondition', `Art direction for ${conceptId} is missing.`);
    const exact = engine.exactTextForCreative(core.campaign, core.brand);
    const hard = engine.hardChecks({ campaign: core.campaign, brand: core.brand, exact });
    if (!hard.allPassed) throw new HttpsError('failed-precondition', 'Creative hard checks no longer pass.');

    await db.collection(BUILD_COLLECTION).doc(buildId).set({ status: 'rendering', lastError: FieldValue.delete(), lastFailedStage: FieldValue.delete(), updatedAt: new Date().toISOString() }, { merge: true });
    await engine.setProgress(sessionId, `render_${conceptId}`, meta.start, `Generating ${meta.label} with GPT Image 2…`, { buildId, currentVariant: conceptId });
    const heroBuffer = await engine.fetchImageBuffer(core.hero.downloadUrl);
    const variant = await engine.renderVariant({
      sessionId,
      creativeId: build.creativeId,
      concept,
      heroBuffer,
      exact,
      hard,
      core,
      variantIndex: meta.index,
      reportProgress: false,
    });

    const fresh = await loadBuild(buildId, sessionId);
    const variants = { ...(fresh.variants || {}), [conceptId]: variant };
    const completedVariants = Object.keys(variants).filter((id) => !id.endsWith('_revision')).length;
    await db.collection(BUILD_COLLECTION).doc(buildId).set({ variants, status: completedVariants >= 3 ? 'variants_ready' : 'rendering', updatedAt: new Date().toISOString() }, { merge: true });
    await engine.setProgress(sessionId, `complete_${conceptId}`, meta.done, `${meta.label} ready${completedVariants < 3 ? '. Continuing to the next concept…' : '. All three concepts are ready.'}`, { buildId, currentVariant: conceptId, completedVariants, totalVariants: 3 });
    return { buildId, conceptId, variant, completedVariants, reused: false };
  } catch (error) {
    const message = await markStageError(sessionId, buildId, `variant_${conceptId}`, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', message);
  }
}

function sortedVariants(build) {
  return Object.values(build.variants || {}).filter(Boolean).sort((a, b) => (Number(b.selectionScore) || 0) - (Number(a.selectionScore) || 0));
}

async function requestRevision(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Firebase authentication is required.');
  await engine.requireMarketingUser(request.auth.uid);
  const sessionId = cleanId(request.data?.sessionId, 'marketing session id');
  const buildId = cleanId(request.data?.buildId, 'creative build id');
  try {
    const build = await loadBuild(buildId, sessionId);
    const variants = sortedVariants(build);
    if (variants.length < 3) throw new HttpsError('failed-precondition', 'Generate all three base concepts before auto-revision.');
    const already = variants.find((variant) => variant.revised || variant.id?.endsWith('_revision'));
    if (already) return { buildId, variant: already, reused: true };
    const selected = variants.find((variant) => variant.qa?.status === 'passed') || variants[0];
    if (selected.qa?.status === 'passed') return { buildId, skipped: true, reason: 'A base concept already passed QA.' };
    const concept = build.artDirection?.concepts?.find((item) => item.id === selected.conceptId);
    if (!concept) throw new HttpsError('failed-precondition', 'Winning concept art direction is missing.');
    const core = await engine.loadCore(sessionId);
    const exact = engine.exactTextForCreative(core.campaign, core.brand);
    const hard = engine.hardChecks({ campaign: core.campaign, brand: core.brand, exact });
    await engine.setProgress(sessionId, 'auto_revision', 88, `Auto-revising ${concept.name} from strict QA feedback…`, { buildId, currentVariant: concept.id });
    const heroBuffer = await engine.fetchImageBuffer(core.hero.downloadUrl);
    const revised = await engine.renderVariant({
      sessionId,
      creativeId: build.creativeId,
      concept,
      heroBuffer,
      exact,
      hard,
      core,
      variantIndex: 3,
      revisionInstructions: selected.qa?.revisionInstructions || [],
      suffix: '_revision',
      reportProgress: false,
    });
    const fresh = await loadBuild(buildId, sessionId);
    const nextVariants = { ...(fresh.variants || {}), [revised.id]: revised };
    await db.collection(BUILD_COLLECTION).doc(buildId).set({ variants: nextVariants, status: 'revision_ready', autoRevised: true, updatedAt: new Date().toISOString() }, { merge: true });
    await engine.setProgress(sessionId, 'revision_ready', 94, 'QA-guided revision ready. Selecting the strongest creative…', { buildId, currentVariant: concept.id });
    return { buildId, variant: revised, reused: false };
  } catch (error) {
    const message = await markStageError(sessionId, buildId, 'revision', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', message);
  }
}

async function finalize(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Firebase authentication is required.');
  const profile = await engine.requireMarketingUser(request.auth.uid);
  const sessionId = cleanId(request.data?.sessionId, 'marketing session id');
  const buildId = cleanId(request.data?.buildId, 'creative build id');
  try {
    const build = await loadBuild(buildId, sessionId);
    const variants = sortedVariants(build);
    const baseVariants = variants.filter((variant) => !variant.revised && !variant.id?.endsWith('_revision'));
    if (baseVariants.length < 3) throw new HttpsError('failed-precondition', 'All three creative concepts must be generated before finalization.');
    let selected = variants.find((variant) => variant.qa?.status === 'passed') || variants[0];
    const hasRevision = variants.some((variant) => variant.revised || variant.id?.endsWith('_revision'));
    if (selected?.qa?.status !== 'passed' && !hasRevision) {
      await engine.setProgress(sessionId, 'revision_required', 86, 'No base concept passed strict QA. Preparing one guided revision…', { buildId, currentVariant: selected?.conceptId || '' });
      return { buildId, revisionRequired: true, selectedVariantId: selected?.id || '', selectedConceptId: selected?.conceptId || '' };
    }
    if (!selected) throw new HttpsError('internal', 'Creative Builder V2.1 did not produce a candidate.');

    await engine.setProgress(sessionId, 'finalize', 96, 'Finalizing the strongest creative and preserving all alternatives…', { buildId });
    const core = await engine.loadCore(sessionId);
    const exact = engine.exactTextForCreative(core.campaign, core.brand);
    const now = new Date().toISOString();
    const status = selected.qa?.status === 'passed' ? 'qa_passed' : 'qa_failed';
    const record = {
      id: build.creativeId,
      sessionId,
      campaignId: core.campaign.id,
      campaignType: core.campaign.campaignType,
      version: Number(build.version) || 1,
      status,
      builderVersion: 'V2.1',
      heroAssetId: core.hero.id,
      imageStoragePath: selected.imageStoragePath,
      imageUrl: selected.imageUrl,
      width: constants.OUTPUT_SIZE || 1080,
      height: constants.OUTPUT_SIZE || 1080,
      reservedFooterPx: constants.FOOTER_RESERVED_PX,
      renderTemplate: selected.conceptId,
      renderMode: 'ai_staged_v21',
      artDirectorModel: constants.ART_DIRECTOR_MODEL,
      imageModel: constants.IMAGE_MODEL,
      qaModel: constants.QA_MODEL,
      artDirection: {
        campaignSummary: engine.safeString(build.artDirection?.campaignSummary, 1000),
        creativeNorthStar: engine.safeString(build.artDirection?.creativeNorthStar, 1000),
      },
      selectedVariantId: selected.id,
      variantCount: variants.length,
      variants,
      autoRevised: Boolean(build.autoRevised || hasRevision),
      exactText: exact,
      captionText: engine.safeString(core.campaign.copy?.primaryText, 700),
      qa: selected.qa,
      papiamentoValidationStatus: core.campaign.papiamentoValidationStatus,
      createdAt: build.createdAt || now,
      updatedAt: now,
      createdByUserId: build.createdByUserId || request.auth.uid,
      createdByName: build.createdByName || engine.safeString(profile.name || profile.displayName || profile.email, 160),
    };
    await db.collection('marketingCreatives').doc(build.creativeId).set(record);
    await db.collection(BUILD_COLLECTION).doc(buildId).set({ status: 'completed', selectedVariantId: selected.id, finalCreativeStatus: status, completedAt: now, updatedAt: now }, { merge: true });
    await db.collection('marketingUploadSessions').doc(sessionId).set({
      creativeStatus: status,
      latestCreativeId: build.creativeId,
      activeCreativeBuildId: FieldValue.delete(),
      creativeCompletedAt: FieldValue.serverTimestamp(),
      creativeError: FieldValue.delete(),
      creativeProgress: { stage: 'completed', percent: 100, label: status === 'qa_passed' ? 'Best creative selected and strict QA passed.' : 'Creative variants generated; best candidate still needs review.', buildId, updatedAt: now },
      updatedAt: now,
    }, { merge: true });
    return { creativeId: record.id, version: record.version, status, imageUrl: record.imageUrl, qa: record.qa, renderMode: record.renderMode, builderVersion: record.builderVersion, selectedVariantId: record.selectedVariantId, variantCount: record.variantCount, revisionRequired: false };
  } catch (error) {
    const message = await markStageError(sessionId, buildId, 'finalize', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', message);
  }
}

exports.requestMarketingCreativePlan = onCall({ region: 'us-central1', timeoutSeconds: 300, memory: '1GiB', secrets: [openAiApiKey] }, requestPlan);
exports.requestMarketingCreativeVariant = onCall({ region: 'us-central1', timeoutSeconds: 720, memory: '2GiB', secrets: [openAiApiKey] }, requestVariant);
exports.requestMarketingCreativeRevision = onCall({ region: 'us-central1', timeoutSeconds: 720, memory: '2GiB', secrets: [openAiApiKey] }, requestRevision);
exports.finalizeMarketingCreativeBuild = onCall({ region: 'us-central1', timeoutSeconds: 180, memory: '512MiB' }, finalize);

exports.__marketingCreativeBuilderV21Test = {
  BUILD_COLLECTION,
  STAGE_META,
  builderVersion: 'V2.1',
  renderMode: 'ai_staged_v21',
};
