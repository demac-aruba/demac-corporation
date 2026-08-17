const { getApp, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const {
  openAiApiKey,
  normalizeSquare,
} = require('./marketingCreativeProvidersV3');
const {
  TEXT_TRANSCRIPTION_SCHEMA,
  transcriptionPrompt,
  evaluateCopyAudit,
  applyCopyAudit,
} = require('./marketingCreativeTextAuditV4');

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const storage = getStorage(app);
const COPY_AUDIT_MODEL = 'gpt-5.6-sol';
const COPY_GATE_VERSION = 1;
const MAX_CONCURRENT_AUDITS = 2;

function safeString(value, max = 1600) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
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
        headers: {
          Authorization: `Bearer ${openAiApiKey.value()}`,
          'Content-Type': 'application/json',
        },
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
  throw lastError || new Error(`${model} copy transcription failed.`);
}

async function downloadVariantBuffer(variant) {
  const path = safeString(variant?.imageStoragePath, 1200);
  if (!path) throw new Error(`Variant ${safeString(variant?.id, 120) || 'unknown'} has no imageStoragePath.`);
  const [buffer] = await storage.bucket().file(path).download();
  if (!buffer?.length) throw new Error(`Variant ${safeString(variant?.id, 120) || 'unknown'} image is empty.`);
  return buffer;
}

async function auditOneVariant(variant, exact) {
  try {
    const buffer = await downloadVariantBuffer(variant);
    const transcription = await structuredResponse({
      model: COPY_AUDIT_MODEL,
      prompt: transcriptionPrompt(),
      schemaName: `demac_v4_copy_transcription_${safeString(variant?.id, 80).replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'variant'}`,
      schema: TEXT_TRANSCRIPTION_SCHEMA,
      imageBuffers: [buffer],
    });
    const copyAudit = evaluateCopyAudit(transcription, exact);
    return {
      ...variant,
      qa: applyCopyAudit(variant?.qa || {}, copyAudit),
    };
  } catch (error) {
    const message = safeString(error instanceof Error ? error.message : String(error), 700) || 'Copy audit failed to execute.';
    const copyAudit = {
      source: 'independent_vision_transcription_v4',
      status: 'failed',
      allRequiredDetected: false,
      missingRequired: ['audit_unavailable'],
      checks: {},
      overlayLines: [],
      uncertainLines: [message],
    };
    return {
      ...variant,
      qa: applyCopyAudit({ ...(variant?.qa || {}), issues: [...(Array.isArray(variant?.qa?.issues) ? variant.qa.issues : []), message] }, copyAudit),
    };
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, () => run()));
  return results;
}

function chooseSelectedVariant(variants, previousSelectedVariantId) {
  const passed = variants
    .filter((variant) => variant?.qa?.status === 'passed' && variant?.qa?.copyAudit?.allRequiredDetected === true)
    .sort((a, b) => (Number(b?.qa?.selectionScore) || Number(b?.selectionScore) || 0) - (Number(a?.qa?.selectionScore) || Number(a?.selectionScore) || 0));
  if (passed.length) return passed[0];
  return variants.find((variant) => variant?.id === previousSelectedVariantId) || variants[0] || null;
}

async function auditCreativeRecord(creativeId) {
  const id = safeString(creativeId, 220);
  if (!id) throw new Error('Creative id is required for the copy gate.');
  const ref = db.collection('marketingCreatives').doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error('Creative was not found for copy audit.');
  const creative = { id: snapshot.id, ...snapshot.data() };
  if (creative.builderVersion !== 'V4') return creative;

  const variants = Array.isArray(creative.variants) ? creative.variants : [];
  if (!variants.length) throw new Error('V4 creative has no variants to audit.');
  const exact = creative.exactText || {};
  const auditedVariants = await mapWithConcurrency(variants, MAX_CONCURRENT_AUDITS, (variant) => auditOneVariant(variant, exact));
  const selected = chooseSelectedVariant(auditedVariants, creative.selectedVariantId);
  if (!selected) throw new Error('Copy gate could not select a creative variant.');

  const copyPassedCount = auditedVariants.filter((variant) => variant?.qa?.copyAudit?.allRequiredDetected === true).length;
  const fullyPassedCount = auditedVariants.filter((variant) => variant?.qa?.status === 'passed').length;
  const status = selected?.qa?.status === 'passed' ? 'qa_passed' : 'qa_failed';
  const now = new Date().toISOString();
  const update = {
    status,
    selectedVariantId: selected.id,
    imageStoragePath: selected.imageStoragePath,
    imageUrl: selected.imageUrl,
    imageModel: selected.imageModel || creative.imageModel,
    qa: selected.qa,
    variants: auditedVariants,
    copyAuditVersion: COPY_GATE_VERSION,
    copyAuditModel: COPY_AUDIT_MODEL,
    copyAuditCompletedAt: now,
    copyAuditSummary: {
      auditedCount: auditedVariants.length,
      copyPassedCount,
      fullyPassedCount,
      selectedCopyPassed: selected?.qa?.copyAudit?.allRequiredDetected === true,
    },
    updatedAt: now,
  };
  await ref.set(update, { merge: true });

  if (creative.sessionId) {
    await db.collection('marketingUploadSessions').doc(creative.sessionId).set({
      creativeStatus: status,
      creativeProgress: {
        stage: 'completed',
        percent: 100,
        label: status === 'qa_passed'
          ? `V4 independent copy gate passed; ${fullyPassedCount} candidate(s) remain eligible.`
          : `V4 independent copy gate completed; no ad-spend-ready candidate with verified exact copy remains.`,
        updatedAt: now,
      },
      updatedAt: now,
    }, { merge: true });
  }

  return { ...creative, ...update };
}

module.exports = {
  COPY_AUDIT_MODEL,
  COPY_GATE_VERSION,
  MAX_CONCURRENT_AUDITS,
  structuredResponse,
  auditOneVariant,
  mapWithConcurrency,
  chooseSelectedVariant,
  auditCreativeRecord,
};
