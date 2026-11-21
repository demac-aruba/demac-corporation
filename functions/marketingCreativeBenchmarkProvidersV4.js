const sharp = require('sharp');

const PROVIDERS = Object.freeze({
  OPENAI_GPT_IMAGE_2: 'openai_gpt_image_2',
  IDEOGRAM_V4_REMIX: 'ideogram_v4_remix',
  RECRAFT_V3_IMAGE_TO_IMAGE: 'recraft_v3_image_to_image',
});

const IDEOGRAM_REMIX_URL = 'https://api.ideogram.ai/v1/ideogram-v4/remix';
const RECRAFT_IMAGE_TO_IMAGE_URL = 'https://external.api.recraft.ai/v1/images/imageToImage';

function safeString(value, max = 10000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function normalizeInput(buffer, maxBytes = 4_500_000) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Benchmark provider requires an image buffer.');
  let quality = 95;
  let output = await sharp(buffer).rotate().resize(1024, 1024, { fit: 'cover', position: 'attention' }).jpeg({ quality }).toBuffer();
  while (output.length > maxBytes && quality > 65) {
    quality -= 8;
    output = await sharp(buffer).rotate().resize(1024, 1024, { fit: 'cover', position: 'attention' }).jpeg({ quality }).toBuffer();
  }
  if (output.length > maxBytes) throw new Error('Benchmark source image could not be normalized below provider upload limits.');
  return output;
}

async function responseJson(response, providerName) {
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    const message = payload?.error?.message || payload?.detail || text || `${providerName} HTTP ${response.status}`;
    throw new Error(`${providerName} failed (${response.status}): ${safeString(String(message), 1600)}`);
  }
  return payload;
}

async function downloadImage(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Generated image download failed (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) throw new Error('Generated image is empty or too large.');
  return buffer;
}

async function ideogramV4Remix({ sourceBuffer, prompt, apiKey, imageWeight = 62, renderingSpeed = 'QUALITY', fetchImpl = fetch }) {
  const key = safeString(apiKey, 1000);
  if (!key) throw new Error('IDEOGRAM_API_KEY is required.');
  const normalized = await normalizeInput(sourceBuffer, 9_000_000);
  const form = new FormData();
  form.append('image', new Blob([normalized], { type: 'image/jpeg' }), 'demac-source.jpg');
  form.append('text_prompt', safeString(prompt, 18000));
  form.append('image_weight', String(Math.max(1, Math.min(100, Number(imageWeight) || 62))));
  form.append('rendering_speed', ['FLASH', 'TURBO', 'DEFAULT', 'QUALITY'].includes(renderingSpeed) ? renderingSpeed : 'QUALITY');

  const response = await fetchImpl(IDEOGRAM_REMIX_URL, {
    method: 'POST',
    headers: { 'Api-Key': key },
    body: form,
  });
  const payload = await responseJson(response, 'Ideogram V4 Remix');
  const item = Array.isArray(payload?.data) ? payload.data[0] : null;
  const url = safeString(item?.url, 5000);
  if (!url) throw new Error('Ideogram V4 Remix returned no image URL.');
  const buffer = await downloadImage(url, fetchImpl);
  return {
    provider: PROVIDERS.IDEOGRAM_V4_REMIX,
    providerModel: 'ideogram-v4-remix',
    buffer,
    metadata: {
      seed: item?.seed ?? null,
      resolution: safeString(item?.resolution, 80),
      safetyPassed: item?.is_image_safe !== false,
      imageWeight: Math.max(1, Math.min(100, Number(imageWeight) || 62)),
      renderingSpeed: ['FLASH', 'TURBO', 'DEFAULT', 'QUALITY'].includes(renderingSpeed) ? renderingSpeed : 'QUALITY',
    },
  };
}

function appendRecraftTextLayout(form, textLayout) {
  if (!Array.isArray(textLayout) || !textLayout.length) return;
  // Recraft accepts multipart non-file values; nested text_layout is encoded as JSON.
  form.append('text_layout', JSON.stringify(textLayout));
}

async function recraftV3ImageToImage({
  sourceBuffer,
  prompt,
  apiToken,
  strength = 0.45,
  textLayout = [],
  negativePrompt = '',
  fetchImpl = fetch,
}) {
  const token = safeString(apiToken, 1000);
  if (!token) throw new Error('RECRAFT_API_TOKEN is required.');
  const normalized = await normalizeInput(sourceBuffer, 4_500_000);
  const form = new FormData();
  form.append('image', new Blob([normalized], { type: 'image/jpeg' }), 'demac-source.jpg');
  form.append('prompt', safeString(prompt, 12000));
  form.append('strength', String(Math.max(0, Math.min(1, Number(strength) || 0.45))));
  form.append('model', 'recraftv3');
  form.append('response_format', 'b64_json');
  if (safeString(negativePrompt, 3000)) form.append('negative_prompt', safeString(negativePrompt, 3000));
  appendRecraftTextLayout(form, textLayout);

  const response = await fetchImpl(RECRAFT_IMAGE_TO_IMAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const payload = await responseJson(response, 'Recraft V3 image-to-image');
  const item = Array.isArray(payload?.data) ? payload.data[0] : null;
  const encoded = safeString(item?.b64_json, 50_000_000);
  let buffer;
  if (encoded) buffer = Buffer.from(encoded, 'base64');
  else if (safeString(item?.url, 5000)) buffer = await downloadImage(item.url, fetchImpl);
  else throw new Error('Recraft V3 image-to-image returned no image payload.');
  if (!buffer.length) throw new Error('Recraft V3 image-to-image returned an empty image.');
  return {
    provider: PROVIDERS.RECRAFT_V3_IMAGE_TO_IMAGE,
    providerModel: 'recraftv3',
    buffer,
    metadata: {
      strength: Math.max(0, Math.min(1, Number(strength) || 0.45)),
      textLayoutCount: Array.isArray(textLayout) ? textLayout.length : 0,
    },
  };
}

function providerBenchmarkManifest() {
  return {
    version: 1,
    productionProviderUnchanged: true,
    providers: [
      {
        id: PROVIDERS.OPENAI_GPT_IMAGE_2,
        model: 'gpt-image-2',
        role: 'production_baseline',
        credential: 'OPENAI_API_KEY',
        enabledWhenCredentialPresent: true,
      },
      {
        id: PROVIDERS.IDEOGRAM_V4_REMIX,
        model: 'ideogram-v4-remix',
        role: 'external_typography_and_layout_challenger',
        credential: 'IDEOGRAM_API_KEY',
        enabledWhenCredentialPresent: false,
      },
      {
        id: PROVIDERS.RECRAFT_V3_IMAGE_TO_IMAGE,
        model: 'recraftv3',
        role: 'external_layout_control_challenger',
        credential: 'RECRAFT_API_TOKEN',
        enabledWhenCredentialPresent: false,
      },
    ],
    rules: [
      'All providers receive the same source photo, approved copy, creative mode, proof constraints, and footer reserve.',
      'No external provider becomes production default from a single generation.',
      'Every rendered candidate must pass the same V4 visual/performance QA and independent exact-copy hard gate.',
      'Benchmark results are stored separately from approved production creatives until a provider is explicitly promoted.',
    ],
  };
}

module.exports = {
  PROVIDERS,
  IDEOGRAM_REMIX_URL,
  RECRAFT_IMAGE_TO_IMAGE_URL,
  normalizeInput,
  ideogramV4Remix,
  recraftV3ImageToImage,
  providerBenchmarkManifest,
};
