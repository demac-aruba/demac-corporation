import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, formatMoney, Input, Pill, SectionTitle } from '../components/UI';
import { useInventoryModule } from '../hooks/useInventoryModule';
import { InventoryCheckEntry, InventoryEvidence, ToolCondition, VanToolAsset, WarehouseInventoryItem } from '../inventory/types';
import { uploadInventoryImage } from '../services/inventoryStorage';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';

const CONDITIONS: ToolCondition[] = ['Nueva', 'Poco uso', 'Uso medio', 'Muy usada', 'Requiere reemplazo'];

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

export function InventoryScreen() {
  const { currentUser, inventory: fallbackInventory, vans: fallbackVans } = useAppState();
  const module = useInventoryModule(currentUser, fallbackInventory, fallbackVans);
  const [view, setView] = useState<InventoryView>('menu');
  const [selectedVanId, setSelectedVanId] = useState('');
  const [message, setMessage] = useState('');
  const [warehouseDraft, setWarehouseDraft] = useState<WarehouseDraft>(emptyWarehouseDraft);
  const [toolName, setToolName] = useState('');
  const [toolCategory, setToolCategory] = useState('Herramientas');
  const [toolCost, setToolCost] = useState('0');
  const [toolCondition, setToolCondition] = useState<ToolCondition>('Nueva');
  const [newToolPhoto, setNewToolPhoto] = useState<PendingPhoto | null>(null);
  const [activeCheckId, setActiveCheckId] = useState('');
  const [photoBusyId, setPhotoBusyId] = useState('');

  const selectedVan = module.vans.find((van) => van.id === selectedVanId);
  const selectedAssets = module.vanAssets.filter((asset) => asset.vanId === selectedVanId);
  const assignedAssets = selectedAssets.filter((asset) => asset.assigned);
  const activeCheck = module.checks.find((check) => check.id === activeCheckId)
    ?? module.checks.find((check) => check.status === 'draft');
  const activeEntries = activeCheck ? module.entries.filter((entry) => entry.checkId === activeCheck.id) : [];
  const completedChecks = module.checks.filter((check) => check.status === 'completed');
  const totalWarehouseValue = module.warehouseItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.cost), 0);
  const lowStock = module.warehouseItems.filter((item) => item.active !== false && Number(item.quantity) <= Number(item.minimum));
  const vanValue = assignedAssets.reduce((sum, asset) => sum + Number(asset.purchaseCost), 0);
  const replacementAssets = assignedAssets.filter((asset) => asset.condition === 'Requiere reemplazo');

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
    const item: WarehouseInventoryItem = {
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

  async function registerTool() {
    if (!selectedVanId || !toolName.trim()) {
      setMessage('Selecciona una van y escribe el nombre de la herramienta.');
      return;
    }
    if (!newToolPhoto) {
      setMessage('La fotografía inicial de la herramienta es obligatoria.');
      return;
    }
    const created = await module.createTool({
      name: toolName,
      category: toolCategory,
      standardCost: Math.max(0, Number(toolCost || 0)),
      initialVanId: selectedVanId,
      condition: toolCondition,
    });
    if (!created.result.ok || !created.asset || !currentUser) {
      setMessage(created.result.message ?? 'No se pudo crear la herramienta.');
      return;
    }
    try {
      setPhotoBusyId(created.asset.id);
      const evidenceId = `inventory-photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const stored = await uploadInventoryImage({ ...newToolPhoto, scope: 'van-tool', entityId: created.asset.id, evidenceId });
      const now = new Date().toISOString();
      const evidence: InventoryEvidence = {
        id: evidenceId, entityType: 'van_tool', entityId: created.asset.id, phase: 'initial', ...stored,
        capturedAt: now, uploadedAt: now, uploadedByUserId: currentUser.id, uploadedByName: currentUser.name,
        condition: toolCondition,
      };
      await module.saveInventoryEvidence(evidence);
      await module.saveVanAsset({
        ...created.asset,
        latestPhotoUrl: stored.downloadUrl,
        latestPhotoStoragePath: stored.storagePath,
        latestPhotoAt: now,
      });
      setToolName('');
      setToolCost('0');
      setToolCondition('Nueva');
      setNewToolPhoto(null);
      setMessage(`Herramienta creada y asignada a ${selectedVan?.name ?? 'la van'}. En las demás vans quedó como No asignada.`);
    } catch (cause) {
      setMessage(`La herramienta fue creada, pero la foto no pudo guardarse: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPhotoBusyId('');
    }
  }

  async function captureAssetPhoto(asset: VanToolAsset, entry?: InventoryCheckEntry) {
    if (!currentUser) return;
    const selected = await pickPhoto(true);
    if (!selected) return;
    setPhotoBusyId(asset.id);
    try {
      const evidenceId = `inventory-photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const stored = await uploadInventoryImage({ ...selected, scope: 'van-tool', entityId: asset.id, evidenceId });
      const now = new Date().toISOString();
      const evidence: InventoryEvidence = {
        id: evidenceId, entityType: 'van_tool', entityId: asset.id, checkId: entry?.checkId,
        phase: entry ? 'control' : 'initial', ...stored, capturedAt: now, uploadedAt: now,
        uploadedByUserId: currentUser.id, uploadedByName: currentUser.name, condition: entry?.condition ?? asset.condition,
      };
      const saved = await module.saveInventoryEvidence(evidence);
      if (!saved.ok) throw new Error(saved.message);
      await module.saveVanAsset({ ...asset, latestPhotoUrl: stored.downloadUrl, latestPhotoStoragePath: stored.storagePath, latestPhotoAt: now });
      if (entry) await module.saveCheckEntry({ ...entry, photoEvidenceId: evidenceId, status: 'present' });
      setMessage('Fotografía agregada al historial de la herramienta.');
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
              <View style={styles.menuCardTop}>
                <Text style={styles.menuIcon}>⏳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuCardTitle}>Hay un control en progreso</Text>
                  <Text style={styles.menuCardText}>
                    {activeCheck.scope === 'van'
                      ? `Control de ${module.vans.find((van) => van.id === activeCheck.vanId)?.name ?? 'van'}`
                      : 'Conteo físico del depósito'}
                  </Text>
                </View>
                <Pill label="Pendiente" tone="warning" />
              </View>
              <Button label="Continuar control" variant="success" onPress={continueActiveCheck} />
            </Card>
          ) : null}
          <View style={styles.menuGrid}>
            <ModuleMenuCard
              icon="📦"
              title="Inventario del depósito"
              description="Consulta existencias, registra artículos, revisa mínimos y valores."
              buttonLabel="Abrir depósito"
              onPress={() => openView('warehouse')}
            />
            <ModuleMenuCard
              icon="🚐"
              title="Herramientas por van"
              description="Primero selecciona una van y luego entra exclusivamente a su perfil."
              buttonLabel="Seleccionar van"
              onPress={() => openVanSelection('tools')}
            />
            <ModuleMenuCard
              icon="✅"
              title="Control de inventario"
              description="Realiza un control de van, un conteo del depósito o consulta el historial."
              buttonLabel="Abrir controles"
              onPress={() => openView('checks-menu')}
            />
          </View>
        </>
      ) : null}

      {view === 'warehouse' ? (
        <>
          <View style={styles.metrics}>
            <Metric label="Valor del depósito" value={formatMoney(totalWarehouseValue)} icon="💰" />
            <Metric label="Artículos" value={String(module.warehouseItems.length)} icon="📦" />
            <Metric label="Reposición" value={String(lowStock.length)} icon="⚠️" warning />
          </View>
          {!module.warehouseItems.length ? (
            <Card>
              <EmptyState icon="📦" title="Depósito sin artículos" message="Importa el inventario base o registra los artículos manualmente." />
              <Button label={module.busy ? 'Importando…' : 'Importar inventario base actual'} disabled={module.busy} onPress={async () => { const result = await module.importFallbackWarehouse(); setMessage(result.message ?? 'Importación finalizada.'); }} />
            </Card>
          ) : null}
          <Card>
            <SectionTitle title="Registrar artículo del depósito" subtitle="Equipos, refrigerantes, cables, consumibles, piezas y materiales." />
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
            <SectionTitle title="Existencias del depósito" subtitle="Para realizar un conteo físico, regresa al menú y selecciona Control de inventario." />
            {module.warehouseItems.length ? module.warehouseItems.map((item) => {
              const low = Number(item.quantity) <= Number(item.minimum);
              return (
                <View key={item.id} style={[styles.inventoryRow, low && styles.warningRow]}>
                  <View style={{ flex: 1, minWidth: 200 }}><Text style={styles.itemTitle}>{item.name}</Text><Text style={styles.itemMeta}>{item.category} · {item.location} · por {item.unit}</Text></View>
                  <View style={styles.quantityBox}><Text style={styles.quantity}>{item.quantity}</Text><Text style={styles.quantityLabel}>actual</Text></View>
                  <Text style={styles.valueText}>{formatMoney(item.quantity * item.cost)}</Text>
                  <View style={styles.rowActions}>
                    <Button compact variant="secondary" label="−" disabled={module.busy} onPress={() => void module.saveWarehouseItem({ ...item, quantity: Math.max(0, item.quantity - 1) })} />
                    <Button compact variant="secondary" label="＋" disabled={module.busy} onPress={() => void module.saveWarehouseItem({ ...item, quantity: item.quantity + 1 })} />
                  </View>
                  {low ? <Pill label="Reponer" tone="warning" /> : <Pill label="Disponible" tone="success" />}
                </View>
              );
            }) : <EmptyState icon="📦" title="Sin artículos" message="Registra o importa el inventario del depósito." />}
          </Card>
        </>
      ) : null}

      {view === 'van-select' ? (
        <VanSelection
          vans={module.vans}
          vanAssets={module.vanAssets}
          title="Selecciona la van que deseas administrar"
          subtitle="Después de seleccionar una van entrarás a su perfil. No podrás cambiar a otra sin regresar."
          buttonLabel="Abrir perfil"
          onSelect={(vanId) => selectVan(vanId, 'tools')}
        />
      ) : null}

      {view === 'van-profile' && selectedVan ? (
        <>
          <VanProfileBanner van={selectedVan} mode="tools" />
          <View style={styles.metrics}>
            <Metric label="Herramientas asignadas" value={String(assignedAssets.length)} icon="🧰" />
            <Metric label="Valor de esta van" value={formatMoney(vanValue)} icon="💰" />
            <Metric label="Requieren reemplazo" value={String(replacementAssets.length)} icon="⚠️" warning />
          </View>
          <Card>
            <SectionTitle title={`Registrar herramienta en ${selectedVan.name}`} subtitle={`La herramienta quedará asignada únicamente a ${selectedVan.name}; en las demás vans aparecerá como No asignada.`} />
            <View style={styles.formGrid}>
              <Input style={styles.wideField} label="Nombre de la herramienta" value={toolName} onChangeText={setToolName} placeholder="Ej. Pistola de calor" />
              <Input style={styles.field} label="Categoría" value={toolCategory} onChangeText={setToolCategory} />
              <Input style={styles.field} keyboardType="numeric" label="Costo Afl." value={toolCost} onChangeText={setToolCost} />
            </View>
            <Text style={styles.smallLabel}>ESTADO INICIAL</Text>
            <View style={styles.optionRow}>{CONDITIONS.map((condition) => <Button key={condition} compact variant={toolCondition === condition ? 'primary' : 'secondary'} label={condition} onPress={() => setToolCondition(condition)} />)}</View>
            <View style={styles.photoCapture}>
              {newToolPhoto ? <Image source={{ uri: newToolPhoto.uri }} style={styles.preview} /> : <View style={styles.photoPlaceholder}><Text style={styles.photoPlaceholderText}>Fotografía inicial obligatoria</Text></View>}
              <View style={styles.rowActions}><Button compact variant="secondary" label="Tomar foto" onPress={async () => setNewToolPhoto(await pickPhoto(true))} /><Button compact variant="secondary" label="Galería" onPress={async () => setNewToolPhoto(await pickPhoto(false))} /></View>
            </View>
            <Button label={module.busy || photoBusyId ? 'Guardando…' : `Crear y asignar a ${selectedVan.name}`} disabled={module.busy || Boolean(photoBusyId)} onPress={() => void registerTool()} />
          </Card>
          <Card>
            <SectionTitle title={`Catálogo de ${selectedVan.name}`} subtitle="Solo estás viendo y modificando el perfil de esta van." />
            {selectedAssets.length ? selectedAssets.map((asset) => {
              const tool = module.catalogById[asset.toolCatalogId];
              const history = module.evidence.filter((photo) => photo.entityId === asset.id);
              return (
                <View key={asset.id} style={[styles.assetCard, !asset.assigned && styles.unassignedCard]}>
                  <View style={styles.assetTop}>
                    {asset.latestPhotoUrl ? <Image source={{ uri: asset.latestPhotoUrl }} style={styles.assetImage} /> : <View style={styles.assetImagePlaceholder}><Text>📷</Text></View>}
                    <View style={{ flex: 1 }}><Text style={styles.assetCode}>{asset.assetCode}</Text><Text style={styles.itemTitle}>{tool?.name ?? asset.toolCatalogId}</Text><Text style={styles.itemMeta}>{tool?.category ?? 'Herramienta'} · {formatMoney(asset.purchaseCost)}</Text></View>
                    <Pill label={asset.assigned ? 'Asignada' : 'No asignada'} tone={asset.assigned ? 'success' : 'neutral'} />
                  </View>
                  <View style={styles.optionRow}><Button compact variant={asset.assigned ? 'danger' : 'success'} label={asset.assigned ? 'Quitar asignación' : `Asignar a ${selectedVan.name}`} disabled={module.busy} onPress={() => void module.saveVanAsset({ ...asset, assigned: !asset.assigned, present: !asset.assigned })} />{asset.assigned ? <Button compact variant="secondary" label={photoBusyId === asset.id ? 'Subiendo…' : 'Nueva foto'} disabled={photoBusyId === asset.id} onPress={() => void captureAssetPhoto(asset)} /> : null}</View>
                  {asset.assigned ? <><Text style={styles.smallLabel}>ESTADO ACTUAL</Text><View style={styles.optionRow}>{CONDITIONS.map((condition) => <Button key={condition} compact variant={asset.condition === condition ? 'primary' : 'secondary'} label={condition} onPress={() => void module.saveVanAsset({ ...asset, condition })} />)}</View></> : null}
                  {history.length ? <ScrollView horizontal contentContainerStyle={styles.historyStrip}>{history.map((photo) => <View key={photo.id}><Image source={{ uri: photo.downloadUrl }} style={styles.historyImage} /><Text style={styles.historyDate}>{new Date(photo.capturedAt).toLocaleDateString('es-AW')}</Text></View>)}</ScrollView> : null}
                </View>
              );
            }) : <EmptyState icon="🧰" title="Sin herramientas" message={`Registra la primera herramienta de ${selectedVan.name}.`} />}
          </Card>
        </>
      ) : null}

      {view === 'checks-menu' ? (
        <>
          {activeCheck ? (
            <Card style={styles.activeCheckCard}>
              <Text style={styles.profileEyebrow}>CONTROL EN PROGRESO</Text>
              <Text style={styles.menuCardTitle}>{activeCheck.scope === 'van' ? module.vans.find((van) => van.id === activeCheck.vanId)?.name ?? 'Van' : 'Depósito'}</Text>
              <Text style={styles.menuCardText}>Este control todavía no se ha finalizado.</Text>
              <Button label="Continuar control pendiente" variant="success" onPress={continueActiveCheck} />
            </Card>
          ) : null}
          <View style={styles.menuGrid}>
            <ModuleMenuCard
              icon="🚐"
              title="Control de una van"
              description="Selecciona primero la van y confirma su perfil antes de comenzar el checklist."
              buttonLabel="Seleccionar van"
              onPress={() => openVanSelection('check')}
            />
            <ModuleMenuCard
              icon="📋"
              title="Conteo físico del depósito"
              description="Revisa las cantidades esperadas y registra las cantidades encontradas."
              buttonLabel="Preparar conteo"
              onPress={() => openView('warehouse-check-ready')}
            />
            <ModuleMenuCard
              icon="🕘"
              title="Historial de controles"
              description="Consulta faltantes, reemplazos, diferencias y valor revisado."
              buttonLabel="Ver historial"
              onPress={() => openView('check-history')}
            />
          </View>
        </>
      ) : null}

      {view === 'check-van-select' ? (
        <VanSelection
          vans={module.vans}
          vanAssets={module.vanAssets}
          title="Selecciona la van que vas a controlar"
          subtitle="La próxima pantalla confirmará claramente la van seleccionada antes de comenzar."
          buttonLabel="Seleccionar para control"
          onSelect={(vanId) => selectVan(vanId, 'check')}
        />
      ) : null}

      {view === 'check-van-ready' && selectedVan ? (
        <>
          <VanProfileBanner van={selectedVan} mode="check" />
          <View style={styles.metrics}>
            <Metric label="Herramientas a revisar" value={String(assignedAssets.length)} icon="🧰" />
            <Metric label="Valor a controlar" value={formatMoney(vanValue)} icon="💰" />
            <Metric label="Reemplazos actuales" value={String(replacementAssets.length)} icon="⚠️" warning />
          </View>
          <Card style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Confirma antes de comenzar</Text>
            <Text style={styles.confirmText}>El checklist que vas a iniciar pertenece únicamente a <Text style={styles.confirmStrong}>{selectedVan.name}</Text>, placa <Text style={styles.confirmStrong}>{selectedVan.plate}</Text>.</Text>
            {!assignedAssets.length ? <Text style={styles.warningText}>Esta van todavía no tiene herramientas asignadas.</Text> : null}
            <Button label={module.busy ? 'Iniciando…' : `Comenzar control de ${selectedVan.name}`} variant="success" disabled={module.busy || !assignedAssets.length} onPress={() => void startCheck('van')} />
          </Card>
        </>
      ) : null}

      {view === 'warehouse-check-ready' ? (
        <>
          <Card style={styles.profileBanner}>
            <View style={styles.profileTop}>
              <Text style={styles.profileIcon}>📦</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileEyebrow}>CONTEO SELECCIONADO</Text>
                <Text style={styles.profileName}>Depósito principal</Text>
                <Text style={styles.profileMeta}>{module.warehouseItems.length} artículos registrados</Text>
              </View>
              <Pill label="Depósito" tone="info" />
            </View>
            <Text style={styles.profileNotice}>La siguiente operación solo afectará el inventario del depósito.</Text>
          </Card>
          <View style={styles.metrics}>
            <Metric label="Artículos a contar" value={String(module.warehouseItems.length)} icon="📦" />
            <Metric label="Valor esperado" value={formatMoney(totalWarehouseValue)} icon="💰" />
            <Metric label="Reposición actual" value={String(lowStock.length)} icon="⚠️" warning />
          </View>
          <Card style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Preparar conteo físico</Text>
            <Text style={styles.confirmText}>El sistema mostrará cada artículo con su cantidad esperada. Al finalizar, las cantidades contadas actualizarán las existencias reales.</Text>
            <Button label={module.busy ? 'Iniciando…' : 'Comenzar conteo del depósito'} variant="success" disabled={module.busy || !module.warehouseItems.length} onPress={() => void startCheck('warehouse')} />
          </Card>
        </>
      ) : null}

      {view === 'check-active' && activeCheck ? (
        <Card>
          <SectionTitle title={activeCheck.scope === 'van' ? `Control de ${module.vans.find((van) => van.id === activeCheck.vanId)?.name ?? 'van'}` : 'Conteo físico del depósito'} subtitle={`Iniciado por ${activeCheck.startedByName} · ${new Date(activeCheck.startedAt).toLocaleString('es-AW')}`} />
          <View style={styles.checkProgress}><Pill label={`${activeEntries.filter((entry) => entry.status !== 'pending').length}/${activeEntries.length} revisados`} tone="info" /><Button compact variant="success" label={module.busy ? 'Finalizando…' : 'Finalizar control'} disabled={module.busy} onPress={() => void finishCheck()} /></View>
          {activeCheck.scope === 'van' ? activeEntries.map((entry) => {
            const asset = module.vanAssets.find((candidate) => candidate.id === entry.assetId);
            const photo = module.evidence.find((candidate) => candidate.id === entry.photoEvidenceId);
            if (!asset) return null;
            return (
              <View key={entry.id} style={[styles.checkRow, entry.status === 'present' && styles.presentRow, entry.status === 'missing' && styles.missingRow]}>
                <View style={{ flex: 1 }}><Text style={styles.assetCode}>{entry.assetCode}</Text><Text style={styles.itemTitle}>{entry.label}</Text><Text style={styles.itemMeta}>{entry.status === 'pending' ? 'Pendiente de revisar' : entry.status === 'present' ? 'Encontrada' : 'Faltante'}</Text></View>
                {photo ? <Image source={{ uri: photo.downloadUrl }} style={styles.checkPhoto} /> : null}
                <View style={styles.rowActions}><Button compact variant="success" label="Presente" onPress={() => void module.saveCheckEntry({ ...entry, status: 'present' })} /><Button compact variant="danger" label="Faltante" onPress={() => void module.saveCheckEntry({ ...entry, status: 'missing', photoEvidenceId: undefined })} /><Button compact variant="secondary" label={photoBusyId === asset.id ? 'Subiendo…' : 'Foto'} disabled={photoBusyId === asset.id || entry.status === 'missing'} onPress={() => void captureAssetPhoto(asset, { ...entry, status: 'present' })} /></View>
                {entry.status === 'present' ? <View style={styles.optionRow}>{CONDITIONS.map((condition) => <Button key={condition} compact variant={entry.condition === condition ? 'primary' : 'secondary'} label={condition} onPress={() => void module.saveCheckEntry({ ...entry, condition })} />)}</View> : null}
              </View>
            );
          }) : activeEntries.map((entry) => <WarehouseCountRow key={entry.id} entry={entry} disabled={module.busy} onSave={async (countedQuantity) => { const result = await module.saveCheckEntry({ ...entry, countedQuantity, status: 'present' }); setMessage(result.ok ? `${entry.label}: conteo guardado.` : result.message ?? 'No se pudo guardar.'); }} />)}
        </Card>
      ) : null}

      {view === 'check-history' ? (
        <Card>
          <SectionTitle title="Historial de controles" subtitle="Resumen de faltantes, reemplazos, diferencias y valor revisado." />
          {completedChecks.length ? completedChecks.map((check) => (
            <View key={check.id} style={styles.historyRow}>
              <View style={{ flex: 1 }}><Text style={styles.itemTitle}>{check.scope === 'van' ? module.vans.find((van) => van.id === check.vanId)?.name ?? 'Van' : 'Depósito'}</Text><Text style={styles.itemMeta}>{check.completedAt ? new Date(check.completedAt).toLocaleString('es-AW') : ''} · {check.startedByName}</Text></View>
              {check.scope === 'van' ? <><Pill label={`${check.missingCount ?? 0} faltantes`} tone={(check.missingCount ?? 0) ? 'danger' : 'success'} /><Pill label={`${check.replacementCount ?? 0} reemplazos`} tone={(check.replacementCount ?? 0) ? 'warning' : 'success'} /></> : <Pill label={`${check.varianceCount ?? 0} diferencias`} tone={(check.varianceCount ?? 0) ? 'warning' : 'success'} />}
              <Text style={styles.valueText}>{formatMoney(check.inventoryValue ?? 0)}</Text>
            </View>
          )) : <EmptyState icon="📝" title="Sin controles completados" message="Los controles finalizados aparecerán aquí." />}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function inventoryHeader(view: InventoryView, selectedVanName?: string, activeCheckVanName?: string) {
  if (view === 'menu') return { title: 'Inventario DEMAC', subtitle: 'Selecciona una sola operación para continuar paso a paso.' };
  if (view === 'warehouse') return { title: 'Inventario del depósito', subtitle: 'Existencias, valores, mínimos y registro de artículos.' };
  if (view === 'van-select') return { title: 'Herramientas por van', subtitle: 'Paso 1 de 2: selecciona la van.' };
  if (view === 'van-profile') return { title: `Perfil de ${selectedVanName ?? 'la van'}`, subtitle: 'Paso 2 de 2: administra únicamente la van seleccionada.' };
  if (view === 'checks-menu') return { title: 'Control de inventario', subtitle: 'Selecciona el tipo de control que deseas realizar.' };
  if (view === 'check-van-select') return { title: 'Control de una van', subtitle: 'Paso 1 de 2: selecciona la van que será revisada.' };
  if (view === 'check-van-ready') return { title: `Preparar control de ${selectedVanName ?? 'la van'}`, subtitle: 'Paso 2 de 2: confirma el perfil antes de comenzar.' };
  if (view === 'warehouse-check-ready') return { title: 'Preparar conteo del depósito', subtitle: 'Confirma el alcance antes de iniciar el conteo físico.' };
  if (view === 'check-active') return { title: activeCheckVanName ? `Control activo · ${activeCheckVanName}` : 'Control activo · Depósito', subtitle: 'Completa el checklist y finaliza cuando todos los artículos estén revisados.' };
  return { title: 'Historial de controles', subtitle: 'Consulta los controles finalizados.' };
}

function ModuleMenuCard({ icon, title, description, buttonLabel, onPress }: { icon: string; title: string; description: string; buttonLabel: string; onPress: () => void }) {
  return (
    <Card style={styles.menuCard}>
      <Text style={styles.menuIcon}>{icon}</Text>
      <Text style={styles.menuCardTitle}>{title}</Text>
      <Text style={styles.menuCardText}>{description}</Text>
      <Button label={buttonLabel} onPress={onPress} />
    </Card>
  );
}

function VanSelection({
  vans,
  vanAssets,
  title,
  subtitle,
  buttonLabel,
  onSelect,
}: {
  vans: Array<{ id: string; name: string; plate: string; status: string }>;
  vanAssets: VanToolAsset[];
  title: string;
  subtitle: string;
  buttonLabel: string;
  onSelect: (vanId: string) => void;
}) {
  return (
    <Card>
      <SectionTitle title={title} subtitle={subtitle} />
      <View style={styles.vanSelectionGrid}>
        {vans.map((van) => {
          const assets = vanAssets.filter((asset) => asset.vanId === van.id && asset.assigned);
          const value = assets.reduce((sum, asset) => sum + Number(asset.purchaseCost), 0);
          return (
            <View key={van.id} style={styles.vanSelectionCard}>
              <View style={styles.vanSelectionTop}>
                <Text style={styles.vanSelectionIcon}>🚐</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.vanSelectionName}>{van.name}</Text>
                  <Text style={styles.vanSelectionMeta}>Placa {van.plate} · {van.status}</Text>
                </View>
              </View>
              <Text style={styles.vanSelectionStats}>{assets.length} herramientas asignadas · {formatMoney(value)}</Text>
              <Button label={`${buttonLabel}: ${van.name}`} onPress={() => onSelect(van.id)} />
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function VanProfileBanner({ van, mode }: { van: { name: string; plate: string; status: string }; mode: 'tools' | 'check' }) {
  return (
    <Card style={styles.profileBanner}>
      <View style={styles.profileTop}>
        <Text style={styles.profileIcon}>🚐</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileEyebrow}>{mode === 'tools' ? 'PERFIL DE VAN ACTIVO' : 'VAN SELECCIONADA PARA CONTROL'}</Text>
          <Text style={styles.profileName}>{van.name}</Text>
          <Text style={styles.profileMeta}>Placa {van.plate} · {van.status}</Text>
        </View>
        <Pill label={mode === 'tools' ? 'Perfil activo' : 'Confirmada'} tone="info" />
      </View>
      <Text style={styles.profileNotice}>
        {mode === 'tools'
          ? `Todo lo que registres o modifiques en esta pantalla corresponde a ${van.name}.`
          : `El próximo checklist corresponderá exclusivamente a ${van.name}.`}
      </Text>
    </Card>
  );
}

function WarehouseCountRow({ entry, disabled, onSave }: { entry: InventoryCheckEntry; disabled: boolean; onSave: (counted: number) => void }) {
  const [value, setValue] = useState(entry.countedQuantity === undefined ? '' : String(entry.countedQuantity));
  useEffect(() => setValue(entry.countedQuantity === undefined ? '' : String(entry.countedQuantity)), [entry.countedQuantity]);
  const counted = Number(value || 0);
  const variance = counted - Number(entry.expectedQuantity ?? 0);
  return (
    <View style={[styles.checkRow, entry.status !== 'pending' && (variance === 0 ? styles.presentRow : styles.warningRow)]}>
      <View style={{ flex: 1, minWidth: 180 }}><Text style={styles.itemTitle}>{entry.label}</Text><Text style={styles.itemMeta}>Sistema: {entry.expectedQuantity ?? 0} · Diferencia: {variance > 0 ? '+' : ''}{variance}</Text></View>
      <Input style={{ width: 130 }} keyboardType="numeric" label="Cantidad contada" value={value} onChangeText={setValue} />
      <Button compact label="Guardar conteo" disabled={disabled || value === ''} onPress={() => onSave(Math.max(0, counted))} />
    </View>
  );
}

function Metric({ label, value, icon, warning }: { label: string; value: string; icon: string; warning?: boolean }) {
  return <Card style={styles.metric}><View style={[styles.metricIcon, warning && { backgroundColor: colors.warningLight }]}><Text>{icon}</Text></View><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></Card>;
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 100 },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' },
  menuCard: { flex: 1, minWidth: 260, gap: 12 },
  menuCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  menuIcon: { fontSize: 30 },
  menuCardTitle: { color: colors.text, fontWeight: '900', fontSize: 18 },
  menuCardText: { color: colors.muted, fontSize: 11, lineHeight: 18, flex: 1 },
  activeCheckCard: { borderColor: colors.warning, backgroundColor: colors.warningLight },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { flex: 1, minWidth: 220 },
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
  inventoryRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12 },
  warningRow: { backgroundColor: '#FFF9F1', borderRadius: 10, paddingHorizontal: 10 },
  itemTitle: { color: colors.text, fontWeight: '900', fontSize: 13 },
  itemMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  quantityBox: { width: 70, alignItems: 'center' },
  quantity: { color: colors.text, fontWeight: '900', fontSize: 18 },
  quantityLabel: { color: colors.muted, fontSize: 8, textTransform: 'uppercase' },
  valueText: { color: colors.text, fontWeight: '900', minWidth: 100 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  smallLabel: { color: colors.muted, fontWeight: '900', fontSize: 9, letterSpacing: 0.8, marginTop: 8, marginBottom: 7 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  photoCapture: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 12 },
  preview: { width: 120, height: 90, borderRadius: 10 },
  photoPlaceholder: { width: 160, height: 90, borderRadius: 10, backgroundColor: '#EEF2F6', alignItems: 'center', justifyContent: 'center', padding: 10 },
  photoPlaceholderText: { color: colors.muted, textAlign: 'center', fontSize: 10 },
  assetCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 12, marginBottom: 10, gap: 9 },
  unassignedCard: { opacity: 0.72, backgroundColor: '#F7F8FA' },
  assetTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  assetImage: { width: 74, height: 62, borderRadius: 9, backgroundColor: '#EEF2F6' },
  assetImagePlaceholder: { width: 74, height: 62, borderRadius: 9, backgroundColor: '#EEF2F6', alignItems: 'center', justifyContent: 'center' },
  assetCode: { color: colors.primary, fontWeight: '900', fontSize: 10, letterSpacing: 0.7 },
  historyStrip: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  historyImage: { width: 80, height: 60, borderRadius: 8 },
  historyDate: { color: colors.muted, fontSize: 8, marginTop: 3 },
  checkProgress: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  checkRow: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 11, marginBottom: 9, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  presentRow: { borderColor: '#B8DEC2', backgroundColor: '#F7FFF9' },
  missingRow: { borderColor: '#F0B8B8', backgroundColor: '#FFF7F7' },
  checkPhoto: { width: 72, height: 58, borderRadius: 8 },
  historyRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  vanSelectionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  vanSelectionCard: { flex: 1, minWidth: 230, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 14, gap: 12, backgroundColor: '#FAFBFC' },
  vanSelectionTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  vanSelectionIcon: { fontSize: 27 },
  vanSelectionName: { color: colors.text, fontWeight: '900', fontSize: 17 },
  vanSelectionMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  vanSelectionStats: { color: colors.primaryDark, fontWeight: '800', fontSize: 10 },
  profileBanner: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileIcon: { fontSize: 34 },
  profileEyebrow: { color: colors.primaryDark, fontWeight: '900', fontSize: 9, letterSpacing: 1 },
  profileName: { color: colors.text, fontWeight: '900', fontSize: 24, marginTop: 3 },
  profileMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  profileNotice: { color: colors.primaryDark, fontWeight: '800', fontSize: 11, lineHeight: 18, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#C8DCF4' },
  confirmCard: { gap: 12 },
  confirmTitle: { color: colors.text, fontWeight: '900', fontSize: 18 },
  confirmText: { color: colors.text, lineHeight: 20 },
  confirmStrong: { fontWeight: '900', color: colors.primaryDark },
  warningText: { color: colors.warning, fontWeight: '800', lineHeight: 18 },
});
