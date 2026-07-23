const sharp = require('sharp');

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 64 * 1024;
const THUMBNAIL_DIMENSION = 144;

function sendJson(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function allowedFirebaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com') {
    throw new Error('La fuente no pertenece a Firebase Storage.');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const bucketIndex = parts.indexOf('b');
  const bucket = bucketIndex >= 0 ? decodeURIComponent(parts[bucketIndex + 1] || '') : '';
  const configuredBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '';
  if (!bucket || (configuredBucket && bucket !== configuredBucket)) {
    throw new Error('La fotografía no pertenece al bucket autorizado.');
  }
  return url;
}

async function createThumbnail(buffer) {
  let output = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: THUMBNAIL_DIMENSION,
      height: THUMBNAIL_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 46, mozjpeg: true })
    .toBuffer();

  if (output.length > MAX_THUMBNAIL_BYTES) {
    output = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: 112, height: 112, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 32, mozjpeg: true })
      .toBuffer();
  }

  if (!output.length || output.length > MAX_THUMBNAIL_BYTES) {
    throw new Error('No se pudo reducir la miniatura por debajo de 64 KB.');
  }
  return output;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Método no permitido.' });
  }

  try {
    const sourceUrl = typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl : '';
    if (!sourceUrl) return sendJson(res, 400, { error: 'Falta la URL de la fotografía.' });

    const validatedUrl = allowedFirebaseUrl(sourceUrl);
    const sourceResponse = await fetch(validatedUrl, { redirect: 'follow' });
    if (!sourceResponse.ok) {
      return sendJson(res, 502, { error: `Firebase respondió ${sourceResponse.status} al leer la fotografía.` });
    }

    const contentLength = Number(sourceResponse.headers.get('content-length') || 0);
    if (contentLength > MAX_SOURCE_BYTES) {
      return sendJson(res, 413, { error: 'La fotografía original supera 25 MB.' });
    }

    const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
    if (!sourceBuffer.length || sourceBuffer.length > MAX_SOURCE_BYTES) {
      return sendJson(res, 413, { error: 'La fotografía original está vacía o supera 25 MB.' });
    }

    const thumbnail = await createThumbnail(sourceBuffer);
    res.status(200);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(thumbnail.length));
    res.setHeader('Cache-Control', 'no-store');
    return res.end(thumbnail);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return sendJson(res, 500, { error: message });
  }
};
