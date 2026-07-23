const fs = require('fs');

function replaceOrConfirm(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Missing block in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

replaceOrConfirm(
  'src/inventory/v2Types.ts',
  "  latestPhotoStoragePath?: string;\n  latestPhotoAt?: string;\n  notes?: string;",
  "  latestPhotoStoragePath?: string;\n  latestPhotoAt?: string;\n  latestThumbnailUrl?: string;\n  latestThumbnailStoragePath?: string;\n  latestThumbnailSourcePhotoPath?: string;\n  notes?: string;",
  'latestThumbnailSourcePhotoPath?: string;',
);

replaceOrConfirm(
  'src/inventory/v2Types.ts',
  "  contentType: string;\n  sizeBytes: number;\n  capturedAt: string;",
  "  contentType: string;\n  sizeBytes: number;\n  thumbnailStoragePath?: string;\n  thumbnailDownloadUrl?: string;\n  thumbnailContentType?: string;\n  thumbnailSizeBytes?: number;\n  capturedAt: string;",
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
  "import { uploadInventoryImage } from '../services/inventoryStorage';\nimport { uploadInventoryThumbnail } from '../services/inventoryThumbnailStorage';",
  "from '../services/inventoryThumbnailStorage'",
);

replaceOrConfirm(
  screen,
  "function isRetired(asset: VanToolAssetV2) {\n  return ['Retirada', 'Desechada'].includes(asset.operationalStatus ?? '') || Boolean(asset.retiredAt);\n}\n",
  `function isRetired(asset: VanToolAssetV2) {
  return ['Retirada', 'Desechada'].includes(asset.operationalStatus ?? '') || Boolean(asset.retiredAt);
}

function currentThumbnailUrl(asset: VanToolAssetV2) {
  if (!asset.latestThumbnailUrl) return undefined;
  if (!asset.latestPhotoStoragePath) return asset.latestThumbnailUrl;
  return asset.latestThumbnailSourcePhotoPath === asset.latestPhotoStoragePath ? asset.latestThumbnailUrl : undefined;
}

function SafeInventoryImage({ thumbnailUrl, originalUrl, style }: { thumbnailUrl?: string; originalUrl?: string; style: StyleProp<ImageStyle> }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  useEffect(() => setThumbnailFailed(false), [thumbnailUrl, originalUrl]);
  const resolvedUrl = thumbnailUrl && !thumbnailFailed ? thumbnailUrl : originalUrl;
  if (!resolvedUrl) return null;
  return (
    <Image
      source={{ uri: resolvedUrl }}
      style={style}
      onError={() => {
        if (thumbnailUrl && resolvedUrl === thumbnailUrl) setThumbnailFailed(true);
      }}
    />
  );
}
`,
  'function SafeInventoryImage(',
);

replaceOrConfirm(
  screen,
  "  const [photoBusyId, setPhotoBusyId] = useState('');\n  const [backgroundUploads, setBackgroundUploads] = useState(0);",
  "  const [photoBusyId, setPhotoBusyId] = useState('');\n  const [backgroundUploads, setBackgroundUploads] = useState(0);\n  const [thumbnailBusy, setThumbnailBusy] = useState(false);\n  const [thumbnailProgress, setThumbnailProgress] = useState('');",
  'const [thumbnailBusy, setThumbnailBusy]',
);

replaceOrConfirm(
  screen,
  "  const registrationQuantity = Math.max(1, Math.min(20, Math.round(Number(toolQuantity || 1))));\n  const additionQuantity = Math.max(1, Math.min(20, Math.round(Number(addQuantity || 1))));",
  "  const registrationQuantity = Math.max(1, Math.min(20, Math.round(Number(toolQuantity || 1))));\n  const additionQuantity = Math.max(1, Math.min(20, Math.round(Number(addQuantity || 1))));\n  const assetsMissingThumbnails = selectedAssets.filter((asset) => asset.latestPhotoUrl && !currentThumbnailUrl(asset));",
  'const assetsMissingThumbnails = selectedAssets.filter',
);

replaceOrConfirm(
  screen,
  "      const stored = await uploadInventoryImage({ ...photo, scope: 'van-tool', entityId: asset.id, evidenceId });\n      const now = new Date().toISOString();",
  "      const stored = await uploadInventoryImage({ ...photo, scope: 'van-tool', entityId: asset.id, evidenceId });\n      const thumbnail = await uploadInventoryThumbnail({ ...photo, scope: 'van-tool', entityId: asset.id, evidenceId }).catch(() => null);\n      const now = new Date().toISOString();",
  'const thumbnail = await uploadInventoryThumbnail',
);

replaceOrConfirm(
  screen,
  "        phase,\n        ...stored,\n        capturedAt: now,",
  "        phase,\n        ...stored,\n        ...(thumbnail ?? {}),\n        capturedAt: now,",
  '...(thumbnail ?? {}),',
);

replaceOrConfirm(
  screen,
  "        latestPhotoUrl: stored.downloadUrl,\n        latestPhotoStoragePath: stored.storagePath,\n        latestPhotoAt: now,",
  "        latestPhotoUrl: stored.downloadUrl,\n        latestPhotoStoragePath: stored.storagePath,\n        latestPhotoAt: now,\n        latestThumbnailUrl: thumbnail?.thumbnailDownloadUrl,\n        latestThumbnailStoragePath: thumbnail?.thumbnailStoragePath,\n        latestThumbnailSourcePhotoPath: thumbnail ? stored.storagePath : undefined,",
  'latestThumbnailSourcePhotoPath: thumbnail ? stored.storagePath',
);

replaceOrConfirm(
  screen,
  "  async function registerTool() {",
  `  async function optimizeExistingThumbnails() {
    if (!currentUser || currentUser.role !== 'admin' || thumbnailBusy) return;
    const pending = selectedAssets.filter((asset) => asset.latestPhotoUrl && !currentThumbnailUrl(asset));
    if (!pending.length) {
      setMessage('Todas las fotografías de esta van ya tienen miniatura optimizada.');
      return;
    }

    setThumbnailBusy(true);
    setThumbnailProgress(`0/${pending.length}`);
    let completed = 0;
    let failed = 0;
    for (const asset of pending) {
      try {
        setThumbnailProgress(`${completed + failed + 1}/${pending.length}`);
        const thumbnail = await uploadInventoryThumbnail({
          uri: asset.latestPhotoUrl,
          sourceStoragePath: asset.latestPhotoStoragePath,
          scope: 'van-tool',
          entityId: asset.id,
          evidenceId: `existing-${asset.id}-${asset.latestPhotoAt ?? Date.now()}`,
        });
        if (!thumbnail) throw new Error('El navegador no pudo crear la miniatura.');

        const assetResult = await module.saveVanAssetQuietly({
          ...asset,
          latestThumbnailUrl: thumbnail.thumbnailDownloadUrl,
          latestThumbnailStoragePath: thumbnail.thumbnailStoragePath,
          latestThumbnailSourcePhotoPath: asset.latestPhotoStoragePath,
        });
        if (!assetResult.ok) throw new Error(assetResult.message ?? 'No se pudo guardar la miniatura.');

        const matchingEvidence = module.evidence
          .filter((evidence) => evidence.entityId === asset.id)
          .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
          .find((evidence) => !asset.latestPhotoStoragePath || evidence.storagePath === asset.latestPhotoStoragePath);
        if (matchingEvidence) {
          const evidenceResult = await module.saveInventoryEvidence({ ...matchingEvidence, ...thumbnail });
          if (!evidenceResult.ok) throw new Error(evidenceResult.message ?? 'No se pudo actualizar el historial fotográfico.');
        }
        completed += 1;
      } catch {
        failed += 1;
      }
    }

    setThumbnailBusy(false);
    setThumbnailProgress('');
    setMessage(failed
      ? `${completed} miniatura(s) optimizadas y ${failed} pendiente(s). Las fotos originales permanecen disponibles.`
      : `${completed} miniatura(s) optimizadas correctamente. Las fotos originales permanecen intactas.`);
  }

  async function registerTool() {`,
  'async function optimizeExistingThumbnails()',
);

replaceOrConfirm(
  screen,
  `function AssetSummary({ asset, catalog, onPhotoPress }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2; onPhotoPress?: () => void }) {
  const image = asset.latestPhotoUrl ? <Image source={{ uri: asset.latestPhotoUrl }} style={styles.assetImage} /> : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>;
  return (
    <View style={styles.assetTop}>
      {asset.latestPhotoUrl && onPhotoPress ? <Pressable accessibilityRole="button" accessibilityLabel="Ver fotografía grande" onPress={onPhotoPress} style={styles.assetPhotoButton}>{image}</Pressable> : image}`,
  `function AssetSummary({ asset, catalog, onPhotoPress }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2; onPhotoPress?: () => void }) {
  const thumbnailUrl = currentThumbnailUrl(asset);
  const image = asset.latestPhotoUrl
    ? <SafeInventoryImage thumbnailUrl={thumbnailUrl} originalUrl={asset.latestPhotoUrl} style={styles.assetImage} />
    : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>;
  return (
    <View style={styles.assetTop}>
      {asset.latestPhotoUrl && onPhotoPress ? <Pressable accessibilityRole="button" accessibilityLabel="Ver fotografía grande" onPress={onPhotoPress} style={styles.assetPhotoButton}>{image}</Pressable> : image}`,
  'const thumbnailUrl = currentThumbnailUrl(asset);\n  const image = asset.latestPhotoUrl',
);

replaceOrConfirm(
  screen,
  `function CompactAssetRow({ asset, catalog, onOpenProfile, onOpenPhoto }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; onOpenProfile: () => void; onOpenPhoto: () => void }) {
  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';`,
  `function CompactAssetRow({ asset, catalog, onOpenProfile, onOpenPhoto }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; onOpenProfile: () => void; onOpenPhoto: () => void }) {
  const thumbnailUrl = currentThumbnailUrl(asset);
  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';`,
  'function CompactAssetRow({ asset, catalog, onOpenProfile, onOpenPhoto',
);

replaceOrConfirm(
  screen,
  `      {asset.latestPhotoUrl ? (
        <Pressable accessibilityRole="button" accessibilityLabel={\`Ver fotografía grande de \${catalog.name}\`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>
          <Image source={{ uri: asset.latestPhotoUrl }} style={styles.compactImage} />
        </Pressable>
      ) : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}`,
  `      {asset.latestPhotoUrl ? (
        <Pressable accessibilityRole="button" accessibilityLabel={\`Ver fotografía grande de \${catalog.name}\`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>
          <SafeInventoryImage thumbnailUrl={thumbnailUrl} originalUrl={asset.latestPhotoUrl} style={styles.compactImage} />
        </Pressable>
      ) : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}`,
  '<SafeInventoryImage thumbnailUrl={thumbnailUrl} originalUrl={asset.latestPhotoUrl} style={styles.compactImage}',
);

replaceOrConfirm(
  screen,
  "{historicalEvidence.map((photo) => <Pressable key={photo.id} accessibilityRole=\"button\" onPress={() => onOpenPhoto(photo.downloadUrl)}><Image source={{ uri: photo.downloadUrl }} style={styles.historyImage} /><Text style={styles.historyDate}>{new Date(photo.capturedAt).toLocaleDateString('es-AW')}</Text></Pressable>)}",
  "{historicalEvidence.map((photo) => <Pressable key={photo.id} accessibilityRole=\"button\" onPress={() => onOpenPhoto(photo.downloadUrl)}><SafeInventoryImage thumbnailUrl={photo.thumbnailDownloadUrl} originalUrl={photo.downloadUrl} style={styles.historyImage} /><Text style={styles.historyDate}>{new Date(photo.capturedAt).toLocaleDateString('es-AW')}</Text></Pressable>)}",
  'thumbnailUrl={photo.thumbnailDownloadUrl} originalUrl={photo.downloadUrl}',
);

replaceOrConfirm(
  screen,
  "{photo ? <Image source={{ uri: photo.downloadUrl }} style={styles.checkPhoto} /> : null}",
  "{photo ? <SafeInventoryImage thumbnailUrl={photo.thumbnailDownloadUrl} originalUrl={photo.downloadUrl} style={styles.checkPhoto} /> : null}",
  'thumbnailUrl={photo.thumbnailDownloadUrl} originalUrl={photo.downloadUrl} style={styles.checkPhoto}',
);

replaceOrConfirm(
  screen,
  "            <SectionTitle title={`Herramientas de ${selectedVan.name}`} subtitle=\"Pulsa una herramienta para abrir su perfil, condición, observaciones y acciones.\" />",
  `            <SectionTitle
              title={\`Herramientas de \${selectedVan.name}\`}
              subtitle="Pulsa una herramienta para abrir su perfil, condición, observaciones y acciones."
              action={currentUser?.role === 'admin' && assetsMissingThumbnails.length ? (
                <Button
                  compact
                  variant="secondary"
                  label={thumbnailBusy ? \`Optimizando \${thumbnailProgress}\` : \`Optimizar miniaturas (\${assetsMissingThumbnails.length})\`}
                  disabled={thumbnailBusy}
                  onPress={() => void optimizeExistingThumbnails()}
                />
              ) : undefined}
            />`,
  'label={thumbnailBusy ? `Optimizando ${thumbnailProgress}`',
);

replaceOrConfirm(
  'src/components/InventoryCleanupAdmin.tsx',
  "      targetEvidence.forEach((photo) => storagePaths.add(photo.storagePath));\n      targetAssets.forEach((asset) => { if (asset.latestPhotoStoragePath) storagePaths.add(asset.latestPhotoStoragePath); });",
  "      targetEvidence.forEach((photo) => {\n        storagePaths.add(photo.storagePath);\n        if (photo.thumbnailStoragePath) storagePaths.add(photo.thumbnailStoragePath);\n      });\n      targetAssets.forEach((asset) => {\n        if (asset.latestPhotoStoragePath) storagePaths.add(asset.latestPhotoStoragePath);\n        if (asset.latestThumbnailStoragePath) storagePaths.add(asset.latestThumbnailStoragePath);\n      });",
  'if (photo.thumbnailStoragePath) storagePaths.add',
);

console.log('Safe inventory thumbnail optimization applied.');
