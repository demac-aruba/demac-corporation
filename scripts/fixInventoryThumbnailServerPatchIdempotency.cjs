const fs = require('fs');

const reliabilityPath = 'scripts/patchInventoryThumbnailReliability.cjs';
let reliability = fs.readFileSync(reliabilityPath, 'utf8');
const reliabilityMarker = "text.includes(\"fetch('/api/inventory-thumbnail'\")";
if (!reliability.includes(reliabilityMarker)) {
  const oldBlock = "  if (text.includes(marker)) return;\n  if (!text.includes(oldText)) throw new Error(`Missing block in ${path}: ${marker}`);";
  const newBlock = "  if (text.includes(marker)) return;\n  if (path.endsWith('inventoryThumbnailStorage.ts') && text.includes(\"fetch('/api/inventory-thumbnail'\")) return;\n  if (!text.includes(oldText)) throw new Error(`Missing block in ${path}: ${marker}`);";
  if (!reliability.includes(oldBlock)) throw new Error('No se encontró el bloque de idempotencia del parche reliability.');
  reliability = reliability.replace(oldBlock, newBlock);
  fs.writeFileSync(reliabilityPath, reliability);
}

const serverPath = 'scripts/patchInventoryThumbnailServer.cjs';
let server = fs.readFileSync(serverPath, 'utf8');
const comment = 'Descarga validada al renderizar; no se usa fetch CORS en el navegador.';
if (!server.includes(`'  // ${comment}',`)) {
  const oldNewText = [
    "    '  const thumbnailDownloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(thumbnailStoragePath)}?alt=media&token=${encodeURIComponent(token)}`;',",
    "    '  return {',",
  ].join('\n');
  const newNewText = [
    "    '  const thumbnailDownloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(thumbnailStoragePath)}?alt=media&token=${encodeURIComponent(token)}`;',",
    `    '  // ${comment}',`,
    "    '  return {',",
  ].join('\n');
  if (!server.includes(oldNewText)) throw new Error('No se encontró el bloque de retorno del parche server.');
  server = server.replace(oldNewText, newNewText);
  server = server.replace(
    "  'La descarga se valida al renderizar la miniatura, sin fetch CORS.',",
    `  '${comment}',`,
  );
  fs.writeFileSync(serverPath, server);
}

console.log('Thumbnail server patch idempotency verified.');
