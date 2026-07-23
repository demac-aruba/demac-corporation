import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, EmptyState, formatMoney, Input, Pill, SectionTitle } from './UI';
import {
  InventoryCheckEntryV2,
  InventoryCheckV2,
  InventoryEvidenceV2,
  ToolCatalogItemV2,
  VanToolAssetV2,
} from '../inventory/v2Types';
import {
  deleteFirestoreDocument,
  getValidFirebaseSession,
  listFirestoreCollection,
  saveFirestoreDocument,
} from '../services/firebase';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';

const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;

type CleanupData = {
  catalog: ToolCatalogItemV2[];
  assets: VanToolAssetV2[];
  evidence: InventoryEvidenceV2[];
  entries: InventoryCheckEntryV2[];
  checks: InventoryCheckV2[];
};

const emptyData: CleanupData = { catalog: [], assets: [], evidence: [], entries: [], checks: [] };

export function InventoryCleanupAdmin() {
  const { currentUser } = useAppState();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [selected, setSelected] = useState<ToolCatalogItemV2 | null>(null);
  const [data, setData] = useState<CleanupData>(emptyData);

  if (currentUser?.role !== 'admin') return null;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [catalog, assets, evidence, entries, checks] = await Promise.all([
        listFirestoreCollection<ToolCatalogItemV2>('toolCatalog'),
        listFirestoreCollection<VanToolAssetV2>('vanToolAssets'),
        listFirestoreCollection<InventoryEvidenceV2>('inventoryEvidence'),
        listFirestoreCollection<InventoryCheckEntryV2>('inventoryCheckEntries'),
        listFirestoreCollection<InventoryCheckV2>('inventoryChecks'),
      ]);
      setData({ catalog: [...catalog].sort((a, b) => a.sequence - b.sequence), assets, evidence, entries, checks });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  function open() {
    setVisible(true);
    setSelected(null);
    setConfirmation('');
    setMessage('');
    setError('');
    void load();
  }

  function close() {
    if (deleting) return;
    setVisible(false);
    setSelected(null);
    setConfirmation('');
  }

  function summary(catalogId: string) {
    const assets = data.assets.filter((asset) => asset.toolCatalogId === catalogId);
    const assetIds = new Set(assets.map((asset) => asset.id));
    const photos = data.evidence.filter((photo) => assetIds.has(photo.entityId));
    const entries = data.entries.filter((entry) => Boolean(entry.assetId) && assetIds.has(entry.assetId!));
    const value = assets.reduce((sum, asset) => {
      const quantity = (asset.trackingMode ?? 'individual') === 'quantity' ? Number(asset.quantityExpected ?? 0) : 1;
      return sum + Math.max(0, Number(asset.purchaseCost)) * Math.max(0, quantity);
    }, 0);
    return { assets, photos, entries, value };
  }

  async function deleteStorageObject(storagePath: string) {
    if (!storagePath || !storageBucket) return;
    const session = await getValidFirebaseSession();
    if (!session) throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
    const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(storagePath)}`;
    const response = await fetch(endpoint, { method: 'DELETE', headers: { Authorization: `Bearer ${session.idToken}` } });
    if (response.ok || response.status === 404) return;
    const text = await response.text();
    let detail = text || 'Firebase Storage rechazó la eliminación.';
    try {
      const payload = JSON.parse(text);
      detail = payload?.error?.message ?? payload?.message ?? detail;
    } catch {
      // Keep the plain-text response.
    }
    throw new Error(`${detail} (Storage ${response.status})`);
  }

  function recomputeCheck(check: InventoryCheckV2, remainingEntries: InventoryCheckEntryV2[], remainingAssets: VanToolAssetV2[]) {
    if (check.status !== 'completed' || check.scope !== 'van') return { ...check, totalItems: remainingEntries.length };
    const assetById = new Map(remainingAssets.map((asset) => [asset.id, asset]));
    let presentCount = 0;
    let missingCount = 0;
    let inventoryValue = 0;
    for (const entry of remainingEntries) {
      const asset = entry.assetId ? assetById.get(entry.assetId) : undefined;
      if ((entry.trackingMode ?? asset?.trackingMode ?? 'individual') === 'quantity') {
        const expected = Math.max(0, Number(entry.expectedQuantity ?? asset?.quantityExpected ?? 0));
        const counted = Math.max(0, Number(entry.countedQuantity ?? 0));
        presentCount += counted;
        missingCount += Math.max(0, expected - counted);
        inventoryValue += counted * Math.max(0, Number(asset?.purchaseCost ?? 0));
      } else {
        const present = entry.status === 'present';
        presentCount += present ? 1 : 0;
        missingCount += present ? 0 : 1;
        inventoryValue += present ? Math.max(0, Number(asset?.purchaseCost ?? 0)) : 0;
      }
    }
    return {
      ...check,
      totalItems: remainingEntries.length,
      presentCount,
      missingCount,
      replacementCount: remainingEntries.filter((entry) => entry.condition === 'Requiere reemplazo').length,
      inventoryValue,
    };
  }

  async function permanentlyDelete() {
    if (!selected || confirmation.trim().toUpperCase() !== 'ELIMINAR') return;
    setDeleting(true);
    setError('');
    setMessage('');
    try {
      const targetAssets = data.assets.filter((asset) => asset.toolCatalogId === selected.id);
      const assetIds = new Set(targetAssets.map((asset) => asset.id));
      const targetEvidence = data.evidence.filter((photo) => assetIds.has(photo.entityId));
      const targetEntries = data.entries.filter((entry) => Boolean(entry.assetId) && assetIds.has(entry.assetId!));
      const entryIds = new Set(targetEntries.map((entry) => entry.id));
      const affectedCheckIds = new Set(targetEntries.map((entry) => entry.checkId));
      const storagePaths = new Set<string>();
      targetEvidence.forEach((photo) => {
        storagePaths.add(photo.storagePath);
        if (photo.thumbnailStoragePath) storagePaths.add(photo.thumbnailStoragePath);
      });
      targetAssets.forEach((asset) => {
        if (asset.latestPhotoStoragePath) storagePaths.add(asset.latestPhotoStoragePath);
        if (asset.latestThumbnailStoragePath) storagePaths.add(asset.latestThumbnailStoragePath);
      });

      for (const storagePath of storagePaths) await deleteStorageObject(storagePath);
      for (const photo of targetEvidence) await deleteFirestoreDocument('inventoryEvidence', photo.id);
      for (const entry of targetEntries) await deleteFirestoreDocument('inventoryCheckEntries', entry.id);
      for (const asset of targetAssets) await deleteFirestoreDocument('vanToolAssets', asset.id);

      const remainingAssets = data.assets.filter((asset) => !assetIds.has(asset.id));
      for (const checkId of affectedCheckIds) {
        const check = data.checks.find((candidate) => candidate.id === checkId);
        if (!check) continue;
        const remainingEntries = data.entries.filter((entry) => entry.checkId === checkId && !entryIds.has(entry.id));
        if (!remainingEntries.length) await deleteFirestoreDocument('inventoryChecks', check.id);
        else await saveFirestoreDocument('inventoryChecks', recomputeCheck(check, remainingEntries, remainingAssets));
      }

      await deleteFirestoreDocument('toolCatalog', selected.id);
      const name = selected.name;
      setSelected(null);
      setConfirmation('');
      setMessage(`${name} fue eliminado permanentemente del sistema.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleting(false);
    }
  }

  const selectedSummary = selected ? summary(selected.id) : undefined;

  return (
    <Card>
      <SectionTitle title="Administración de inventario" subtitle="Herramientas administrativas para limpiar información de prueba o registros creados por error." />
      <View style={styles.warning}>
        <Text style={styles.warningTitle}>Eliminación permanente</Text>
        <Text style={styles.warningText}>Esta función borra el modelo de todas las vans, fotografías y controles. No debe utilizarse para herramientas reales dañadas o retiradas.</Text>
        <Button variant="danger" label="Eliminar registros de prueba" onPress={open} />
      </View>

      <AppModal visible={visible} title={selected ? 'Confirmar eliminación permanente' : 'Eliminar registros de prueba'} onClose={close}>
        {selected && selectedSummary ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <Card style={styles.dangerCard}>
              <Text style={styles.dangerTitle}>Esta acción no se puede deshacer</Text>
              <Text style={styles.body}>Se eliminará completamente <Text style={styles.bold}>{selected.name}</Text>.</Text>
              <View style={styles.summaryRow}>
                <Pill label={`${selectedSummary.assets.length} registros`} tone="danger" />
                <Pill label={`${selectedSummary.photos.length} fotografías`} tone="danger" />
                <Pill label={`${selectedSummary.entries.length} controles`} tone="danger" />
              </View>
            </Card>
            <Input label="Escribe ELIMINAR para confirmar" value={confirmation} autoCapitalize="characters" onChangeText={setConfirmation} placeholder="ELIMINAR" />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <Button variant="secondary" label="Regresar" disabled={deleting} onPress={() => { setSelected(null); setConfirmation(''); setError(''); }} />
              <Button variant="danger" label={deleting ? 'Eliminando…' : 'Eliminar permanentemente'} disabled={deleting || confirmation.trim().toUpperCase() !== 'ELIMINAR'} onPress={() => void permanentlyDelete()} />
            </View>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.modalContent}>
            <SectionTitle title="Catálogo maestro" subtitle="Selecciona únicamente información de prueba, duplicados o registros incorrectos." />
            {message ? <Text style={styles.success}>{message}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {loading ? <Text style={styles.loading}>Cargando registros…</Text> : null}
            {!loading && !data.catalog.length ? <EmptyState icon="🧹" title="Sin registros" message="No hay herramientas registradas para eliminar." /> : null}
            {!loading ? data.catalog.map((catalog) => {
              const itemSummary = summary(catalog.id);
              return (
                <Card key={catalog.id} style={styles.catalogCard}>
                  <View style={styles.catalogHeader}>
                    <View style={{ flex: 1 }}><Text style={styles.catalogName}>{catalog.name}</Text><Text style={styles.body}>{catalog.category} · {formatMoney(catalog.standardCost)}</Text></View>
                    <Pill label={catalog.trackingMode === 'quantity' ? 'Por cantidad' : 'Individual'} tone="info" />
                  </View>
                  <View style={styles.summaryRow}><Pill label={`${itemSummary.assets.length} registros`} /><Pill label={`${itemSummary.photos.length} fotos`} /><Pill label={formatMoney(itemSummary.value)} /></View>
                  <Button compact variant="danger" label="Eliminar modelo completo" onPress={() => { setSelected(catalog); setConfirmation(''); setError(''); }} />
                </Card>
              );
            }) : null}
            <Button variant="secondary" label="Cerrar" onPress={close} />
          </ScrollView>
        )}
      </AppModal>
    </Card>
  );
}

const styles = StyleSheet.create({
  warning: { borderWidth: 1, borderColor: '#F3C8C8', backgroundColor: '#FFF8F8', borderRadius: 13, padding: 15, gap: 8, alignItems: 'flex-start' },
  warningTitle: { color: colors.danger, fontWeight: '900' },
  warningText: { color: colors.text, lineHeight: 19, marginBottom: 4 },
  modalContent: { gap: 12, paddingBottom: 8 },
  dangerCard: { borderColor: colors.danger, backgroundColor: colors.dangerLight, gap: 10 },
  dangerTitle: { color: colors.danger, fontWeight: '900', fontSize: 16 },
  body: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  bold: { color: colors.text, fontWeight: '900' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginVertical: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 },
  catalogCard: { gap: 10 },
  catalogHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  catalogName: { color: colors.text, fontWeight: '900', fontSize: 15 },
  loading: { color: colors.muted, fontWeight: '700', paddingVertical: 20, textAlign: 'center' },
  error: { color: colors.danger, backgroundColor: colors.dangerLight, padding: 10, borderRadius: 8, fontWeight: '700' },
  success: { color: colors.success, backgroundColor: colors.successLight, padding: 10, borderRadius: 8, fontWeight: '700' },
});