const { defineSecret } = require('firebase-functions/params');
const sharp = require('sharp');
const { PROVIDER_STRATEGY } = require('./marketingCreativeSkillsV3');

const openAiApiKey = defineSecret('OPENAI_API_KEY');
const OPENAI_IMAGE_MODEL = 'gpt-image-2';
const MAX_CONCURRENT_IMAGE_CALLS = 2;
const MAX_IMAGE_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1500;
const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

let activeImageCalls = 0;
const imageCallQueue = [];

async function normalizeSquare(buffer, size = 1024) {
  return sharp(buffer)
    .rotate()
    .resize(size, size, { fit: 'cover', position: 'attention' })
    .png()
    .toBuffer();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function acquireImageSlot() {
  return new Promise((resolve) => {
    const start = () => {
      activeImageCalls += 1;
      resolve();
    };
    if (activeImageCalls < MAX_CONCURRENT_IMAGE_CALLS) start();
    else imageCallQueue.push(start);
  });
}

function releaseImageSlot() {
  activeImageCalls = Math.max(0, activeImageCalls - 1);
  const next = imageCallQueue.shift();
  if (next) next();
}

async function withImageSlot(task) {
  await acquireImageSlot();
  try {
    return await task();
  } finally {
    releaseImageSlot();
  }
}

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30000, Math.max(1000, seconds * 1000));
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.min(30000, Math.max(1000, retryAt - Date.now()));
  }
  const exponential = BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 600);
  return Math.min(15000, exponential + jitter);
}

function requestIdFrom(response) {
  return response?.headers?.get('x-request-id')
    || response?.headers?.get('x-openai-request-id')
    || '';
}

function buildImageForm(normalized, prompt, quality) {
  const form = new FormData();
  form.append('model', OPENAI_IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('image', new Blob([normalized], { type: 'image/png' }), 'demac-creative-source.png');
  form.append('size', '1024x1024');
  form.append('quality', quality);
  form.append('output_format', 'png');
  return form;
}

async function callOpenAiImageEdit({ imageBuffer, prompt, quality = 'high' }) {
  const normalized = await normalizeSquare(imageBuffer, 1024);

  return withImageSlot(async () => {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt += 1) {
      let response;
      try {
        response = await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openAiApiKey.value()}` },
          body: buildImageForm(normalized, prompt, quality),
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt >= MAX_IMAGE_ATTEMPTS) {
          throw new Error(`GPT Image 2 network failure after ${attempt} attempts: ${lastError.message}`);
        }
        const delay = retryDelayMs(null, attempt);
        console.warn(`GPT Image 2 network failure on attempt ${attempt}/${MAX_IMAGE_ATTEMPTS}; retrying in ${delay}ms.`, lastError.message);
        await sleep(delay);
        continue;
      }

      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch {}
      const result = payload?.data?.[0]?.b64_json;
      if (response.ok && result) return Buffer.from(result, 'base64');

      const requestId = requestIdFrom(response);
      const details = payload?.error?.message || text || 'No image returned.';
      lastError = new Error(`GPT Image 2 failed (${response.status})${requestId ? ` [request ${requestId}]` : ''}: ${details}`);
      const retryable = RETRYABLE_HTTP_STATUS.has(response.status);
      if (!retryable || attempt >= MAX_IMAGE_ATTEMPTS) throw lastError;

      const delay = retryDelayMs(response, attempt);
      console.warn(`GPT Image 2 returned ${response.status} on attempt ${attempt}/${MAX_IMAGE_ATTEMPTS}${requestId ? ` (${requestId})` : ''}; retrying in ${delay}ms.`);
      await sleep(delay);
    }

    throw lastError || new Error('GPT Image 2 failed without a response.');
  });
}

async function generateFullDesign({ sourceBuffer, prompt }) {
  return callOpenAiImageEdit({ imageBuffer: sourceBuffer, prompt, quality: 'high' });
}

async function refineFullDesign({ currentBuffer, prompt }) {
  return callOpenAiImageEdit({ imageBuffer: currentBuffer, prompt, quality: 'high' });
}

function providerManifest() {
  return {
    activeProvider: PROVIDER_STRATEGY.defaultProvider,
    activeImageModel: OPENAI_IMAGE_MODEL,
    providers: PROVIDER_STRATEGY.available,
    notes: PROVIDER_STRATEGY.notes,
    resilience: {
      maxConcurrentImageCalls: MAX_CONCURRENT_IMAGE_CALLS,
      maxAttemptsPerImage: MAX_IMAGE_ATTEMPTS,
      retryableHttpStatus: [...RETRYABLE_HTTP_STATUS],
    },
  };
}

module.exports = {
  openAiApiKey,
  OPENAI_IMAGE_MODEL,
  generateFullDesign,
  refineFullDesign,
  providerManifest,
  normalizeSquare,
  __marketingCreativeProviderV3Test: {
    MAX_CONCURRENT_IMAGE_CALLS,
    MAX_IMAGE_ATTEMPTS,
    RETRYABLE_HTTP_STATUS: [...RETRYABLE_HTTP_STATUS],
  },
};
