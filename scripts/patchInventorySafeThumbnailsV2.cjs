const fs = require('fs');

const lines = (...values) => values.join('\n');

function replaceOrConfirm(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Missing block in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

replaceOrConfirm(
  'src/inventory/v2Types.ts',
  lines(
    '  latestPhotoStoragePath?: string;',
    '  latestPhotoAt?: string;',
    '  notes?: string;',
  ),
  lines(
    '  latestPhotoStoragePath?: string;',
    '  latestPhotoAt?: string;',
    '  latestThumbnailUrl?: string;',
    '  latestThumbnailStoragePath?: string;',
    '  latestThumbnailSourcePhotoPath?: string;',
    '  notes?: string;',
  ),
  'latestThumbnailSourcePhotoPath?: string;',
);

replaceOrConfirm(
  'src/inventory/v2Types.ts',
  lines(
    '  contentType: string;',
    '  sizeBytes: number;',
    '  capturedAt: string;',
  ),
  lines(
    '  contentType: string;',
    '  sizeBytes: number;',
    '  thumbnailStoragePath?: string;',
    '  thumbnailDownloadUrl?: string;',
    '  thumbnailContentType?: string;',
    '  thumbnailSizeBytes?: number;',
    '  capturedAt: string;',
  ),
  'thumbnailDownloadUrl?: string;',
);

const screen = 'src/screens/InventoryScreenV4.tsx';

replaceOrConfirm(
  screen,
  "import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';",
  "import { Image, ImageStyle, Pressable, ScrollView, StyleProp, StyleSheet, Text, View } from 'react-native';",
  'ImageStyle, Pressable',
);

replaceOrConfirm(
  screen,
  "import { uploadInventoryImage } from '../services/inventoryStorage';",
  lines(
    "import { uploadInventoryImage } from '../services/inventoryStorage';",
    "import { uploadInventoryThumbnail } from '../services/inventoryThumbnailStorage';",
  ),
  "from '../services/inventoryThumbnailStorage'",
);

replaceOrConfirm(
  screen,
  lines(
    'function isRetired(asset: VanToolAssetV2) {',
    "  return ['Retirada', 'Desechada'].includes(asset.operationalStatus ?? '') || Boolean(asset.retiredAt);",
    '}',
    '',
  ),
  lines(
    'function isRetired(asset: VanToolAssetV2) {',
    "  return ['Retirada', 'Desechada'].includes(asset.operationalStatus ?? '') || Boolean(asset.retiredAt);",
    '}',
    '',
    'function currentThumbnailUrl(asset: VanToolAssetV2) {',
    '  if (!asset.latestThumbnailUrl) return undefined;',
    '  if (!asset.latestPhotoStoragePath) return asset.latestThumbnailUrl;',
    '  return asset.latestThumbnailSourcePhotoPath === asset.latestPhotoStoragePath ? asset.latestThumbnailUrl : undefined;',
    '}',
    '',
    'function SafeInventoryImage({ thumbnailUrl, originalUrl, style }: { thumbnailUrl?: string; originalUrl?: string; style: StyleProp<ImageStyle> }) {',
    '  const [thumbnailFailed, setThumbnailFailed] = useState(false);',
    '  useEffect(() => setThumbnailFailed(false), [thumbnailUrl, originalUrl]);',
    '  const resolvedUrl = thumbnailUrl && !thumbnailFailed ? thumbnailUrl : originalUrl;',
    '  if (!resolvedUrl) return null;',
    '  return (',
    '    <Image',
    '      source={{ uri: resolvedUrl }}',
    '      style={style}',
    '      onError={() => {',
    '        if (thumbnailUrl && resolvedUrl === thumbnailUrl) setThumbnailFailed(true);',
    '      }}',
    '    />',
    '  );',
    '}',
    '',
  ),
  'function SafeInventoryImage(',
);

replaceOrConfirm(
  screen,
  lines(
    "  const [photoBusyId, setPhotoBusyId] = useState('');",
    '  const [backgroundUploads, setBackgroundUploads] = useState(0);',
  ),
  lines(
    "  const [photoBusyId, setPhotoBusyId] = useState('');",
    '  const [backgroundUploads, setBackgroundUploads] = useState(0);',
    '  const [thumbnailBusy, setThumbnailBusy] = useState(false);',
    "  const [thumbnailProgress, setThumbnailProgress] = useState('');",
  ),
  'const [thumbnailBusy, setThumbnailBusy]',
);

replaceOrConfirm(
  screen,
  lines(
    '  const registrationQuantity = Math.max(1, Math.min(20, Math.round(Number(toolQuantity || 1))));',
    '  const additionQuantity = Math.max(1, Math.min(20, Math.round(Number(addQuantity || 1))));',
  ),
  lines(
    '  const registrationQuantity = Math.max(1, Math.min(20, Math.round(Number(toolQuantity || 1))));',
    '  const additionQuantity = Math.max(1, Math.min(20, Math.round(Number(addQuantity || 1))));',
    '  const assetsMissingThumbnails = selectedAssets.filter((asset) => asset.latestPhotoUrl && !currentThumbnailUrl(asset));',
  ),
  'const assetsMissingThumbnails = selectedAssets.filter',
);

replaceOrConfirm(
  screen,
  lines(
    "      const stored = await uploadInventoryImage({ ...photo, scope: 'van-tool', entityId: asset.id, evidenceId });",
    '      const now = new Date().toISOString();',
  ),
  lines(
    "      const stored = await uploadInventoryImage({ ...photo, scope: 'van-tool', entityId: asset.id, evidenceId });",
    "      const thumbnail = await uploadInventoryThumbnail({ ...photo, scope: 'van-tool', entityId: asset.id, evidenceId }).catch(() => null);",
    '      const now = new Date().toISOString();',
  ),
  'const thumbnail = await uploadInventoryThumbnail',
);

replaceOrConfirm(
  screen,
  lines(
    '        phase,',
    '        ...stored,',
    '        capturedAt: now,',
  ),
  lines(
    '        phase,',
    '        ...stored,',
    '        ...(thumbnail ?? {}),',
    '        capturedAt: now,',
  ),
  '...(thumbnail ?? {}),',
);

replaceOrConfirm(
  screen,
  lines(
    '        latestPhotoUrl: stored.downloadUrl,',
    '        latestPhotoStoragePath: stored.storagePath,',
    '        latestPhotoAt: now,',
  ),
  lines(
    '        latestPhotoUrl: stored.downloadUrl,',
    '        latestPhotoStoragePath: stored.storagePath,',
    '        latestPhotoAt: now,',
    '        latestThumbnailUrl: thumbnail?.thumbnailDownloadUrl,',
    '        latestThumbnailStoragePath: thumbnail?.thumbnailStoragePath,',
    '        latestThumbnailSourcePhotoPath: thumbnail ? stored.storagePath : undefined,',
  ),
  'latestThumbnailSourcePhotoPath: thumbnail ? stored.storagePath',
);

const optimizeFunction = lines(
  '  async function optimizeExistingThumbnails() {',
  "    if (!currentUser || currentUser.role !== 'admin' || thumbnailBusy) return;",
  '    const pending = selectedAssets.filter((asset) => asset.latestPhotoUrl && !currentThumbnailUrl(asset));',
  '    if (!pending.length) {',
  "      setMessage('Todas las fotografías de esta van ya tienen miniatura optimizada.');",
  '      return;',
  '    }',
  '',
  '    setThumbnailBusy(true);',
  '    setThumbnailProgress(`0/${pending.length}`);',
  '    let completed = 0;',
  '    let failed = 0;',
  '    for (const asset of pending) {',
  '      try {',
  '        setThumbnailProgress(`${completed + failed + 1}/${pending.length}`);',
  '        const thumbnail = await uploadInventoryThumbnail({',
  '          uri: asset.latestPhotoUrl,',
  '          sourceStoragePath: asset.latestPhotoStoragePath,',
  "          scope: 'van-tool',",
  '          entityId: asset.id,',
  '          evidenceId: `existing-${asset.id}-${asset.latestPhotoAt ?? Date.now()}`,',
  '        });',
  "        if (!thumbnail) throw new Error('El navegador no pudo crear la miniatura.');",
  '',
  '        const assetResult = await module.saveVanAssetQuietly({',
  '          ...asset,',
  '          latestThumbnailUrl: thumbnail.thumbnailDownloadUrl,',
  '          latestThumbnailStoragePath: thumbnail.thumbnailStoragePath,',
  '          latestThumbnailSourcePhotoPath: asset.latestPhotoStoragePath,',
  '        });',
  "        if (!assetResult.ok) throw new Error(assetResult.message ?? 'No se pudo guardar la miniatura.');",
  '',
  '        const matchingEvidence = module.evidence',
  '          .filter((evidence) => evidence.entityId === asset.id)',
  '          .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))',
  '          .find((evidence) => !asset.latestPhotoStoragePath || evidence.storagePath === asset.latestPhotoStoragePath);',
  '        if (matchingEvidence) {',
  '          const evidenceResult = await module.saveInventoryEvidence({ ...matchingEvidence, ...thumbnail });',
  "          if (!evidenceResult.ok) throw new Error(evidenceResult.message ?? 'No se pudo actualizar el historial fotográfico.');",
  '        }',
  '        completed += 1;',
  '      } catch {',
  '        failed += 1;',
  '      }',
  '    }',
  '',
  '    setThumbnailBusy(false);',
  "    setThumbnailProgress('');",
  '    setMessage(failed',
  '      ? `${completed} miniatura(s) optimizadas y ${failed} pendiente(s). Las fotos originales permanecen disponibles.`',
  '      : `${completed} miniatura(s) optimizadas correctamente. Las fotos originales permanecen intactas.`);',
  '  }',
  '',
);

replaceOrConfirm(
  screen,
  '  async function registerTool() {',
  `${optimizeFunction}  async function registerTool() {`,
  'async function optimizeExistingThumbnails()',
);

replaceOrConfirm(
  screen,
  lines(
    'function AssetSummary({ asset, catalog, onPhotoPress }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2; onPhotoPress?: () => void }) {',
    '  const image = asset.latestPhotoUrl ? <Image source={{ uri: asset.latestPhotoUrl }} style={styles.assetImage} /> : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>;',
    '  return (',
    '    <View style={styles.assetTop}>',
    '      {asset.latestPhotoUrl && onPhotoPress ? <Pressable accessibilityRole="button" accessibilityLabel="Ver fotografía grande" onPress={onPhotoPress} style={styles.assetPhotoButton}>{image}</Pressable> : image}',
  ),
  lines(
    'function AssetSummary({ asset, catalog, onPhotoPress }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2; onPhotoPress?: () => void }) {',
    '  const thumbnailUrl = currentThumbnailUrl(asset);',
    '  const image = asset.latestPhotoUrl',
    '    ? <SafeInventoryImage thumbnailUrl={thumbnailUrl} originalUrl={asset.latestPhotoUrl} style={styles.assetImage} />',
    '    : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>;',
    '  return (',
    '    <View style={styles.assetTop}>',
    '      {asset.latestPhotoUrl && onPhotoPress ? <Pressable accessibilityRole="button" accessibilityLabel="Ver fotografía grande" onPress={onPhotoPress} style={styles.assetPhotoButton}>{image}</Pressable> : image}',
  ),
  'originalUrl={asset.latestPhotoUrl} style={styles.assetImage}',
);

const compactStartOld = lines(
  'function CompactAssetRow({ asset, catalog, onOpenProfile, onOpenPhoto }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; onOpenProfile: () => void; onOpenPhoto: () => void }) {',
  "  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';",
);
const compactStartNew = lines(
  'function CompactAssetRow({ asset, catalog, onOpenProfile, onOpenPhoto }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; onOpenProfile: () => void; onOpenPhoto: () => void }) {',
  '  const thumbnailUrl = currentThumbnailUrl(asset);',
  "  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';",
);
replaceOrConfirm(screen, compactStartOld, compactStartNew, compactStartNew);

replaceOrConfirm(
  screen,
  lines(
    '      {asset.latestPhotoUrl ? (',
    '        <Pressable accessibilityRole="button" accessibilityLabel={`Ver fotografía grande de ${catalog.name}`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>',
    '          <Image source={{ uri: asset.latestPhotoUrl }} style={styles.compactImage} />',
    '        </Pressable>',
    '      ) : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}',
  ),
  lines(
    '      {asset.latestPhotoUrl ? (',
    '        <Pressable accessibilityRole="button" accessibilityLabel={`Ver fotografía grande de ${catalog.name}`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>',
    '          <SafeInventoryImage thumbnailUrl={thumbnailUrl} originalUrl={asset.latestPhotoUrl} style={styles.compactImage} />',
    '        </Pressable>',
    '      ) : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}',
  ),
  'originalUrl={asset.latestPhotoUrl} style={styles.compactImage}',
);

replaceOrConfirm(
  screen,
  '{historicalEvidence.map((photo) => <Pressable key={photo.id} accessibilityRole="button" onPress={() => onOpenPhoto(photo.downloadUrl)}><Image source={{ uri: photo.downloadUrl }} style={styles.historyImage} /><Text style={styles.historyDate}>{new Date(photo.capturedAt).toLocaleDateString(\'es-AW\')}</Text></Pressable>)}',
  '{historicalEvidence.map((photo) => <Pressable key={photo.id} accessibilityRole="button" onPress={() => onOpenPhoto(photo.downloadUrl)}><SafeInventoryImage thumbnailUrl={photo.thumbnailDownloadUrl} originalUrl={photo.downloadUrl} style={styles.historyImage} /><Text style={styles.historyDate}>{new Date(photo.capturedAt).toLocaleDateString(\'es-AW\')}</Text></Pressable>)}',
  'thumbnailUrl={photo.thumbnailDownloadUrl} originalUrl={photo.downloadUrl}',
);

replaceOrConfirm(
  screen,
  '{photo ? <Image source={{ uri: photo.downloadUrl }} style={styles.checkPhoto} /> : null}',
  '{photo ? <SafeInventoryImage thumbnailUrl={photo.thumbnailDownloadUrl} originalUrl={photo.downloadUrl} style={styles.checkPhoto} /> : null}',
  'thumbnailUrl={photo.thumbnailDownloadUrl} originalUrl={photo.downloadUrl} style={styles.checkPhoto}',
);

const sectionOld = '            <SectionTitle title={`Herramientas de ${selectedVan.name}`} subtitle="Pulsa una herramienta para abrir su perfil, condición, observaciones y acciones." />';
const sectionNew = lines(
  '            <SectionTitle',
  '              title={`Herramientas de ${selectedVan.name}`}',
  '              subtitle="Pulsa una herramienta para abrir su perfil, condición, observaciones y acciones."',
  "              action={currentUser?.role === 'admin' && assetsMissingThumbnails.length ? (",
  '                <Button',
  '                  compact',
  '                  variant="secondary"',
  '                  label={thumbnailBusy ? `Optimizando ${thumbnailProgress}` : `Optimizar miniaturas (${assetsMissingThumbnails.length})`}',
  '                  disabled={thumbnailBusy}',
  '                  onPress={() => void optimizeExistingThumbnails()}',
  '                />',
  '              ) : undefined}',
  '            />',
);
replaceOrConfirm(screen, sectionOld, sectionNew, 'Optimizar miniaturas (${assetsMissingThumbnails.length})');

replaceOrConfirm(
  'src/components/InventoryCleanupAdmin.tsx',
  lines(
    '      targetEvidence.forEach((photo) => storagePaths.add(photo.storagePath));',
    '      targetAssets.forEach((asset) => { if (asset.latestPhotoStoragePath) storagePaths.add(asset.latestPhotoStoragePath); });',
  ),
  lines(
    '      targetEvidence.forEach((photo) => {',
    '        storagePaths.add(photo.storagePath);',
    '        if (photo.thumbnailStoragePath) storagePaths.add(photo.thumbnailStoragePath);',
    '      });',
    '      targetAssets.forEach((asset) => {',
    '        if (asset.latestPhotoStoragePath) storagePaths.add(asset.latestPhotoStoragePath);',
    '        if (asset.latestThumbnailStoragePath) storagePaths.add(asset.latestThumbnailStoragePath);',
    '      });',
  ),
  'if (photo.thumbnailStoragePath) storagePaths.add',
);

console.log('Safe inventory thumbnail optimization v2 applied.');
