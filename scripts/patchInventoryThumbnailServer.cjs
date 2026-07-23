const fs = require('fs');

const lines = (...values) => values.join('\n');
const path = 'src/services/inventoryThumbnailStorage.ts';
let text = fs.readFileSync(path, 'utf8');

function replaceOrConfirm(oldText, newText, marker) {
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Missing thumbnail server block: ${marker}`);
  text = text.replace(oldText, newText);
}

replaceOrConfirm(
  lines(
    'async function fetchSourceBlob(input: ThumbnailInput, idToken: string) {',
    "  let storageReadError = '';",
    '  if (input.sourceStoragePath) {',
    '    try {',
    '      const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket!)}/o/${encodeURIComponent(input.sourceStoragePath)}?alt=media`;',
    '      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${idToken}` } });',
    '      if (response.ok) return response.blob();',
    '      const text = await response.text();',
    "      storageReadError = `${responseMessage(text) ?? 'No se pudo leer la fotografía original desde Storage.'} (Storage ${response.status})`;",
    '    } catch (cause) {',
    '      storageReadError = cause instanceof Error ? cause.message : String(cause);',
    '    }',
    '  }',
    '',
    '  if (input.uri) {',
    '    try {',
    "      const response = await fetch(input.uri, { cache: 'no-store' });",
    '      if (response.ok) return response.blob();',
    "      storageReadError = `${storageReadError ? `${storageReadError}; ` : ''}la URL original respondió ${response.status}`;",
    '    } catch (cause) {',
    '      const uriError = cause instanceof Error ? cause.message : String(cause);',
    "      storageReadError = `${storageReadError ? `${storageReadError}; ` : ''}${uriError}`;",
    '    }',
    '  }',
    '',
    "  throw new Error(storageReadError || 'No se encontró una fuente legible para crear la miniatura.');",
    '}',
  ),
  lines(
    'async function fetchSourceBlob(input: ThumbnailInput, _idToken: string) {',
    '  const remoteFirebasePhoto = Boolean(input.uri && /^https:\\/\\/firebasestorage\\.googleapis\\.com\\//i.test(input.uri));',
    '  if (remoteFirebasePhoto) {',
    "    const response = await fetch('/api/inventory-thumbnail', {",
    "      method: 'POST',",
    "      headers: { 'Content-Type': 'application/json' },",
    '      body: JSON.stringify({ sourceUrl: input.uri }),',
    '    });',
    '    if (!response.ok) {',
    '      const text = await response.text();',
    "      let message = `El servidor de miniaturas respondió ${response.status}.`;",
    '      try {',
    '        const payload = JSON.parse(text) as { error?: string };',
    '        if (payload.error) message = payload.error;',
    '      } catch {',
    '        if (text.trim()) message = text.trim();',
    '      }',
    '      throw new Error(message);',
    '    }',
    '    const thumbnailBlob = await response.blob();',
    "    if (!thumbnailBlob.size) throw new Error('El servidor devolvió una miniatura vacía.');",
    '    return thumbnailBlob;',
    '  }',
    '',
    '  if (input.uri) {',
    '    const response = await fetch(input.uri);',
    "    if (!response.ok) throw new Error('No se pudo leer la fotografía local para crear la miniatura.');",
    '    return response.blob();',
    '  }',
    '',
    "  throw new Error('No se encontró la URL original necesaria para crear la miniatura.');",
    '}',
  ),
  "fetch('/api/inventory-thumbnail'",
);

replaceOrConfirm(
  lines(
    '  const thumbnailDownloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(thumbnailStoragePath)}?alt=media&token=${encodeURIComponent(token)}`;',
    "  const verification = await fetch(thumbnailDownloadUrl, { cache: 'no-store' });",
    '  if (!verification.ok) {',
    '    throw new Error(`La miniatura subió, pero no se pudo verificar su descarga (Storage ${verification.status}).`);',
    '  }',
    '  const verifiedBlob = await verification.blob();',
    '  if (verifiedBlob.size <= 0 || verifiedBlob.size > MAX_THUMBNAIL_BYTES) {',
    "    throw new Error('La miniatura descargada no tiene un tamaño válido.');",
    '  }',
    '  return {',
  ),
  lines(
    '  const thumbnailDownloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(thumbnailStoragePath)}?alt=media&token=${encodeURIComponent(token)}`;',
    '  return {',
  ),
  'La descarga se valida al renderizar la miniatura, sin fetch CORS.',
);

fs.writeFileSync(path, text);
console.log('Server-side inventory thumbnail generation patch applied.');
