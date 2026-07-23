const fs = require('fs');

const path = 'scripts/patchInventorySafeThumbnailsV2.cjs';
let text = fs.readFileSync(path, 'utf8');
const oldMarker = "  'originalUrl={asset.latestPhotoUrl} style={styles.compactImage}',";
const newMarker = "  'thumbnailUrl={thumbnailUrl} originalUrl={asset.latestPhotoUrl}',";

if (text.includes(oldMarker)) {
  text = text.replace(oldMarker, newMarker);
  fs.writeFileSync(path, text);
} else if (!text.includes(newMarker)) {
  throw new Error('No se encontró el marcador de la miniatura compacta para hacerlo idempotente.');
}

console.log('Base thumbnail patch idempotency verified.');
