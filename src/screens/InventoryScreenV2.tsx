import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, EmptyState, formatMoney, Input, Pill, SectionTitle } from '../components/UI';
import { assetInventoryValue, assetIsInVan, assetIsInWarehouse, useInventoryModuleV2 } from '../hooks/useInventoryModuleV2';
import {
  InventoryCheckEntryV2,
  InventoryEvidenceV2,
  ToolCatalogItemV2,
  ToolConditionV2,
  ToolLifecycleAction,
  ToolLifecycleEventV2,
  ToolOperationalStatus,
  ToolRetirementDisposition,
  ToolTrackingMode,
  VanToolAssetV2,
  WarehouseInventoryItemV2,
} from '../inventory/v2Types';
import { uploadInventoryImage } from '../services/inventoryStorage';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { Van } from '../types';

const CONDITIONS: ToolConditionV2[] = ['Nueva', 'Poco uso', 'Uso medio', 'Muy usada', 'Requiere reemplazo'];
const EDITABLE_STATUSES: ToolOperationalStatus[] = ['Disponible', 'Prestada'];
const RETIREMENT_DISPOSITIONS: ToolRetirementDisposition[] = ['Retirada', 'Desechada', 'Vendida', 'Donada', 'Para piezas', 'Otro'];

type PendingPhoto = { uri: string; mimeType?: string | null; fileName?: string | null };
type InventoryView = 'menu' | 'warehouse' | 'van-select' | 'van-profile' | 'checks-menu' | 'check-van-select' | 'check-van-ready' | 'warehouse-check-ready' | 'check-active' | 'check-history';
type LifecycleAction = 'repair' | 'missing' | 'retire' | 'quantity-retire';

type WarehouseDraft = {
  name: string;
  category: string;
  unit: string;
  quantity: string;
  minimum: string;
  cost: string;
  location: string;
};

const emptyWarehouseDraft: WarehouseDraft = { name: '', category: 'Consumibles', unit: 'unidad', quantity: '0', minimum: '0', cost: '0', location: 'Depósito principal' };

function makePhotoSlots(quantity: number, mode: ToolTrackingMode, previous: Array<PendingPhoto | null> = []) {
  const length = mode === 'individual' ? Math.max(1, quantity) : 1;
  return Array.from({ length }, (_, index) => previous[index] ?? null);
}

function eventId() {
  return `lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRetired(asset: VanToolAssetV2) {
  return ['Retirada', 'Desechada'].includes(asset.operationalStatus ?? '') || Boolean(asset.retiredAt);
}

function availableQuantity(assets: VanToolAssetV2[], catalog: ToolCatalogItemV2) {
  if ((catalog.trackingMode ?? 'individual') === 'quantity') {
    return assets.reduce((sum, asset) => sum + Math.max(0, Number(asset.quantityPresent ?? asset.quantityExpected ?? 0)), 0);
  }
  return assets.filter((asset) => asset.present !== false && !['Faltante', 'Retirada', 'Desechada', 'En reparación'].includes(asset.operationalStatus ?? 'Disponible')).length;
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
  const [toolCategory, setToolCategory] = useState('Power Tools');
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
  const [replacementAssignment, setReplacementAssignment] = useState(false);

  const [transferAsset, setTransferAsset] = useState<VanToolAssetV2 | null>(null);
  const [lifecycleAsset, setLifecycleAsset] = useState<VanToolAssetV2 | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction>('repair');
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [lifecycleDisposition, setLifecycleDisposition] = useState<ToolRetirementDisposition>('Retirada');
  const [lifecycleQuantity, setLifecycleQuantity] = useState('1');
  const [lifecyclePhoto, setLifecyclePhoto] = useState<PendingPhoto | null>(null);

  const selectedVan = module.vans.find((van) => van.id === selectedVanId);
  const selectedAssets = module.vanAssets.filter((asset) => assetIsInVan(asset, selectedVanId) && !isRetired(asset));
  const retiredForSelectedVan = module.vanAssets.filter((asset) => asset.vanId === selectedVanId && isRetired(asset));
  const warehousePowerTools = module.vanAssets.filter((asset) => assetIsInWarehouse(asset) && !isRetired(asset));
  const activeCheck = module.checks.find((check) => check.id === activeCheckId) ?? module.checks.find((check) => check.status === 'draft');
  const activeEntries = activeCheck ? module.entries.filter((entry) => entry.checkId === activeCheck.id) : [];
  const completedChecks = module.checks.filter((check) => check.status === 'completed');
  const totalWarehouseValue = module.warehouseItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.cost), 0);
  const lowStock = module.warehouseItems.filter((item) => item.active !== false && Number(item.quantity) <= Number(item.minimum));

  const physicalToolCount = module.toolCatalog.reduce((sum, catalog) => sum + availableQuantity(selectedAssets.filter((asset) => asset.toolCatalogId === catalog.id), catalog), 0);
  const vanValue = selectedAssets.reduce((sum, asset) => sum + (asset.present === false ? 0 : assetInventoryValue(asset)), 0);
  const replacementCount = module.toolCatalog.reduce((sum, catalog) => {
    const available = availableQuantity(selectedAssets.filter((asset) => asset.toolCatalogId === catalog.id), catalog);
    return sum + Math.max(0, Number(catalog.recommendedQuantity ?? 1) - available);
  }, 0);

  const registrationQuantity = Math.max(1, Math.min(20, Math.round(Number(toolQuantity || 1))));
  const additionQuantity = Math.max(1, Math.min(20, Math.round(Number(addQuantity || 1))));

  useEffect(() => setToolPhotos((previous) => makePhotoSlots(registrationQuantity, trackingMode, previous)), [registrationQuantity, trackingMode]);
  useEffect(() => {
    if (!addCatalog) return;
    setAddPhotos((previous) => makePhotoSlots(additionQuantity, addCatalog.trackingMode ?? 'individual', previous));
  }, [additionQuantity, addCatalog]);

  async function pickPhoto(camera = true): Promise<PendingPhoto | null> {
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
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
    if (view === 'warehouse' || view === 'van-select' || view === 'checks-menu') { setSelectedVanId(''); setView('menu'); return; }
    if (view === 'van-profile') { setSelectedVanId(''); setView('van-select'); return; }
    if (view === 'check-van-select' || view === 'warehouse-check-ready' || view === 'check-history' || view === 'check-active') { setSelectedVanId(''); setView('checks-menu'); return; }
    if (view === 'check-van-ready') { setSelectedVanId(''); setView('check-van-select'); }
  }

  async function registerWarehouseItem() {
    if (!warehouseDraft.name.trim()) return setMessage('Escribe el nombre del artículo del depósito.');
    const now = new Date().toISOString();
    const item: WarehouseInventoryItemV2 = {
      id: `warehouse-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: warehouseDraft.name.trim(), category: warehouseDraft.category.trim() || 'General', unit: warehouseDraft.unit.trim() || 'unidad',
      quantity: Math.max(0, Number(warehouseDraft.quantity || 0)), minimum: Math.max(0, Number(warehouseDraft.minimum || 0)), cost: Math.max(0, Number(warehouseDraft.cost || 0)),
      location: warehouseDraft.location.trim() || 'Depósito principal', active: true, createdAt: now, updatedAt: now,
    };
    const result = await module.saveWarehouseItem(item);
    setMessage(result.ok ? 'Artículo agregado al depósito.' : result.message ?? 'No se pudo guardar el artículo.');
    if (result.ok) setWarehouseDraft(emptyWarehouseDraft);
  }

  async function uploadEvidence(asset: VanToolAssetV2, photo: PendingPhoto, phase: 'initial' | 'control' | 'discrepancy', note?: string, checkId?: string) {
    if (!currentUser) throw new Error('Debes iniciar sesión.');
    setPhotoBusyId(asset.id);
    const evidenceId = `inventory-photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stored = await uploadInventoryImage({ ...photo, scope: 'van-tool', entityId: asset.id, evidenceId });
    const now = new Date().toISOString();
    const evidence: InventoryEvidenceV2 = {
      id: evidenceId, entityType: 'van_tool', entityId: asset.id, checkId, phase, ...stored,
      capturedAt: now, uploadedAt: now, uploadedByUserId: currentUser.id, uploadedByName: currentUser.name, condition: asset.condition, note,
    };
    const evidenceResult = await module.saveInventoryEvidence(evidence);
    if (!evidenceResult.ok) throw new Error(evidenceResult.message);
    const saveResult = await module.saveVanAsset({ ...asset, latestPhotoUrl: stored.downloadUrl, latestPhotoStoragePath: stored.storagePath, latestPhotoAt: now });
    if (!saveResult.ok) throw new Error(saveResult.message);
    setPhotoBusyId('');
    return evidenceId;
  }

  async function uploadPhotosForAssets(assets: VanToolAssetV2[], photos: Array<PendingPhoto | null>, phase: 'initial' | 'control', checkId?: string) {
    const evidenceIds: Record<string, string> = {};
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      const photo = photos[(asset.trackingMode ?? 'individual') === 'quantity' ? 0 : index];
      if (photo) evidenceIds[asset.id] = await uploadEvidence(asset, photo, phase, undefined, checkId);
    }
    return evidenceIds;
  }

  async function registerTool() {
    if (!selectedVanId || !toolName.trim()) return setMessage('Selecciona una van y escribe el nombre de la herramienta.');
    if (toolPhotos.some((photo) => !photo)) return setMessage(trackingMode === 'individual' ? `Debes tomar una fotografía de cada una de las ${registrationQuantity} unidades.` : 'Debes tomar una fotografía general del grupo.');
    const created = await module.createTool({
      name: toolName, category: toolCategory, standardCost: Math.max(0, Number(toolCost || 0)), initialVanId: selectedVanId,
      condition: toolCondition, trackingMode, quantity: registrationQuantity, recommendedQuantity: Math.max(1, Number(recommendedQuantity || registrationQuantity)),
    });
    if (!created.result.ok || !created.assets.length) return setMessage(created.result.message ?? 'No se pudo crear la herramienta.');
    try {
      await uploadPhotosForAssets(created.assets, toolPhotos, 'initial');
      setToolName(''); setToolCost('0'); setToolCondition('Nueva'); setTrackingMode('individual'); setToolQuantity('1'); setRecommendedQuantity('1'); setToolPhotos([null]);
      setMessage(`${created.catalog?.name ?? 'Herramienta'} registrada en ${selectedVan?.name ?? 'la van'}.`);
    } catch (cause) {
      setMessage(`Las herramientas fueron creadas, pero faltó guardar alguna fotografía: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { setPhotoBusyId(''); }
  }

  function openAddUnits(catalog: ToolCatalogItemV2, suggestedQuantity = 1, replacement = false) {
    setAddCatalog(catalog); setAddQuantity(String(Math.max(1, suggestedQuantity))); setAddCondition('Nueva'); setAddPhotos([null]); setReplacementAssignment(replacement);
  }

  function makeLifecycleEvent(action: ToolLifecycleAction, fromVanId?: string, toVanId?: string, reason?: string, disposition?: ToolRetirementDisposition, quantity?: number, photoEvidenceId?: string): ToolLifecycleEventV2 {
    return {
      id: eventId(), action, occurredAt: new Date().toISOString(), performedByUserId: currentUser?.id ?? 'unknown', performedByName: currentUser?.name ?? 'Usuario',
      fromVanId, toVanId, reason, disposition, quantity, photoEvidenceId,
    };
  }

  async function addUnits() {
    if (!addCatalog || !selectedVan) return;
    if (addPhotos.some((photo) => !photo)) return setMessage((addCatalog.trackingMode ?? 'individual') === 'individual' ? `Debes tomar una fotografía de cada una de las ${additionQuantity} unidades.` : 'Debes tomar una fotografía general del grupo.');
    const created = await module.addUnitsToVan({ catalogId: addCatalog.id, vanId: selectedVan.id, condition: addCondition, quantity: additionQuantity });
    if (!created.result.ok || !created.assets.length) return setMessage(created.result.message ?? 'No se pudieron asignar las unidades.');
    try {
      await uploadPhotosForAssets(created.assets, addPhotos, 'initial');
      if (replacementAssignment) {
        for (const asset of created.assets) {
          const lifecycleHistory = [...(asset.lifecycleHistory ?? []), makeLifecycleEvent('replacement_assigned', asset.vanId, asset.vanId, 'Reemplazo asignado')];
          await module.saveVanAsset({ ...asset, lifecycleHistory });
        }
      }
      setMessage(`${additionQuantity} ${additionQuantity === 1 ? 'unidad asignada' : 'unidades asignadas'} a ${selectedVan.name}.`);
      setAddCatalog(null); setReplacementAssignment(false);
    } catch (cause) {
      setMessage(`Las unidades fueron asignadas, pero faltó guardar alguna fotografía: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { setPhotoBusyId(''); }
  }

  async function captureAssetPhoto(asset: VanToolAssetV2, entry?: InventoryCheckEntryV2) {
    const photo = await pickPhoto(true);
    if (!photo) return;
    try {
      const evidenceId = await uploadEvidence(asset, photo, entry ? 'control' : 'initial', undefined, entry?.checkId);
      if (entry) {
        const quantityMode = (entry.trackingMode ?? asset.trackingMode ?? 'individual') === 'quantity';
        const result = await module.saveCheckEntry({ ...entry, photoEvidenceId: evidenceId, status: quantityMode ? entry.status : 'present', countedQuantity: quantityMode ? entry.countedQuantity : 1 });
        if (!result.ok) throw new Error(result.message);
      }
      setMessage('Fotografía agregada al historial.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPhotoBusyId(''); }
  }

  function openLifecycle(asset: VanToolAssetV2) {
    setLifecycleAsset(asset);
    setLifecycleAction((asset.trackingMode ?? 'individual') === 'quantity' ? 'quantity-retire' : 'repair');
    setLifecycleReason(''); setLifecycleDisposition('Retirada'); setLifecycleQuantity('1'); setLifecyclePhoto(null);
  }

  async function applyLifecycle() {
    if (!lifecycleAsset || !lifecycleReason.trim()) return setMessage('Escribe el motivo de la salida o cambio de estado.');
    const requiresPhoto = lifecycleAction === 'retire' || lifecycleAction === 'quantity-retire';
    if (requiresPhoto && !lifecyclePhoto) return setMessage('Toma una fotografía final antes de retirar la herramienta.');
    const asset = lifecycleAsset;
    try {
      let photoEvidenceId: string | undefined;
      if (lifecyclePhoto) photoEvidenceId = await uploadEvidence(asset, lifecyclePhoto, 'discrepancy', lifecycleReason.trim());
      const now = new Date().toISOString();
      const history = [...(asset.lifecycleHistory ?? [])];

      if (lifecycleAction === 'repair') {
        history.push(makeLifecycleEvent('sent_to_repair', asset.vanId, undefined, lifecycleReason.trim(), undefined, 1, photoEvidenceId));
        const result = await module.saveVanAsset({ ...asset, assigned: true, previousVanId: asset.vanId, locationType: 'warehouse', locationId: 'warehouse', operationalStatus: 'En reparación', present: true, lifecycleHistory: history, notes: lifecycleReason.trim(), updatedAt: now });
        setMessage(result.ok ? 'Herramienta enviada a reparación. La van ahora muestra la unidad faltante.' : result.message ?? 'No se pudo actualizar.');
      } else if (lifecycleAction === 'missing') {
        history.push(makeLifecycleEvent('marked_missing', asset.vanId, asset.vanId, lifecycleReason.trim(), undefined, 1, photoEvidenceId));
        const result = await module.saveVanAsset({ ...asset, assigned: true, operationalStatus: 'Faltante', present: false, quantityPresent: 0, lifecycleHistory: history, notes: lifecycleReason.trim(), updatedAt: now });
        setMessage(result.ok ? 'Herramienta marcada como faltante. Queda pendiente de reposición o investigación.' : result.message ?? 'No se pudo actualizar.');
      } else if (lifecycleAction === 'retire') {
        const discarded = lifecycleDisposition === 'Desechada';
        history.push(makeLifecycleEvent(discarded ? 'discarded' : 'retired', asset.vanId, undefined, lifecycleReason.trim(), lifecycleDisposition, 1, photoEvidenceId));
        const result = await module.saveVanAsset({
          ...asset, assigned: false, present: false, quantityPresent: 0, operationalStatus: discarded ? 'Desechada' : 'Retirada',
          retiredAt: now, retiredReason: lifecycleReason.trim(), retiredDisposition: lifecycleDisposition, retiredByUserId: currentUser?.id, retiredByName: currentUser?.name,
          lifecycleHistory: history, notes: lifecycleReason.trim(), updatedAt: now,
        });
        setMessage(result.ok ? 'Herramienta retirada del inventario activo y conservada en el historial.' : result.message ?? 'No se pudo retirar.');
      } else {
        const expected = Math.max(0, Number(asset.quantityExpected ?? 0));
        const quantity = Math.min(expected, Math.max(1, Number(lifecycleQuantity || 1)));
        const remaining = Math.max(0, expected - quantity);
        const present = Math.min(remaining, Math.max(0, Number(asset.quantityPresent ?? expected) - quantity));
        history.push(makeLifecycleEvent('quantity_retired', asset.vanId, undefined, lifecycleReason.trim(), lifecycleDisposition, quantity, photoEvidenceId));
        const result = await module.saveVanAsset({
          ...asset, assigned: remaining > 0, quantityExpected: remaining, quantityPresent: present, present: present > 0,
          operationalStatus: remaining > 0 ? 'Disponible' : lifecycleDisposition === 'Desechada' ? 'Desechada' : 'Retirada',
          retiredAt: remaining > 0 ? asset.retiredAt : now, retiredReason: remaining > 0 ? asset.retiredReason : lifecycleReason.trim(), retiredDisposition: remaining > 0 ? asset.retiredDisposition : lifecycleDisposition,
          retiredByUserId: remaining > 0 ? asset.retiredByUserId : currentUser?.id, retiredByName: remaining > 0 ? asset.retiredByName : currentUser?.name,
          lifecycleHistory: history, notes: lifecycleReason.trim(), updatedAt: now,
        });
        setMessage(result.ok ? `${quantity} unidad(es) retiradas. La van muestra automáticamente la cantidad pendiente de reemplazo.` : result.message ?? 'No se pudo retirar la cantidad.');
      }
      setLifecycleAsset(null);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPhotoBusyId(''); }
  }

  async function performTransfer(destination: string) {
    if (!transferAsset) return;
    const warehouse = destination === 'warehouse';
    const destinationVan = module.vans.find((van) => van.id === destination);
    if (!warehouse && !destinationVan) return;
    const sourceVanId = transferAsset.locationType === 'warehouse' ? transferAsset.previousVanId : transferAsset.vanId;
    const action: ToolLifecycleAction = !warehouse && transferAsset.operationalStatus === 'En reparación' ? 'returned_to_service' : 'transferred';
    const history = [...(transferAsset.lifecycleHistory ?? []), makeLifecycleEvent(action, sourceVanId, destinationVan?.id, warehouse ? 'Transferida al depósito' : 'Transferida a una van')];
    const result = await module.saveVanAsset({
      ...transferAsset, assigned: true, vanId: destinationVan?.id ?? transferAsset.vanId, previousVanId: warehouse ? transferAsset.vanId : transferAsset.previousVanId,
      locationType: warehouse ? 'warehouse' : 'van', locationId: warehouse ? 'warehouse' : destinationVan!.id,
      operationalStatus: warehouse ? 'En depósito' : 'Disponible', present: true, quantityPresent: 1, lifecycleHistory: history,
    });
    setMessage(result.ok ? 'Herramienta transferida correctamente.' : result.message ?? 'No se pudo transferir.');
    if (result.ok) setTransferAsset(null);
  }

  async function startCheck(scope: 'van' | 'warehouse') {
    if (scope === 'van' && !selectedVanId) return setMessage('Selecciona primero la van que deseas controlar.');
    const started = scope === 'van' ? await module.startVanCheck(selectedVanId) : await module.startWarehouseCheck();
    setMessage(started.result.ok ? 'Control iniciado. Completa cada artículo del checklist.' : started.result.message ?? 'No se pudo iniciar el control.');
    if (started.check) { setActiveCheckId(started.check.id); setView('check-active'); }
  }

  async function finishCheck() {
    if (!activeCheck) return;
    const result = await module.completeCheck(activeCheck.id);
    setMessage(result.message ?? (result.ok ? 'Control completado.' : 'No se pudo completar.'));
    if (result.ok) { setActiveCheckId(''); setSelectedVanId(''); setView('checks-menu'); }
  }

  function continueActiveCheck() {
    if (!activeCheck) return;
    setActiveCheckId(activeCheck.id); setSelectedVanId(activeCheck.vanId ?? ''); setMessage(''); setView('check-active');
  }

  if (module.loading) return <ScrollView contentContainerStyle={styles.page}><Card><SectionTitle title="Inventario" subtitle="Cargando inventario real desde Firebase…" /></Card></ScrollView>;

  const header = inventoryHeader(view, selectedVan?.name, activeCheck?.scope === 'van' ? module.vans.find((van) => van.id === activeCheck.vanId)?.name : undefined);
  const backLabel = view === 'van-profile' || view === 'check-van-ready' ? '← Cambiar van' : view === 'check-active' ? '← Salir del control' : '← Regresar';

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SectionTitle title={header.title} subtitle={header.subtitle} action={view !== 'menu' ? <Button compact variant="secondary" label={backLabel} onPress={goBack} /> : undefined} />
      {module.error ? <View style={styles.errorBox}><Text style={styles.errorText}>{module.error}</Text></View> : null}
      {message ? <View style={styles.messageBox}><Text style={styles.messageText}>{message}</Text></View> : null}

      {view === 'menu' ? <><View style={styles.menuGrid}><MenuCard icon="📦" title="Inventario del depósito" text="Existencias, mínimos, costos y power tools guardados en el depósito." label="Abrir depósito" onPress={() => openView('warehouse')} /><MenuCard icon="🚐" title="Herramientas por van" text="Selecciona una van y administra exclusivamente su perfil." label="Seleccionar van" onPress={() => openVanSelection('tools')} /><MenuCard icon="✅" title="Control de inventario" text="Checklist de vans, conteo del depósito e historial." label="Abrir controles" onPress={() => openView('checks-menu')} /></View>{activeCheck ? <Card style={styles.noticeCard}><Text style={styles.cardTitle}>Control en progreso</Text><Button label="Continuar control" variant="success" onPress={continueActiveCheck} /></Card> : null}</> : null}

      {view === 'warehouse' ? <>
        <View style={styles.metrics}><Metric label="Valor del depósito" value={formatMoney(totalWarehouseValue)} icon="💰" /><Metric label="Artículos" value={String(module.warehouseItems.length)} icon="📦" /><Metric label="Reposición" value={String(lowStock.length)} icon="⚠️" warning /><Metric label="Power tools guardados" value={String(warehousePowerTools.length)} icon="🧰" /></View>
        <Card><SectionTitle title="Registrar artículo del depósito" /><View style={styles.formGrid}><Input style={styles.wideField} label="Nombre" value={warehouseDraft.name} onChangeText={(name) => setWarehouseDraft((draft) => ({ ...draft, name }))} /><Input style={styles.field} label="Categoría" value={warehouseDraft.category} onChangeText={(category) => setWarehouseDraft((draft) => ({ ...draft, category }))} /><Input style={styles.field} label="Unidad" value={warehouseDraft.unit} onChangeText={(unit) => setWarehouseDraft((draft) => ({ ...draft, unit }))} /><Input style={styles.field} keyboardType="numeric" label="Cantidad inicial" value={warehouseDraft.quantity} onChangeText={(quantity) => setWarehouseDraft((draft) => ({ ...draft, quantity }))} /><Input style={styles.field} keyboardType="numeric" label="Mínimo" value={warehouseDraft.minimum} onChangeText={(minimum) => setWarehouseDraft((draft) => ({ ...draft, minimum }))} /><Input style={styles.field} keyboardType="numeric" label="Costo unitario Afl." value={warehouseDraft.cost} onChangeText={(cost) => setWarehouseDraft((draft) => ({ ...draft, cost }))} /><Input style={styles.wideField} label="Ubicación" value={warehouseDraft.location} onChangeText={(location) => setWarehouseDraft((draft) => ({ ...draft, location }))} /></View><Button label="Agregar al depósito" disabled={module.busy} onPress={() => void registerWarehouseItem()} /></Card>
        <Card><SectionTitle title="Existencias del depósito" />{module.warehouseItems.length ? module.warehouseItems.map((item) => <WarehouseItemRow key={item.id} item={item} disabled={module.busy} onSave={module.saveWarehouseItem} />) : <EmptyState icon="📦" title="Sin artículos" message="Registra o importa el inventario del depósito." />}</Card>
        <Card><SectionTitle title="Power tools en depósito o reparación" subtitle="Conservan su historial y pueden regresar a cualquier van." />{warehousePowerTools.length ? warehousePowerTools.map((asset) => <View key={asset.id} style={styles.assetCard}><AssetSummary asset={asset} catalog={module.catalogById[asset.toolCatalogId]} /><View style={styles.optionRow}><Button compact variant="secondary" label="Transferir a una van" onPress={() => setTransferAsset(asset)} /><Button compact variant="danger" label="Retirar definitivamente" onPress={() => openLifecycle(asset)} /></View></View>) : <EmptyState icon="🧰" title="Sin power tools guardados" message="Las herramientas enviadas al depósito o reparación aparecerán aquí." />}</Card>
      </> : null}

      {view === 'van-select' ? <VanSelection vans={module.vans} assets={module.vanAssets} title="Selecciona la van que deseas administrar" subtitle="Entrarás exclusivamente al perfil seleccionado." label="Abrir perfil" onSelect={(vanId) => selectVan(vanId, 'tools')} /> : null}

      {view === 'van-profile' && selectedVan ? <>
        <VanBanner van={selectedVan} mode="tools" />
        <View style={styles.metrics}><Metric label="Unidades disponibles" value={String(physicalToolCount)} icon="🧰" /><Metric label="Valor disponible" value={formatMoney(vanValue)} icon="💰" /><Metric label="Pendientes de reemplazo" value={String(replacementCount)} icon="⚠️" warning /></View>
        <Card><SectionTitle title={`Registrar herramienta en ${selectedVan.name}`} subtitle="Selecciona una categoría y el tipo de control." /><View style={styles.modeGrid}><ModeCard active={trackingMode === 'individual'} title="Control individual" text="Una foto e historial por power tool." onPress={() => setTrackingMode('individual')} /><ModeCard active={trackingMode === 'quantity'} title="Control por cantidad" text="Conteo para herramientas pequeñas." onPress={() => setTrackingMode('quantity')} /></View><Input label="Nombre de la herramienta" value={toolName} onChangeText={setToolName} /><Text style={styles.smallLabel}>CATEGORÍA</Text><View style={styles.optionRow}><Button compact variant={toolCategory === 'Power Tools' ? 'primary' : 'secondary'} label="Power Tools" onPress={() => setToolCategory('Power Tools')} /><Button compact variant={toolCategory === 'Hand Tools' ? 'primary' : 'secondary'} label="Hand Tools" onPress={() => setToolCategory('Hand Tools')} /></View><View style={styles.formGrid}><Input style={styles.field} keyboardType="numeric" label="Costo por unidad Afl." value={toolCost} onChangeText={setToolCost} /><Input style={styles.field} keyboardType="numeric" label="Cantidad en esta van" value={toolQuantity} onChangeText={setToolQuantity} /><Input style={styles.field} keyboardType="numeric" label="Cantidad estándar recomendada" value={recommendedQuantity} onChangeText={setRecommendedQuantity} /></View><Text style={styles.smallLabel}>ESTADO INICIAL</Text><View style={styles.optionRow}>{CONDITIONS.map((condition) => <Button key={condition} compact variant={toolCondition === condition ? 'primary' : 'secondary'} label={condition} onPress={() => setToolCondition(condition)} />)}</View><PhotoSlots title={trackingMode === 'individual' ? 'Fotografía obligatoria por unidad' : 'Fotografía general obligatoria'} slots={toolPhotos} mode={trackingMode} onCamera={(index) => void replacePhoto(toolPhotos, setToolPhotos, index, true)} onGallery={(index) => void replacePhoto(toolPhotos, setToolPhotos, index, false)} /><Button label={module.busy || photoBusyId ? 'Guardando…' : `Registrar en ${selectedVan.name}`} disabled={module.busy || Boolean(photoBusyId)} onPress={() => void registerTool()} /></Card>
        <Card><SectionTitle title={`Catálogo de ${selectedVan.name}`} subtitle="Las herramientas reales pueden retirarse sin borrar su historial." />{module.toolCatalog.filter((catalog) => catalog.active !== false).map((catalog) => {
          const assets = selectedAssets.filter((asset) => asset.toolCatalogId === catalog.id);
          const available = availableQuantity(assets, catalog);
          const recommended = Number(catalog.recommendedQuantity ?? 1);
          const shortage = Math.max(0, recommended - available);
          return <View key={catalog.id} style={styles.catalogGroup}><View style={styles.catalogHeader}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{catalog.name}</Text><Text style={styles.cardText}>{catalog.category} · {formatMoney(catalog.standardCost)} por unidad</Text><Text style={[styles.catalogStats, shortage > 0 && styles.shortageText]}>Disponibles: {available} · Estándar: {recommended} · {shortage ? `Faltan ${shortage}` : 'Completo'}</Text></View><Pill label={(catalog.trackingMode ?? 'individual') === 'individual' ? 'Individual' : 'Por cantidad'} tone="info" /><Button compact variant={shortage ? 'success' : 'secondary'} label={shortage ? `Asignar reemplazo (${shortage})` : 'Asignar ahora'} onPress={() => openAddUnits(catalog, shortage || 1, shortage > 0)} /></View>{assets.length ? assets.map((asset) => <AssetEditorCard key={asset.id} asset={asset} catalog={catalog} evidence={module.evidence.filter((photo) => photo.entityId === asset.id)} busy={module.busy || photoBusyId === asset.id} onSave={async (updated) => { const result = await module.saveVanAsset(updated); setMessage(result.ok ? 'Herramienta actualizada.' : result.message ?? 'No se pudo actualizar.'); }} onPhoto={() => void captureAssetPhoto(asset)} onTransfer={() => setTransferAsset(asset)} onLifecycle={() => openLifecycle(asset)} />) : <View style={styles.unassignedBox}><Text style={styles.cardText}>No asignada a esta van.</Text></View>}</View>;
        })}{!module.toolCatalog.length ? <EmptyState icon="🧰" title="Sin herramientas" message={`Registra la primera herramienta de ${selectedVan.name}.`} /> : null}</Card>
        <Card><SectionTitle title={`Historial de herramientas retiradas de ${selectedVan.name}`} subtitle="Estos activos ya no cuentan en el inventario activo, pero conservan su información." />{retiredForSelectedVan.length ? retiredForSelectedVan.map((asset) => <RetiredAssetCard key={asset.id} asset={asset} catalog={module.catalogById[asset.toolCatalogId]} />) : <EmptyState icon="🗂️" title="Sin herramientas retiradas" message="Los activos retirados o desechados aparecerán aquí." />}</Card>
      </> : null}

      {view === 'checks-menu' ? <View style={styles.menuGrid}><MenuCard icon="🚐" title="Control de una van" text="Selecciona la van y confirma antes del checklist." label="Seleccionar van" onPress={() => openVanSelection('check')} /><MenuCard icon="📋" title="Conteo físico del depósito" text="Compara cantidades esperadas y encontradas." label="Preparar conteo" onPress={() => openView('warehouse-check-ready')} /><MenuCard icon="🕘" title="Historial de controles" text="Consulta faltantes y reemplazos." label="Ver historial" onPress={() => openView('check-history')} /></View> : null}
      {view === 'check-van-select' ? <VanSelection vans={module.vans} assets={module.vanAssets} title="Selecciona la van que vas a controlar" subtitle="La próxima pantalla confirmará claramente la van." label="Seleccionar para control" onSelect={(vanId) => selectVan(vanId, 'check')} /> : null}
      {view === 'check-van-ready' && selectedVan ? <><VanBanner van={selectedVan} mode="check" /><View style={styles.metrics}><Metric label="Unidades a revisar" value={String(physicalToolCount)} icon="🧰" /><Metric label="Valor a controlar" value={formatMoney(vanValue)} icon="💰" /><Metric label="Reemplazos actuales" value={String(replacementCount)} icon="⚠️" warning /></View><Card><Text style={styles.cardTitle}>Confirma antes de comenzar</Text><Text style={styles.cardText}>El checklist pertenece únicamente a {selectedVan.name}, placa {selectedVan.plate}.</Text><Button label={`Comenzar control de ${selectedVan.name}`} variant="success" disabled={module.busy || !selectedAssets.length} onPress={() => void startCheck('van')} /></Card></> : null}
      {view === 'warehouse-check-ready' ? <Card><SectionTitle title="Preparar conteo físico" /><Text style={styles.cardText}>{module.warehouseItems.length} artículos serán contados.</Text><Button label="Comenzar conteo del depósito" variant="success" disabled={module.busy || !module.warehouseItems.length} onPress={() => void startCheck('warehouse')} /></Card> : null}
      {view === 'check-active' && activeCheck ? <Card><SectionTitle title={activeCheck.scope === 'van' ? `Control de ${module.vans.find((van) => van.id === activeCheck.vanId)?.name ?? 'van'}` : 'Conteo físico del depósito'} /><View style={styles.checkProgress}><Pill label={`${activeEntries.filter((entry) => entry.status !== 'pending').length}/${activeEntries.length} revisados`} tone="info" /><Button compact variant="success" label="Finalizar control" disabled={module.busy} onPress={() => void finishCheck()} /></View>{activeCheck.scope === 'van' ? activeEntries.map((entry) => { const asset = module.vanAssets.find((candidate) => candidate.id === entry.assetId); if (!asset) return null; return (entry.trackingMode ?? asset.trackingMode ?? 'individual') === 'quantity' ? <QuantityCheckRow key={entry.id} entry={entry} asset={asset} disabled={module.busy} onSave={module.saveCheckEntry} onPhoto={() => void captureAssetPhoto(asset, entry)} /> : <IndividualCheckRow key={entry.id} entry={entry} asset={asset} photo={module.evidence.find((candidate) => candidate.id === entry.photoEvidenceId)} disabled={module.busy || photoBusyId === asset.id} onSave={module.saveCheckEntry} onPhoto={() => void captureAssetPhoto(asset, entry)} />; }) : activeEntries.map((entry) => <WarehouseCountRow key={entry.id} entry={entry} disabled={module.busy} onSave={async (countedQuantity) => { const result = await module.saveCheckEntry({ ...entry, countedQuantity, status: 'present' }); setMessage(result.ok ? `${entry.label}: conteo guardado.` : result.message ?? 'No se pudo guardar.'); }} />)}</Card> : null}
      {view === 'check-history' ? <Card><SectionTitle title="Historial de controles" />{completedChecks.length ? completedChecks.map((check) => <View key={check.id} style={styles.historyRow}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{check.scope === 'van' ? module.vans.find((van) => van.id === check.vanId)?.name ?? 'Van' : 'Depósito'}</Text><Text style={styles.cardText}>{check.completedAt ? new Date(check.completedAt).toLocaleString('es-AW') : ''}</Text></View>{check.scope === 'van' ? <><Pill label={`${check.missingCount ?? 0} faltantes`} tone={(check.missingCount ?? 0) ? 'danger' : 'success'} /><Pill label={`${check.replacementCount ?? 0} reemplazos`} tone={(check.replacementCount ?? 0) ? 'warning' : 'success'} /></> : <Pill label={`${check.varianceCount ?? 0} diferencias`} tone={(check.varianceCount ?? 0) ? 'warning' : 'success'} />}</View>) : <EmptyState icon="📝" title="Sin controles completados" message="Los controles finalizados aparecerán aquí." />}</Card> : null}

      <AppModal visible={Boolean(addCatalog)} title={addCatalog ? `Asignar ${addCatalog.name}` : 'Asignar herramienta'} onClose={() => { setAddCatalog(null); setReplacementAssignment(false); }}>{addCatalog ? <ScrollView keyboardShouldPersistTaps="handled"><Text style={styles.cardText}>Se asignará únicamente a {selectedVan?.name}.</Text><Input keyboardType="numeric" label="Cantidad a asignar" value={addQuantity} onChangeText={setAddQuantity} /><Text style={styles.smallLabel}>ESTADO INICIAL</Text><View style={styles.optionRow}>{CONDITIONS.map((condition) => <Button key={condition} compact variant={addCondition === condition ? 'primary' : 'secondary'} label={condition} onPress={() => setAddCondition(condition)} />)}</View><PhotoSlots title={(addCatalog.trackingMode ?? 'individual') === 'individual' ? 'Una fotografía por unidad' : 'Fotografía general'} slots={addPhotos} mode={addCatalog.trackingMode ?? 'individual'} onCamera={(index) => void replacePhoto(addPhotos, setAddPhotos, index, true)} onGallery={(index) => void replacePhoto(addPhotos, setAddPhotos, index, false)} /><Button label={module.busy || photoBusyId ? 'Guardando…' : `Asignar a ${selectedVan?.name ?? 'la van'}`} disabled={module.busy || Boolean(photoBusyId)} onPress={() => void addUnits()} /></ScrollView> : null}</AppModal>

      <AppModal visible={Boolean(transferAsset)} title="Transferir herramienta" onClose={() => setTransferAsset(null)}>{transferAsset ? <View style={{ gap: 12 }}><AssetSummary asset={transferAsset} catalog={module.catalogById[transferAsset.toolCatalogId]} /><Text style={styles.cardText}>El código permanece igual para conservar el historial.</Text><View style={styles.optionRow}>{module.vans.filter((van) => !assetIsInVan(transferAsset, van.id)).map((van) => <Button key={van.id} variant="secondary" label={van.name} onPress={() => void performTransfer(van.id)} />)}{!assetIsInWarehouse(transferAsset) ? <Button variant="secondary" label="Depósito" onPress={() => void performTransfer('warehouse')} /> : null}</View></View> : null}</AppModal>

      <AppModal visible={Boolean(lifecycleAsset)} title="Retirar, reparar o reportar herramienta" onClose={() => setLifecycleAsset(null)}>{lifecycleAsset ? <ScrollView keyboardShouldPersistTaps="handled"><AssetSummary asset={lifecycleAsset} catalog={module.catalogById[lifecycleAsset.toolCatalogId]} /><Text style={styles.smallLabel}>ACCIÓN</Text><View style={styles.optionRow}>{(lifecycleAsset.trackingMode ?? 'individual') === 'quantity' ? <Button compact variant="primary" label="Retirar cantidad" onPress={() => setLifecycleAction('quantity-retire')} /> : <><Button compact variant={lifecycleAction === 'repair' ? 'primary' : 'secondary'} label="Enviar a reparación" onPress={() => setLifecycleAction('repair')} /><Button compact variant={lifecycleAction === 'missing' ? 'primary' : 'secondary'} label="Marcar faltante" onPress={() => setLifecycleAction('missing')} /><Button compact variant={lifecycleAction === 'retire' ? 'danger' : 'secondary'} label="Retirar definitivamente" onPress={() => setLifecycleAction('retire')} /></>}</View>{lifecycleAction === 'quantity-retire' ? <Input keyboardType="numeric" label="Cantidad que sale de circulación" value={lifecycleQuantity} onChangeText={setLifecycleQuantity} /> : null}{lifecycleAction === 'retire' || lifecycleAction === 'quantity-retire' ? <><Text style={styles.smallLabel}>DESTINO FINAL</Text><View style={styles.optionRow}>{RETIREMENT_DISPOSITIONS.map((disposition) => <Button key={disposition} compact variant={lifecycleDisposition === disposition ? 'primary' : 'secondary'} label={disposition} onPress={() => setLifecycleDisposition(disposition)} />)}</View></> : null}<Input multiline label="Motivo obligatorio" value={lifecycleReason} onChangeText={setLifecycleReason} placeholder="Ej. Motor quemado, no tiene reparación, no apareció en el inventario…" /><Text style={styles.smallLabel}>{lifecycleAction === 'retire' || lifecycleAction === 'quantity-retire' ? 'FOTOGRAFÍA FINAL OBLIGATORIA' : 'FOTOGRAFÍA OPCIONAL'}</Text>{lifecyclePhoto ? <Image source={{ uri: lifecyclePhoto.uri }} style={styles.lifecyclePhoto} /> : null}<View style={styles.optionRow}><Button compact variant="secondary" label="Cámara" onPress={async () => setLifecyclePhoto(await pickPhoto(true))} /><Button compact variant="secondary" label="Galería" onPress={async () => setLifecyclePhoto(await pickPhoto(false))} /></View><Button variant={lifecycleAction === 'retire' || lifecycleAction === 'quantity-retire' ? 'danger' : 'success'} label={photoBusyId ? 'Guardando…' : 'Confirmar acción'} disabled={Boolean(photoBusyId) || !lifecycleReason.trim()} onPress={() => void applyLifecycle()} /></ScrollView> : null}</AppModal>
    </ScrollView>
  );
}

function inventoryHeader(view: InventoryView, selectedVanName?: string, activeCheckVanName?: string) {
  if (view === 'menu') return { title: 'Inventario DEMAC', subtitle: 'Selecciona una operación para continuar paso a paso.' };
  if (view === 'warehouse') return { title: 'Inventario del depósito', subtitle: 'Existencias, valores y power tools guardados.' };
  if (view === 'van-select') return { title: 'Herramientas por van', subtitle: 'Paso 1 de 2: selecciona la van.' };
  if (view === 'van-profile') return { title: `Perfil de ${selectedVanName ?? 'la van'}`, subtitle: 'Paso 2 de 2: administra únicamente la van seleccionada.' };
  if (view === 'checks-menu') return { title: 'Control de inventario', subtitle: 'Selecciona el tipo de control.' };
  if (view === 'check-van-select') return { title: 'Control de una van', subtitle: 'Paso 1 de 2: selecciona la van.' };
  if (view === 'check-van-ready') return { title: `Preparar control de ${selectedVanName ?? 'la van'}`, subtitle: 'Paso 2 de 2: confirma antes de comenzar.' };
  if (view === 'warehouse-check-ready') return { title: 'Preparar conteo del depósito', subtitle: 'Confirma el alcance antes de iniciar.' };
  if (view === 'check-active') return { title: activeCheckVanName ? `Control activo · ${activeCheckVanName}` : 'Control activo · Depósito', subtitle: 'Completa el checklist y finaliza.' };
  return { title: 'Historial de controles', subtitle: 'Consulta los controles finalizados.' };
}

function MenuCard({ icon, title, text, label, onPress }: { icon: string; title: string; text: string; label: string; onPress: () => void }) { return <Card style={styles.menuCard}><Text style={styles.menuIcon}>{icon}</Text><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardText}>{text}</Text><Button label={label} onPress={onPress} /></Card>; }
function ModeCard({ active, title, text, onPress }: { active: boolean; title: string; text: string; onPress: () => void }) { return <Card style={[styles.modeCard, active && styles.modeCardActive]}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardText}>{text}</Text><Button compact variant={active ? 'primary' : 'secondary'} label={active ? 'Seleccionado' : 'Seleccionar'} onPress={onPress} /></Card>; }
function PhotoSlots({ title, slots, mode, onCamera, onGallery }: { title: string; slots: Array<PendingPhoto | null>; mode: ToolTrackingMode; onCamera: (index: number) => void; onGallery: (index: number) => void }) { return <View style={styles.photoSection}><Text style={styles.smallLabel}>{title.toUpperCase()}</Text><View style={styles.photoGrid}>{slots.map((photo, index) => <View key={index} style={styles.photoSlot}>{photo ? <Image source={{ uri: photo.uri }} style={styles.preview} /> : <View style={styles.photoPlaceholder}><Text>{mode === 'individual' ? `Unidad ${index + 1}` : 'Foto general'}</Text></View>}<View style={styles.optionRow}><Button compact variant="secondary" label="Cámara" onPress={() => onCamera(index)} /><Button compact variant="secondary" label="Galería" onPress={() => onGallery(index)} /></View></View>)}</View></View>; }
function VanSelection({ vans, assets, title, subtitle, label, onSelect }: { vans: Van[]; assets: VanToolAssetV2[]; title: string; subtitle: string; label: string; onSelect: (vanId: string) => void }) { return <Card><SectionTitle title={title} subtitle={subtitle} /><View style={styles.vanGrid}>{vans.map((van) => { const vanAssets = assets.filter((asset) => assetIsInVan(asset, van.id) && !isRetired(asset)); return <View key={van.id} style={styles.vanCard}><Text style={styles.menuIcon}>🚐</Text><Text style={styles.cardTitle}>{van.name}</Text><Text style={styles.cardText}>Placa {van.plate} · {van.status}</Text><Text style={styles.catalogStats}>{vanAssets.length} registros</Text><Button label={`${label}: ${van.name}`} onPress={() => onSelect(van.id)} /></View>; })}</View></Card>; }
function VanBanner({ van, mode }: { van: Van; mode: 'tools' | 'check' }) { return <Card style={styles.banner}><View style={styles.bannerTop}><Text style={styles.menuIcon}>🚐</Text><View style={{ flex: 1 }}><Text style={styles.eyebrow}>{mode === 'tools' ? 'PERFIL DE VAN ACTIVO' : 'VAN SELECCIONADA PARA CONTROL'}</Text><Text style={styles.bannerName}>{van.name}</Text><Text style={styles.cardText}>Placa {van.plate} · {van.status}</Text></View><Pill label={mode === 'tools' ? 'Perfil activo' : 'Confirmada'} tone="info" /></View></Card>; }
function AssetSummary({ asset, catalog }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2 }) { return <View style={styles.assetTop}>{asset.latestPhotoUrl ? <Image source={{ uri: asset.latestPhotoUrl }} style={styles.assetImage} /> : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>}<View style={{ flex: 1 }}><Text style={styles.assetCode}>{asset.assetCode}</Text><Text style={styles.cardTitle}>{catalog?.name ?? asset.toolCatalogId}</Text><Text style={styles.cardText}>{catalog?.category ?? 'Herramienta'} · {formatMoney(asset.purchaseCost)}</Text></View><Pill label={asset.operationalStatus ?? 'Disponible'} tone={statusTone(asset.operationalStatus)} /></View>; }

function AssetEditorCard({ asset, catalog, evidence, busy, onSave, onPhoto, onTransfer, onLifecycle }: { asset: VanToolAssetV2; catalog: ToolCatalogItemV2; evidence: InventoryEvidenceV2[]; busy: boolean; onSave: (asset: VanToolAssetV2) => Promise<void>; onPhoto: () => void; onTransfer: () => void; onLifecycle: () => void }) {
  const [condition, setCondition] = useState<ToolConditionV2>(asset.condition);
  const [status, setStatus] = useState<ToolOperationalStatus>(asset.operationalStatus ?? 'Disponible');
  const [notes, setNotes] = useState(asset.notes ?? '');
  const [expected, setExpected] = useState(String(asset.quantityExpected ?? 1));
  const [present, setPresent] = useState(String(asset.quantityPresent ?? asset.quantityExpected ?? 1));
  useEffect(() => { setCondition(asset.condition); setStatus(asset.operationalStatus ?? 'Disponible'); setNotes(asset.notes ?? ''); setExpected(String(asset.quantityExpected ?? 1)); setPresent(String(asset.quantityPresent ?? asset.quantityExpected ?? 1)); }, [asset]);
  const quantityMode = (asset.trackingMode ?? catalog.trackingMode ?? 'individual') === 'quantity';
  return <View style={styles.assetCard}><AssetSummary asset={asset} catalog={catalog} />{quantityMode ? <View style={styles.formGrid}><Input style={styles.field} keyboardType="numeric" label="Cantidad asignada" value={expected} onChangeText={setExpected} /><Input style={styles.field} keyboardType="numeric" label="Cantidad presente" value={present} onChangeText={setPresent} /></View> : null}<Text style={styles.smallLabel}>CONDICIÓN</Text><View style={styles.optionRow}>{CONDITIONS.map((candidate) => <Button key={candidate} compact variant={condition === candidate ? 'primary' : 'secondary'} label={candidate} onPress={() => setCondition(candidate)} />)}</View>{!['Faltante', 'En reparación'].includes(asset.operationalStatus ?? '') ? <><Text style={styles.smallLabel}>ESTADO OPERATIVO</Text><View style={styles.optionRow}>{EDITABLE_STATUSES.map((candidate) => <Button key={candidate} compact variant={status === candidate ? 'primary' : 'secondary'} label={candidate} onPress={() => setStatus(candidate)} />)}</View></> : null}<Input multiline label="Observación, daño o anomalía" value={notes} onChangeText={setNotes} /><View style={styles.optionRow}><Button compact variant="success" label={busy ? 'Guardando…' : 'Guardar cambios'} disabled={busy} onPress={() => void onSave({ ...asset, condition, operationalStatus: status, notes: notes.trim(), quantityExpected: quantityMode ? Math.max(0, Number(expected || 0)) : 1, quantityPresent: quantityMode ? Math.max(0, Number(present || 0)) : asset.present === false ? 0 : 1 })} /><Button compact variant="secondary" label="Nueva foto" disabled={busy} onPress={onPhoto} />{!quantityMode ? <Button compact variant="secondary" label="Transferir" disabled={busy} onPress={onTransfer} /> : null}<Button compact variant="danger" label="Retirar / reparar" disabled={busy} onPress={onLifecycle} /></View>{evidence.length ? <ScrollView horizontal contentContainerStyle={styles.historyStrip}>{evidence.map((photo) => <View key={photo.id}><Image source={{ uri: photo.downloadUrl }} style={styles.historyImage} /><Text style={styles.historyDate}>{new Date(photo.capturedAt).toLocaleDateString('es-AW')}</Text></View>)}</ScrollView> : null}</View>;
}

function RetiredAssetCard({ asset, catalog }: { asset: VanToolAssetV2; catalog?: ToolCatalogItemV2 }) { return <View style={styles.retiredCard}><AssetSummary asset={asset} catalog={catalog} /><Text style={styles.cardText}>{asset.retiredAt ? new Date(asset.retiredAt).toLocaleString('es-AW') : ''} · {asset.retiredDisposition ?? asset.operationalStatus}</Text>{asset.retiredReason ? <Text style={styles.retiredReason}>{asset.retiredReason}</Text> : null}{asset.lifecycleHistory?.length ? <View style={styles.lifecycleList}>{asset.lifecycleHistory.slice().reverse().map((event) => <Text key={event.id} style={styles.lifecycleText}>• {new Date(event.occurredAt).toLocaleDateString('es-AW')} — {lifecycleLabel(event.action)}{event.reason ? `: ${event.reason}` : ''}</Text>)}</View> : null}</View>; }
function lifecycleLabel(action: ToolLifecycleAction) { const labels: Record<ToolLifecycleAction, string> = { registered: 'Registrada', transferred: 'Transferida', sent_to_repair: 'Enviada a reparación', returned_to_service: 'Regresó a servicio', marked_missing: 'Marcada faltante', retired: 'Retirada', discarded: 'Desechada', quantity_retired: 'Cantidad retirada', replacement_assigned: 'Reemplazo asignado' }; return labels[action]; }
function WarehouseItemRow({ item, disabled, onSave }: { item: WarehouseInventoryItemV2; disabled: boolean; onSave: (item: WarehouseInventoryItemV2) => Promise<{ ok: boolean; message?: string }> }) { const low = Number(item.quantity) <= Number(item.minimum); return <View style={[styles.inventoryRow, low && styles.warningRow]}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.cardText}>{item.category} · {item.location}</Text></View><Text style={styles.valueText}>{item.quantity} · {formatMoney(item.quantity * item.cost)}</Text><View style={styles.optionRow}><Button compact variant="secondary" label="−" disabled={disabled} onPress={() => void onSave({ ...item, quantity: Math.max(0, item.quantity - 1) })} /><Button compact variant="secondary" label="＋" disabled={disabled} onPress={() => void onSave({ ...item, quantity: item.quantity + 1 })} /></View></View>; }
function IndividualCheckRow({ entry, asset, photo, disabled, onSave, onPhoto }: { entry: InventoryCheckEntryV2; asset: VanToolAssetV2; photo?: InventoryEvidenceV2; disabled: boolean; onSave: (entry: InventoryCheckEntryV2) => Promise<{ ok: boolean; message?: string }>; onPhoto: () => void }) { return <View style={styles.checkRow}><View style={{ flex: 1 }}><Text style={styles.assetCode}>{entry.assetCode}</Text><Text style={styles.cardTitle}>{entry.label}</Text></View>{photo ? <Image source={{ uri: photo.downloadUrl }} style={styles.checkPhoto} /> : null}<View style={styles.optionRow}><Button compact variant="success" label="Presente" disabled={disabled} onPress={() => void onSave({ ...entry, status: 'present', countedQuantity: 1, operationalStatus: 'Disponible' })} /><Button compact variant="danger" label="Faltante" disabled={disabled} onPress={() => void onSave({ ...entry, status: 'missing', countedQuantity: 0, photoEvidenceId: undefined, operationalStatus: 'Faltante' })} /><Button compact variant="secondary" label="Foto" disabled={disabled || entry.status === 'missing'} onPress={onPhoto} /></View></View>; }
function QuantityCheckRow({ entry, asset, disabled, onSave, onPhoto }: { entry: InventoryCheckEntryV2; asset: VanToolAssetV2; disabled: boolean; onSave: (entry: InventoryCheckEntryV2) => Promise<{ ok: boolean; message?: string }>; onPhoto: () => void }) { const [value, setValue] = useState(entry.countedQuantity === undefined ? '' : String(entry.countedQuantity)); const expected = Number(entry.expectedQuantity ?? asset.quantityExpected ?? 0); return <View style={styles.checkRow}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{entry.label}</Text><Text style={styles.cardText}>Esperadas: {expected}</Text></View><Input style={{ width: 140 }} keyboardType="numeric" label="Encontradas" value={value} onChangeText={setValue} /><Button compact variant="success" label="Guardar" disabled={disabled || value === ''} onPress={() => void onSave({ ...entry, countedQuantity: Math.max(0, Number(value || 0)), status: Number(value || 0) > 0 ? 'present' : 'missing' })} /><Button compact variant="secondary" label="Foto" disabled={disabled} onPress={onPhoto} /></View>; }
function WarehouseCountRow({ entry, disabled, onSave }: { entry: InventoryCheckEntryV2; disabled: boolean; onSave: (counted: number) => void }) { const [value, setValue] = useState(entry.countedQuantity === undefined ? '' : String(entry.countedQuantity)); return <View style={styles.checkRow}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{entry.label}</Text><Text style={styles.cardText}>Sistema: {entry.expectedQuantity ?? 0}</Text></View><Input style={{ width: 140 }} keyboardType="numeric" label="Cantidad" value={value} onChangeText={setValue} /><Button compact label="Guardar" disabled={disabled || value === ''} onPress={() => onSave(Math.max(0, Number(value || 0)))} /></View>; }
function Metric({ label, value, icon, warning }: { label: string; value: string; icon: string; warning?: boolean }) { return <Card style={styles.metric}><Text style={styles.metricIcon}>{icon}</Text><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, warning && { color: colors.warning }]}>{value}</Text></Card>; }
function statusTone(status?: ToolOperationalStatus): 'neutral' | 'success' | 'warning' | 'danger' | 'info' { if (status === 'Disponible') return 'success'; if (status === 'Prestada' || status === 'En reparación' || status === 'En depósito') return 'warning'; if (status === 'Faltante' || status === 'Desechada') return 'danger'; if (status === 'Retirada') return 'neutral'; return 'info'; }

const styles = StyleSheet.create({
  page: { padding: 24, gap: 16, paddingBottom: 90, backgroundColor: colors.background },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, menuCard: { flex: 1, minWidth: 230, gap: 9 }, menuIcon: { fontSize: 28 },
  cardTitle: { color: colors.text, fontWeight: '900', fontSize: 14 }, cardText: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  messageBox: { backgroundColor: colors.successLight, padding: 11, borderRadius: 8 }, messageText: { color: colors.success, fontWeight: '800' }, errorBox: { backgroundColor: colors.dangerLight, padding: 11, borderRadius: 8 }, errorText: { color: colors.danger, fontWeight: '800' }, noticeCard: { gap: 10 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, metric: { flex: 1, minWidth: 150, gap: 5 }, metricIcon: { fontSize: 22 }, metricLabel: { color: colors.muted, fontSize: 10, fontWeight: '800' }, metricValue: { color: colors.text, fontWeight: '900', fontSize: 18 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, field: { flex: 1, minWidth: 150 }, wideField: { flex: 2, minWidth: 230 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' }, smallLabel: { color: colors.text, fontSize: 10, fontWeight: '900', marginTop: 10, marginBottom: 7 },
  modeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 }, modeCard: { flex: 1, minWidth: 210, gap: 8 }, modeCardActive: { borderColor: colors.primary, backgroundColor: '#F5F9FF' },
  photoSection: { marginVertical: 12 }, photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, photoSlot: { width: 180, gap: 7 }, preview: { width: 180, height: 120, borderRadius: 9 }, photoPlaceholder: { width: 180, height: 120, borderRadius: 9, backgroundColor: '#EEF1F5', alignItems: 'center', justifyContent: 'center' },
  vanGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, vanCard: { width: 220, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, gap: 7 },
  banner: { backgroundColor: '#F5F9FF', borderColor: colors.primary }, bannerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 }, bannerName: { color: colors.primaryDark, fontWeight: '900', fontSize: 20 }, eyebrow: { color: colors.primary, fontWeight: '900', fontSize: 9 },
  catalogGroup: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, marginTop: 14 }, catalogHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9 }, catalogStats: { color: colors.info, fontWeight: '800', fontSize: 10, marginTop: 5 }, shortageText: { color: colors.danger }, unassignedBox: { padding: 12, backgroundColor: '#F7F8FA', borderRadius: 8, marginTop: 9 },
  assetCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginTop: 10, gap: 10 }, assetTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, assetImage: { width: 72, height: 72, borderRadius: 8 }, assetImagePlaceholder: { width: 72, height: 72, borderRadius: 8, backgroundColor: '#EEF1F5', alignItems: 'center', justifyContent: 'center' }, assetCode: { color: colors.primary, fontWeight: '900', fontSize: 10 },
  historyStrip: { gap: 8 }, historyImage: { width: 90, height: 70, borderRadius: 7 }, historyDate: { color: colors.muted, fontSize: 8, marginTop: 3 },
  retiredCard: { borderWidth: 1, borderColor: '#D6D8DC', borderRadius: 10, padding: 12, gap: 8, marginTop: 10, backgroundColor: '#FAFAFA' }, retiredReason: { color: colors.text, fontSize: 11, fontWeight: '700' }, lifecycleList: { gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }, lifecycleText: { color: colors.muted, fontSize: 9, lineHeight: 14 },
  inventoryRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }, warningRow: { backgroundColor: colors.warningLight }, valueText: { color: colors.text, fontWeight: '900' },
  checkProgress: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }, checkRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }, checkPhoto: { width: 68, height: 54, borderRadius: 7 }, historyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  lifecyclePhoto: { width: '100%', height: 220, borderRadius: 10, marginVertical: 8 },
});
