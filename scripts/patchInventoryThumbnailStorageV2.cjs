const fs = require('fs');

const path = 'src/services/inventoryThumbnailStorage.ts';
let text = fs.readFileSync(path, 'utf8');

function replaceOrConfirm(oldText, newText, marker) {
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Missing thumbnail storage block: ${marker}`);
  text = text.replace(oldText, newText);
}

replaceOrConfirm(
  "  const sourceType = mimeType || sourceBlob.type || 'image/jpeg';\n  if (!sourceType.startsWith('image/')) throw new Error('El archivo original no es una imagen válida.');",
  "  const sourceType = mimeType || (sourceBlob.type?.startsWith('image/') ? sourceBlob.type : 'image/jpeg');\n  if (!sourceType.startsWith('image/')) throw new Error('El archivo original no es una imagen válida.');",
  "sourceBlob.type?.startsWith('image/')",
);

replaceOrConfirm(
  "  const evidenceId = safeSegment(input.evidenceId, randomToken());\n  // Storage rules allow one file level below the entity folder. Keep thumbnails\n  // beside the original instead of using a nested /thumbnails/ subfolder.\n  const thumbnailStoragePath = `inventory/${input.scope}/${entityId}/${evidenceId}-thumb.jpg`;",
  "  const evidenceId = safeSegment(input.evidenceId, randomToken());\n  const explicitDownloadToken = randomToken();\n  const fileVersion = safeSegment(explicitDownloadToken, 'token');\n  // Keep the thumbnail beside the original. A unique v2 filename avoids collisions\n  // with failed or inaccessible thumbnail objects from previous migrations.\n  const thumbnailStoragePath = `inventory/${input.scope}/${entityId}/${evidenceId}-v2-${fileVersion}-thumb.jpg`;",
  "const explicitDownloadToken = randomToken();",
);

replaceOrConfirm(
  "      sizeBytes: String(generated.blob.size),\n      uploadedByUid: session.uid,",
  "      sizeBytes: String(generated.blob.size),\n      firebaseStorageDownloadTokens: explicitDownloadToken,\n      uploadedByUid: session.uid,",
  "firebaseStorageDownloadTokens: explicitDownloadToken",
);

replaceOrConfirm(
  "  const token = downloadToken(payload) ?? await fetchGeneratedToken(thumbnailStoragePath, session.idToken);\n  if (!token) throw new Error('La miniatura subió, pero Firebase no devolvió su enlace de descarga.');",
  "  const token = explicitDownloadToken;",
  "const token = explicitDownloadToken;",
);

fs.writeFileSync(path, text);
console.log('Inventory thumbnail storage v2 applied.');
