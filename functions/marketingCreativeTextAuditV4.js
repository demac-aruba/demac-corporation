// Independent visible-copy audit for DEMAC Creative Engine V4.
// Critical rule: the transcription model MUST NOT receive the expected copy.
// It first reports what is actually visible; deterministic code then compares
// that evidence with the approved campaign strings. This prevents a reviewer
// from simply echoing the expected headline while the image contains different text.

const TEXT_TRANSCRIPTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overlayLines', 'sourceLabelLines', 'uncertainLines'],
  properties: {
    overlayLines: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'confidence'],
        properties: {
          text: { type: 'string' },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
        },
      },
    },
    sourceLabelLines: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'confidence'],
        properties: {
          text: { type: 'string' },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
        },
      },
    },
    uncertainLines: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string' },
    },
  },
};

function safeString(value, max = 800) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeVisibleText(value) {
  return safeString(value, 4000)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(value) {
  return safeString(value, 120).replace(/\D+/g, '');
}

function transcriptionPrompt() {
  return [
    'Transcribe the visible text in this paid-social advertisement exactly as it appears.',
    'Do NOT infer, repair, translate, paraphrase, or guess what the ad was supposed to say.',
    'You are not given the expected campaign copy on purpose.',
    'Classify designed advertising typography as overlayLines.',
    'Classify tiny manufacturer stickers, equipment model labels, incidental building signage, or text physically present in the source photograph as sourceLabelLines.',
    'If a designed line is partially unreadable, put the readable fragment in overlayLines with lower confidence and describe the uncertainty in uncertainLines.',
    'Preserve words, numbers, punctuation, and phone-number digits as faithfully as vision allows.',
    'A large headline is always overlay text even if it visually overlaps the photograph.',
  ].join('\n');
}

function joinedOverlayText(transcription = {}) {
  const lines = Array.isArray(transcription.overlayLines) ? transcription.overlayLines : [];
  return normalizeVisibleText(lines.map((line) => safeString(line?.text, 500)).filter(Boolean).join(' '));
}

function requiredCopyItems(exact = {}) {
  const items = [
    ['headline', safeString(exact.headline, 300)],
    ['subheadline', safeString(exact.subheadline, 500)],
    ['cta', safeString(exact.cta, 220)],
  ];
  if (safeString(exact.offer, 400)) items.push(['offer', safeString(exact.offer, 400)]);
  return items.filter(([, value]) => Boolean(value));
}

function evaluateCopyAudit(transcription = {}, exact = {}) {
  const overlay = joinedOverlayText(transcription);
  const checks = {};
  for (const [key, value] of requiredCopyItems(exact)) {
    const normalized = normalizeVisibleText(value);
    checks[key] = Boolean(normalized) && overlay.includes(normalized);
  }

  const expectedPhone = normalizePhone(exact.whatsapp);
  const visibleDigits = normalizePhone((Array.isArray(transcription.overlayLines) ? transcription.overlayLines : [])
    .map((line) => safeString(line?.text, 500)).join(' '));
  const whatsappDetected = Boolean(expectedPhone) && visibleDigits.includes(expectedPhone);
  checks.whatsapp = whatsappDetected;

  const missingRequired = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key);
  return {
    source: 'independent_vision_transcription_v4',
    status: missingRequired.length ? 'failed' : 'passed',
    allRequiredDetected: missingRequired.length === 0,
    missingRequired,
    checks,
    overlayLines: Array.isArray(transcription.overlayLines)
      ? transcription.overlayLines.slice(0, 30).map((line) => ({
        text: safeString(line?.text, 500),
        confidence: Number(line?.confidence) || 0,
      })).filter((line) => line.text)
      : [],
    uncertainLines: Array.isArray(transcription.uncertainLines)
      ? transcription.uncertainLines.slice(0, 20).map((line) => safeString(line, 500)).filter(Boolean)
      : [],
  };
}

async function auditVisibleCopy({ buffer, structuredResponse, model }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Visible-copy audit requires an image buffer.');
  if (typeof structuredResponse !== 'function') throw new Error('Visible-copy audit requires structuredResponse.');
  const transcription = await structuredResponse({
    model,
    prompt: transcriptionPrompt(),
    schemaName: 'demac_creative_v4_visible_copy_transcription',
    schema: TEXT_TRANSCRIPTION_SCHEMA,
    imageBuffers: [buffer],
  });
  return transcription;
}

function applyCopyAudit(qa = {}, copyAudit = {}) {
  const failed = copyAudit?.allRequiredDetected !== true;
  const reasons = failed
    ? [`Independent visible-copy audit failed: missing ${Array.isArray(copyAudit?.missingRequired) ? copyAudit.missingRequired.join(', ') : 'required copy'}.`]
    : [];
  const existingHardReasons = Array.isArray(qa.hardFailureReasons) ? qa.hardFailureReasons : [];
  const hardFailureReasons = [...new Set([...existingHardReasons, ...reasons])].slice(0, 12);
  const existingIssues = Array.isArray(qa.issues) ? qa.issues : [];
  const issues = [...new Set([...existingIssues, ...reasons])].slice(0, 12);
  const status = qa.status === 'passed' && !failed ? 'passed' : 'failed';
  const selectionScore = failed ? Math.max(0, Math.min(Number(qa.selectionScore) || 0, 35)) : Number(qa.selectionScore) || 0;
  return {
    ...qa,
    source: failed ? 'openai_vision_v4_paired_benchmark+independent_copy_audit' : qa.source,
    status,
    selectionScore,
    visibleTextExact: qa.visibleTextExact === true && !failed,
    hardFailure: Boolean(qa.hardFailure) || failed,
    hardFailureReasons,
    issues,
    copyAudit,
  };
}

module.exports = {
  TEXT_TRANSCRIPTION_SCHEMA,
  transcriptionPrompt,
  normalizeVisibleText,
  normalizePhone,
  joinedOverlayText,
  evaluateCopyAudit,
  auditVisibleCopy,
  applyCopyAudit,
};
