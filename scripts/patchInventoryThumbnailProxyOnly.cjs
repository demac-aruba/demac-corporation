const fs = require('fs');

const screenPath = 'src/screens/InventoryScreenV4.tsx';
let text = fs.readFileSync(screenPath, 'utf8');

const oldThumbnailFunction = [
  'function currentThumbnailUrl(asset: VanToolAssetV2) {',
  '  if (!asset.latestThumbnailUrl || !asset.latestThumbnailStoragePath?.includes("-v2-")) return undefined;',
  '  if (Number(asset.latestThumbnailSizeBytes ?? 0) > 64 * 1024) return undefined;',
  '  if (Number(asset.latestThumbnailWidth ?? 0) > 144 || Number(asset.latestThumbnailHeight ?? 0) > 144) return undefined;',
  '  if (!asset.latestPhotoStoragePath) return asset.latestThumbnailUrl;',
  '  return asset.latestThumbnailSourcePhotoPath === asset.latestPhotoStoragePath ? asset.latestThumbnailUrl : undefined;',
  '}',
].join('\n');

const newThumbnailFunction = [
  'function thumbnailProxyUrl(originalUrl?: string) {',
  '  if (!originalUrl) return undefined;',
  '  const origin = typeof window !== "undefined" ? window.location.origin : "https://demac-aruba.com";',
  '  return `${origin}/api/inventory-thumbnail?sourceUrl=${encodeURIComponent(originalUrl)}`;',
  '}',
  '',
  'function currentThumbnailUrl(asset: VanToolAssetV2) {',
  '  return thumbnailProxyUrl(asset.latestPhotoUrl);',
  '}',
].join('\n');

if (!text.includes('function thumbnailProxyUrl(')) {
  if (!text.includes(oldThumbnailFunction)) {
    throw new Error('No se encontró la función final de miniaturas para cambiarla al proxy.');
  }
  text = text.replace(oldThumbnailFunction, newThumbnailFunction);
}

const uploadLine = "      const thumbnail = await uploadInventoryThumbnail({ ...photo, scope: 'van-tool', entityId: asset.id, evidenceId }).catch(() => null);\n";
if (text.includes(uploadLine)) {
  text = text.replace(uploadLine, '      // La miniatura se sirve por el proxy cacheado; no se sube a Firebase.\n');
}

text = text.replace('        ...(thumbnail ?? {}),\n', '');

const thumbnailFieldsWithSize = [
  '        latestThumbnailUrl: thumbnail?.thumbnailDownloadUrl,',
  '        latestThumbnailStoragePath: thumbnail?.thumbnailStoragePath,',
  '        latestThumbnailSourcePhotoPath: thumbnail ? stored.storagePath : undefined,',
  '        latestThumbnailSizeBytes: thumbnail?.thumbnailSizeBytes,',
  '        latestThumbnailWidth: thumbnail?.thumbnailWidth,',
  '        latestThumbnailHeight: thumbnail?.thumbnailHeight,',
  '',
].join('\n');
const thumbnailFieldsBasic = [
  '        latestThumbnailUrl: thumbnail?.thumbnailDownloadUrl,',
  '        latestThumbnailStoragePath: thumbnail?.thumbnailStoragePath,',
  '        latestThumbnailSourcePhotoPath: thumbnail ? stored.storagePath : undefined,',
  '',
].join('\n');
text = text.replace(thumbnailFieldsWithSize, '');
text = text.replace(thumbnailFieldsBasic, '');

fs.writeFileSync(screenPath, text);
console.log('Inventory thumbnail proxy-only patch applied.');
