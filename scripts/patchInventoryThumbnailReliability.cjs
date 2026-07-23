const fs = require('fs');

const lines = (...values) => values.join('\n');

function replaceOrConfirm(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Missing block in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

const storage = 'src/services/inventoryThumbnailStorage.ts';

replaceOrConfirm(
  storage,
  lines(
    'async function fetchSourceBlob(input: ThumbnailInput, idToken: string) {',
    '  if (input.sourceStoragePath) {',
    '    const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket!)}/o/${encodeURIComponent(input.sourceStoragePath)}?alt=media`;',
    '    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${idToken}` } });',
    '    if (!response.ok) {',
    '      const text = await response.text();',
    "      throw new Error(`${responseMessage(text) ?? 'No se pudo leer la fotografía original.'} (Storage ${response.status})`);",
    '    }',
    '    return response.blob();',
    '  }',
    '',
    "  if (!input.uri) throw new Error('No se encontró la fotografía original para crear la miniatura.');",
    '  const response = await fetch(input.uri);',
    "  if (!response.ok) throw new Error('No se pudo leer la fotografía original para crear la miniatura.');",
    '  return response.blob();',
    '}',
  ),
  lines(
    'async function fetchSourceBlob(input: ThumbnailInput, idToken: string) {',
    "  let storageReadError = '';",
    '  if (input.sourceStoragePath) {',
    '    try {',
    '      const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket!)}/o/${encodeURIComponent(input.sourceStoragePath)}?alt=media`;',
    '      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${idToken}` } });',
    '      if (response.ok) return response.blob();',
    '      const text = await response.text();',
    "      storageReadError = `${responseMessage(text) ?? 'No se pudo leer la fotografía original desde Storage.'} (Storage ${response.status})`;",
    '    } catch (cause) {',
    "      storageReadError = cause instanceof Error ? cause.message : String(cause);",
    '    }',
    '  }',
    '',
    '  if (input.uri) {',
    '    try {',
    "      const response = await fetch(input.uri, { cache: 'no-store' });",
    '      if (response.ok) return response.blob();',
    "      storageReadError = `${storageReadError ? `${storageReadError}; ` : ''}la URL original respondió ${response.status}`;",
    '    } catch (cause) {',
    "      const uriError = cause instanceof Error ? cause.message : String(cause);",
    "      storageReadError = `${storageReadError ? `${storageReadError}; ` : ''}${uriError}`;",
    '    }',
    '  }',
    '',
    "  throw new Error(storageReadError || 'No se encontró una fuente legible para crear la miniatura.');",
    '}',
  ),
  "let storageReadError = '';",
);

replaceOrConfirm(
  storage,
  lines(
    '  const thumbnailDownloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(thumbnailStoragePath)}?alt=media&token=${encodeURIComponent(token)}`;',
    '  return {',
  ),
  lines(
    '  const thumbnailDownloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(thumbnailStoragePath)}?alt=media&token=${encodeURIComponent(token)}`;',
    "  const verification = await fetch(thumbnailDownloadUrl, { cache: 'no-store' });",
    '  if (!verification.ok) {',
    "    throw new Error(`La miniatura subió, pero no se pudo verificar su descarga (Storage ${verification.status}).`);",
    '  }',
    '  const verifiedBlob = await verification.blob();',
    '  if (verifiedBlob.size <= 0 || verifiedBlob.size > MAX_THUMBNAIL_BYTES) {',
    "    throw new Error('La miniatura descargada no tiene un tamaño válido.');",
    '  }',
    '  return {',
  ),
  'const verifiedBlob = await verification.blob();',
);

const screen = 'src/screens/InventoryScreenV4.tsx';

replaceOrConfirm(
  screen,
  lines(
    '  useEffect(() => {',
    "    if (view !== 'van-profile' || !selectedVanId || currentUser?.role !== 'admin' || thumbnailBusy || !assetsMissingThumbnails.length) return;",
    '    const timer = setTimeout(() => { void optimizeExistingThumbnails(); }, 500);',
    '    return () => clearTimeout(timer);',
    '  }, [view, selectedVanId, currentUser?.role, assetsMissingThumbnails.length]);',
    '',
  ),
  lines(
    '  // La migración de miniaturas es manual para evitar ciclos silenciosos cuando una operación falla.',
    '',
  ),
  'La migración de miniaturas es manual',
);

replaceOrConfirm(
  screen,
  lines(
    '    let completed = 0;',
    '    let failed = 0;',
  ),
  lines(
    '    let completed = 0;',
    '    let failed = 0;',
    "    let firstError = '';",
    "    let failedAssetCode = '';",
  ),
  "let firstError = '';",
);

replaceOrConfirm(
  screen,
  lines(
    '        const matchingEvidence = module.evidence',
    '          .filter((evidence) => evidence.entityId === asset.id)',
    '          .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))',
    '          .find((evidence) => !asset.latestPhotoStoragePath || evidence.storagePath === asset.latestPhotoStoragePath);',
    '        if (matchingEvidence) {',
    '          const evidenceResult = await module.saveInventoryEvidence({ ...matchingEvidence, ...thumbnail });',
    "          if (!evidenceResult.ok) throw new Error(evidenceResult.message ?? 'No se pudo actualizar el historial fotográfico.');",
    '        }',
  ),
  lines(
    '        // El listado depende del activo. El historial antiguo no se modifica durante esta migración.',
  ),
  'El historial antiguo no se modifica durante esta migración.',
);

replaceOrConfirm(
  screen,
  lines(
    '        completed += 1;',
    '      } catch {',
    '        failed += 1;',
    '      }',
  ),
  lines(
    '        completed += 1;',
    '      } catch (cause) {',
    '        failed += 1;',
    "        failedAssetCode = asset.assetCode;",
    "        firstError = cause instanceof Error ? cause.message : String(cause);",
    '        break;',
    '      }',
  ),
  'failedAssetCode = asset.assetCode;',
);

replaceOrConfirm(
  screen,
  lines(
    '    setMessage(failed',
    '      ? `${completed} miniatura(s) optimizadas y ${failed} pendiente(s). Las fotos originales permanecen disponibles.`',
    '      : `${completed} miniatura(s) optimizadas correctamente. Las fotos originales permanecen intactas.`);',
  ),
  lines(
    '    setMessage(failed',
    '      ? `Se optimizaron ${completed} miniatura(s). El proceso se detuvo en ${failedAssetCode || "una herramienta"}: ${firstError || "error desconocido"}. La foto original permanece intacta.`',
    '      : `${completed} miniatura(s) optimizadas correctamente. Las fotos originales permanecen intactas.`);',
  ),
  'El proceso se detuvo en ${failedAssetCode',
);

console.log('Inventory thumbnail reliability patch applied.');
