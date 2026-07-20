import { useCallback, useEffect, useMemo, useState } from 'react';
import { listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { InventoryItem, User, Van } from '../types';
import {
  InventoryCheck,
  InventoryCheckEntry,
  InventoryEvidence,
  ToolCatalogItem,
  ToolCondition,
  VanToolAsset,
  WarehouseInventoryItem,
} from '../inventory/types';

export type InventoryOperationResult = { ok: boolean; message?: string };

type CreateToolInput = {
  name: string;
  category: string;
  standardCost: number;
  initialVanId: string;
  condition: ToolCondition;
};

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function vanCode(van: Van, index: number) {
  const digits = van.name.match(/\d+/)?.[0];
  return `V${digits || index + 1}`;
}

function normalizeFallback(items: InventoryItem[]): WarehouseInventoryItem[] {
  return items.map((item) => ({ ...item, active: true }));
}

export function useInventoryModule(currentUser: User | null, fallbackInventory: InventoryItem[], fallbackVans: Van[]) {
  const firebase = currentUser?.authProvider === 'firebase';
  const [warehouseItems, setWarehouseItems] = useState<WarehouseInventoryItem[]>(normalizeFallback(fallbackInventory));
  const [toolCatalog, setToolCatalog] = useState<ToolCatalogItem[]>([]);
  const [vanAssets, setVanAssets] = useState<VanToolAsset[]>([]);
  const [checks, setChecks] = useState<InventoryCheck[]>([]);
  const [entries, setEntries] = useState<InventoryCheckEntry[]>([]);
  const [evidence, setEvidence] = useState<InventoryEvidence[]>([]);
  const [vans, setVans] = useState<Van[]>(fallbackVans);
  const [loading, setLoading] = useState(firebase);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!firebase) {
      setWarehouseItems(normalizeFallback(fallbackInventory));
      setVans(fallbackVans);
      return;
    }
    setLoading(true);
    try {
      const [remoteWarehouse, remoteCatalog, remoteAssets, remoteChecks, remoteEntries, remoteEvidence, remoteVans] = await Promise.all([
        listFirestoreCollection<WarehouseInventoryItem>('warehouseInventory'),
        listFirestoreCollection<ToolCatalogItem>('toolCatalog'),
        listFirestoreCollection<VanToolAsset>('vanToolAssets'),
        listFirestoreCollection<InventoryCheck>('inventoryChecks'),
        listFirestoreCollection<InventoryCheckEntry>('inventoryCheckEntries'),
        listFirestoreCollection<InventoryEvidence>('inventoryEvidence'),
        listFirestoreCollection<Van>('vans').catch(() => [] as Van[]),
      ]);
      setWarehouseItems([...remoteWarehouse].sort((a, b) => a.name.localeCompare(b.name)));
      setToolCatalog([...remoteCatalog].sort((a, b) => a.sequence - b.sequence));
      setVanAssets([...remoteAssets].sort((a, b) => a.assetCode.localeCompare(b.assetCode)));
      setChecks([...remoteChecks].sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
      setEntries(remoteEntries);
      setEvidence([...remoteEvidence].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)));
      setVans(remoteVans.length ? remoteVans : fallbackVans);
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

  async function saveWarehouseItem(item: WarehouseInventoryItem): Promise<InventoryOperationResult> {
    setBusy(true);
    try {
      const updated = { ...item, updatedAt: new Date().toISOString() };
      await persist('warehouseInventory', updated);
      setWarehouseItems((previous) => [...previous.filter((candidate) => candidate.id !== updated.id), updated].sort((a, b) => a.name.localeCompare(b.name)));
      return { ok: true };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    } finally { setBusy(false); }
  }

  async function importFallbackWarehouse(): Promise<InventoryOperationResult> {
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const normalized = normalizeFallback(fallbackInventory).map((item) => ({ ...item, createdAt: item.createdAt ?? now, updatedAt: now }));
      for (const item of normalized) await persist('warehouseInventory', item);
      setWarehouseItems(normalized);
      return { ok: true, message: `${normalized.length} artículos importados al depósito.` };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    } finally { setBusy(false); }
  }

  async function createTool(input: CreateToolInput): Promise<{ result: InventoryOperationResult; asset?: VanToolAsset }> {
    if (!currentUser) return { result: { ok: false, message: 'Debes iniciar sesión.' } };
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const sequence = Math.max(0, ...toolCatalog.map((item) => item.sequence)) + 1;
      const catalog: ToolCatalogItem = {
        id: nowId('tool'),
        sequence,
        name: input.name.trim(),
        category: input.category.trim() || 'Herramientas',
        standardCost: Math.max(0, input.standardCost),
        active: true,
        createdAt: now,
        updatedAt: now,
        createdByUserId: currentUser.id,
        createdByName: currentUser.name,
      };
      await persist('toolCatalog', catalog);
      const createdAssets: VanToolAsset[] = [];
      for (let index = 0; index < vans.length; index += 1) {
        const van = vans[index];
        const assigned = van.id === input.initialVanId;
        const asset: VanToolAsset = {
          id: `${van.id}-${catalog.id}`,
          toolCatalogId: catalog.id,
          vanId: van.id,
          assetCode: `${vanCode(van, index)}-H${String(sequence).padStart(3, '0')}`,
          assigned,
          condition: assigned ? input.condition : 'No inspeccionada',
          purchaseCost: catalog.standardCost,
          present: assigned,
          createdAt: now,
          updatedAt: now,
        };
        await persist('vanToolAssets', asset);
        createdAssets.push(asset);
      }
      setToolCatalog((previous) => [...previous, catalog].sort((a, b) => a.sequence - b.sequence));
      setVanAssets((previous) => [...previous, ...createdAssets].sort((a, b) => a.assetCode.localeCompare(b.assetCode)));
      return { result: { ok: true }, asset: createdAssets.find((item) => item.vanId === input.initialVanId) };
    } catch (cause) {
      return { result: { ok: false, message: cause instanceof Error ? cause.message : String(cause) } };
    } finally { setBusy(false); }
  }

  async function saveVanAsset(asset: VanToolAsset): Promise<InventoryOperationResult> {
    setBusy(true);
    try {
      const updated = { ...asset, updatedAt: new Date().toISOString() };
      await persist('vanToolAssets', updated);
      setVanAssets((previous) => previous.map((candidate) => candidate.id === updated.id ? updated : candidate));
      return { ok: true };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    } finally { setBusy(false); }
  }

  async function saveInventoryEvidence(item: InventoryEvidence): Promise<InventoryOperationResult> {
    try {
      await persist('inventoryEvidence', item);
      setEvidence((previous) => [item, ...previous.filter((candidate) => candidate.id !== item.id)]);
      return { ok: true };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async function startVanCheck(vanId: string): Promise<{ result: InventoryOperationResult; check?: InventoryCheck }> {
    if (!currentUser) return { result: { ok: false, message: 'Debes iniciar sesión.' } };
    const assigned = vanAssets.filter((asset) => asset.vanId === vanId && asset.assigned);
    if (!assigned.length) return { result: { ok: false, message: 'Esta van no tiene herramientas asignadas.' } };
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const check: InventoryCheck = {
        id: nowId('van-check'), scope: 'van', vanId, status: 'draft', startedAt: now,
        startedByUserId: currentUser.id, startedByName: currentUser.name, totalItems: assigned.length,
      };
      const newEntries: InventoryCheckEntry[] = assigned.map((asset) => ({
        id: `${check.id}-${asset.id}`, checkId: check.id, scope: 'van', vanId, assetId: asset.id,
        label: toolCatalog.find((tool) => tool.id === asset.toolCatalogId)?.name ?? asset.assetCode,
        assetCode: asset.assetCode, status: 'pending', condition: asset.condition, updatedAt: now,
      }));
      await persist('inventoryChecks', check);
      for (const entry of newEntries) await persist('inventoryCheckEntries', entry);
      setChecks((previous) => [check, ...previous]);
      setEntries((previous) => [...previous, ...newEntries]);
      return { result: { ok: true }, check };
    } catch (cause) {
      return { result: { ok: false, message: cause instanceof Error ? cause.message : String(cause) } };
    } finally { setBusy(false); }
  }

  async function startWarehouseCheck(): Promise<{ result: InventoryOperationResult; check?: InventoryCheck }> {
    if (!currentUser) return { result: { ok: false, message: 'Debes iniciar sesión.' } };
    const active = warehouseItems.filter((item) => item.active !== false);
    if (!active.length) return { result: { ok: false, message: 'El depósito no tiene artículos registrados.' } };
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const check: InventoryCheck = {
        id: nowId('warehouse-check'), scope: 'warehouse', status: 'draft', startedAt: now,
        startedByUserId: currentUser.id, startedByName: currentUser.name, totalItems: active.length,
      };
      const newEntries: InventoryCheckEntry[] = active.map((item) => ({
        id: `${check.id}-${item.id}`, checkId: check.id, scope: 'warehouse', warehouseItemId: item.id,
        label: item.name, expectedQuantity: item.quantity, countedQuantity: undefined,
        status: 'pending', updatedAt: now,
      }));
      await persist('inventoryChecks', check);
      for (const entry of newEntries) await persist('inventoryCheckEntries', entry);
      setChecks((previous) => [check, ...previous]);
      setEntries((previous) => [...previous, ...newEntries]);
      return { result: { ok: true }, check };
    } catch (cause) {
      return { result: { ok: false, message: cause instanceof Error ? cause.message : String(cause) } };
    } finally { setBusy(false); }
  }

  async function saveCheckEntry(entry: InventoryCheckEntry): Promise<InventoryOperationResult> {
    try {
      const updated = { ...entry, updatedAt: new Date().toISOString() };
      await persist('inventoryCheckEntries', updated);
      setEntries((previous) => previous.map((candidate) => candidate.id === updated.id ? updated : candidate));
      return { ok: true };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async function completeCheck(checkId: string): Promise<InventoryOperationResult> {
    const check = checks.find((item) => item.id === checkId);
    if (!check) return { ok: false, message: 'El control ya no existe.' };
    const checkEntries = entries.filter((entry) => entry.checkId === checkId);
    const unresolved = checkEntries.filter((entry) => entry.status === 'pending' || (entry.scope === 'warehouse' && entry.countedQuantity === undefined));
    if (unresolved.length) return { ok: false, message: `Faltan ${unresolved.length} artículos por revisar.` };
    const vanWithoutPhoto = checkEntries.filter((entry) => entry.scope === 'van' && entry.status === 'present' && !entry.photoEvidenceId);
    if (vanWithoutPhoto.length) return { ok: false, message: `Faltan fotografías de ${vanWithoutPhoto.length} herramientas presentes.` };

    setBusy(true);
    try {
      const completedAt = new Date().toISOString();
      let value = 0;
      if (check.scope === 'warehouse') {
        for (const entry of checkEntries) {
          const item = warehouseItems.find((candidate) => candidate.id === entry.warehouseItemId);
          if (!item) continue;
          const counted = Math.max(0, Number(entry.countedQuantity ?? 0));
          value += counted * item.cost;
          await saveWarehouseItem({ ...item, quantity: counted, latestCountAt: completedAt });
        }
      } else {
        for (const entry of checkEntries) {
          const asset = vanAssets.find((candidate) => candidate.id === entry.assetId);
          if (!asset) continue;
          value += asset.purchaseCost;
          await saveVanAsset({ ...asset, present: entry.status === 'present', condition: entry.condition ?? asset.condition });
        }
      }
      const completed: InventoryCheck = {
        ...check,
        status: 'completed',
        completedAt,
        presentCount: checkEntries.filter((entry) => entry.status === 'present').length,
        missingCount: checkEntries.filter((entry) => entry.status === 'missing').length,
        replacementCount: checkEntries.filter((entry) => entry.condition === 'Requiere reemplazo').length,
        varianceCount: checkEntries.filter((entry) => entry.scope === 'warehouse' && Number(entry.countedQuantity) !== Number(entry.expectedQuantity)).length,
        inventoryValue: value,
      };
      await persist('inventoryChecks', completed);
      setChecks((previous) => previous.map((candidate) => candidate.id === completed.id ? completed : candidate));
      return { ok: true, message: 'Control de inventario completado.' };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    } finally { setBusy(false); }
  }

  const catalogById = useMemo(() => Object.fromEntries(toolCatalog.map((item) => [item.id, item])), [toolCatalog]);

  return {
    warehouseItems, toolCatalog, catalogById, vanAssets, checks, entries, evidence, vans,
    loading, busy, error, refresh, saveWarehouseItem, importFallbackWarehouse, createTool,
    saveVanAsset, saveInventoryEvidence, startVanCheck, startWarehouseCheck, saveCheckEntry, completeCheck,
  };
}
