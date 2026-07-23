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
  "import React, { useEffect, useState } from 'react';",
  "import React, { useEffect, useRef, useState } from 'react';",
  'useEffect, useRef, useState',
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
  "function isRetired(asset: VanToolAssetV2) {\n  return ['Retirada', 'Desechada'].includes(asset.operationalStatus ?? '') || Boolean(asset.retiredAt);\n}\n\nfunction currentThumbnailUrl(asset: VanToolAssetV2) {\n  if (!asset.latestThumbnailUrl) return undefined;\n  if (!asset.latestPhotoStoragePath) return asset.latestThumbnailUrl;\n  return asset.latestThumbnailSourcePhotoPath === asset.latestPhotoStoragePath ? asset.latestThumbnailUrl : undefined;\n}\n",
  'function currentThumbnailUrl(asset: VanToolAssetV2)',
);

replaceOrConfirm(
  screen,
  "  const [photoBusyId, setPhotoBusyId] = useState('');\n  const [backgroundUploads, setBackgroundUploads] = useState(0);",
  "  const [photoBusyId, setPhotoBusyId] = useState('');\n  const [backgroundUploads, setBackgroundUploads] = useState(0);\n  const thumbnailAttemptedIds = useRef(new Set<string>());",
  'const thumbnailAttemptedIds = useRef',
);

replaceOrConfirm(
  screen,
  "  const registrationQuantity = Math.max(1, Math.min(20, Math.round(Number(toolQuantity || 1))));\n  const additionQuantity = Math.max(1, Math.min(20, Math.round(Number(addQuantity || 1))));\n\n  useEffect(() => {",
  "  const registrationQuantity = Math.max(1, Math.min(20, Math.round(Number(toolQuantity || 1))));\n  const additionQuantity = Math.max(1, Math.min(20, Math.round(Number(addQuantity || 1))));\n  const thumbnailBackfillKey = selectedAssets\n    .filter((asset) => asset.latestPhotoUrl && !currentThumbnailUrl(asset))\n    .map((asset) => `${asset.id}:${asset.latestPhotoStoragePath ?? asset.latestPhotoAt ?? 'photo'}`)\n    .join('|');\n\n  useEffect(() => {\n    if (view !== 'van-profile' || currentUser?.authProvider !== 'firebase' || !thumbnailBackfillKey) return;\n    const pending = selectedAssets\n      .filter((asset) => asset.latestPhotoUrl && !currentThumbnailUrl(asset))\n      .filter((asset) => !thumbnailAttemptedIds.current.has(`${asset.id}:${asset.latestPhotoStoragePath ?? asset.latestPhotoAt ?? 'photo'}`))\n      .slice(0, 4);\n    if (!pending.length) return;\n\n    let active = true;\n    void (async () => {\n      for (const asset of pending) {\n        if (!active) break;\n        const attemptKey = `${asset.id}:${asset.latestPhotoStoragePath ?? asset.latestPhotoAt ?? 'photo'}`;\n        thumbnailAttemptedIds.current.add(attemptKey);\n        try {\n          const thumbnail = await uploadInventoryThumbnail({\n            uri: asset.latestPhotoUrl!,\n            scope: 'van-tool',\n            entityId: asset.id,\n            evidenceId: `legacy-${asset.id}-${asset.latestPhotoAt ?? 'photo'}`,\n          });\n          if (!thumbnail || !active) continue;\n          await module.saveVanAssetQuietly({\n            ...asset,\n            latestThumbnailUrl: thumbnail.thumbnailDownloadUrl,\n            latestThumbnailStoragePath: thumbnail.thumbnailStoragePath,\n            latestThumbnailSourcePhotoPath: asset.latestPhotoStoragePath,\n          });\n        } catch {\n          // The full image remains available from the tool profile if thumbnail backfill fails.\n        }\n      }\n    })();\n\n    return () => { active = false; };\n  }, [view, selectedVanId, thumbnailBackfillKey, currentUser?.id]);\n\n  useEffect(() => {",
  'const thumbnailBackfillKey = selectedAssets',
);

replaceOrConfirm(
  screen,
  "      const stored = await uploadInventoryImage({ ...photo, scope: 'van-tool', entityId: asset.id, evidenceId });\n      const now = new Date().toISOString();",
  "      const [stored, thumbnail] = await Promise.all([\n        uploadInventoryImage({ ...photo, scope: 'van-tool', entityId: asset.id, evidenceId }),\n        uploadInventoryThumbnail({ ...photo, scope: 'van-tool', entityId: asset.id, evidenceId }).catch(() => null),\n      ]);\n      const now = new Date().toISOString();",
  'const [stored, thumbnail] = await Promise.all',
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
  "        latestPhotoUrl: stored.downloadUrl,\n        latestPhotoStoragePath: stored.storagePath,\n        latestPhotoAt: now,\n        latestThumbnailUrl: thumbnail?.thumbnailDownloadUrl ?? asset.latestThumbnailUrl,\n        latestThumbnailStoragePath: thumbnail?.thumbnailStoragePath ?? asset.latestThumbnailStoragePath,\n        latestThumbnailSourcePhotoPath: thumbnail ? stored.storagePath : asset.latestThumbnailSourcePhotoPath,",
  'latestThumbnailSourcePhotoPath: thumbnail ? stored.storagePath',
);

replaceOrConfirm(
  screen,
  "function AssetSummary({ asset, catalog, onPhotoPress }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2; onPhotoPress?: () => void }) {\n  const image = asset.latestPhotoUrl ? <Image source={{ uri: asset.latestPhotoUrl }} style={styles.assetImage} /> : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>;\n  return (\n    <View style={styles.assetTop}>\n      {asset.latestPhotoUrl && onPhotoPress ? <Pressable accessibilityRole=\"button\" accessibilityLabel=\"Ver fotografía grande\" onPress={onPhotoPress} style={styles.assetPhotoButton}>{image}</Pressable> : image}",
  "function AssetSummary({ asset, catalog, onPhotoPress }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2; onPhotoPress?: () => void }) {\n  const imageUrl = currentThumbnailUrl(asset) ?? asset.latestPhotoUrl;\n  const image = imageUrl ? <Image source={{ uri: imageUrl }} style={styles.assetImage} /> : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>;\n  return (\n    <View style={styles.assetTop}>\n      {imageUrl && onPhotoPress ? <Pressable accessibilityRole=\"button\" accessibilityLabel=\"Ver fotografía grande\" onPress={onPhotoPress} style={styles.assetPhotoButton}>{image}</Pressable> : image}",
  'const imageUrl = currentThumbnailUrl(asset)',
);

replaceOrConfirm(
  screen,
  "function CompactAssetRow({ asset, catalog, onOpenProfile, onOpenPhoto }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; onOpenProfile: () => void; onOpenPhoto: () => void }) {\n  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';",
  "function CompactAssetRow({ asset, catalog, onOpenProfile, onOpenPhoto }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; onOpenProfile: () => void; onOpenPhoto: () => void }) {\n  const thumbnailUrl = currentThumbnailUrl(asset);\n  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';",
  'const thumbnailUrl = currentThumbnailUrl(asset);',
);

replaceOrConfirm(
  screen,
  "      {asset.latestPhotoUrl ? (\n        <Pressable accessibilityRole=\"button\" accessibilityLabel={`Ver fotografía grande de ${catalog.name}`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>\n          <Image source={{ uri: asset.latestPhotoUrl }} style={styles.compactImage} />\n        </Pressable>\n      ) : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}",
  "      {thumbnailUrl ? (\n        <Pressable accessibilityRole=\"button\" accessibilityLabel={`Ver fotografía grande de ${catalog.name}`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>\n          <Image source={{ uri: thumbnailUrl }} style={styles.compactImage} />\n        </Pressable>\n      ) : <View style={styles.compactImagePlaceholder}><Text>{asset.latestPhotoUrl ? '⋯' : '📷'}</Text></View>}",
  "<Image source={{ uri: thumbnailUrl }} style={styles.compactImage}",
);

replaceOrConfirm(
  screen,
  "{historicalEvidence.map((photo) => <Pressable key={photo.id} accessibilityRole=\"button\" onPress={() => onOpenPhoto(photo.downloadUrl)}><Image source={{ uri: photo.downloadUrl }} style={styles.historyImage} /><Text style={styles.historyDate}>{new Date(photo.capturedAt).toLocaleDateString('es-AW')}</Text></Pressable>)}",
  "{historicalEvidence.map((photo) => <Pressable key={photo.id} accessibilityRole=\"button\" onPress={() => onOpenPhoto(photo.downloadUrl)}><Image source={{ uri: photo.thumbnailDownloadUrl ?? photo.downloadUrl }} style={styles.historyImage} /><Text style={styles.historyDate}>{new Date(photo.capturedAt).toLocaleDateString('es-AW')}</Text></Pressable>)}",
  'photo.thumbnailDownloadUrl ?? photo.downloadUrl',
);

replaceOrConfirm(
  screen,
  "{photo ? <Image source={{ uri: photo.downloadUrl }} style={styles.checkPhoto} /> : null}",
  "{photo ? <Image source={{ uri: photo.thumbnailDownloadUrl ?? photo.downloadUrl }} style={styles.checkPhoto} /> : null}",
  "photo.thumbnailDownloadUrl ?? photo.downloadUrl }} style={styles.checkPhoto}",
);

replaceOrConfirm(
  'src/components/InventoryCleanupAdmin.tsx',
  "      targetEvidence.forEach((photo) => storagePaths.add(photo.storagePath));\n      targetAssets.forEach((asset) => { if (asset.latestPhotoStoragePath) storagePaths.add(asset.latestPhotoStoragePath); });",
  "      targetEvidence.forEach((photo) => {\n        storagePaths.add(photo.storagePath);\n        if (photo.thumbnailStoragePath) storagePaths.add(photo.thumbnailStoragePath);\n      });\n      targetAssets.forEach((asset) => {\n        if (asset.latestPhotoStoragePath) storagePaths.add(asset.latestPhotoStoragePath);\n        if (asset.latestThumbnailStoragePath) storagePaths.add(asset.latestThumbnailStoragePath);\n      });",
  'if (photo.thumbnailStoragePath) storagePaths.add',
);

console.log('Inventory thumbnail optimization applied.');
