const fs = require('fs');

const path = 'src/screens/InventoryScreenV4.tsx';
let text = fs.readFileSync(path, 'utf8');

if (!text.includes('const thumbnailFailedFallbackEnabled = true;')) {
  const oldAssetSummary = `function AssetSummary({ asset, catalog, onPhotoPress }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2; onPhotoPress?: () => void }) {
  const imageUrl = currentThumbnailUrl(asset) ?? asset.latestPhotoUrl;
  const image = imageUrl ? <Image source={{ uri: imageUrl }} style={styles.assetImage} /> : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>;
  return (
    <View style={styles.assetTop}>
      {imageUrl && onPhotoPress ? <Pressable accessibilityRole="button" accessibilityLabel="Ver fotografía grande" onPress={onPhotoPress} style={styles.assetPhotoButton}>{image}</Pressable> : image}`;

  const newAssetSummary = `function AssetSummary({ asset, catalog, onPhotoPress }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2; onPhotoPress?: () => void }) {
  const thumbnailFailedFallbackEnabled = true;
  const thumbnailUrl = currentThumbnailUrl(asset);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const imageUrl = !thumbnailFailed && thumbnailUrl ? thumbnailUrl : asset.latestPhotoUrl;
  const image = imageUrl ? <Image source={{ uri: imageUrl }} style={styles.assetImage} onError={() => { if (thumbnailFailedFallbackEnabled && thumbnailUrl && imageUrl === thumbnailUrl) setThumbnailFailed(true); }} /> : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>;
  return (
    <View style={styles.assetTop}>
      {imageUrl && onPhotoPress ? <Pressable accessibilityRole="button" accessibilityLabel="Ver fotografía grande" onPress={onPhotoPress} style={styles.assetPhotoButton}>{image}</Pressable> : image}`;

  if (!text.includes(oldAssetSummary)) throw new Error('No se encontró el bloque AssetSummary optimizado para aplicar el fallback seguro.');
  text = text.replace(oldAssetSummary, newAssetSummary);

  const oldCompactStart = `function CompactAssetRow({ asset, catalog, onOpenProfile, onOpenPhoto }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; onOpenProfile: () => void; onOpenPhoto: () => void }) {
  const thumbnailUrl = currentThumbnailUrl(asset);
  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';`;

  const newCompactStart = `function CompactAssetRow({ asset, catalog, onOpenProfile, onOpenPhoto }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; onOpenProfile: () => void; onOpenPhoto: () => void }) {
  const thumbnailUrl = currentThumbnailUrl(asset);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const previewUrl = !thumbnailFailed && thumbnailUrl ? thumbnailUrl : asset.latestPhotoUrl;
  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';`;

  if (!text.includes(oldCompactStart)) throw new Error('No se encontró el inicio de CompactAssetRow para aplicar el fallback seguro.');
  text = text.replace(oldCompactStart, newCompactStart);

  const oldCompactImage = `      {thumbnailUrl ? (
        <Pressable accessibilityRole="button" accessibilityLabel={\`Ver fotografía grande de \${catalog.name}\`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>
          <Image source={{ uri: thumbnailUrl }} style={styles.compactImage} />
        </Pressable>
      ) : <View style={styles.compactImagePlaceholder}><Text>{asset.latestPhotoUrl ? '⋯' : '📷'}</Text></View>}`;

  const newCompactImage = `      {previewUrl ? (
        <Pressable accessibilityRole="button" accessibilityLabel={\`Ver fotografía grande de \${catalog.name}\`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>
          <Image source={{ uri: previewUrl }} style={styles.compactImage} onError={() => { if (thumbnailUrl && previewUrl === thumbnailUrl) setThumbnailFailed(true); }} />
        </Pressable>
      ) : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}`;

  if (!text.includes(oldCompactImage)) throw new Error('No se encontró la imagen compacta optimizada para aplicar el fallback seguro.');
  text = text.replace(oldCompactImage, newCompactImage);

  fs.writeFileSync(path, text);
}

console.log('Inventory thumbnail safe fallback applied.');
