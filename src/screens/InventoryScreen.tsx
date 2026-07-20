import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, EmptyState, formatMoney, Input, Pill, SectionTitle } from '../components/UI';
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
import { InventoryScreen as InventoryScreenV2 } from './InventoryScreenV2';

const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;

type CleanupData = {
  catalog: ToolCatalogItemV2[];
  assets: VanToolAssetV2[];
  evidence: InventoryEvidenceV2[];
  entries: InventoryCheckEntryV2[];
  checks: InventoryCheckV2[];
};

const emptyCleanupData: CleanupData = {
  catalog: [],
  assets: [],
  evidence: [],
  entries: [],
  checks: [],
};

export function InventoryScreen() {
  const { currentUser } = useAppState();
  const [screenKey, setScreenKey] = useState(0);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [selectedCatalog, setSelectedCatalog] = useState<ToolCatalogItemV2 | null>(null);
  const [data, setData] = useState<CleanupData>(emptyCleanupData);

  const canDeletePermanently = currentUser?.role === 'admin' || currentUser?.role === 'supervisor';

  async function loadCleanupData() {
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
      setData({
        catalog: [...catalog].sort((a, b) => a.sequence - b.sequence),
        assets,
        evidence,
        entries,
        checks,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  function openCleanup() {
    setVisible(true);
    setSelectedCatalog(null);
    setConfirmation('');
    setMessage('');
    setError('');
    void loadCleanupData();
  }

  function closeCleanup() {
    if (deleting) return;
    setVisible(false);
    setSelectedCatalog(null);
    setConfirmation('');
  }

  function catalogSummary(catalogId: string) {
    const assets = data.assets.filter((asset) => asset.toolCatalogId === catalogId);
    const assetIds = new Set(assets.map((asset) => asset.id));
    const photos = data.evidence.filter((photo) => assetIds.has(photo.entityId));
    const entries = data.entries.filter((entry) => Boolean(entry.assetId) && assetIds.has(entry.assetId!));
    const value = assets.reduce((sum, asset) => {
      const quantity = (asset.trackingMode ?? 'individual') === 'quantity'
        ? Number(asset.quantityExpected ?? 0)
        : 1;
      return sum + Math.max(0, Number(asset.purchaseCost)) * Math.max(0, quantity);
    }, 0);
    return { assets, photos, entries, value };
  }

  async function deleteStorageObject(storagePath: string) {
    if (!storagePath || !storageBucket) return;
    const session = await getValidFirebaseSession();
    if (!session) throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
    const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(storagePath)}`;
    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.idToken}` },
    });
    if (response.ok || response.status === 404) return;
    const text = await response.text();
    let detail = text || 'Firebase Storage rechazó la eliminación.';
    try {
      const payload = JSON.parse(text);
      detail = payload?.error?.message ?? payload?.message ?? detail;
    } catch {
      // Preserve the plain-text Storage response.
    }
    throw new Error(`${detail} (Storage ${response.status})`);
  }

  function recomputeCompletedCheck(
    check: InventoryCheckV2,
    remainingEntries: InventoryCheckEntryV2[],
    remainingAssets: VanToolAssetV2[],
  ): InventoryCheckV2 {
    if (check.status !== 'completed' || check.scope !== 'van') {
      return { ...check, totalItems: remainingEntries.length };
    }

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

  async function permanentlyDeleteSelectedCatalog() {
    if (!selectedCatalog || confirmation.trim().toUpperCase() !== 'ELIMINAR') return;
    setDeleting(true);
    setError('');
    setMessage('');

    try {
      const targetAssets = data.assets.filter((asset) => asset.toolCatalogId === selectedCatalog.id);
      const targetAssetIds = new Set(targetAssets.map((asset) => asset.id));
      const targetEvidence = data.evidence.filter((photo) => targetAssetIds.has(photo.entityId));
      const targetEntries = data.entries.filter((entry) => Boolean(entry.assetId) && targetAssetIds.has(entry.assetId!));
      const targetEntryIds = new Set(targetEntries.map((entry) => entry.id));
      const affectedCheckIds = new Set(targetEntries.map((entry) => entry.checkId));
      const storagePaths = new Set<string>();

      for (const photo of targetEvidence) storagePaths.add(photo.storagePath);
      for (const asset of targetAssets) {
        if (asset.latestPhotoStoragePath) storagePaths.add(asset.latestPhotoStoragePath);
      }

      for (const storagePath of storagePaths) await deleteStorageObject(storagePath);
      for (const photo of targetEvidence) await deleteFirestoreDocument('inventoryEvidence', photo.id);
      for (const entry of targetEntries) await deleteFirestoreDocument('inventoryCheckEntries', entry.id);
      for (const asset of targetAssets) await deleteFirestoreDocument('vanToolAssets', asset.id);

      const remainingAssets = data.assets.filter((asset) => !targetAssetIds.has(asset.id));
      for (const checkId of affectedCheckIds) {
        const check = data.checks.find((candidate) => candidate.id === checkId);
        if (!check) continue;
        const remainingEntries = data.entries.filter((entry) => entry.checkId === checkId && !targetEntryIds.has(entry.id));
        if (!remainingEntries.length) {
          await deleteFirestoreDocument('inventoryChecks', check.id);
        } else {
          await saveFirestoreDocument('inventoryChecks', recomputeCompletedCheck(check, remainingEntries, remainingAssets));
        }
      }

      await deleteFirestoreDocument('toolCatalog', selectedCatalog.id);

      const deletedName = selectedCatalog.name;
      setSelectedCatalog(null);
      setConfirmation('');
      setMessage(`${deletedName} fue eliminado permanentemente del catálogo, las vans, el depósito y el historial.`);
      setScreenKey((current) => current + 1);
      await loadCleanupData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleting(false);
    }
  }

  const selectedSummary = selectedCatalog ? catalogSummary(selectedCatalog.id) : undefined;

  return (
    <View style={styles.container}>
      <InventoryScreenV2 key={screenKey} />

      {canDeletePermanently ? (
        <View style={styles.deleteLauncher}>
          <Button compact variant="danger" label="Eliminar registro" onPress={openCleanup} />
        </View>
      ) : null}

      <AppModal
        visible={visible}
        title={selectedCatalog ? 'Confirmar eliminación permanente' : 'Eliminar registros de inventario'}
        onClose={closeCleanup}
      >
        {selectedCatalog && selectedSummary ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <Card style={styles.dangerCard}>
              <Text style={styles.dangerTitle}>Esta acción no se puede deshacer</Text>
              <Text style={styles.bodyText}>
                Se eliminará completamente <Text style={styles.bold}>{selectedCatalog.name}</Text> del catálogo maestro y de todas las vans.
              </Text>
              <View style={styles.summaryRow}>
                <Pill label={`${selectedSummary.assets.length} registros físicos`} tone="danger" />
                <Pill label={`${selectedSummary.photos.length} fotografías`} tone="danger" />
                <Pill label={`${selectedSummary.entries.length} entradas de controles`} tone="danger" />
              </View>
              <Text style={styles.bodyText}>
                También se borrarán las fotografías de Firebase Storage y se corregirán o eliminarán los controles relacionados para que la herramienta no aparezca en el historial.
              </Text>
            </Card>

            <Input
              label="Escribe ELIMINAR para confirmar"
              value={confirmation}
              autoCapitalize="characters"
              onChangeText={setConfirmation}
              placeholder="ELIMINAR"
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <View style={styles.actionRow}>
              <Button
                variant="secondary"
                label="Regresar"
                disabled={deleting}
                onPress={() => {
                  setSelectedCatalog(null);
                  setConfirmation('');
                  setError('');
                }}
              />
              <Button
                variant="danger"
                label={deleting ? 'Eliminando…' : 'Eliminar permanentemente'}
                disabled={deleting || confirmation.trim().toUpperCase() !== 'ELIMINAR'}
                onPress={() => void permanentlyDeleteSelectedCatalog()}
              />
            </View>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.modalContent}>
            <SectionTitle
              title="Limpieza del catálogo maestro"
              subtitle="Esta función elimina el modelo seleccionado de todas las vans, el depósito, las fotos y los controles asociados."
            />
            {message ? <Text style={styles.successText}>{message}</Text> : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {loading ? <Text style={styles.loadingText}>Cargando registros…</Text> : null}

            {!loading && !data.catalog.length ? (
              <EmptyState icon="🧹" title="Sin registros" message="No hay herramientas registradas para eliminar." />
            ) : null}

            {!loading ? data.catalog.map((catalog) => {
              const summary = catalogSummary(catalog.id);
              return (
                <Card key={catalog.id} style={styles.catalogCard}>
                  <View style={styles.catalogHeader}>
                    <View style={styles.catalogInfo}>
                      <Text style={styles.catalogName}>{catalog.name}</Text>
                      <Text style={styles.bodyText}>{catalog.category} · {formatMoney(catalog.standardCost)} por unidad</Text>
                    </View>
                    <Pill label={catalog.trackingMode === 'quantity' ? 'Por cantidad' : 'Individual'} tone="info" />
                  </View>
                  <View style={styles.summaryRow}>
                    <Pill label={`${summary.assets.length} registros`} tone="neutral" />
                    <Pill label={`${summary.photos.length} fotos`} tone="neutral" />
                    <Pill label={formatMoney(summary.value)} tone="neutral" />
                  </View>
                  <Button
                    compact
                    variant="danger"
                    label="Eliminar modelo completo"
                    onPress={() => {
                      setSelectedCatalog(catalog);
                      setConfirmation('');
                      setError('');
                    }}
                  />
                </Card>
              );
            }) : null}

            <Button variant="secondary" label="Cerrar" onPress={closeCleanup} />
          </ScrollView>
        )}
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  deleteLauncher: {
    position: 'absolute',
    right: 24,
    bottom: 92,
    zIndex: 20,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  modalContent: { gap: 12, paddingBottom: 8 },
  dangerCard: { borderColor: colors.danger, backgroundColor: colors.dangerLight, gap: 10 },
  dangerTitle: { color: colors.danger, fontWeight: '900', fontSize: 16 },
  bodyText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  bold: { color: colors.text, fontWeight: '900' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginVertical: 6 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 },
  catalogCard: { gap: 10 },
  catalogHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  catalogInfo: { flex: 1, minWidth: 210 },
  catalogName: { color: colors.text, fontWeight: '900', fontSize: 15 },
  loadingText: { color: colors.muted, fontWeight: '700', paddingVertical: 20, textAlign: 'center' },
  errorText: { color: colors.danger, backgroundColor: colors.dangerLight, padding: 10, borderRadius: 8, fontWeight: '700' },
  successText: { color: colors.success, backgroundColor: colors.successLight, padding: 10, borderRadius: 8, fontWeight: '700' },
});
