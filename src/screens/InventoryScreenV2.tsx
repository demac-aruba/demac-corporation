import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, EmptyState, formatMoney, Input, Pill, SectionTitle } from '../components/UI';
import {
  assetInventoryValue,
  assetIsInVan,
  assetIsInWarehouse,
  useInventoryModuleV2,
} from '../hooks/useInventoryModuleV2';
import {
  InventoryCheckEntryV2,
  InventoryEvidenceV2,
  ToolCatalogItemV2,
  ToolConditionV2,
  ToolOperationalStatus,
  ToolTrackingMode,
  VanToolAssetV2,
  WarehouseInventoryItemV2,
} from '../inventory/v2Types';
import { uploadInventoryImage } from '../services/inventoryStorage';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { Van } from '../types';

const CONDITIONS: ToolConditionV2[] = ['Nueva', 'Poco uso', 'Uso medio', 'Muy usada', 'Requiere reemplazo'];
const OPERATIONAL_STATUSES: ToolOperationalStatus[] = ['Disponible', 'Prestada', 'En reparación', 'En depósito', 'Faltante', 'Retirada', 'Desechada'];

type PendingPhoto = { uri: string; mimeType?: string | null; fileName?: string | null };
type InventoryView =
  | 'menu'
  | 'warehouse'
  | 'van-select'
  | 'van-profile'
  | 'checks-menu'
  | 'check-van-select'
  | 'check-van-ready'
  | 'warehouse-check-ready'
  | 'check-active'
  | 'check-history';

type WarehouseDraft = {
  name: string;
  category: string;
  unit: string;
  quantity: string;
  minimum: string;
  cost: string;
  location: string;
};

const emptyWarehouseDraft: WarehouseDraft = {
  name: '', category: 'Consumibles', unit: 'unidad', quantity: '0', minimum: '0', cost: '0', location: 'Depósito principal',
};

function makePhotoSlots(quantity: number, mode: ToolTrackingMode, previous: Array<PendingPhoto | null> = []) {
  const length = mode === 'individual' ? Math.max(1, quantity) : 1;
  return Array.from({ length }, (_, index) => previous[index] ?? null);
}

export function InventoryScreen() {
  const { currentUser, inventory: fallbackInventory, vans: fallbackVans } = useAppState();
  const module = useInventoryModuleV2(currentUser, fallbackInventory, fallbackVans);
  const [view, setView] = useState<InventoryView>('menu');
  const [selectedVanId, setSelectedVanId] = useState('');
  const [message, setMessage] = useState('');
  const [warehouseDraft, setWarehouseDraft] = useState<WarehouseDraft>(emptyWarehouseDraft);
  const [activeCheckId, setActiveCheckId] = useState('');
  const [photoBusyId, setPhotoBusyId] = useState('');

  const [toolName, setToolName] = useState('');
  const [toolCategory, setToolCategory] = useState('Power tools');
  const [toolCost, setToolCost] = useState('0');
  const [toolCondition, setToolCondition] = useState<ToolConditionV2>('Nueva');
  const [trackingMode, setTrackingMode] = useState<ToolTrackingMode>('individual');
  const [toolQuantity, setToolQuantity] = useState('1');
  const [recommendedQuantity, setRecommendedQuantity] = useState('1');
  const [toolPhotos, setToolPhotos] = useState<Array<PendingPhoto | null>>([null]);

  const [addCatalog, setAddCatalog] = useState<ToolCatalogItemV2 | null>(null);
  const [addQuantity, setAddQuantity] = useState('1');
  const [addCondition, setAddCondition] = useState<ToolConditionV2>('Nueva');
  const [addPhotos, setAddPhotos] = useState<Array<PendingPhoto | null>>([null]);
  const [transferAsset, setTransferAsset] = useState<VanToolAssetV2 | null>(null);

  const selectedVan = module.vans.find((van) => van.id === selectedVanId);
  const selectedAssets = module.vanAssets.filter((asset) => assetIsInVan(asset, selectedVanId));
  const physicalToolCount = selectedAssets.reduce((sum, asset) => sum + ((asset.trackingMode ?? 'individual') === 'quantity' ? Number(asset.quantityExpected ?? 0) : 1), 0);
  const vanValue = selectedAssets.reduce((sum, asset) => sum + assetInventoryValue(asset), 0);
  const replacementCount = selectedAssets.reduce((sum, asset) => sum + (asset.condition === 'Requiere reemplazo' ? ((asset.trackingMode ?? 'individual') === 'quantity' ? Number(asset.quantityExpected ?? 0) : 1) : 0), 0);
  const warehousePowerTools = module.vanAssets.filter(assetIsInWarehouse);
  const activeCheck = module.checks.find((check) => check.id === activeCheckId)
    ?? module.checks.find((check) => check.status === 'draft');
  const activeEntries = activeCheck ? module.entries.filter((entry) => entry.checkId === activeCheck.id) : [];
  const completedChecks = module.checks.filter((check) => check.status === 'completed');
  const totalWarehouseValue = module.warehouseItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.cost), 0);
  const lowStock = module.warehouseItems.filter((item) => item.active !== false && Number(item.quantity) <= Number(item.minimum));

  const registrationQuantity = Math.max(1, Math.min(20, Math.round(Number(toolQuantity || 1))));
  const additionQuantity = Math.max(1, Math.min(20, Math.round(Number(addQuantity || 1))));

  useEffect(() => {
    setToolPhotos((previous) => makePhotoSlots(registrationQuantity, trackingMode, previous));
  }, [registrationQuantity, trackingMode]);

  useEffect(() => {
    if (!addCatalog) return;
    setAddPhotos((previous) => makePhotoSlots(additionQuantity, addCatalog.trackingMode ?? 'individual', previous));
  }, [additionQuantity, addCatalog]);

  async function pickPhoto(camera = true): Promise<PendingPhoto | null> {
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage('Debes autorizar la cámara o galería para registrar evidencia.');
      return null;
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.72 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.72 });
    if (result.canceled || !result.assets[0]) return null;
    const asset = result.assets[0];
    return { uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName };
  }

  async function replacePhoto(slots: Array<PendingPhoto | null>, setSlots: React.Dispatch<React.SetStateAction<Array<PendingPhoto | null>>>, index: number, camera: boolean) {
    const photo = await pickPhoto(camera);
    if (!photo) return;
    setSlots(slots.map((candidate, candidateIndex) => candidateIndex === index ? photo : candidate));
  }

  function openView(nextView: InventoryView) {
    setMessage('');
    setView(nextView);
  }

  function openVanSelection(target: 'tools' | 'check') {
    setSelectedVanId('');
    openView(target === 'tools' ? 'van-select' : 'check-van-select');
  }

  function selectVan(vanId: string, target: 'tools' | 'check') {
    setSelectedVanId(vanId);
    setMessage('');
    setView(target === 'tools' ? 'van-profile' : 'check-van-ready');
  }

  function goBack() {
    setMessage('');
    if (view === 'warehouse' || view === 'van-select' || view === 'checks-menu') {
      setSelectedVanId('');
      setView('menu');
      return;
    }
    if (view === 'van-profile') {
      setSelectedVanId('');
      setView('van-select');
      return;
    }
    if (view === 'check-van-select' || view === 'warehouse-check-ready' || view === 'check-history' || view === 'check-active') {
      setSelectedVanId('');
      setView('checks-menu');
      return;
    }
    if (view === 'check-van-ready') {
      setSelectedVanId('');
      setView('check-van-select');
    }
  }

  async function registerWarehouseItem() {
    if (!warehouseDraft.name.trim()) {
      setMessage('Escribe el nombre del artículo del depósito.');
      return;
    }
    const now = new Date().toISOString();
    const item: WarehouseInventoryItemV2 = {
      id: `warehouse-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: warehouseDraft.name.trim(),
      category: warehouseDraft.category.trim() || 'General',
      unit: warehouseDraft.unit.trim() || 'unidad',
      quantity: Math.max(0, Number(warehouseDraft.quantity || 0)),
      minimum: Math.max(0, Number(warehouseDraft.minimum || 0)),
      cost: Math.max(0, Number(warehouseDraft.cost || 0)),
      location: warehouseDraft.location.trim() || 'Depósito principal',
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    const result = await module.saveWarehouseItem(item);
    setMessage(result.ok ? 'Artículo agregado al depósito.' : result.message ?? 'No se pudo guardar el artículo.');
    if (result.ok) setWarehouseDraft(emptyWarehouseDraft);
  }

  async function uploadPhotosForAssets(assets: VanToolAssetV2[], photos: Array<PendingPhoto | null>, phase: 'initial' | 'control', checkId?: string) {
    if (!currentUser) throw new Error('Debes iniciar sesión.');
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      const photo = photos[(asset.trackingMode ?? 'individual') === 'quantity' ? 0 : index];
      if (!photo) continue;
      setPhotoBusyId(asset.id);
      const evidenceId = `inventory-photo-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
      const stored = await uploadInventoryImage({ ...photo, scope: 'van-tool', entityId: asset.id, evidenceId });
      const now = new Date().toISOString();
      const evidence: InventoryEvidenceV2 = {
        id: evidenceId,
        entityType: 'van_tool',
        entityId: asset.id,
        checkId,
        phase,
        ...stored,
        capturedAt: now,
        uploadedAt: now,
        uploadedByUserId: currentUser.id,
        uploadedByName: currentUser.name,
        condition: asset.condition,
      };
      const evidenceResult = await module.saveInventoryEvidence(evidence);
      if (!evidenceResult.ok) throw new Error(evidenceResult.message);
      const saveResult = await module.saveVanAsset({
        ...asset,
        latestPhotoUrl: stored.downloadUrl,
        latestPhotoStoragePath: stored.storagePath,
        latestPhotoAt: now,
      });
      if (!saveResult.ok) throw new Error(saveResult.message);
    }
    setPhotoBusyId('');
  }

  async function registerTool() {
    if (!selectedVanId || !toolName.trim()) {
      setMessage('Selecciona una van y escribe el nombre de la herramienta.');
      return;
    }
    if (toolPhotos.some((photo) => !photo)) {
      setMessage(trackingMode === 'individual'
        ? `Debes tomar una fotografía de cada una de las ${registrationQuantity} unidades.`
        : 'Debes tomar una fotografía general del grupo.');
      return;
    }
    const created = await module.createTool({
      name: toolName,
      category: toolCategory,
      standardCost: Math.max(0, Number(toolCost || 0)),
      initialVanId: selectedVanId,
      condition: toolCondition,
      trackingMode,
      quantity: registrationQuantity,
      recommendedQuantity: Math.max(1, Number(recommendedQuantity || registrationQuantity)),
    });
    if (!created.result.ok || !created.assets.length) {
      setMessage(created.result.message ?? 'No se pudo crear la herramienta.');
      return;
    }
    try {
      await uploadPhotosForAssets(created.assets, toolPhotos, 'initial');
      setToolName('');
      setToolCost('0');
      setToolCondition('Nueva');
      setTrackingMode('individual');
      setToolQuantity('1');
      setRecommendedQuantity('1');
      setToolPhotos([null]);
      setMessage(`${created.catalog?.name ?? 'Herramienta'} registrada: ${registrationQuantity} ${registrationQuantity === 1 ? 'unidad' : 'unidades'} en ${selectedVan?.name ?? 'la van'}.`);
    } catch (cause) {
      setMessage(`Las herramientas fueron creadas, pero faltó guardar alguna fotografía: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPhotoBusyId('');
    }
  }

  function openAddUnits(catalog: ToolCatalogItemV2) {
    setAddCatalog(catalog);
    setAddQuantity('1');
    setAddCondition('Nueva');
    setAddPhotos([null]);
  }

  async function addUnits() {
    if (!addCatalog || !selectedVan) return;
    if (addPhotos.some((photo) => !photo)) {
      setMessage((addCatalog.trackingMode ?? 'individual') === 'individual'
        ? `Debes tomar una fotografía de cada una de las ${additionQuantity} unidades.`
        : 'Debes tomar una fotografía general del grupo.');
      return;
    }
    const created = await module.addUnitsToVan({
      catalogId: addCatalog.id,
      vanId: selectedVan.id,
      condition: addCondition,
      quantity: additionQuantity,
    });
    if (!created.result.ok || !created.assets.length) {
      setMessage(created.result.message ?? 'No se pudieron agregar las unidades.');
      return;
    }
    try {
      await uploadPhotosForAssets(created.assets, addPhotos, 'initial');
      setMessage(`${additionQuantity} ${additionQuantity === 1 ? 'unidad agregada' : 'unidades agregadas'} a ${selectedVan.name}.`);
      setAddCatalog(null);
    } catch (cause) {
      setMessage(`Las unidades fueron agregadas, pero faltó guardar alguna fotografía: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPhotoBusyId('');
    }
  }

  async function captureAssetPhoto(asset: VanToolAssetV2, entry?: InventoryCheckEntryV2) {
    if (!currentUser) return;
    const photo = await pickPhoto(true);
    if (!photo) return;
    try {
      await uploadPhotosForAssets([asset], [photo], entry ? 'control' : 'initial', entry?.checkId);
      const latestEvidence = module.evidence.find((candidate) => candidate.entityId === asset.id && candidate.checkId === entry?.checkId);
      if (entry) {
        const allEvidence = module.evidence.filter((candidate) => candidate.entityId === asset.id && candidate.checkId === entry.checkId);
        const evidenceId = latestEvidence?.id ?? allEvidence[0]?.id;
        const result = await module.saveCheckEntry({ ...entry, photoEvidenceId: evidenceId, status: 'present', countedQuantity: entry.countedQuantity ?? 1 });
        if (!result.ok) throw new Error(result.message);
      }
      setMessage('Fotografía agregada al historial.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPhotoBusyId('');
    }
  }

  async function startCheck(scope: 'van' | 'warehouse') {
    if (scope === 'van' && !selectedVanId) {
      setMessage('Selecciona primero la van que deseas controlar.');
      return;
    }
    const started = scope === 'van' ? await module.startVanCheck(selectedVanId) : await module.startWarehouseCheck();
    setMessage(started.result.ok ? 'Control iniciado. Completa cada artículo del checklist.' : started.result.message ?? 'No se pudo iniciar el control.');
    if (started.check) {
      setActiveCheckId(started.check.id);
      setView('check-active');
    }
  }

  async function finishCheck() {
    if (!activeCheck) return;
    const result = await module.completeCheck(activeCheck.id);
    setMessage(result.message ?? (result.ok ? 'Control completado.' : 'No se pudo completar.'));
    if (result.ok) {
      setActiveCheckId('');
      setSelectedVanId('');
      setView('checks-menu');
    }
  }

  function continueActiveCheck() {
    if (!activeCheck) return;
    setActiveCheckId(activeCheck.id);
    setSelectedVanId(activeCheck.vanId ?? '');
    setMessage('');
    setView('check-active');
  }

  async function performTransfer(destination: string) {
    if (!transferAsset) return;
    const result = await module.transferAsset(transferAsset.id, destination);
    setMessage(result.ok ? 'Herramienta transferida correctamente.' : result.message ?? 'No se pudo transferir.');
    if (result.ok) setTransferAsset(null);
  }

  if (module.loading) {
    return <ScrollView contentContainerStyle={styles.page}><Card><SectionTitle title="Inventario" subtitle="Cargando inventario real desde Firebase…" /></Card></ScrollView>;
  }

  const header = inventoryHeader(view, selectedVan?.name, activeCheck?.scope === 'van'
    ? module.vans.find((van) => van.id === activeCheck.vanId)?.name
    : undefined);
  const backLabel = view === 'van-profile' || view === 'check-van-ready' ? '← Cambiar van' : view === 'check-active' ? '← Salir del control' : '← Regresar';

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SectionTitle
        title={header.title}
        subtitle={header.subtitle}
        action={view !== 'menu' ? <Button compact variant="secondary" label={backLabel} onPress={goBack} /> : undefined}
      />
      {module.error ? <View style={styles.errorBox}><Text style={styles.errorText}>{module.error}</Text></View> : null}
      {message ? <View style={styles.messageBox}><Text style={styles.messageText}>{message}</Text></View> : null}

      {view === 'menu' ? (
        <>
          {activeCheck ? (
            <Card style={styles.activeCheckCard}>
              <Text style={styles.eyebrow}>CONTROL EN PROGRESO</Text>
              <Text style={styles.cardTitle}>{activeCheck.scope === 'van' ? module.vans.find((van) => van.id === activeCheck.vanId)?.name ?? 'Van' : 'Depósito'}</Text>
              <Text style={styles.cardText}>Este control todavía no se ha finalizado.</Text>
              <Button label="Continuar control" variant="success" onPress={continueActiveCheck} />
            </Card>
          ) : null}
          <View style={styles.menuGrid}>
            <MenuCard icon="📦" title="Inventario del depósito" text="Existencias, mínimos, costos y power tools guardados en el depósito." label="Abrir depósito" onPress={() => openView('warehouse')} />
            <MenuCard icon="🚐" title="Herramientas por van" text="Selecciona una van y administra exclusivamente su perfil." label="Seleccionar van" onPress={() => openVanSelection('tools')} />
            <MenuCard icon="✅" title="Control de inventario" text="Realiza el checklist de una van, conteo del depósito o consulta el historial." label="Abrir controles" onPress={() => openView('checks-menu')} />
          </View>
        </>
      ) : null}

      {view === 'warehouse' ? (
        <>
          <View style={styles.metrics}>
            <Metric label="Valor del depósito" value={formatMoney(totalWarehouseValue)} icon="💰" />
            <Metric label="Artículos" value={String(module.warehouseItems.length)} icon="📦" />
            <Metric label="Reposición" value={String(lowStock.length)} icon="⚠️" warning />
            <Metric label="Power tools guardados" value={String(warehousePowerTools.length)} icon="🧰" />
          </View>
          {!module.warehouseItems.length ? (
            <Card>
              <EmptyState icon="📦" title="Depósito sin artículos" message="Importa el inventario base o registra los artículos manualmente." />
              <Button label={module.busy ? 'Importando…' : 'Importar inventario base actual'} disabled={module.busy} onPress={async () => { const result = await module.importFallbackWarehouse(); setMessage(result.message ?? 'Importación finalizada.'); }} />
            </Card>
          ) : null}
          <Card>
            <SectionTitle title="Registrar artículo del depósito" subtitle="Materiales, refrigerantes, piezas, consumibles y artículos controlados por cantidad." />
            <View style={styles.formGrid}>
              <Input style={styles.wideField} label="Nombre" value={warehouseDraft.name} onChangeText={(name) => setWarehouseDraft((draft) => ({ ...draft, name }))} />
              <Input style={styles.field} label="Categoría" value={warehouseDraft.category} onChangeText={(category) => setWarehouseDraft((draft) => ({ ...draft, category }))} />
              <Input style={styles.field} label="Unidad" value={warehouseDraft.unit} onChangeText={(unit) => setWarehouseDraft((draft) => ({ ...draft, unit }))} />
              <Input style={styles.field} keyboardType="numeric" label="Cantidad inicial" value={warehouseDraft.quantity} onChangeText={(quantity) => setWarehouseDraft((draft) => ({ ...draft, quantity }))} />
              <Input style={styles.field} keyboardType="numeric" label="Mínimo" value={warehouseDraft.minimum} onChangeText={(minimum) => setWarehouseDraft((draft) => ({ ...draft, minimum }))} />
              <Input style={styles.field} keyboardType="numeric" label="Costo unitario Afl." value={warehouseDraft.cost} onChangeText={(cost) => setWarehouseDraft((draft) => ({ ...draft, cost }))} />
              <Input style={styles.wideField} label="Ubicación" value={warehouseDraft.location} onChangeText={(location) => setWarehouseDraft((draft) => ({ ...draft, location }))} />
            </View>
            <Button label={module.busy ? 'Guardando…' : 'Agregar al depósito'} disabled={module.busy} onPress={() => void registerWarehouseItem()} />
          </Card>
          <Card>
            <SectionTitle title="Existencias del depósito" subtitle="Para hacer un conteo físico, regresa al menú y selecciona Control de inventario." />
            {module.warehouseItems.length ? module.warehouseItems.map((item) => <WarehouseItemRow key={item.id} item={item} disabled={module.busy} onSave={module.saveWarehouseItem} />) : <EmptyState icon="📦" title="Sin artículos" message="Registra o importa el inventario del depósito." />}
          </Card>
          <Card>
            <SectionTitle title="Power tools en el depósito" subtitle="Herramientas individuales transferidas temporalmente fuera de una van." />
            {warehousePowerTools.length ? warehousePowerTools.map((asset) => (
              <View key={asset.id} style={styles.assetCard}>
                <AssetSummary asset={asset} catalog={module.catalogById[asset.toolCatalogId]} />
                <View style={styles.optionRow}>
                  {module.vans.map((van) => <Button key={van.id} compact variant="secondary" label={`Enviar a ${van.name}`} onPress={() => { setTransferAsset(asset); void performTransfer(van.id); }} />)}
                </View>
              </View>
            )) : <EmptyState icon="🧰" title="Sin power tools guardados" message="Las herramientas transferidas al depósito aparecerán aquí." />}
          </Card>
        </>
      ) : null}

      {view === 'van-select' ? <VanSelection vans={module.vans} assets={module.vanAssets} title="Selecciona la van que deseas administrar" subtitle="Entrarás exclusivamente al perfil seleccionado." label="Abrir perfil" onSelect={(vanId) => selectVan(vanId, 'tools')} /> : null}

      {view === 'van-profile' && selectedVan ? (
        <>
          <VanBanner van={selectedVan} mode="tools" />
          <View style={styles.metrics}>
            <Metric label="Unidades físicas" value={String(physicalToolCount)} icon="🧰" />
            <Metric label="Valor de esta van" value={formatMoney(vanValue)} icon="💰" />
            <Metric label="Requieren reemplazo" value={String(replacementCount)} icon="⚠️" warning />
          </View>
          <Card>
            <SectionTitle title={`Registrar herramienta en ${selectedVan.name}`} subtitle="Power tools: control individual. Herramientas pequeñas: control por cantidad." />
            <View style={styles.modeGrid}>
              <ModeCard active={trackingMode === 'individual'} title="Control individual" text="Una foto, condición e historial por cada power tool." onPress={() => setTrackingMode('individual')} />
              <ModeCard active={trackingMode === 'quantity'} title="Control por cantidad" text="Un conteo y una fotografía general para herramientas pequeñas." onPress={() => setTrackingMode('quantity')} />
            </View>
            <View style={styles.formGrid}>
              <Input style={styles.wideField} label="Nombre de la herramienta" value={toolName} onChangeText={setToolName} placeholder="Ej. Makita Hammer Drill" />
              <Input style={styles.field} label="Categoría" value={toolCategory} onChangeText={setToolCategory} />
              <Input style={styles.field} keyboardType="numeric" label="Costo por unidad Afl." value={toolCost} onChangeText={setToolCost} />
              <Input style={styles.field} keyboardType="numeric" label="Cantidad en esta van" value={toolQuantity} onChangeText={setToolQuantity} />
              <Input style={styles.field} keyboardType="numeric" label="Cantidad estándar recomendada" value={recommendedQuantity} onChangeText={setRecommendedQuantity} />
            </View>
            <Text style={styles.smallLabel}>ESTADO INICIAL</Text>
            <View style={styles.optionRow}>{CONDITIONS.map((condition) => <Button key={condition} compact variant={toolCondition === condition ? 'primary' : 'secondary'} label={condition} onPress={() => setToolCondition(condition)} />)}</View>
            <PhotoSlots title={trackingMode === 'individual' ? 'Fotografía obligatoria por unidad' : 'Fotografía general obligatoria'} slots={toolPhotos} mode={trackingMode} onCamera={(index) => void replacePhoto(toolPhotos, setToolPhotos, index, true)} onGallery={(index) => void replacePhoto(toolPhotos, setToolPhotos, index, false)} />
            <Button label={module.busy || photoBusyId ? 'Guardando…' : `Registrar en ${selectedVan.name}`} disabled={module.busy || Boolean(photoBusyId)} onPress={() => void registerTool()} />
          </Card>
          <Card>
            <SectionTitle title={`Catálogo de ${selectedVan.name}`} subtitle="El catálogo es compartido; las cantidades y unidades físicas son independientes por van." />
            {module.toolCatalog.filter((catalog) => catalog.active !== false).map((catalog) => {
              const assets = selectedAssets.filter((asset) => asset.toolCatalogId === catalog.id);
              const assignedQuantity = assets.reduce((sum, asset) => sum + ((asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity' ? Number(asset.quantityExpected ?? 0) : 1), 0);
              const recommended = Number(catalog.recommendedQuantity ?? 1);
              return (
                <View key={catalog.id} style={styles.catalogGroup}>
                  <View style={styles.catalogHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{catalog.name}</Text>
                      <Text style={styles.cardText}>{catalog.category} · {formatMoney(catalog.standardCost)} por unidad</Text>
                      <Text style={styles.catalogStats}>Asignadas: {assignedQuantity} · Estándar: {recommended} · {assignedQuantity >= recommended ? 'Completo' : `Faltan ${recommended - assignedQuantity}`}</Text>
                    </View>
                    <Pill label={(catalog.trackingMode ?? 'individual') === 'individual' ? 'Individual' : 'Por cantidad'} tone="info" />
                    <Button compact variant="success" label="Agregar unidades" onPress={() => openAddUnits(catalog)} />
                  </View>
                  {assets.length ? assets.map((asset) => (
                    <AssetEditorCard
                      key={asset.id}
                      asset={asset}
                      catalog={catalog}
                      evidence={module.evidence.filter((photo) => photo.entityId === asset.id)}
                      vans={module.vans}
                      busy={module.busy || photoBusyId === asset.id}
                      onSave={async (updated) => { const result = await module.saveVanAsset(updated); setMessage(result.ok ? 'Herramienta actualizada.' : result.message ?? 'No se pudo actualizar.'); }}
                      onPhoto={() => void captureAssetPhoto(asset)}
                      onTransfer={() => setTransferAsset(asset)}
                    />
                  )) : <View style={styles.unassignedBox}><Text style={styles.cardText}>No asignada a esta van.</Text><Button compact variant="success" label="Asignar ahora" onPress={() => openAddUnits(catalog)} /></View>}
                </View>
              );
            })}
            {!module.toolCatalog.length ? <EmptyState icon="🧰" title="Sin herramientas" message={`Registra la primera herramienta de ${selectedVan.name}.`} /> : null}
          </Card>
        </>
      ) : null}

      {view === 'checks-menu' ? (
        <>
          {activeCheck ? <Card style={styles.activeCheckCard}><Text style={styles.eyebrow}>CONTROL EN PROGRESO</Text><Text style={styles.cardTitle}>{activeCheck.scope === 'van' ? module.vans.find((van) => van.id === activeCheck.vanId)?.name ?? 'Van' : 'Depósito'}</Text><Button label="Continuar control pendiente" variant="success" onPress={continueActiveCheck} /></Card> : null}
          <View style={styles.menuGrid}>
            <MenuCard icon="🚐" title="Control de una van" text="Selecciona la van y confirma su perfil antes del checklist." label="Seleccionar van" onPress={() => openVanSelection('check')} />
            <MenuCard icon="📋" title="Conteo físico del depósito" text="Compara cantidades esperadas y encontradas." label="Preparar conteo" onPress={() => openView('warehouse-check-ready')} />
            <MenuCard icon="🕘" title="Historial de controles" text="Consulta faltantes, reemplazos, diferencias y valor revisado." label="Ver historial" onPress={() => openView('check-history')} />
          </View>
        </>
      ) : null}

      {view === 'check-van-select' ? <VanSelection vans={module.vans} assets={module.vanAssets} title="Selecciona la van que vas a controlar" subtitle="La próxima pantalla confirmará claramente la van seleccionada." label="Seleccionar para control" onSelect={(vanId) => selectVan(vanId, 'check')} /> : null}

      {view === 'check-van-ready' && selectedVan ? (
        <>
          <VanBanner van={selectedVan} mode="check" />
          <View style={styles.metrics}>
            <Metric label="Unidades a revisar" value={String(physicalToolCount)} icon="🧰" />
            <Metric label="Valor a controlar" value={formatMoney(vanValue)} icon="💰" />
            <Metric label="Reemplazos actuales" value={String(replacementCount)} icon="⚠️" warning />
          </View>
          <Card style={styles.confirmCard}>
            <Text style={styles.cardTitle}>Confirma antes de comenzar</Text>
            <Text style={styles.cardText}>El checklist pertenece únicamente a {selectedVan.name}, placa {selectedVan.plate}.</Text>
            <Button label={module.busy ? 'Iniciando…' : `Comenzar control de ${selectedVan.name}`} variant="success" disabled={module.busy || !selectedAssets.length} onPress={() => void startCheck('van')} />
          </Card>
        </>
      ) : null}

      {view === 'warehouse-check-ready' ? (
        <>
          <View style={styles.metrics}>
            <Metric label="Artículos a contar" value={String(module.warehouseItems.length)} icon="📦" />
            <Metric label="Valor esperado" value={formatMoney(totalWarehouseValue)} icon="💰" />
            <Metric label="Reposición actual" value={String(lowStock.length)} icon="⚠️" warning />
          </View>
          <Card style={styles.confirmCard}><Text style={styles.cardTitle}>Preparar conteo físico</Text><Text style={styles.cardText}>Al finalizar, las cantidades contadas actualizarán las existencias reales.</Text><Button label={module.busy ? 'Iniciando…' : 'Comenzar conteo del depósito'} variant="success" disabled={module.busy || !module.warehouseItems.length} onPress={() => void startCheck('warehouse')} /></Card>
        </>
      ) : null}

      {view === 'check-active' && activeCheck ? (
        <Card>
          <SectionTitle title={activeCheck.scope === 'van' ? `Control de ${module.vans.find((van) => van.id === activeCheck.vanId)?.name ?? 'van'}` : 'Conteo físico del depósito'} subtitle={`Iniciado por ${activeCheck.startedByName} · ${new Date(activeCheck.startedAt).toLocaleString('es-AW')}`} />
          <View style={styles.checkProgress}><Pill label={`${activeEntries.filter((entry) => entry.status !== 'pending').length}/${activeEntries.length} revisados`} tone="info" /><Button compact variant="success" label={module.busy ? 'Finalizando…' : 'Finalizar control'} disabled={module.busy} onPress={() => void finishCheck()} /></View>
          {activeCheck.scope === 'van' ? activeEntries.map((entry) => {
            const asset = module.vanAssets.find((candidate) => candidate.id === entry.assetId);
            if (!asset) return null;
            return (entry.trackingMode ?? asset.trackingMode ?? 'individual') === 'quantity'
              ? <QuantityCheckRow key={entry.id} entry={entry} asset={asset} disabled={module.busy} onSave={async (updated) => { const result = await module.saveCheckEntry(updated); setMessage(result.ok ? `${entry.label}: conteo guardado.` : result.message ?? 'No se pudo guardar.'); }} onPhoto={() => void captureAssetPhoto(asset, entry)} />
              : <IndividualCheckRow key={entry.id} entry={entry} asset={asset} photo={module.evidence.find((candidate) => candidate.id === entry.photoEvidenceId)} disabled={module.busy || photoBusyId === asset.id} onSave={module.saveCheckEntry} onPhoto={() => void captureAssetPhoto(asset, entry)} />;
          }) : activeEntries.map((entry) => <WarehouseCountRow key={entry.id} entry={entry} disabled={module.busy} onSave={async (countedQuantity) => { const result = await module.saveCheckEntry({ ...entry, countedQuantity, status: 'present' }); setMessage(result.ok ? `${entry.label}: conteo guardado.` : result.message ?? 'No se pudo guardar.'); }} />)}
        </Card>
      ) : null}

      {view === 'check-history' ? (
        <Card>
          <SectionTitle title="Historial de controles" subtitle="Resumen de faltantes, reemplazos, diferencias y valor revisado." />
          {completedChecks.length ? completedChecks.map((check) => (
            <View key={check.id} style={styles.historyRow}>
              <View style={{ flex: 1 }}><Text style={styles.cardTitle}>{check.scope === 'van' ? module.vans.find((van) => van.id === check.vanId)?.name ?? 'Van' : 'Depósito'}</Text><Text style={styles.cardText}>{check.completedAt ? new Date(check.completedAt).toLocaleString('es-AW') : ''} · {check.startedByName}</Text></View>
              {check.scope === 'van' ? <><Pill label={`${check.missingCount ?? 0} faltantes`} tone={(check.missingCount ?? 0) ? 'danger' : 'success'} /><Pill label={`${check.replacementCount ?? 0} reemplazos`} tone={(check.replacementCount ?? 0) ? 'warning' : 'success'} /></> : <Pill label={`${check.varianceCount ?? 0} diferencias`} tone={(check.varianceCount ?? 0) ? 'warning' : 'success'} />}
              <Text style={styles.valueText}>{formatMoney(check.inventoryValue ?? 0)}</Text>
            </View>
          )) : <EmptyState icon="📝" title="Sin controles completados" message="Los controles finalizados aparecerán aquí." />}
        </Card>
      ) : null}

      <AppModal visible={Boolean(addCatalog)} title={addCatalog ? `Agregar ${addCatalog.name}` : 'Agregar unidades'} onClose={() => setAddCatalog(null)}>
        {addCatalog ? <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={styles.cardText}>Se agregarán unidades solamente a {selectedVan?.name}. El catálogo seguirá compartido con las demás vans.</Text>
          <View style={styles.formGrid}>
            <Input style={styles.field} keyboardType="numeric" label="Cantidad a agregar" value={addQuantity} onChangeText={setAddQuantity} />
          </View>
          <Text style={styles.smallLabel}>ESTADO INICIAL</Text>
          <View style={styles.optionRow}>{CONDITIONS.map((condition) => <Button key={condition} compact variant={addCondition === condition ? 'primary' : 'secondary'} label={condition} onPress={() => setAddCondition(condition)} />)}</View>
          <PhotoSlots title={(addCatalog.trackingMode ?? 'individual') === 'individual' ? 'Una fotografía por unidad' : 'Fotografía general'} slots={addPhotos} mode={addCatalog.trackingMode ?? 'individual'} onCamera={(index) => void replacePhoto(addPhotos, setAddPhotos, index, true)} onGallery={(index) => void replacePhoto(addPhotos, setAddPhotos, index, false)} />
          <Button label={module.busy || photoBusyId ? 'Guardando…' : `Agregar a ${selectedVan?.name ?? 'la van'}`} disabled={module.busy || Boolean(photoBusyId)} onPress={() => void addUnits()} />
        </ScrollView> : null}
      </AppModal>

      <AppModal visible={Boolean(transferAsset)} title="Transferir herramienta" onClose={() => setTransferAsset(null)}>
        {transferAsset ? <View style={{ gap: 12 }}>
          <AssetSummary asset={transferAsset} catalog={module.catalogById[transferAsset.toolCatalogId]} />
          <Text style={styles.cardText}>El código permanece igual para conservar el historial. Selecciona el nuevo destino:</Text>
          <View style={styles.optionRow}>
            {module.vans.filter((van) => !assetIsInVan(transferAsset, van.id)).map((van) => <Button key={van.id} variant="secondary" label={van.name} onPress={() => void performTransfer(van.id)} />)}
            <Button variant="secondary" label="Depósito" onPress={() => void performTransfer('warehouse')} />
          </View>
        </View> : null}
      </AppModal>
    </ScrollView>
  );
}

function inventoryHeader(view: InventoryView, selectedVanName?: string, activeCheckVanName?: string) {
  if (view === 'menu') return { title: 'Inventario DEMAC', subtitle: 'Selecciona una operación para continuar paso a paso.' };
  if (view === 'warehouse') return { title: 'Inventario del depósito', subtitle: 'Existencias, valores, mínimos y power tools guardados.' };
  if (view === 'van-select') return { title: 'Herramientas por van', subtitle: 'Paso 1 de 2: selecciona la van.' };
  if (view === 'van-profile') return { title: `Perfil de ${selectedVanName ?? 'la van'}`, subtitle: 'Paso 2 de 2: administra únicamente la van seleccionada.' };
  if (view === 'checks-menu') return { title: 'Control de inventario', subtitle: 'Selecciona el tipo de control.' };
  if (view === 'check-van-select') return { title: 'Control de una van', subtitle: 'Paso 1 de 2: selecciona la van.' };
  if (view === 'check-van-ready') return { title: `Preparar control de ${selectedVanName ?? 'la van'}`, subtitle: 'Paso 2 de 2: confirma antes de comenzar.' };
  if (view === 'warehouse-check-ready') return { title: 'Preparar conteo del depósito', subtitle: 'Confirma el alcance antes de iniciar.' };
  if (view === 'check-active') return { title: activeCheckVanName ? `Control activo · ${activeCheckVanName}` : 'Control activo · Depósito', subtitle: 'Completa el checklist y finaliza.' };
  return { title: 'Historial de controles', subtitle: 'Consulta los controles finalizados.' };
}

function MenuCard({ icon, title, text, label, onPress }: { icon: string; title: string; text: string; label: string; onPress: () => void }) {
  return <Card style={styles.menuCard}><Text style={styles.menuIcon}>{icon}</Text><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardText}>{text}</Text><Button label={label} onPress={onPress} /></Card>;
}

function ModeCard({ active, title, text, onPress }: { active: boolean; title: string; text: string; onPress: () => void }) {
  return <Card style={[styles.modeCard, active && styles.modeCardActive]}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardText}>{text}</Text><Button compact variant={active ? 'primary' : 'secondary'} label={active ? 'Seleccionado' : 'Seleccionar'} onPress={onPress} /></Card>;
}

function PhotoSlots({ title, slots, mode, onCamera, onGallery }: { title: string; slots: Array<PendingPhoto | null>; mode: ToolTrackingMode; onCamera: (index: number) => void; onGallery: (index: number) => void }) {
  return <View style={styles.photoSection}><Text style={styles.smallLabel}>{title.toUpperCase()}</Text><View style={styles.photoGrid}>{slots.map((photo, index) => <View key={index} style={styles.photoSlot}>{photo ? <Image source={{ uri: photo.uri }} style={styles.preview} /> : <View style={styles.photoPlaceholder}><Text style={styles.photoPlaceholderText}>{mode === 'individual' ? `Unidad ${index + 1}` : 'Foto general'}</Text></View>}<View style={styles.optionRow}><Button compact variant="secondary" label="Cámara" onPress={() => onCamera(index)} /><Button compact variant="secondary" label="Galería" onPress={() => onGallery(index)} /></View></View>)}</View></View>;
}

function VanSelection({ vans, assets, title, subtitle, label, onSelect }: { vans: Van[]; assets: VanToolAssetV2[]; title: string; subtitle: string; label: string; onSelect: (vanId: string) => void }) {
  return <Card><SectionTitle title={title} subtitle={subtitle} /><View style={styles.vanGrid}>{vans.map((van) => { const vanAssets = assets.filter((asset) => assetIsInVan(asset, van.id)); const units = vanAssets.reduce((sum, asset) => sum + ((asset.trackingMode ?? 'individual') === 'quantity' ? Number(asset.quantityExpected ?? 0) : 1), 0); const value = vanAssets.reduce((sum, asset) => sum + assetInventoryValue(asset), 0); return <View key={van.id} style={styles.vanCard}><Text style={styles.menuIcon}>🚐</Text><Text style={styles.cardTitle}>{van.name}</Text><Text style={styles.cardText}>Placa {van.plate} · {van.status}</Text><Text style={styles.catalogStats}>{units} unidades · {formatMoney(value)}</Text><Button label={`${label}: ${van.name}`} onPress={() => onSelect(van.id)} /></View>; })}</View></Card>;
}

function VanBanner({ van, mode }: { van: Van; mode: 'tools' | 'check' }) {
  return <Card style={styles.banner}><View style={styles.bannerTop}><Text style={styles.menuIcon}>🚐</Text><View style={{ flex: 1 }}><Text style={styles.eyebrow}>{mode === 'tools' ? 'PERFIL DE VAN ACTIVO' : 'VAN SELECCIONADA PARA CONTROL'}</Text><Text style={styles.bannerName}>{van.name}</Text><Text style={styles.cardText}>Placa {van.plate} · {van.status}</Text></View><Pill label={mode === 'tools' ? 'Perfil activo' : 'Confirmada'} tone="info" /></View><Text style={styles.notice}>Todo lo que registres en esta pantalla corresponde exclusivamente a {van.name}.</Text></Card>;
}

function AssetSummary({ asset, catalog }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2 }) {
  return <View style={styles.assetTop}>{asset.latestPhotoUrl ? <Image source={{ uri: asset.latestPhotoUrl }} style={styles.assetImage} /> : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>}<View style={{ flex: 1 }}><Text style={styles.assetCode}>{asset.assetCode}</Text><Text style={styles.cardTitle}>{catalog?.name ?? asset.toolCatalogId}</Text><Text style={styles.cardText}>{catalog?.category ?? 'Herramienta'} · {formatMoney(asset.purchaseCost)} por unidad</Text></View><Pill label={asset.operationalStatus ?? 'Disponible'} tone={statusTone(asset.operationalStatus)} /></View>;
}

function AssetEditorCard({ asset, catalog, evidence, vans, busy, onSave, onPhoto, onTransfer }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; evidence: InventoryEvidenceV2[]; vans: Van[]; busy: boolean; onSave: (asset: VanToolAssetV2) => Promise<void>; onPhoto: () => void; onTransfer: () => void }) {
  const [condition, setCondition] = useState<ToolConditionV2>(asset.condition);
  const [status, setStatus] = useState<ToolOperationalStatus>(asset.operationalStatus ?? 'Disponible');
  const [notes, setNotes] = useState(asset.notes ?? '');
  const [maintenance, setMaintenance] = useState(asset.maintenanceDueAt ?? '');
  const [calibration, setCalibration] = useState(asset.calibrationDueAt ?? '');
  const [expected, setExpected] = useState(String(asset.quantityExpected ?? 1));
  const [present, setPresent] = useState(String(asset.quantityPresent ?? asset.quantityExpected ?? 1));
  useEffect(() => { setCondition(asset.condition); setStatus(asset.operationalStatus ?? 'Disponible'); setNotes(asset.notes ?? ''); setMaintenance(asset.maintenanceDueAt ?? ''); setCalibration(asset.calibrationDueAt ?? ''); setExpected(String(asset.quantityExpected ?? 1)); setPresent(String(asset.quantityPresent ?? asset.quantityExpected ?? 1)); }, [asset]);
  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';
  return <View style={styles.assetCard}><AssetSummary asset={asset} catalog={catalog} />{quantityMode ? <View style={styles.formGrid}><Input style={styles.field} keyboardType="numeric" label="Cantidad asignada" value={expected} onChangeText={setExpected} /><Input style={styles.field} keyboardType="numeric" label="Cantidad presente" value={present} onChangeText={setPresent} /></View> : null}<Text style={styles.smallLabel}>CONDICIÓN</Text><View style={styles.optionRow}>{CONDITIONS.map((candidate) => <Button key={candidate} compact variant={condition === candidate ? 'primary' : 'secondary'} label={candidate} onPress={() => setCondition(candidate)} />)}</View><Text style={styles.smallLabel}>ESTADO OPERATIVO</Text><View style={styles.optionRow}>{OPERATIONAL_STATUSES.map((candidate) => <Button key={candidate} compact variant={status === candidate ? 'primary' : 'secondary'} label={candidate} onPress={() => setStatus(candidate)} />)}</View><View style={styles.formGrid}><Input style={styles.wideField} multiline label="Observación, daño o anomalía" value={notes} onChangeText={setNotes} placeholder="Ej. Batería floja, cable deteriorado, requiere revisión…" /><Input style={styles.field} label="Próximo mantenimiento" value={maintenance} onChangeText={setMaintenance} placeholder="AAAA-MM-DD" /><Input style={styles.field} label="Próxima calibración" value={calibration} onChangeText={setCalibration} placeholder="Opcional" /></View><View style={styles.optionRow}><Button compact variant="success" label={busy ? 'Guardando…' : 'Guardar cambios'} disabled={busy} onPress={() => void onSave({ ...asset, condition, operationalStatus: status, notes: notes.trim(), maintenanceDueAt: maintenance.trim() || undefined, calibrationDueAt: calibration.trim() || undefined, quantityExpected: quantityMode ? Math.max(0, Number(expected || 0)) : 1, quantityPresent: quantityMode ? Math.max(0, Number(present || 0)) : (status === 'Faltante' ? 0 : 1), present: quantityMode ? Number(present || 0) > 0 : status !== 'Faltante' })} /><Button compact variant="secondary" label="Nueva foto" disabled={busy} onPress={onPhoto} />{!quantityMode ? <Button compact variant="secondary" label="Transferir" disabled={busy} onPress={onTransfer} /> : null}</View>{evidence.length ? <ScrollView horizontal contentContainerStyle={styles.historyStrip}>{evidence.map((photo) => <View key={photo.id}><Image source={{ uri: photo.downloadUrl }} style={styles.historyImage} /><Text style={styles.historyDate}>{new Date(photo.capturedAt).toLocaleDateString('es-AW')}</Text></View>)}</ScrollView> : null}</View>;
}

function WarehouseItemRow({ item, disabled, onSave }: { item: WarehouseInventoryItemV2; disabled: boolean; onSave: (item: WarehouseInventoryItemV2) => Promise<{ ok: boolean; message?: string }> }) {
  const low = Number(item.quantity) <= Number(item.minimum);
  return <View style={[styles.inventoryRow, low && styles.warningRow]}><View style={{ flex: 1, minWidth: 200 }}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.cardText}>{item.category} · {item.location} · por {item.unit}</Text></View><View style={styles.quantityBox}><Text style={styles.quantity}>{item.quantity}</Text><Text style={styles.quantityLabel}>actual</Text></View><Text style={styles.valueText}>{formatMoney(item.quantity * item.cost)}</Text><View style={styles.optionRow}><Button compact variant="secondary" label="−" disabled={disabled} onPress={() => void onSave({ ...item, quantity: Math.max(0, item.quantity - 1) })} /><Button compact variant="secondary" label="＋" disabled={disabled} onPress={() => void onSave({ ...item, quantity: item.quantity + 1 })} /></View>{low ? <Pill label="Reponer" tone="warning" /> : <Pill label="Disponible" tone="success" />}</View>;
}

function IndividualCheckRow({ entry, asset, photo, disabled, onSave, onPhoto }: { entry: InventoryCheckEntryV2; asset: VanToolAssetV2; photo?: InventoryEvidenceV2; disabled: boolean; onSave: (entry: InventoryCheckEntryV2) => Promise<{ ok: boolean; message?: string }>; onPhoto: () => void }) {
  return <View style={[styles.checkRow, entry.status === 'present' && styles.presentRow, entry.status === 'missing' && styles.missingRow]}><View style={{ flex: 1 }}><Text style={styles.assetCode}>{entry.assetCode}</Text><Text style={styles.cardTitle}>{entry.label}</Text><Text style={styles.cardText}>{entry.status === 'pending' ? 'Pendiente de revisar' : entry.status === 'present' ? 'Encontrada' : 'Faltante'}</Text></View>{photo ? <Image source={{ uri: photo.downloadUrl }} style={styles.checkPhoto} /> : null}<View style={styles.optionRow}><Button compact variant="success" label="Presente" disabled={disabled} onPress={() => void onSave({ ...entry, status: 'present', countedQuantity: 1, operationalStatus: entry.operationalStatus === 'Faltante' ? 'Disponible' : entry.operationalStatus })} /><Button compact variant="danger" label="Faltante" disabled={disabled} onPress={() => void onSave({ ...entry, status: 'missing', countedQuantity: 0, photoEvidenceId: undefined, operationalStatus: 'Faltante' })} /><Button compact variant="secondary" label="Foto" disabled={disabled || entry.status === 'missing'} onPress={onPhoto} /></View>{entry.status === 'present' ? <View style={styles.optionRow}>{CONDITIONS.map((condition) => <Button key={condition} compact variant={entry.condition === condition ? 'primary' : 'secondary'} label={condition} onPress={() => void onSave({ ...entry, condition })} />)}</View> : null}</View>;
}

function QuantityCheckRow({ entry, asset, disabled, onSave, onPhoto }: { entry: InventoryCheckEntryV2; asset: VanToolAssetV2; disabled: boolean; onSave: (entry: InventoryCheckEntryV2) => Promise<void>; onPhoto: () => void }) {
  const [value, setValue] = useState(entry.countedQuantity === undefined ? '' : String(entry.countedQuantity));
  useEffect(() => setValue(entry.countedQuantity === undefined ? '' : String(entry.countedQuantity)), [entry.countedQuantity]);
  const counted = Math.max(0, Number(value || 0));
  const expected = Number(entry.expectedQuantity ?? asset.quantityExpected ?? 0);
  const difference = counted - expected;
  return <View style={[styles.checkRow, entry.status !== 'pending' && (difference === 0 ? styles.presentRow : styles.warningRow)]}><View style={{ flex: 1, minWidth: 180 }}><Text style={styles.assetCode}>{entry.assetCode}</Text><Text style={styles.cardTitle}>{entry.label}</Text><Text style={styles.cardText}>Esperadas: {expected} · Diferencia: {difference > 0 ? '+' : ''}{difference}</Text></View><Input style={{ width: 140 }} keyboardType="numeric" label="Cantidad encontrada" value={value} onChangeText={setValue} /><View style={styles.optionRow}><Button compact variant="success" label="Guardar conteo" disabled={disabled || value === ''} onPress={() => void onSave({ ...entry, countedQuantity: counted, status: counted > 0 ? 'present' : 'missing', operationalStatus: counted > 0 ? 'Disponible' : 'Faltante' })} /><Button compact variant="secondary" label="Foto general" disabled={disabled} onPress={onPhoto} /></View></View>;
}

function WarehouseCountRow({ entry, disabled, onSave }: { entry: InventoryCheckEntryV2; disabled: boolean; onSave: (counted: number) => void }) {
  const [value, setValue] = useState(entry.countedQuantity === undefined ? '' : String(entry.countedQuantity));
  useEffect(() => setValue(entry.countedQuantity === undefined ? '' : String(entry.countedQuantity)), [entry.countedQuantity]);
  const counted = Number(value || 0);
  const variance = counted - Number(entry.expectedQuantity ?? 0);
  return <View style={[styles.checkRow, entry.status !== 'pending' && (variance === 0 ? styles.presentRow : styles.warningRow)]}><View style={{ flex: 1, minWidth: 180 }}><Text style={styles.cardTitle}>{entry.label}</Text><Text style={styles.cardText}>Sistema: {entry.expectedQuantity ?? 0} · Diferencia: {variance > 0 ? '+' : ''}{variance}</Text></View><Input style={{ width: 140 }} keyboardType="numeric" label="Cantidad contada" value={value} onChangeText={setValue} /><Button compact label="Guardar conteo" disabled={disabled || value === ''} onPress={() => onSave(Math.max(0, counted))} /></View>;
}

function Metric({ label, value, icon, warning }: { label: string; value: string; icon: string; warning?: boolean }) {
  return <Card style={styles.metric}><View style={[styles.metricIcon, warning && { backgroundColor: colors.warningLight }]}><Text>{icon}</Text></View><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></Card>;
}

function statusTone(status?: ToolOperationalStatus): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'Disponible') return 'success';
  if (status === 'Prestada' || status === 'En depósito') return 'info';
  if (status === 'En reparación') return 'warning';
  if (status === 'Faltante' || status === 'Desechada') return 'danger';
  return 'neutral';
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 110 },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' },
  menuCard: { flex: 1, minWidth: 260, gap: 12 },
  menuIcon: { fontSize: 30 },
  cardTitle: { color: colors.text, fontWeight: '900', fontSize: 15 },
  cardText: { color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: 3 },
  eyebrow: { color: colors.primary, fontWeight: '900', fontSize: 10, letterSpacing: 0.9 },
  activeCheckCard: { borderColor: colors.warning, backgroundColor: colors.warningLight, gap: 10 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { flex: 1, minWidth: 200 },
  metricIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  metricLabel: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  metricValue: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 5 },
  messageBox: { backgroundColor: colors.primaryLight, borderRadius: 10, padding: 12 },
  messageText: { color: colors.primaryDark, fontWeight: '700', lineHeight: 18 },
  errorBox: { backgroundColor: colors.dangerLight, borderRadius: 10, padding: 12 },
  errorText: { color: colors.danger, fontWeight: '700' },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  field: { minWidth: 145, flex: 1 },
  wideField: { minWidth: 240, flex: 2 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8, marginBottom: 10 },
  smallLabel: { color: colors.muted, fontWeight: '900', fontSize: 9, letterSpacing: 0.8, marginTop: 8, marginBottom: 7 },
  modeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
  modeCard: { flex: 1, minWidth: 230, gap: 8 },
  modeCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  photoSection: { marginBottom: 14 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  photoSlot: { width: 190, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 },
  preview: { width: '100%', height: 110, borderRadius: 9, backgroundColor: '#EEF2F6' },
  photoPlaceholder: { width: '100%', height: 110, borderRadius: 9, backgroundColor: '#EEF2F6', alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderText: { color: colors.muted, fontWeight: '800' },
  vanGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  vanCard: { flex: 1, minWidth: 260, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, gap: 8 },
  catalogStats: { color: colors.success, fontWeight: '900', fontSize: 10, marginTop: 6 },
  banner: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  bannerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bannerName: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 2 },
  notice: { color: colors.primaryDark, fontWeight: '800', marginTop: 12, fontSize: 11 },
  catalogGroup: { borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 13, marginBottom: 14 },
  catalogHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 },
  unassignedBox: { backgroundColor: '#F7F8FA', borderRadius: 10, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  assetCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginTop: 10 },
  assetTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  assetImage: { width: 82, height: 68, borderRadius: 9, backgroundColor: '#EEF2F6' },
  assetImagePlaceholder: { width: 82, height: 68, borderRadius: 9, backgroundColor: '#EEF2F6', alignItems: 'center', justifyContent: 'center' },
  assetCode: { color: colors.primary, fontWeight: '900', fontSize: 10, letterSpacing: 0.7 },
  historyStrip: { flexDirection: 'row', gap: 8, paddingTop: 8 },
  historyImage: { width: 86, height: 64, borderRadius: 8 },
  historyDate: { color: colors.muted, fontSize: 8, marginTop: 3 },
  inventoryRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12 },
  warningRow: { backgroundColor: '#FFF9F1', borderRadius: 10, paddingHorizontal: 10 },
  quantityBox: { width: 70, alignItems: 'center' },
  quantity: { color: colors.text, fontWeight: '900', fontSize: 18 },
  quantityLabel: { color: colors.muted, fontSize: 8, textTransform: 'uppercase' },
  valueText: { color: colors.text, fontWeight: '900', minWidth: 100 },
  confirmCard: { gap: 12, borderColor: colors.success },
  checkProgress: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  checkRow: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 11, marginBottom: 9, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  presentRow: { borderColor: '#B8DEC2', backgroundColor: '#F7FFF9' },
  missingRow: { borderColor: '#F0B8B8', backgroundColor: '#FFF7F7' },
  checkPhoto: { width: 72, height: 58, borderRadius: 8 },
  historyRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
});
