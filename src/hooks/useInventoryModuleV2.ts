import { useCallback, useEffect, useMemo, useState } from 'react';
import { listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { InventoryItem, User, Van } from '../types';
import {
  InventoryCheckEntryV2,
  InventoryCheckV2,
  InventoryEvidenceV2,
  ToolCatalogItemV2,
  ToolConditionV2,
  ToolTrackingMode,
  VanToolAssetV2,
  WarehouseInventoryItemV2,
} from '../inventory/v2Types';

export type InventoryOperationResultV2 = { ok: boolean; message?: string };

type CreateToolInputV2 = {
  name: string;
  category: string;
  standardCost: number;
  initialVanId: string;
  condition: ToolConditionV2;
  trackingMode: ToolTrackingMode;
  quantity: number;
  recommendedQuantity: number;
};

type AddUnitsInputV2 = {
  catalogId: string;
  vanId: string;
  condition: ToolConditionV2;
  quantity: number;
};

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function naturalNumber(value?: string) {
  const match = value?.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function sortVans(items: Van[]) {
  return [...items].sort((a, b) => {
    const numberDifference = naturalNumber(a.name) - naturalNumber(b.name);
    return numberDifference || a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' });
  });
}

function sortAssetCodes<T extends { assetCode: string }>(items: T[]) {
  return [...items].sort((a, b) => a.assetCode.localeCompare(b.assetCode, 'en', { numeric: true, sensitivity: 'base' }));
}

function vanCode(van: Van, index: number) {
  const digits = van.name.match(/\d+/)?.[0];
  return `V${digits || index + 1}`;
}

function normalizeFallback(items: InventoryItem[]): WarehouseInventoryItemV2[] {
  return items.map((item) => ({ ...item, active: true }));
}

function normalizeCatalog(item: ToolCatalogItemV2): ToolCatalogItemV2 {
  return {
    ...item,
    trackingMode: item.trackingMode ?? 'individual',
    recommendedQuantity: Math.max(1, Number(item.recommendedQuantity ?? 1)),
  };
}

function normalizeAsset(asset: VanToolAssetV2): VanToolAssetV2 {
  const trackingMode = asset.trackingMode ?? 'individual';
  return {
    ...asset,
    trackingMode,
    operationalStatus: asset.operationalStatus ?? (asset.present === false ? 'Faltante' : 'Disponible'),
    locationType: asset.locationType ?? 'van',
    locationId: asset.locationId ?? asset.vanId,
    quantityExpected: trackingMode === 'quantity' ? Math.max(0, Number(asset.quantityExpected ?? 1)) : 1,
    quantityPresent: trackingMode === 'quantity'
      ? Math.max(0, Number(asset.quantityPresent ?? (asset.present === false ? 0 : asset.quantityExpected ?? 1)))
      : (asset.present === false ? 0 : 1),
  };
}

export function assetIsInVan(asset: VanToolAssetV2, vanId: string) {
  const normalized = normalizeAsset(asset);
  return normalized.assigned
    && normalized.locationType !== 'warehouse'
    && (normalized.locationId ?? normalized.vanId) === vanId;
}

export function assetIsInWarehouse(asset: VanToolAssetV2) {
  const normalized = normalizeAsset(asset);
  return normalized.assigned && normalized.locationType === 'warehouse';
}

export function assetInventoryValue(asset: VanToolAssetV2) {
  const normalized = normalizeAsset(asset);
  const quantity = normalized.trackingMode === 'quantity' ? Number(normalized.quantityExpected ?? 0) : 1;
  return Math.max(0, Number(normalized.purchaseCost)) * Math.max(0, quantity);
}

export function useInventoryModuleV2(currentUser: User | null, fallbackInventory: InventoryItem[], fallbackVans: Van[]) {
  const firebase = currentUser?.authProvider === 'firebase';
  const [warehouseItems, setWarehouseItems] = useState<WarehouseInventoryItemV2[]>(normalizeFallback(fallbackInventory));
  const [toolCatalog, setToolCatalog] = useState<ToolCatalogItemV2[]>([]);
  const [vanAssets, setVanAssets] = useState<VanToolAssetV2[]>([]);
  const [checks, setChecks] = useState<InventoryCheckV2[]>([]);
  const [entries, setEntries] = useState<InventoryCheckEntryV2[]>([]);
  const [evidence, setEvidence] = useState<InventoryEvidenceV2[]>([]);
  const [vans, setVans] = useState<Van[]>(sortVans(fallbackVans));
  const [loading, setLoading] = useState(firebase);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!firebase) {
      setWarehouseItems(normalizeFallback(fallbackInventory));
      setVans(sortVans(fallbackVans));
      return;
    }
    setLoading(true);
    try {
      const [remoteWarehouse, remoteCatalog, remoteAssets, remoteChecks, remoteEntries, remoteEvidence, remoteVans] = await Promise.all([
        listFirestoreCollection<WarehouseInventoryItemV2>('warehouseInventory'),
        listFirestoreCollection<ToolCatalogItemV2>('toolCatalog'),
        listFirestoreCollection<VanToolAssetV2>('vanToolAssets'),
        listFirestoreCollection<InventoryCheckV2>('inventoryChecks'),
        listFirestoreCollection<InventoryCheckEntryV2>('inventoryCheckEntries'),
        listFirestoreCollection<InventoryEvidenceV2>('inventoryEvidence'),
        listFirestoreCollection<Van>('vans').catch(() => [] as Van[]),
      ]);
      setWarehouseItems([...remoteWarehouse].sort((a, b) => a.name.localeCompare(b.name)));
      setToolCatalog(remoteCatalog.map(normalizeCatalog).sort((a, b) => a.sequence - b.sequence));
      setVanAssets(sortAssetCodes(remoteAssets.map(normalizeAsset)));
      setChecks([...remoteChecks].sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
      setEntries(remoteEntries);
      setEvidence([...remoteEvidence].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)));
      setVans(sortVans(remoteVans.length ? remoteVans : fallbackVans));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [firebase, fallbackInventory, fallbackVans]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function persist<T extends { id: string }>(collection: string, item: T) {
    if (firebase) await saveFirestoreDocument(collection, item);
  }

  async function saveWarehouseItem(item: WarehouseInventoryItemV2): Promise<InventoryOperationResultV2> {
    setBusy(true);
    try {
      const updated = { ...item, updatedAt: new Date().toISOString() };
      await persist('warehouseInventory', updated);
      setWarehouseItems((previous) => [...previous.filter((candidate) => candidate.id !== updated.id), updated].sort((a, b) => a.name.localeCompare(b.name)));
      return { ok: true };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      setBusy(false);
    }
  }

  async function importFallbackWarehouse(): Promise<InventoryOperationResultV2> {
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const normalized = normalizeFallback(fallbackInventory).map((item) => ({ ...item, createdAt: item.createdAt ?? now, updatedAt: now }));
      await Promise.all(normalized.map((item) => persist('warehouseInventory', item)));
      setWarehouseItems(normalized);
      return { ok: true, message: `${normalized.length} artículos importados al depósito.` };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      setBusy(false);
    }
  }

  function nextUnitNumber(catalogId: string) {
    return Math.max(0, ...vanAssets
      .filter((asset) => asset.toolCatalogId === catalogId && (asset.trackingMode ?? 'individual') === 'individual')
      .map((asset) => Number(asset.unitNumber ?? asset.assetCode.match(/-(\d+)$/)?.[1] ?? 0))) + 1;
  }

  function baseAssetCode(van: Van, catalogSequence: number) {
    const index = vans.findIndex((candidate) => candidate.id === van.id);
    return `${vanCode(van, Math.max(0, index))}-H${String(catalogSequence).padStart(3, '0')}`;
  }

  function buildIndividualAssets(catalog: ToolCatalogItemV2, van: Van, quantity: number, condition: ToolConditionV2) {
    const now = new Date().toISOString();
    const firstUnit = nextUnitNumber(catalog.id);
    return Array.from({ length: quantity }, (_, index): VanToolAssetV2 => {
      const unitNumber = firstUnit + index;
      return {
        id: nowId(`asset-${catalog.id}`),
        toolCatalogId: catalog.id,
        vanId: van.id,
        assetCode: `${baseAssetCode(van, catalog.sequence)}-${String(unitNumber).padStart(2, '0')}`,
        assigned: true,
        trackingMode: 'individual',
        unitNumber,
        quantityExpected: 1,
        quantityPresent: 1,
        condition,
        operationalStatus: 'Disponible',
        purchaseCost: catalog.standardCost,
        present: true,
        locationType: 'van',
        locationId: van.id,
        createdAt: now,
        updatedAt: now,
      };
    });
  }

  function buildQuantityAsset(catalog: ToolCatalogItemV2, van: Van, quantity: number, condition: ToolConditionV2): VanToolAssetV2 {
    const now = new Date().toISOString();
    return {
      id: `${van.id}-${catalog.id}-quantity`,
      toolCatalogId: catalog.id,
      vanId: van.id,
      assetCode: `${baseAssetCode(van, catalog.sequence)}-Q`,
      assigned: true,
      trackingMode: 'quantity',
      quantityExpected: quantity,
      quantityPresent: quantity,
      condition,
      operationalStatus: 'Disponible',
      purchaseCost: catalog.standardCost,
      present: quantity > 0,
      locationType: 'van',
      locationId: van.id,
      createdAt: now,
      updatedAt: now,
    };
  }

  async function createTool(input: CreateToolInputV2): Promise<{ result: InventoryOperationResultV2; catalog?: ToolCatalogItemV2; assets: VanToolAssetV2[] }> {
    if (!currentUser) return { result: { ok: false, message: 'Debes iniciar sesión.' }, assets: [] };
    const van = vans.find((candidate) => candidate.id === input.initialVanId);
    if (!van) return { result: { ok: false, message: 'La van seleccionada no existe.' }, assets: [] };
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const sequence = Math.max(0, ...toolCatalog.map((item) => item.sequence)) + 1;
      const catalog: ToolCatalogItemV2 = {
        id: nowId('tool'),
        sequence,
        name: input.name.trim(),
        category: input.category.trim() || 'Herramientas',
        standardCost: Math.max(0, input.standardCost),
        trackingMode: input.trackingMode,
        recommendedQuantity: Math.max(1, Math.round(input.recommendedQuantity)),
        active: true,
        createdAt: now,
        updatedAt: now,
        createdByUserId: currentUser.id,
        createdByName: currentUser.name,
      };
      const quantity = Math.max(1, Math.round(input.quantity));
      const assets = input.trackingMode === 'individual'
        ? buildIndividualAssets(catalog, van, quantity, input.condition)
        : [buildQuantityAsset(catalog, van, quantity, input.condition)];
      await Promise.all([
        persist('toolCatalog', catalog),
        ...assets.map((asset) => persist('vanToolAssets', asset)),
      ]);
      setToolCatalog((previous) => [...previous, catalog].sort((a, b) => a.sequence - b.sequence));
      setVanAssets((previous) => sortAssetCodes([...previous, ...assets]));
      return { result: { ok: true }, catalog, assets };
    } catch (cause) {
      return { result: { ok: false, message: cause instanceof Error ? cause.message : String(cause) }, assets: [] };
    } finally {
      setBusy(false);
    }
  }

  async function addUnitsToVan(input: AddUnitsInputV2): Promise<{ result: InventoryOperationResultV2; assets: VanToolAssetV2[] }> {
    const catalog = toolCatalog.find((item) => item.id === input.catalogId);
    const van = vans.find((item) => item.id === input.vanId);
    if (!catalog || !van) return { result: { ok: false, message: 'No se encontró la herramienta o la van.' }, assets: [] };
    const quantity = Math.max(1, Math.round(input.quantity));
    setBusy(true);
    try {
      if ((catalog.trackingMode ?? 'individual') === 'quantity') {
        const existing = vanAssets.find((asset) => asset.toolCatalogId === catalog.id && assetIsInVan(asset, van.id) && (asset.trackingMode ?? 'individual') === 'quantity');
        const updated = existing
          ? normalizeAsset({
              ...existing,
              assigned: true,
              quantityExpected: Number(existing.quantityExpected ?? 0) + quantity,
              quantityPresent: Number(existing.quantityPresent ?? 0) + quantity,
              present: true,
              operationalStatus: 'Disponible',
              updatedAt: new Date().toISOString(),
            })
          : buildQuantityAsset(catalog, van, quantity, input.condition);
        await persist('vanToolAssets', updated);
        setVanAssets((previous) => sortAssetCodes([...previous.filter((asset) => asset.id !== updated.id), updated]));
        return { result: { ok: true }, assets: [updated] };
      }
      const assets = buildIndividualAssets(catalog, van, quantity, input.condition);
      await Promise.all(assets.map((asset) => persist('vanToolAssets', asset)));
      setVanAssets((previous) => sortAssetCodes([...previous, ...assets]));
      return { result: { ok: true }, assets };
    } catch (cause) {
      return { result: { ok: false, message: cause instanceof Error ? cause.message : String(cause) }, assets: [] };
    } finally {
      setBusy(false);
    }
  }

  async function saveCatalog(item: ToolCatalogItemV2): Promise<InventoryOperationResultV2> {
    setBusy(true);
    try {
      const updated = normalizeCatalog({ ...item, updatedAt: new Date().toISOString() });
      await persist('toolCatalog', updated);
      setToolCatalog((previous) => previous.map((candidate) => candidate.id === updated.id ? updated : candidate));
      return { ok: true };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      setBusy(false);
    }
  }

  async function saveVanAssetInternal(asset: VanToolAssetV2, manageBusy: boolean): Promise<InventoryOperationResultV2> {
    if (manageBusy) setBusy(true);
    try {
      const updated = normalizeAsset({ ...asset, updatedAt: new Date().toISOString() });
      await persist('vanToolAssets', updated);
      setVanAssets((previous) => sortAssetCodes([...previous.filter((candidate) => candidate.id !== updated.id), updated]));
      return { ok: true };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      if (manageBusy) setBusy(false);
    }
  }

  async function saveVanAsset(asset: VanToolAssetV2) {
    return saveVanAssetInternal(asset, true);
  }

  async function saveVanAssetQuietly(asset: VanToolAssetV2) {
    return saveVanAssetInternal(asset, false);
  }

  async function transferAsset(assetId: string, destination: string): Promise<InventoryOperationResultV2> {
    const asset = vanAssets.find((item) => item.id === assetId);
    if (!asset) return { ok: false, message: 'No se encontró la herramienta.' };
    if ((asset.trackingMode ?? 'individual') !== 'individual') {
      return { ok: false, message: 'Las herramientas controladas por cantidad se ajustan desde la cantidad asignada de cada van.' };
    }
    const warehouse = destination === 'warehouse';
    const destinationVan = vans.find((van) => van.id === destination);
    if (!warehouse && !destinationVan) return { ok: false, message: 'El destino seleccionado no existe.' };
    return saveVanAsset({
      ...asset,
      vanId: destinationVan?.id ?? asset.vanId,
      locationType: warehouse ? 'warehouse' : 'van',
      locationId: warehouse ? 'warehouse' : destinationVan!.id,
      operationalStatus: warehouse ? 'En depósito' : 'Disponible',
      present: true,
      assigned: true,
    });
  }

  async function saveInventoryEvidence(item: InventoryEvidenceV2): Promise<InventoryOperationResultV2> {
    try {
      await persist('inventoryEvidence', item);
      setEvidence((previous) => [item, ...previous.filter((candidate) => candidate.id !== item.id)]);
      if (item.checkId) {
        const matchingEntry = entries.find((entry) => entry.checkId === item.checkId && entry.assetId === item.entityId);
        if (matchingEntry) {
          const linkedEntry: InventoryCheckEntryV2 = {
            ...matchingEntry,
            photoEvidenceId: item.id,
            status: matchingEntry.status === 'missing' ? 'missing' : 'present',
            countedQuantity: matchingEntry.trackingMode === 'quantity'
              ? matchingEntry.countedQuantity
              : 1,
            updatedAt: new Date().toISOString(),
          };
          await persist('inventoryCheckEntries', linkedEntry);
          setEntries((previous) => previous.map((entry) => entry.id === linkedEntry.id ? linkedEntry : entry));
        }
      }
      return { ok: true };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async function startVanCheck(vanId: string, trackingModeFilter?: ToolTrackingMode): Promise<{ result: InventoryOperationResultV2; check?: InventoryCheckV2 }> {
    if (!currentUser) return { result: { ok: false, message: 'Debes iniciar sesión.' } };
    const assigned = sortAssetCodes(vanAssets.filter((asset) => assetIsInVan(asset, vanId)
      && !['Retirada', 'Desechada'].includes(normalizeAsset(asset).operationalStatus ?? 'Disponible')
      && (!trackingModeFilter || (normalizeAsset(asset).trackingMode ?? 'individual') === trackingModeFilter)));
    if (!assigned.length) {
      const label = trackingModeFilter === 'individual' ? 'herramientas de control individual' : trackingModeFilter === 'quantity' ? 'herramientas controladas por cantidad' : 'herramientas asignadas';
      return { result: { ok: false, message: `Esta van no tiene ${label}.` } };
    }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const check: InventoryCheckV2 = {
        id: nowId('van-check'),
        scope: 'van',
        vanId,
        trackingModeFilter,
        status: 'draft',
        startedAt: now,
        startedByUserId: currentUser.id,
        startedByName: currentUser.name,
        totalItems: assigned.length,
      };
      const newEntries: InventoryCheckEntryV2[] = assigned.map((rawAsset) => {
        const asset = normalizeAsset(rawAsset);
        const tool = toolCatalog.find((candidate) => candidate.id === asset.toolCatalogId);
        return {
          id: `${check.id}-${asset.id}`,
          checkId: check.id,
          scope: 'van',
          vanId,
          assetId: asset.id,
          trackingMode: asset.trackingMode,
          label: tool?.name ?? asset.assetCode,
          assetCode: asset.assetCode,
          expectedQuantity: asset.trackingMode === 'quantity' ? Number(asset.quantityExpected ?? 0) : 1,
          countedQuantity: asset.trackingMode === 'quantity' ? undefined : 1,
          status: 'pending',
          condition: asset.condition,
          operationalStatus: asset.operationalStatus,
          updatedAt: now,
        };
      });
      await Promise.all([
        persist('inventoryChecks', check),
        ...newEntries.map((entry) => persist('inventoryCheckEntries', entry)),
      ]);
      setChecks((previous) => [check, ...previous]);
      setEntries((previous) => [...previous, ...newEntries]);
      return { result: { ok: true }, check };
    } catch (cause) {
      return { result: { ok: false, message: cause instanceof Error ? cause.message : String(cause) } };
    } finally {
      setBusy(false);
    }
  }

  async function startWarehouseCheck(): Promise<{ result: InventoryOperationResultV2; check?: InventoryCheckV2 }> {
    if (!currentUser) return { result: { ok: false, message: 'Debes iniciar sesión.' } };
    const active = warehouseItems.filter((item) => item.active !== false);
    if (!active.length) return { result: { ok: false, message: 'El depósito no tiene artículos registrados.' } };
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const check: InventoryCheckV2 = {
        id: nowId('warehouse-check'), scope: 'warehouse', status: 'draft', startedAt: now,
        startedByUserId: currentUser.id, startedByName: currentUser.name, totalItems: active.length,
      };
      const newEntries: InventoryCheckEntryV2[] = active.map((item) => ({
        id: `${check.id}-${item.id}`, checkId: check.id, scope: 'warehouse', warehouseItemId: item.id,
        label: item.name, expectedQuantity: item.quantity, countedQuantity: undefined,
        status: 'pending', updatedAt: now,
      }));
      await Promise.all([
        persist('inventoryChecks', check),
        ...newEntries.map((entry) => persist('inventoryCheckEntries', entry)),
      ]);
      setChecks((previous) => [check, ...previous]);
      setEntries((previous) => [...previous, ...newEntries]);
      return { result: { ok: true }, check };
    } catch (cause) {
      return { result: { ok: false, message: cause instanceof Error ? cause.message : String(cause) } };
    } finally {
      setBusy(false);
    }
  }

  async function saveCheckEntry(entry: InventoryCheckEntryV2): Promise<InventoryOperationResultV2> {
    try {
      const current = entries.find((candidate) => candidate.id === entry.id);
      const updated = {
        ...current,
        ...entry,
        photoEvidenceId: entry.photoEvidenceId ?? current?.photoEvidenceId,
        updatedAt: new Date().toISOString(),
      } as InventoryCheckEntryV2;
      await persist('inventoryCheckEntries', updated);
      setEntries((previous) => previous.map((candidate) => candidate.id === updated.id ? updated : candidate));
      return { ok: true };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async function completeCheck(checkId: string): Promise<InventoryOperationResultV2> {
    const check = checks.find((item) => item.id === checkId);
    if (!check) return { ok: false, message: 'El control ya no existe.' };
    const checkEntries = entries.filter((entry) => entry.checkId === checkId);
    const unresolved = checkEntries.filter((entry) => entry.status === 'pending'
      || ((entry.scope === 'warehouse' || entry.trackingMode === 'quantity') && entry.countedQuantity === undefined));
    if (unresolved.length) return { ok: false, message: `Faltan ${unresolved.length} artículos por revisar.` };
    const individualWithoutPhoto = checkEntries.filter((entry) => {
      if (entry.scope !== 'van' || (entry.trackingMode ?? 'individual') !== 'individual' || entry.status !== 'present') return false;
      return !entry.photoEvidenceId && !evidence.some((photo) => photo.checkId === entry.checkId && photo.entityId === entry.assetId);
    });
    if (individualWithoutPhoto.length) return { ok: false, message: `Faltan fotografías de ${individualWithoutPhoto.length} power tools presentes.` };

    setBusy(true);
    try {
      const completedAt = new Date().toISOString();
      let value = 0;
      let presentCount = 0;
      let missingCount = 0;
      if (check.scope === 'warehouse') {
        const updatedItems: WarehouseInventoryItemV2[] = [];
        for (const entry of checkEntries) {
          const item = warehouseItems.find((candidate) => candidate.id === entry.warehouseItemId);
          if (!item) continue;
          const counted = Math.max(0, Number(entry.countedQuantity ?? 0));
          value += counted * item.cost;
          updatedItems.push({ ...item, quantity: counted, latestCountAt: completedAt, updatedAt: completedAt });
        }
        await Promise.all(updatedItems.map((item) => persist('warehouseInventory', item)));
        setWarehouseItems((previous) => previous.map((item) => updatedItems.find((updated) => updated.id === item.id) ?? item));
      } else {
        const updatedAssets: VanToolAssetV2[] = [];
        for (const entry of checkEntries) {
          const current = vanAssets.find((candidate) => candidate.id === entry.assetId);
          if (!current) continue;
          const asset = normalizeAsset(current);
          if ((entry.trackingMode ?? asset.trackingMode) === 'quantity') {
            const expected = Math.max(0, Number(entry.expectedQuantity ?? asset.quantityExpected ?? 0));
            const counted = Math.max(0, Number(entry.countedQuantity ?? 0));
            presentCount += counted;
            missingCount += Math.max(0, expected - counted);
            value += counted * asset.purchaseCost;
            updatedAssets.push(normalizeAsset({
              ...asset,
              quantityExpected: expected,
              quantityPresent: counted,
              present: counted > 0,
              condition: entry.condition ?? asset.condition,
              operationalStatus: counted === 0 ? 'Faltante' : asset.operationalStatus === 'Faltante' ? 'Disponible' : asset.operationalStatus,
              updatedAt: completedAt,
            }));
          } else {
            const present = entry.status === 'present';
            presentCount += present ? 1 : 0;
            missingCount += present ? 0 : 1;
            if (present) value += asset.purchaseCost;
            updatedAssets.push(normalizeAsset({
              ...asset,
              present,
              quantityPresent: present ? 1 : 0,
              condition: entry.condition ?? asset.condition,
              operationalStatus: present
                ? (entry.operationalStatus === 'Faltante' ? 'Disponible' : entry.operationalStatus ?? asset.operationalStatus)
                : 'Faltante',
              updatedAt: completedAt,
            }));
          }
        }
        await Promise.all(updatedAssets.map((asset) => persist('vanToolAssets', asset)));
        setVanAssets((previous) => sortAssetCodes(previous.map((asset) => updatedAssets.find((updated) => updated.id === asset.id) ?? asset)));
      }
      const completed: InventoryCheckV2 = {
        ...check,
        status: 'completed',
        completedAt,
        presentCount,
        missingCount,
        replacementCount: checkEntries.filter((entry) => entry.condition === 'Requiere reemplazo').length,
        varianceCount: checkEntries.filter((entry) => entry.scope === 'warehouse' && Number(entry.countedQuantity) !== Number(entry.expectedQuantity)).length,
        inventoryValue: value,
      };
      await persist('inventoryChecks', completed);
      setChecks((previous) => previous.map((candidate) => candidate.id === completed.id ? completed : candidate));
      return { ok: true, message: 'Control de inventario completado.' };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      setBusy(false);
    }
  }

  const catalogById = useMemo<Record<string, ToolCatalogItemV2>>(
    () => Object.fromEntries(toolCatalog.map((item) => [item.id, item])),
    [toolCatalog],
  );

  return {
    warehouseItems,
    toolCatalog,
    catalogById,
    vanAssets,
    checks,
    entries,
    evidence,
    vans,
    loading,
    busy,
    error,
    refresh,
    saveWarehouseItem,
    importFallbackWarehouse,
    createTool,
    addUnitsToVan,
    saveCatalog,
    saveVanAsset,
    saveVanAssetQuietly,
    transferAsset,
    saveInventoryEvidence,
    startVanCheck,
    startWarehouseCheck,
    saveCheckEntry,
    completeCheck,
  };
}
