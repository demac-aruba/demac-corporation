const fs = require('fs');

const lines = (...values) => values.join('\n');

function replaceOrConfirm(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Missing block in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

const screen = 'src/screens/InventoryScreenV4.tsx';

replaceOrConfirm(
  screen,
  lines(
    'function currentThumbnailUrl(asset: VanToolAssetV2) {',
    '  if (!asset.latestThumbnailUrl) return undefined;',
    '  if (Number(asset.latestThumbnailSizeBytes ?? 0) > 64 * 1024) return undefined;',
    '  if (Number(asset.latestThumbnailWidth ?? 0) > 144 || Number(asset.latestThumbnailHeight ?? 0) > 144) return undefined;',
    '  if (!asset.latestPhotoStoragePath) return asset.latestThumbnailUrl;',
    '  return asset.latestThumbnailSourcePhotoPath === asset.latestPhotoStoragePath ? asset.latestThumbnailUrl : undefined;',
    '}',
  ),
  lines(
    'function currentThumbnailUrl(asset: VanToolAssetV2) {',
    '  if (!asset.latestThumbnailUrl || !asset.latestThumbnailStoragePath?.includes("-v2-")) return undefined;',
    '  if (Number(asset.latestThumbnailSizeBytes ?? 0) > 64 * 1024) return undefined;',
    '  if (Number(asset.latestThumbnailWidth ?? 0) > 144 || Number(asset.latestThumbnailHeight ?? 0) > 144) return undefined;',
    '  if (!asset.latestPhotoStoragePath) return asset.latestThumbnailUrl;',
    '  return asset.latestThumbnailSourcePhotoPath === asset.latestPhotoStoragePath ? asset.latestThumbnailUrl : undefined;',
    '}',
  ),
  'latestThumbnailStoragePath?.includes("-v2-")',
);

console.log('Inventory thumbnail download-link fix applied.');
