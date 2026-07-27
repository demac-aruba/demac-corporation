const sharp = require('sharp');

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

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

function thumbnailProfile(value) {
  if (value === 'report') {
    return {
      width: 420,
      height: 315,
      fallbackWidth: 360,
      fallbackHeight: 270,
      quality: 62,
      fallbackQuality: 48,
      maxBytes: 160 * 1024,
    };
  }
  return {
    width: 144,
    height: 144,
    fallbackWidth: 112,
    fallbackHeight: 112,
    quality: 46,
    fallbackQuality: 32,
    maxBytes: 64 * 1024,
  };
}

async function createThumbnail(buffer, profile) {
  let output = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: profile.width,
      height: profile.height,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: profile.quality, mozjpeg: true })
    .toBuffer();

  if (output.length > profile.maxBytes) {
    output = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: profile.fallbackWidth, height: profile.fallbackHeight, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: profile.fallbackQuality, mozjpeg: true })
      .toBuffer();
  }

  if (!output.length || output.length > profile.maxBytes) {
    throw new Error('No se pudo reducir la miniatura al tamaño requerido.');
  }
  return output;
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: 'Método no permitido.' });
  }

  try {
    const sourceUrl = req.method === 'GET'
      ? (typeof req.query?.sourceUrl === 'string' ? req.query.sourceUrl : '')
      : (typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl : '');
    if (!sourceUrl) return sendJson(res, 400, { error: 'Falta la URL de la fotografía.' });

    const size = req.method === 'GET'
      ? (typeof req.query?.size === 'string' ? req.query.size : '')
      : (typeof req.body?.size === 'string' ? req.body.size : '');
    const profile = thumbnailProfile(size);
    const validatedUrl = allowedFirebaseUrl(sourceUrl);
    const sourceResponse = await fetch(validatedUrl, { redirect: 'follow' });
    if (!sourceResponse.ok) {
      return sendJson(res, 502, { error: `Firebase respondió ${sourceResponse.status} al leer la fotografía.` });
    }

    const contentType = sourceResponse.headers.get('content-type') || '';
    if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
      return sendJson(res, 415, { error: 'La fuente no es una imagen válida.' });
    }

    const contentLength = Number(sourceResponse.headers.get('content-length') || 0);
    if (contentLength > MAX_SOURCE_BYTES) {
      return sendJson(res, 413, { error: 'La fotografía original supera 25 MB.' });
    }

    const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
    if (!sourceBuffer.length || sourceBuffer.length > MAX_SOURCE_BYTES) {
      return sendJson(res, 413, { error: 'La fotografía original está vacía o supera 25 MB.' });
    }

    const thumbnail = await createThumbnail(sourceBuffer, profile);
    res.status(200);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(thumbnail.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=86400, immutable');
    return res.end(thumbnail);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return sendJson(res, 500, { error: message });
  }
};
