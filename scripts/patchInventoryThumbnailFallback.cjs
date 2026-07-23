const fs = require('fs');

const path = 'src/screens/InventoryScreenV4.tsx';
let text = fs.readFileSync(path, 'utf8');

if (!text.includes('const previewUrl = thumbnailUrl ?? asset.latestPhotoUrl;')) {
  const oldStart = "  const thumbnailUrl = currentThumbnailUrl(asset);\n  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';";
  const newStart = "  const thumbnailUrl = currentThumbnailUrl(asset);\n  const previewUrl = thumbnailUrl ?? asset.latestPhotoUrl;\n  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';";
  if (!text.includes(oldStart)) throw new Error('No se encontró CompactAssetRow para restaurar la foto original.');
  text = text.replace(oldStart, newStart);

  const oldImage = "      {thumbnailUrl ? (\n        <Pressable accessibilityRole=\"button\" accessibilityLabel={`Ver fotografía grande de ${catalog.name}`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>\n          <Image source={{ uri: thumbnailUrl }} style={styles.compactImage} />\n        </Pressable>\n      ) : <View style={styles.compactImagePlaceholder}><Text>{asset.latestPhotoUrl ? '⋯' : '📷'}</Text></View>}";
  const newImage = "      {previewUrl ? (\n        <Pressable accessibilityRole=\"button\" accessibilityLabel={`Ver fotografía grande de ${catalog.name}`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>\n          <Image source={{ uri: previewUrl }} style={styles.compactImage} />\n        </Pressable>\n      ) : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}";
  if (!text.includes(oldImage)) throw new Error('No se encontró el bloque de imagen compacta para restaurar la foto original.');
  text = text.replace(oldImage, newImage);

  fs.writeFileSync(path, text);
}

console.log('Inventory thumbnail safe fallback applied.');
