const { defineSecret } = require('firebase-functions/params');
const sharp = require('sharp');
const { PROVIDER_STRATEGY } = require('./marketingCreativeSkillsV3');

const openAiApiKey = defineSecret('OPENAI_API_KEY');
const OPENAI_IMAGE_MODEL = 'gpt-image-2';

async function normalizeSquare(buffer, size = 1024) {
  return sharp(buffer)
    .rotate()
    .resize(size, size, { fit: 'cover', position: 'attention' })
    .png()
    .toBuffer();
}

async function callOpenAiImageEdit({ imageBuffer, prompt, quality = 'high' }) {
  const normalized = await normalizeSquare(imageBuffer, 1024);
  const form = new FormData();
  form.append('model', OPENAI_IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('image', new Blob([normalized], { type: 'image/png' }), 'demac-creative-source.png');
  form.append('size', '1024x1024');
  form.append('quality', quality);
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
  };
}

module.exports = {
  openAiApiKey,
  OPENAI_IMAGE_MODEL,
  generateFullDesign,
  refineFullDesign,
  providerManifest,
  normalizeSquare,
};
