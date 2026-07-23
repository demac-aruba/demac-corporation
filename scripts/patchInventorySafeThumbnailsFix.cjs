const fs = require('fs');

const path = 'src/screens/InventoryScreenV4.tsx';
let text = fs.readFileSync(path, 'utf8');
const marker = `function CompactAssetRow({ asset, catalog, onOpenProfile, onOpenPhoto }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; onOpenProfile: () => void; onOpenPhoto: () => void }) {\n  const thumbnailUrl = currentThumbnailUrl(asset);`;
if (!text.includes(marker)) {
  const oldText = `function CompactAssetRow({ asset, catalog, onOpenProfile, onOpenPhoto }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; onOpenProfile: () => void; onOpenPhoto: () => void }) {\n  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';`;
  if (!text.includes(oldText)) throw new Error('No se encontró CompactAssetRow para añadir la miniatura segura.');
  text = text.replace(oldText, `${marker}\n  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';`);
  fs.writeFileSync(path, text);
}

console.log('Compact inventory thumbnail row verified.');
