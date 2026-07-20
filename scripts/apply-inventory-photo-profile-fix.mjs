import fs from 'node:fs';

const target = 'src/screens/InventoryScreenV4.tsx';
let source = fs.readFileSync(target, 'utf8');

function replaceOrThrow(before, after, label) {
  if (!source.includes(before)) throw new Error(`No se encontró el bloque: ${label}`);
  source = source.replace(before, after);
}

replaceOrThrow(
  "  const [selectedAssetId, setSelectedAssetId] = useState('');\n",
  "  const [selectedAssetId, setSelectedAssetId] = useState('');\n  const [lightboxUrl, setLightboxUrl] = useState('');\n",
  'estado de lightbox',
);

replaceOrThrow(
  "                      <CompactAssetRow key={asset.id} asset={asset} catalog={catalog} onPress={() => setSelectedAssetId(asset.id)} />",
  "                      <CompactAssetRow\n                        key={asset.id}\n                        asset={asset}\n                        catalog={catalog}\n                        onOpenProfile={() => setSelectedAssetId(asset.id)}\n                        onOpenPhoto={() => setLightboxUrl(asset.latestPhotoUrl ?? '')}\n                      />",
  'fila compacta',
);

replaceOrThrow(
`              onSave={async (updated) => {
                const result = await module.saveVanAsset(updated);
                setMessage(result.ok ? 'Herramienta actualizada.' : result.message ?? 'No se pudo actualizar.');
              }}
              onPhoto={() => void captureAssetPhoto(selectedAsset)}
              onTransfer={() => { setSelectedAssetId(''); setTransferAsset(selectedAsset); }}
              onLifecycle={() => openLifecycle(selectedAsset)}`,
`              onSave={async (updated, updatedCost) => {
                const assetResult = await module.saveVanAsset({ ...updated, purchaseCost: updatedCost });
                if (!assetResult.ok) {
                  setMessage(assetResult.message ?? 'No se pudo actualizar la herramienta.');
                  return;
                }
                const catalogResult = await module.saveCatalog({ ...selectedAssetCatalog, standardCost: updatedCost });
                setMessage(catalogResult.ok ? 'Herramienta y costo actualizados.' : catalogResult.message ?? 'La herramienta se actualizó, pero no el costo estándar.');
              }}
              onPhoto={() => void captureAssetPhoto(selectedAsset)}
              onOpenPhoto={(url) => setLightboxUrl(url || selectedAsset.latestPhotoUrl || '')}
              onTransfer={() => { setSelectedAssetId(''); setTransferAsset(selectedAsset); }}
              onLifecycle={() => openLifecycle(selectedAsset)}`,
  'guardado de perfil',
);

replaceOrThrow(
`      <AppModal
        visible={Boolean(addCatalog)}`,
`      <AppModal visible={Boolean(lightboxUrl)} title="Fotografía de la herramienta" onClose={() => setLightboxUrl('')}>
        {lightboxUrl ? (
          <View style={styles.photoViewerContent}>
            <Image source={{ uri: lightboxUrl }} resizeMode="contain" style={styles.photoViewerImage} />
            <Button variant="secondary" label="Cerrar fotografía" onPress={() => setLightboxUrl('')} />
          </View>
        ) : null}
      </AppModal>

      <AppModal
        visible={Boolean(addCatalog)}`,
  'modal de foto grande',
);

const oldFunctions = `function AssetSummary({ asset, catalog }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2 }) {
  return <View style={styles.assetTop}>{asset.latestPhotoUrl ? <Image source={{ uri: asset.latestPhotoUrl }} style={styles.assetImage} /> : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>}<View style={styles.flexOne}><Text style={styles.assetCode}>{asset.assetCode}</Text><Text style={styles.cardTitle}>{catalog?.name ?? asset.toolCatalogId}</Text><Text style={styles.cardText}>{catalog?.category ?? 'Herramienta'} · {formatMoney(asset.purchaseCost)}</Text></View><Pill label={asset.operationalStatus ?? 'Disponible'} tone={statusTone(asset.operationalStatus)} /></View>;
}

function CompactAssetRow({ asset, catalog, onPress }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; onPress: () => void }) {
  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';
  const quantityText = quantityMode
    ? \`${'${Number(asset.quantityPresent ?? 0)} presentes de ${Number(asset.quantityExpected ?? 0)}'}\`
    : '1 unidad física';
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.compactAssetRow, pressed && styles.compactAssetRowPressed]}>
      {asset.latestPhotoUrl ? <Image source={{ uri: asset.latestPhotoUrl }} style={styles.compactImage} /> : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}
      <View style={styles.compactAssetText}>
        <Text style={styles.assetCode}>{asset.assetCode}</Text>
        <Text style={styles.cardTitle}>{catalog.name}</Text>
        <Text style={styles.cardText}>{quantityText} · {formatMoney(asset.purchaseCost)} por unidad</Text>
      </View>
      <View style={styles.compactAssetRight}>
        <Pill label={asset.operationalStatus ?? 'Disponible'} tone={statusTone(asset.operationalStatus)} />
        <Text style={styles.openProfileText}>Abrir perfil ›</Text>
      </View>
    </Pressable>
  );
}

function AssetProfileEditor({ asset, catalog, evidence, busy, onSave, onPhoto, onTransfer, onLifecycle }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; evidence: InventoryEvidenceV2[]; busy: boolean; onSave: (asset: VanToolAssetV2) => Promise<void>; onPhoto: () => void; onTransfer: () => void; onLifecycle: () => void }) {
  const [condition, setCondition] = useState<ToolConditionV2>(asset.condition);
  const [status, setStatus] = useState<ToolOperationalStatus>(asset.operationalStatus ?? 'Disponible');
  const [notes, setNotes] = useState(asset.notes ?? '');
  const [expected, setExpected] = useState(String(asset.quantityExpected ?? 1));
  const [present, setPresent] = useState(String(asset.quantityPresent ?? asset.quantityExpected ?? 1));
  useEffect(() => {
    setCondition(asset.condition);
    setStatus(asset.operationalStatus ?? 'Disponible');
    setNotes(asset.notes ?? '');
    setExpected(String(asset.quantityExpected ?? 1));
    setPresent(String(asset.quantityPresent ?? asset.quantityExpected ?? 1));
  }, [asset]);
  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';
  const historicalEvidence = evidence.filter((photo) => photo.storagePath !== asset.latestPhotoStoragePath);
  return (
    <View style={styles.profileEditor}>
      <AssetSummary asset={asset} catalog={catalog} />
      <View style={styles.profileFacts}>
        <ProfileFact label="Tipo de control" value={quantityMode ? 'Por cantidad' : 'Individual'} />
        <ProfileFact label="Costo por unidad" value={formatMoney(asset.purchaseCost)} />
        <ProfileFact label="Última foto" value={asset.latestPhotoAt ? new Date(asset.latestPhotoAt).toLocaleString('es-AW') : 'Sin fecha'} />
      </View>
      {quantityMode ? <View style={styles.formGrid}><Input style={styles.field} keyboardType="numeric" label="Cantidad asignada" value={expected} onChangeText={setExpected} /><Input style={styles.field} keyboardType="numeric" label="Cantidad presente" value={present} onChangeText={setPresent} /></View> : null}
      <Text style={styles.smallLabel}>CONDICIÓN</Text>
      <View style={styles.optionRow}>{CONDITIONS.map((candidate) => <Button key={candidate} compact variant={condition === candidate ? 'primary' : 'secondary'} label={candidate} onPress={() => setCondition(candidate)} />)}</View>
      {!['Faltante', 'En reparación'].includes(asset.operationalStatus ?? '') ? <><Text style={styles.smallLabel}>ESTADO OPERATIVO</Text><View style={styles.optionRow}>{EDITABLE_STATUSES.map((candidate) => <Button key={candidate} compact variant={status === candidate ? 'primary' : 'secondary'} label={candidate} onPress={() => setStatus(candidate)} />)}</View></> : null}
      <Input multiline label="Observación, daño o anomalía" value={notes} onChangeText={setNotes} />
      <View style={styles.optionRow}>
        <Button compact variant="success" label={busy ? 'Guardando…' : 'Guardar cambios'} disabled={busy} onPress={() => void onSave({ ...asset, condition, operationalStatus: status, notes: notes.trim(), quantityExpected: quantityMode ? Math.max(0, Number(expected || 0)) : 1, quantityPresent: quantityMode ? Math.max(0, Number(present || 0)) : asset.present === false ? 0 : 1 })} />
        <Button compact variant="secondary" label="Nueva foto" disabled={busy} onPress={onPhoto} />
        {!quantityMode ? <Button compact variant="secondary" label="Transferir" disabled={busy} onPress={onTransfer} /> : null}
        <Button compact variant="danger" label="Retirar / reparar" disabled={busy} onPress={onLifecycle} />
      </View>
      {historicalEvidence.length ? (
        <View style={styles.historySection}>
          <Text style={styles.smallLabel}>HISTORIAL DE FOTOGRAFÍAS</Text>
          <ScrollView horizontal contentContainerStyle={styles.historyStrip}>
            {historicalEvidence.map((photo) => <View key={photo.id}><Image source={{ uri: photo.downloadUrl }} style={styles.historyImage} /><Text style={styles.historyDate}>{new Date(photo.capturedAt).toLocaleDateString('es-AW')}</Text></View>)}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}`;

const newFunctions = `function AssetSummary({ asset, catalog, onPhotoPress }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2; onPhotoPress?: () => void }) {
  const image = asset.latestPhotoUrl ? <Image source={{ uri: asset.latestPhotoUrl }} style={styles.assetImage} /> : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>;
  return (
    <View style={styles.assetTop}>
      {asset.latestPhotoUrl && onPhotoPress ? <Pressable accessibilityRole="button" accessibilityLabel="Ver fotografía grande" onPress={onPhotoPress} style={styles.assetPhotoButton}>{image}</Pressable> : image}
      <View style={styles.flexOne}>
        <Text style={styles.assetCode}>{asset.assetCode}</Text>
        <Text style={styles.cardTitle}>{catalog?.name ?? asset.toolCatalogId}</Text>
        <Text style={styles.cardText}>{catalog?.category ?? 'Herramienta'} · {formatMoney(asset.purchaseCost)}</Text>
      </View>
      <Pill label={asset.operationalStatus ?? 'Disponible'} tone={statusTone(asset.operationalStatus)} />
    </View>
  );
}

function CompactAssetRow({ asset, catalog, onOpenProfile, onOpenPhoto }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; onOpenProfile: () => void; onOpenPhoto: () => void }) {
  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';
  const quantityText = quantityMode
    ? \`${'${Number(asset.quantityPresent ?? 0)} presentes de ${Number(asset.quantityExpected ?? 0)}'}\`
    : '1 unidad física';
  return (
    <View style={styles.compactAssetRow}>
      {asset.latestPhotoUrl ? (
        <Pressable accessibilityRole="button" accessibilityLabel={\`Ver fotografía grande de ${'${catalog.name}'}\`} onPress={onOpenPhoto} style={({ pressed }) => [styles.compactPhotoButton, pressed && styles.compactAssetRowPressed]}>
          <Image source={{ uri: asset.latestPhotoUrl }} style={styles.compactImage} />
        </Pressable>
      ) : <View style={styles.compactImagePlaceholder}><Text>📷</Text></View>}
      <Pressable accessibilityRole="button" accessibilityLabel={\`Abrir perfil de ${'${catalog.name}'}\`} onPress={onOpenProfile} style={({ pressed }) => [styles.compactAssetText, pressed && styles.compactTextPressed]}>
        <Text style={styles.assetCode}>{asset.assetCode}</Text>
        <Text style={styles.compactToolName}>{catalog.name}</Text>
        <Text style={styles.cardText}>{quantityText} · {formatMoney(asset.purchaseCost)} por unidad</Text>
      </Pressable>
      <View style={styles.compactAssetRight}>
        <View style={styles.compactStatus}><Pill label={asset.operationalStatus ?? 'Disponible'} tone={statusTone(asset.operationalStatus)} /></View>
        <Button compact variant="secondary" label="Abrir perfil" onPress={onOpenProfile} />
      </View>
    </View>
  );
}

function AssetProfileEditor({ asset, catalog, evidence, busy, onSave, onPhoto, onOpenPhoto, onTransfer, onLifecycle }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; evidence: InventoryEvidenceV2[]; busy: boolean; onSave: (asset: VanToolAssetV2, cost: number) => Promise<void>; onPhoto: () => void; onOpenPhoto: (url?: string) => void; onTransfer: () => void; onLifecycle: () => void }) {
  const [condition, setCondition] = useState<ToolConditionV2>(asset.condition);
  const [status, setStatus] = useState<ToolOperationalStatus>(asset.operationalStatus ?? 'Disponible');
  const [notes, setNotes] = useState(asset.notes ?? '');
  const [cost, setCost] = useState(String(asset.purchaseCost ?? catalog.standardCost ?? 0));
  const [expected, setExpected] = useState(String(asset.quantityExpected ?? 1));
  const [present, setPresent] = useState(String(asset.quantityPresent ?? asset.quantityExpected ?? 1));
  useEffect(() => {
    setCondition(asset.condition);
    setStatus(asset.operationalStatus ?? 'Disponible');
    setNotes(asset.notes ?? '');
    setCost(String(asset.purchaseCost ?? catalog.standardCost ?? 0));
    setExpected(String(asset.quantityExpected ?? 1));
    setPresent(String(asset.quantityPresent ?? asset.quantityExpected ?? 1));
  }, [asset, catalog.standardCost]);
  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';
  const historicalEvidence = evidence.filter((photo) => photo.storagePath !== asset.latestPhotoStoragePath);
  return (
    <View style={styles.profileEditor}>
      <AssetSummary asset={asset} catalog={catalog} onPhotoPress={() => onOpenPhoto(asset.latestPhotoUrl)} />
      <View style={styles.profileFacts}>
        <ProfileFact label="Tipo de control" value={quantityMode ? 'Por cantidad' : 'Individual'} />
        <ProfileFact label="Código interno" value={asset.assetCode} />
        <ProfileFact label="Última foto" value={asset.latestPhotoAt ? new Date(asset.latestPhotoAt).toLocaleString('es-AW') : 'Sin fecha'} />
      </View>
      <View style={styles.formGrid}>
        <Input style={styles.field} keyboardType="numeric" label="Costo por unidad Afl." value={cost} onChangeText={setCost} />
        {quantityMode ? <><Input style={styles.field} keyboardType="numeric" label="Cantidad asignada" value={expected} onChangeText={setExpected} /><Input style={styles.field} keyboardType="numeric" label="Cantidad presente" value={present} onChangeText={setPresent} /></> : null}
      </View>
      <Text style={styles.smallLabel}>CONDICIÓN</Text>
      <View style={styles.optionRow}>{CONDITIONS.map((candidate) => <Button key={candidate} compact variant={condition === candidate ? 'primary' : 'secondary'} label={candidate} onPress={() => setCondition(candidate)} />)}</View>
      {!['Faltante', 'En reparación'].includes(asset.operationalStatus ?? '') ? <><Text style={styles.smallLabel}>ESTADO OPERATIVO</Text><View style={styles.optionRow}>{EDITABLE_STATUSES.map((candidate) => <Button key={candidate} compact variant={status === candidate ? 'primary' : 'secondary'} label={candidate} onPress={() => setStatus(candidate)} />)}</View></> : null}
      <Input multiline label="Observación, daño o anomalía" value={notes} onChangeText={setNotes} />
      <View style={styles.optionRow}>
        <Button compact variant="success" label={busy ? 'Guardando…' : 'Guardar cambios'} disabled={busy} onPress={() => void onSave({ ...asset, condition, operationalStatus: status, notes: notes.trim(), quantityExpected: quantityMode ? Math.max(0, Number(expected || 0)) : 1, quantityPresent: quantityMode ? Math.max(0, Number(present || 0)) : asset.present === false ? 0 : 1 }, Math.max(0, Number(cost || 0)))} />
        <Button compact variant="secondary" label="Nueva foto" disabled={busy} onPress={onPhoto} />
        {!quantityMode ? <Button compact variant="secondary" label="Transferir" disabled={busy} onPress={onTransfer} /> : null}
        <Button compact variant="danger" label="Retirar / reparar" disabled={busy} onPress={onLifecycle} />
      </View>
      {historicalEvidence.length ? (
        <View style={styles.historySection}>
          <Text style={styles.smallLabel}>HISTORIAL DE FOTOGRAFÍAS</Text>
          <ScrollView horizontal contentContainerStyle={styles.historyStrip}>
            {historicalEvidence.map((photo) => <Pressable key={photo.id} accessibilityRole="button" onPress={() => onOpenPhoto(photo.downloadUrl)}><Image source={{ uri: photo.downloadUrl }} style={styles.historyImage} /><Text style={styles.historyDate}>{new Date(photo.capturedAt).toLocaleDateString('es-AW')}</Text></Pressable>)}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}`;

replaceOrThrow(oldFunctions, newFunctions, 'componentes de herramienta');

replaceOrThrow(
`  compactAssetRow: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 10, backgroundColor: '#FFFFFF' },
  compactAssetRowPressed: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  compactImage: { width: 70, height: 58, borderRadius: 8 },
  compactImagePlaceholder: { width: 70, height: 58, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2F6' },
  compactAssetText: { flex: 1, minWidth: 170 },
  compactAssetRight: { alignItems: 'flex-end', gap: 6 },
  openProfileText: { color: colors.primary, fontWeight: '900', fontSize: 10 },
  assetCard:`,
`  compactAssetRow: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 10, backgroundColor: '#FFFFFF' },
  compactAssetRowPressed: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  compactPhotoButton: { borderRadius: 8 },
  compactImage: { width: 70, height: 58, borderRadius: 8 },
  compactImagePlaceholder: { width: 70, height: 58, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2F6' },
  compactAssetText: { flex: 1, minWidth: 170, borderRadius: 7, paddingVertical: 3, paddingHorizontal: 2 },
  compactTextPressed: { backgroundColor: colors.primaryLight },
  compactToolName: { color: colors.text, fontWeight: '900', fontSize: 14 },
  compactAssetRight: { width: 126, alignItems: 'stretch', justifyContent: 'center', gap: 7 },
  compactStatus: { alignItems: 'center', justifyContent: 'center', minHeight: 24 },
  assetCard:`,
  'estilos de alineación',
);

replaceOrThrow(
`  assetImage: { width: 82, height: 68, borderRadius: 8 },
  assetImagePlaceholder:`,
`  assetPhotoButton: { borderRadius: 8 },
  assetImage: { width: 82, height: 68, borderRadius: 8 },
  assetImagePlaceholder:`,
  'estilo de foto del perfil',
);

replaceOrThrow(
`  lifecyclePhoto: { width: '100%', height: 220, borderRadius: 10 },`,
`  lifecyclePhoto: { width: '100%', height: 220, borderRadius: 10 },
  photoViewerContent: { gap: 12, alignItems: 'stretch' },
  photoViewerImage: { width: '100%', height: 520, borderRadius: 10, backgroundColor: '#0B1220' },`,
  'estilos del visor',
);

fs.writeFileSync(target, source);
fs.rmSync('scripts/apply-inventory-photo-profile-fix.mjs');
fs.rmSync('.github/workflows/apply-inventory-photo-profile-fix.yml');
console.log('InventoryScreenV4.tsx actualizado correctamente.');
