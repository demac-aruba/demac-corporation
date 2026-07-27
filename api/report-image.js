const sharp = require('sharp');

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_DIMENSION = 2400;

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

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Método no permitido.' });
  }

  try {
    const sourceUrl = typeof req.query?.sourceUrl === 'string' ? req.query.sourceUrl : '';
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

    const normalized = await sharp(sourceBuffer, { failOn: 'none' })
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    if (!normalized.length) return sendJson(res, 500, { error: 'No se pudo preparar la fotografía para el PDF.' });

    res.status(200);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(normalized.length));
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.end(normalized);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return sendJson(res, 500, { error: message });
  }
};
