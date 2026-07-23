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
    '  latestThumbnailSourcePhotoPath?: string;',
    '  notes?: string;',
  ),
  lines(
    '  latestThumbnailSourcePhotoPath?: string;',
    '  latestThumbnailSizeBytes?: number;',
    '  latestThumbnailWidth?: number;',
    '  latestThumbnailHeight?: number;',
    '  notes?: string;',
  ),
  'latestThumbnailHeight?: number;',
);

replaceOrConfirm(
  'src/inventory/v2Types.ts',
  lines(
    '  thumbnailContentType?: string;',
    '  thumbnailSizeBytes?: number;',
    '  capturedAt: string;',
  ),
  lines(
    '  thumbnailContentType?: string;',
    '  thumbnailSizeBytes?: number;',
    '  thumbnailWidth?: number;',
    '  thumbnailHeight?: number;',
    '  capturedAt: string;',
  ),
  'thumbnailHeight?: number;',
);

const screen = 'src/screens/InventoryScreenV4.tsx';

replaceOrConfirm(
  screen,
  lines(
    'function currentThumbnailUrl(asset: VanToolAssetV2) {',
    '  if (!asset.latestThumbnailUrl) return undefined;',
    '  if (!asset.latestPhotoStoragePath) return asset.latestThumbnailUrl;',
    '  return asset.latestThumbnailSourcePhotoPath === asset.latestPhotoStoragePath ? asset.latestThumbnailUrl : undefined;',
    '}',
  ),
  lines(
    'function currentThumbnailUrl(asset: VanToolAssetV2) {',
    '  if (!asset.latestThumbnailUrl) return undefined;',
    '  if (Number(asset.latestThumbnailSizeBytes ?? 0) > 64 * 1024) return undefined;',
    '  if (Number(asset.latestThumbnailWidth ?? 0) > 144 || Number(asset.latestThumbnailHeight ?? 0) > 144) return undefined;',
    '  if (!asset.latestPhotoStoragePath) return asset.latestThumbnailUrl;',
    '  return asset.latestThumbnailSourcePhotoPath === asset.latestPhotoStoragePath ? asset.latestThumbnailUrl : undefined;',
    '}',
  ),
  'Number(asset.latestThumbnailSizeBytes ?? 0) > 64 * 1024',
);

replaceOrConfirm(
  screen,
  lines(
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
  ),
  lines(
    'function SafeInventoryImage({ thumbnailUrl, originalUrl, style, fallbackToOriginal = true }: { thumbnailUrl?: string; originalUrl?: string; style: StyleProp<ImageStyle>; fallbackToOriginal?: boolean }) {',
    '  const [thumbnailFailed, setThumbnailFailed] = useState(false);',
    '  useEffect(() => setThumbnailFailed(false), [thumbnailUrl, originalUrl]);',
    '  const resolvedUrl = thumbnailUrl && !thumbnailFailed ? thumbnailUrl : fallbackToOriginal ? originalUrl : undefined;',
    '  if (!resolvedUrl) return <View style={style as any}><Text>📷</Text></View>;',
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
  ),
  'fallbackToOriginal = true',
);

replaceOrConfirm(
  screen,
  lines(
    '        latestThumbnailUrl: thumbnail?.thumbnailDownloadUrl,',
    '        latestThumbnailStoragePath: thumbnail?.thumbnailStoragePath,',
    '        latestThumbnailSourcePhotoPath: thumbnail ? stored.storagePath : undefined,',
  ),
  lines(
    '        latestThumbnailUrl: thumbnail?.thumbnailDownloadUrl,',
    '        latestThumbnailStoragePath: thumbnail?.thumbnailStoragePath,',
    '        latestThumbnailSourcePhotoPath: thumbnail ? stored.storagePath : undefined,',
    '        latestThumbnailSizeBytes: thumbnail?.thumbnailSizeBytes,',
    '        latestThumbnailWidth: thumbnail?.thumbnailWidth,',
    '        latestThumbnailHeight: thumbnail?.thumbnailHeight,',
  ),
  'latestThumbnailHeight: thumbnail?.thumbnailHeight',
);

replaceOrConfirm(
  screen,
  lines(
    '          latestThumbnailUrl: thumbnail.thumbnailDownloadUrl,',
    '          latestThumbnailStoragePath: thumbnail.thumbnailStoragePath,',
    '          latestThumbnailSourcePhotoPath: asset.latestPhotoStoragePath,',
  ),
  lines(
    '          latestThumbnailUrl: thumbnail.thumbnailDownloadUrl,',
    '          latestThumbnailStoragePath: thumbnail.thumbnailStoragePath,',
    '          latestThumbnailSourcePhotoPath: asset.latestPhotoStoragePath,',
    '          latestThumbnailSizeBytes: thumbnail.thumbnailSizeBytes,',
    '          latestThumbnailWidth: thumbnail.thumbnailWidth,',
    '          latestThumbnailHeight: thumbnail.thumbnailHeight,',
  ),
  'latestThumbnailHeight: thumbnail.thumbnailHeight',
);

replaceOrConfirm(
  screen,
  '          <SafeInventoryImage thumbnailUrl={thumbnailUrl} originalUrl={asset.latestPhotoUrl} style={styles.compactImage} />',
  '          <SafeInventoryImage thumbnailUrl={thumbnailUrl} originalUrl={asset.latestPhotoUrl} fallbackToOriginal={false} style={styles.compactImage} />',
  'fallbackToOriginal={false} style={styles.compactImage}',
);

replaceOrConfirm(
  screen,
  lines(
    '  useEffect(() => {',
    '    if (!addCatalog) return;',
    "    setAddPhotos((previous) => makePhotoSlots(additionQuantity, addCatalog.trackingMode ?? 'individual', previous));",
    '  }, [additionQuantity, addCatalog]);',
    '',
    '  function resetNewToolForm() {',
  ),
  lines(
    '  useEffect(() => {',
    '    if (!addCatalog) return;',
    "    setAddPhotos((previous) => makePhotoSlots(additionQuantity, addCatalog.trackingMode ?? 'individual', previous));",
    '  }, [additionQuantity, addCatalog]);',
    '',
    '  useEffect(() => {',
    "    if (view !== 'van-profile' || !selectedVanId || currentUser?.role !== 'admin' || thumbnailBusy || !assetsMissingThumbnails.length) return;",
    '    const timer = setTimeout(() => { void optimizeExistingThumbnails(); }, 500);',
    '    return () => clearTimeout(timer);',
    '  }, [view, selectedVanId]);',
    '',
    '  function resetNewToolForm() {',
  ),
  'const timer = setTimeout(() => { void optimizeExistingThumbnails(); }, 500);',
);

console.log('Inventory thumbnail hardening applied.');
