const fs = require('fs');

const path = 'scripts/patchInventorySafeThumbnailsV2.cjs';
let text = fs.readFileSync(path, 'utf8');
const oldBlock = `replaceOrConfirm(
  screen,
  lines(
    '      {asset.latestPhotoUrl ? (',
    '        <Pressable accessibilityRole="button" accessibilityLabel={\`Ver fotografía grande de \${catalog.name}\`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>',
    '          <Image source={{ uri: asset.latestPhotoUrl }} style={styles.compactImage} />',
    '        </Pressable>',
    '      ) : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}',
  ),
  lines(
    '      {asset.latestPhotoUrl ? (',
    '        <Pressable accessibilityRole="button" accessibilityLabel={\`Ver fotografía grande de \${catalog.name}\`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>',
    '          <SafeInventoryImage thumbnailUrl={thumbnailUrl} originalUrl={asset.latestPhotoUrl} style={styles.compactImage} />',
    '        </Pressable>',
    '      ) : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}',
  ),
  'originalUrl={asset.latestPhotoUrl} style={styles.compactImage}',
);`;

const newBlock = `{
  let compactText = fs.readFileSync(screen, 'utf8');
  const compactAlreadyApplied = compactText.includes('fallbackToOriginal={false} style={styles.compactImage}')
    || compactText.includes('<SafeInventoryImage thumbnailUrl={thumbnailUrl} originalUrl={asset.latestPhotoUrl} style={styles.compactImage} />');
  if (!compactAlreadyApplied) {
    const compactOld = lines(
      '      {asset.latestPhotoUrl ? (',
      '        <Pressable accessibilityRole="button" accessibilityLabel={\`Ver fotografía grande de \${catalog.name}\`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>',
      '          <Image source={{ uri: asset.latestPhotoUrl }} style={styles.compactImage} />',
      '        </Pressable>',
      '      ) : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}',
    );
    const compactNew = lines(
      '      {asset.latestPhotoUrl ? (',
      '        <Pressable accessibilityRole="button" accessibilityLabel={\`Ver fotografía grande de \${catalog.name}\`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>',
      '          <SafeInventoryImage thumbnailUrl={thumbnailUrl} originalUrl={asset.latestPhotoUrl} style={styles.compactImage} />',
      '        </Pressable>',
      '      ) : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}',
    );
    if (!compactText.includes(compactOld)) throw new Error('Missing compact inventory image block.');
    compactText = compactText.replace(compactOld, compactNew);
    fs.writeFileSync(screen, compactText);
  }
}`;

if (text.includes(oldBlock)) {
  text = text.replace(oldBlock, newBlock);
  fs.writeFileSync(path, text);
} else if (!text.includes('const compactAlreadyApplied = compactText.includes')) {
  throw new Error('No se encontró el bloque de miniatura compacta para hacerlo idempotente.');
}

function makeProxyAware(scriptPath) {
  let script = fs.readFileSync(scriptPath, 'utf8');
  const marker = "text.includes('function thumbnailProxyUrl(')";
  if (script.includes(marker)) return;
  const oldGuard = "  if (text.includes(marker)) return;\n  if (!text.includes(oldText)) throw new Error(`Missing block in ${path}: ${marker}`);";
  const newGuard = "  if (text.includes(marker)) return;\n  if (path.endsWith('InventoryScreenV4.tsx') && text.includes('function thumbnailProxyUrl(')) return;\n  if (!text.includes(oldText)) throw new Error(`Missing block in ${path}: ${marker}`);";
  if (!script.includes(oldGuard)) throw new Error(`No se encontró el guard de idempotencia en ${scriptPath}.`);
  script = script.replace(oldGuard, newGuard);
  fs.writeFileSync(scriptPath, script);
}

makeProxyAware('scripts/patchInventoryThumbnailHardening.cjs');
makeProxyAware('scripts/patchInventoryThumbnailDownloadFix.cjs');

console.log('Base thumbnail patch idempotency verified.');
