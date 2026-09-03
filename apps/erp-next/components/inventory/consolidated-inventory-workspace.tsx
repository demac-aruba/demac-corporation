'use client';

import Image, { type ImageLoaderProps } from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  OFFICE_LOCATION_ID,
  WAREHOUSE_LOCATION_ID,
} from '../../lib/inventory';
import {
  canonicalVanId,
  loadCanonicalOperationsState,
  resolveCanonicalCrew,
  staffDisplayName,
  type CanonicalOperationsState,
  type CanonicalVan,
} from '../../lib/canonical-operations';
import {
  addInventoryToolToVan,
  allocateLegacyProductStock,
  cancelInventoryTransfer,
  createInventoryRequestId,
  createInventoryTransfer,
  getInventorySnapshot,
  moveInventoryTool,
  pickupInventoryTransfer,
  receiveInventoryTransfer,
  updateInventoryToolDetails,
  updateInventoryLocationState,
  type AddInventoryToolToVanInput,
  type InventoryBalance,
  type InventoryItem,
  type InventoryLocation,
  type InventorySnapshot,
  type InventoryToolAsset,
  type InventoryToolCatalogItem,
  type InventoryTransfer,
} from '../../lib/inventory-authority';
import { uploadVanToolPhoto, type InventoryToolPhotoUpload } from '../../lib/firebase/inventory-storage';
import { InventoryIcon, VanThumbnail, type InventoryIconName } from './inventory-visuals';
import styles from './consolidated-inventory-workspace.module.css';

const LEGACY_LOCATION_ID = 'LEGACY-UNASSIGNED';
type View = 'overview' | 'warehouse' | 'office' | 'vans' | 'tools' | 'transfers' | 'replenishment' | 'movements';
type VanSection = 'workspace' | 'overview' | 'consumables' | 'products' | 'tools';
type StockEdit = { item: InventoryItem; locationId: string; onHand: string; minimum: string; target: string };
type TransferDraftLine = { itemKind: 'product' | 'material'; itemId: string; quantity: number };
type VanInventoryStatus = { label: string; tone: 'ready' | 'attention' | 'pending' | 'unavailable' };
type ToolEdit = {
  asset: InventoryToolAsset;
  condition: string;
  notes: string;
  purchaseCost: string;
  quantityExpected: string;
  quantityPresent: string;
  destinationLocationId: string;
  transferReason: string;
  transferConfirmed: boolean;
};
type AddToolDraft = {
  requestId: string;
  vanId: string;
  catalogId: string;
  search: string;
  creatingNew: boolean;
  name: string;
  description: string;
  category: string;
  toolCost: string;
  trackingMode: 'individual' | 'quantity';
  recommendedQuantity: string;
  condition: string;
  quantity: string;
  notes: string;
};
type BackgroundAddToolTask = {
  requestId: string;
  label: string;
  vanLabel: string;
  file: File;
  input: Omit<AddInventoryToolToVanInput, 'photoUrl' | 'photoStoragePath' | 'thumbnailUrl' | 'thumbnailStoragePath'>;
  uploadedPhoto?: InventoryToolPhotoUpload;
};
type BackgroundToolJob = {
  requestId: string;
  label: string;
  vanLabel: string;
  status: 'uploading' | 'saving' | 'complete' | 'failed';
  task?: BackgroundAddToolTask;
  error?: string;
};

const TOOL_CONDITIONS = ['Nueva', 'Poco uso', 'Uso medio', 'Muy usada', 'Requiere reemplazo', 'No inspeccionada'] as const;
const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;

function balance(item: InventoryItem, locationId: string): InventoryBalance {
  return item.balances?.[locationId] ?? { onHand: 0, reserved: 0, minimum: 0, target: 0 };
}
function available(value: InventoryBalance) { return Math.max(0, value.onHand - value.reserved); }
function locationLabel(locations: InventoryLocation[], id: string) { return locations.find((location) => location.id === id)?.name ?? id; }
function dateTime(value?: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-US', { timeZone: 'America/Aruba', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function transferStatus(value: InventoryTransfer['status']) {
  return value === 'requested' ? 'Requested' : value === 'in_transit' ? 'In transit' : value === 'completed' ? 'Completed' : 'Cancelled';
}
function itemKey(item: InventoryItem) { return `${item.itemKind}:${item.id}`; }
function arubaDateKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Aruba', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function quantity(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
}
function money(value: number) {
  return `Afl. ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)}`;
}
function toolExpectedQuantity(asset: InventoryToolAsset) {
  if (asset.trackingMode !== 'quantity') return 1;
  return Math.max(0, Number(asset.quantityExpected ?? asset.quantity ?? 0) || 0);
}
function toolPresentQuantity(asset: InventoryToolAsset) {
  if (asset.trackingMode !== 'quantity') {
    const status = String(asset.operationalStatus ?? '').trim().toLowerCase();
    const statusIsMissing = ['missing', 'lost', 'faltante'].some((value) => status.includes(value));
    return asset.present === false || statusIsMissing ? 0 : 1;
  }
  const expected = toolExpectedQuantity(asset);
  return Math.max(0, Number(asset.quantityPresent ?? (asset.present === false ? 0 : asset.quantity ?? expected)) || 0);
}
function toolMissingQuantity(asset: InventoryToolAsset) {
  return Math.max(0, toolExpectedQuantity(asset) - toolPresentQuantity(asset));
}
function toolRecommendedQuantity(asset: InventoryToolAsset, catalog?: InventoryToolCatalogItem) {
  if (asset.trackingMode !== 'quantity') return 1;
  return Math.max(1, Math.floor(Number(catalog?.recommendedQuantity) || toolExpectedQuantity(asset) || 1));
}
function toolRecommendedShortfall(asset: InventoryToolAsset, catalog?: InventoryToolCatalogItem) {
  return Math.max(0, toolRecommendedQuantity(asset, catalog) - toolPresentQuantity(asset));
}
function toolQuantity(asset: InventoryToolAsset) {
  return toolExpectedQuantity(asset);
}
function toolThumbnailUrl(asset: InventoryToolAsset) {
  if (asset.latestThumbnailUrl) return asset.latestThumbnailUrl;
  if (!asset.latestPhotoUrl) return '';
  return `/api/inventory-thumbnail?sourceUrl=${encodeURIComponent(asset.latestPhotoUrl)}`;
}
function toolCanTransfer(asset: InventoryToolAsset) {
  if (asset.trackingMode === 'quantity') return false;
  const status = inventoryStatusText(asset.operationalStatus);
  return asset.present !== false && !['prestada', 'loaned', 'faltante', 'missing', 'en reparacion', 'en reparación', 'retirada', 'desechada'].some((blocked) => status.includes(blocked));
}
function inventoryStatusText(value?: string) {
  return String(value ?? '').trim().toLowerCase();
}
function isLiveToolAsset(asset: InventoryToolAsset) {
  const status = inventoryStatusText(asset.operationalStatus);
  return asset.active !== false
    && asset.assigned !== false
    && !asset.retiredAt
    && !['retirada', 'retired', 'desechada', 'disposed'].some((blocked) => status.includes(blocked));
}
function toolNeedsService(asset: InventoryToolAsset) {
  const condition = inventoryStatusText(asset.condition);
  const status = inventoryStatusText(asset.operationalStatus);
  const dueAt = asset.maintenanceDueAt ? Date.parse(asset.maintenanceDueAt) : Number.NaN;
  return condition.includes('requiere reemplazo')
    || condition.includes('damaged')
    || condition.includes('dañad')
    || status.includes('repair')
    || status.includes('repar')
    || (Number.isFinite(dueAt) && dueAt <= Date.now());
}
function toolLocationId(asset: InventoryToolAsset) {
  return asset.inventoryLocationId || asset.locationId || asset.vanId || '';
}
function toolCatalogName(catalog?: InventoryToolCatalogItem) {
  return catalog?.name?.trim() || catalog?.id || 'Tool template';
}
function normalizedToolCatalogName(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 240).toLocaleLowerCase('en');
}

function ToolPhoto({ asset, onOpen, mode = 'thumbnail' }: { asset: InventoryToolAsset; onOpen: (url: string) => void; mode?: 'thumbnail' | 'detail' }) {
  const [failed, setFailed] = useState(false);
  const thumbnail = toolThumbnailUrl(asset);
  const original = asset.latestPhotoUrl || asset.latestThumbnailUrl || '';
  const displayUrl = mode === 'detail' ? original : thumbnail;
  useEffect(() => setFailed(false), [displayUrl]);
  if (!displayUrl || failed) return <span className={styles.toolPhotoFallback}><InventoryIcon name="tool" /></span>;
  return <button type="button" className={styles.toolPhotoButton} onClick={() => onOpen(original)} aria-label={`Open photo for ${asset.assetCode || asset.id}`}>
    <Image loader={passthroughImageLoader} src={displayUrl} alt="" fill sizes={mode === 'detail' ? '(max-width: 760px) 100vw, 72px' : '52px'} unoptimized onError={() => setFailed(true)} />
  </button>;
}

function InventoryLoadingSkeleton() {
  return <section className={`${styles.page} ${styles.loadingShell}`} aria-label="Loading live inventory" aria-busy="true">
    <div className={styles.skeletonHeader}><span /><span /></div>
    <div className={styles.skeletonMetrics}>{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div>
    <div className={styles.skeletonPanel}><span /><span /><span /><span /></div>
    <span className={styles.skeletonLabel}>Loading live inventory…</span>
  </section>;
}

export function ConsolidatedInventoryWorkspace() {
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [operations, setOperations] = useState<CanonicalOperationsState | null>(null);
  const [operationsUnavailable, setOperationsUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<View>('overview');
  const [vanSection, setVanSection] = useState<VanSection>('workspace');
  const [activeVanId, setActiveVanId] = useState('');
  const [stockEdit, setStockEdit] = useState<StockEdit | null>(null);
  const [legacyItem, setLegacyItem] = useState<InventoryItem | null>(null);
  const [legacyWarehouse, setLegacyWarehouse] = useState('0');
  const [legacyOffice, setLegacyOffice] = useState('0');
  const [sourceLocationId, setSourceLocationId] = useState(WAREHOUSE_LOCATION_ID);
  const [destinationLocationId, setDestinationLocationId] = useState(OFFICE_LOCATION_ID);
  const [pickupName, setPickupName] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [lineItemKey, setLineItemKey] = useState('');
  const [lineQuantity, setLineQuantity] = useState('1');
  const [transferLines, setTransferLines] = useState<TransferDraftLine[]>([]);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [transferNotes, setTransferNotes] = useState<Record<string, string>>({});
  const [toolEdit, setToolEdit] = useState<ToolEdit | null>(null);
  const [toolLightbox, setToolLightbox] = useState('');
  const [addToolDraft, setAddToolDraft] = useState<AddToolDraft | null>(null);
  const [addToolPhoto, setAddToolPhoto] = useState<File | null>(null);
  const [addToolPhotoPreview, setAddToolPhotoPreview] = useState('');
  const [backgroundToolJob, setBackgroundToolJob] = useState<BackgroundToolJob | null>(null);
  const [mobileToolQuery, setMobileToolQuery] = useState('');
  const [mobileToolAction, setMobileToolAction] = useState<'summary' | 'edit' | 'transfer'>('summary');
  const operationsLoadStarted = useRef(false);
  const toolProfileHistoryEntry = useRef(false);
  const backgroundToolJobRunning = backgroundToolJob?.status === 'uploading' || backgroundToolJob?.status === 'saving';

  const closeToolProfile = useCallback(() => {
    const shouldConsumeHistory = typeof window !== 'undefined'
      && toolProfileHistoryEntry.current
      && window.history.state?.inventoryOverlay === 'tool-profile';
    toolProfileHistoryEntry.current = false;
    setToolLightbox('');
    setMobileToolAction('summary');
    setToolEdit(null);
    if (shouldConsumeHistory) window.history.back();
  }, []);

  const refresh = useCallback(async () => {
    const startedAt = typeof performance === 'undefined' ? 0 : performance.now();
    try {
      const next = await getInventorySnapshot();
      setSnapshot(next);
      setError('');
      const firstVan = next.locations
        .filter((location) => location.type === 'van')
        .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true, sensitivity: 'base' }))[0]?.id ?? '';
      setActiveVanId((current) => current && next.locations.some((location) => location.id === current) ? current : firstVan);
      setLineItemKey((current) => current && next.items.some((item) => itemKey(item) === current) ? current : (next.items[0] ? itemKey(next.items[0]) : ''));
      if (startedAt && typeof performance !== 'undefined') {
        performance.measure('demac.inventory.snapshot', { start: startedAt, end: performance.now() });
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inventory could not be loaded.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOperationsEnrichment = useCallback(async () => {
    if (operationsLoadStarted.current) return;
    operationsLoadStarted.current = true;
    const startedAt = typeof performance === 'undefined' ? 0 : performance.now();
    try {
      const nextOperations = await loadCanonicalOperationsState();
      setOperations(nextOperations);
      setOperationsUnavailable(false);
    } catch {
      operationsLoadStarted.current = false;
      setOperationsUnavailable(true);
    } finally {
      if (startedAt && typeof performance !== 'undefined') {
        performance.measure('demac.inventory.operations-enrichment', { start: startedAt, end: performance.now() });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadOperationsEnrichment();
  }, [loadOperationsEnrichment, refresh]);
  useEffect(() => {
    if (!toolEdit && !toolLightbox && !addToolDraft) return undefined;
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (toolLightbox) setToolLightbox('');
      else if (toolEdit) closeToolProfile();
      else {
        setError('');
        setAddToolDraft(null);
        setAddToolPhoto(null);
        setAddToolPhotoPreview('');
      }
    };
    window.addEventListener('keydown', closeOverlay);
    return () => window.removeEventListener('keydown', closeOverlay);
  }, [addToolDraft, closeToolProfile, toolEdit, toolLightbox]);
  useEffect(() => () => {
    if (addToolPhotoPreview) URL.revokeObjectURL(addToolPhotoPreview);
  }, [addToolPhotoPreview]);
  useEffect(() => {
    const syncFromHistory = () => {
      toolProfileHistoryEntry.current = false;
      setToolLightbox('');
      setToolEdit(null);
      setMobileToolAction('summary');
      const params = new URLSearchParams(window.location.search);
      const requestedView = params.get('inventoryView');
      const requestedSection = params.get('vanSection');
      const allowedViews: View[] = ['overview', 'warehouse', 'office', 'vans', 'tools', 'transfers', 'replenishment', 'movements'];
      const allowedSections: VanSection[] = ['workspace', 'overview', 'consumables', 'products', 'tools'];
      setView(allowedViews.includes(requestedView as View) ? requestedView as View : 'overview');
      setVanSection(allowedSections.includes(requestedSection as VanSection) ? requestedSection as VanSection : 'workspace');
    };
    syncFromHistory();
    window.addEventListener('popstate', syncFromHistory);
    return () => window.removeEventListener('popstate', syncFromHistory);
  }, []);

  const locations = snapshot?.locations ?? [];
  const normalLocations = locations.filter((location) => location.type !== 'legacy');
  const vans = normalLocations
    .filter((location) => location.type === 'van')
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { numeric: true, sensitivity: 'base' }));
  const items = useMemo(() => (snapshot?.items ?? []).filter((item) => item.active !== false), [snapshot]);
  const products = items.filter((item) => item.itemKind === 'product');
  const materials = items.filter((item) => item.itemKind === 'material');
  const openTransfers = (snapshot?.transfers ?? []).filter((transfer) => transfer.status === 'requested' || transfer.status === 'in_transit');
  const companyProductUnits = products.reduce((total, item) => total + Object.values(item.balances || {}).reduce((sum, row) => sum + Number(row.onHand || 0), 0), 0);
  const selectedTransferItem = items.find((item) => itemKey(item) === lineItemKey);
  const legacyProducts = products.filter((item) => (item.balances?.[LEGACY_LOCATION_ID]?.onHand ?? 0) > 0);
  const activeToolAssets = (snapshot?.toolAssets ?? []).filter(isLiveToolAsset);
  const vanLocationIds = new Set(vans.map((van) => van.id));
  const toolsAssignedToVans = activeToolAssets.filter((asset) => vanLocationIds.has(asset.inventoryLocationId || asset.locationId || asset.vanId || ''));
  const today = arubaDateKey();

  function writeInventoryHistory(nextView: View, nextSection: VanSection = 'workspace') {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (nextView === 'overview') {
      url.searchParams.delete('inventoryView');
      url.searchParams.delete('vanSection');
    } else {
      url.searchParams.set('inventoryView', nextView);
      if (nextView === 'vans' && nextSection !== 'workspace') url.searchParams.set('vanSection', nextSection);
      else url.searchParams.delete('vanSection');
    }
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.pushState({ inventoryView: nextView, vanSection: nextSection }, '', nextUrl);
  }

  function openView(nextView: View) {
    setView(nextView);
    if (nextView === 'vans') setVanSection('workspace');
    writeInventoryHistory(nextView);
  }

  function openVanSection(nextSection: VanSection) {
    setView('vans');
    setVanSection(nextSection);
    writeInventoryHistory('vans', nextSection);
  }

  function profileForVan(location: InventoryLocation): CanonicalVan | undefined {
    if (!operations) return undefined;
    const exactId = location.vanId || location.id;
    const exact = operations.vans.find((van) => van.id === exactId);
    if (exact) return exact;
    const lane = canonicalVanId(location.name || exactId, operations.vans);
    return operations.vans.find((van) => canonicalVanId(van.id, operations.vans) === lane);
  }

  function crewForVan(location: InventoryLocation) {
    const profile = profileForVan(location);
    if (!profile || !operations) return [] as string[];
    const crew = resolveCanonicalCrew(profile, today, operations);
    return [crew.driver, crew.helper, crew.additionalHelper]
      .filter((member): member is NonNullable<typeof member> => Boolean(member))
      .map((member) => staffDisplayName(member));
  }

  function toolsAt(locationId: string) {
    return activeToolAssets.filter((asset) => (asset.inventoryLocationId || asset.locationId || asset.vanId) === locationId);
  }

  function transferTouches(locationId: string, transfer: InventoryTransfer) {
    return transfer.sourceLocationId === locationId || transfer.destinationLocationId === locationId;
  }

  function statusForVan(location: InventoryLocation): VanInventoryStatus {
    const profileStatus = inventoryStatusText(profileForVan(location)?.status);
    if (profileStatus && !['disponible', 'available', 'active', 'ready'].includes(profileStatus)) {
      return { label: profileForVan(location)?.status || 'Unavailable', tone: 'unavailable' };
    }
    if ((snapshot?.replenishment ?? []).some((row) => row.locationId === location.id)) {
      return { label: 'Replenishment needed', tone: 'attention' };
    }
    if (openTransfers.some((transfer) => transferTouches(location.id, transfer))) {
      return { label: 'Transfer pending', tone: 'pending' };
    }
    return { label: 'Ready', tone: 'ready' };
  }

  function onHandAt(locationId: string, kind?: InventoryItem['itemKind']) {
    return items
      .filter((item) => !kind || item.itemKind === kind)
      .reduce((sum, item) => sum + Number(balance(item, locationId).onHand || 0), 0);
  }

  function reservedAt(locationId: string, kind?: InventoryItem['itemKind']) {
    return items
      .filter((item) => !kind || item.itemKind === kind)
      .reduce((sum, item) => sum + Number(balance(item, locationId).reserved || 0), 0);
  }

  const activeVan = vans.find((van) => van.id === activeVanId) ?? vans[0];
  const activeVanProfile = activeVan ? profileForVan(activeVan) : undefined;
  const activeVanCrew = activeVan ? crewForVan(activeVan) : [];
  const activeVanTools = activeVan ? toolsAt(activeVan.id) : [];
  const activeVanTransfers = activeVan ? openTransfers.filter((transfer) => transferTouches(activeVan.id, transfer)) : [];
  const activeVanReplenishment = activeVan ? (snapshot?.replenishment ?? []).filter((row) => row.locationId === activeVan.id) : [];
  const activeVanMovements = activeVan ? (snapshot?.movements ?? []).filter((row) => row.sourceLocationId === activeVan.id || row.destinationLocationId === activeVan.id) : [];
  const activeVanMissingTools = activeVanTools.filter((asset) => toolMissingQuantity(asset) > 0);
  const addToolWriteAvailable = (snapshot?.version ?? 0) >= 2;
  const activeToolCatalog = [...(snapshot?.toolCatalog ?? [])]
    .filter((catalog) => catalog.active !== false)
    .sort((a, b) => toolCatalogName(a).localeCompare(toolCatalogName(b), undefined, { numeric: true, sensitivity: 'base' }));
  const catalogVanCoverage = new Map<string, InventoryLocation[]>();
  for (const asset of activeToolAssets) {
    if (!asset.toolCatalogId) continue;
    const van = vans.find((candidate) => candidate.id === toolLocationId(asset));
    if (!van) continue;
    const coveredVans = catalogVanCoverage.get(asset.toolCatalogId) ?? [];
    if (!coveredVans.some((candidate) => candidate.id === van.id)) coveredVans.push(van);
    catalogVanCoverage.set(asset.toolCatalogId, coveredVans);
  }
  const activeVanCatalogIds = new Set(activeVanTools.map((asset) => asset.toolCatalogId).filter(Boolean));
  const missingVanToolTemplates = activeToolCatalog
    .filter((catalog) => !activeVanCatalogIds.has(catalog.id))
    .map((catalog) => ({ catalog, vans: (catalogVanCoverage.get(catalog.id) ?? []).filter((van) => van.id !== activeVan?.id) }))
    .filter((entry) => entry.vans.length > 0);
  const selectedAddToolCatalog = addToolDraft?.catalogId
    ? activeToolCatalog.find((catalog) => catalog.id === addToolDraft.catalogId)
    : undefined;
  const normalizedCatalogSearch = addToolDraft?.search.trim().toLowerCase() ?? '';
  const filteredToolCatalog = activeToolCatalog.filter((catalog) => {
    if (!normalizedCatalogSearch) return true;
    return `${catalog.id} ${catalog.name ?? ''} ${catalog.description ?? ''} ${catalog.category ?? ''}`.toLowerCase().includes(normalizedCatalogSearch);
  }).slice(0, 8);

  const inventorySnapshotRows = useMemo(() => {
    const stockSummary = (kind: InventoryItem['itemKind']) => {
      const records = items.filter((item) => item.itemKind === kind);
      const onHand = records.reduce((sum, item) => sum + Object.values(item.balances || {}).reduce((rowSum, row) => rowSum + Number(row.onHand || 0), 0), 0);
      const reserved = records.reduce((sum, item) => sum + Object.values(item.balances || {}).reduce((rowSum, row) => rowSum + Number(row.reserved || 0), 0), 0);
      const value = records.reduce((sum, item) => {
        const unitValue = kind === 'product' ? Number(item.price || 0) : Number(item.cost || 0);
        return sum + unitValue * Object.values(item.balances || {}).reduce((rowSum, row) => rowSum + Number(row.onHand || 0), 0);
      }, 0);
      const alerts = (snapshot?.replenishment ?? []).filter((row) => row.itemKind === kind).length;
      const out = records.filter((item) => normalLocations.every((location) => available(balance(item, location.id)) <= 0)).length;
      return { items: records.length, onHand, reserved, available: Math.max(0, onHand - reserved), alerts, out, value };
    };
    const productsSummary = stockSummary('product');
    const materialsSummary = stockSummary('material');
    const toolUnits = activeToolAssets.reduce((sum, asset) => sum + toolPresentQuantity(asset), 0);
    const toolMissing = activeToolAssets.reduce((sum, asset) => sum + toolMissingQuantity(asset), 0);
    const toolLowStock = activeToolAssets.reduce((sum, asset) => {
      const catalog = snapshot?.toolCatalog.find((tool) => tool.id === asset.toolCatalogId);
      return sum + toolRecommendedShortfall(asset, catalog);
    }, 0);
    const toolOutOfStock = activeToolAssets.filter((asset) => toolPresentQuantity(asset) === 0).length;
    const toolValue = activeToolAssets.reduce((sum, asset) => {
      const catalog = snapshot?.toolCatalog.find((tool) => tool.id === asset.toolCatalogId);
      const unitCost = Number.isFinite(Number(asset.purchaseCost)) ? Number(asset.purchaseCost) : Number(catalog?.standardCost || 0);
      return sum + unitCost * toolQuantity(asset);
    }, 0);
    return [
      { label: 'Products', ...productsSummary },
      { label: 'Consumables', ...materialsSummary },
      { label: 'Tools', items: activeToolAssets.length, onHand: toolUnits, reserved: 0, available: toolUnits, alerts: Math.max(toolMissing, toolLowStock), out: toolOutOfStock, value: toolValue },
    ];
  }, [activeToolAssets, items, normalLocations, snapshot?.replenishment, snapshot?.toolCatalog]);

  function isPending(actionKey: string) {
    return pendingActions.has(actionKey);
  }

  function isTransferPending(transferId: string) {
    return ['cancel', 'pickup', 'receive'].some((action) => isPending(`transfer:${action}:${transferId}`));
  }

  async function run(actionKey: string, action: () => Promise<unknown>, success: string) {
    setPendingActions((current) => new Set(current).add(actionKey));
    setError(''); setNotice('');
    try {
      await action();
      setNotice(success);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inventory operation failed.');
    } finally {
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(actionKey);
        return next;
      });
    }
  }

  async function refreshInventory() {
    const actionKey = 'refresh';
    setPendingActions((current) => new Set(current).add(actionKey));
    setError(''); setNotice('');
    try {
      const [refreshed] = await Promise.all([refresh(), loadOperationsEnrichment()]);
      if (refreshed) setNotice('Live inventory refreshed.');
    } finally {
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(actionKey);
        return next;
      });
    }
  }

  function beginStockEdit(item: InventoryItem, locationId: string) {
    const current = balance(item, locationId);
    setStockEdit({ item, locationId, onHand: String(current.onHand), minimum: String(current.minimum), target: String(current.target) });
  }

  async function saveStockEdit() {
    if (!stockEdit) return;
    const onHand = Math.max(0, Number(stockEdit.onHand) || 0);
    const minimum = Math.max(0, Number(stockEdit.minimum) || 0);
    const target = Math.max(minimum, Number(stockEdit.target) || 0);
    await run(`stock:${stockEdit.locationId}:${itemKey(stockEdit.item)}`, async () => {
      await updateInventoryLocationState({ requestId: createInventoryRequestId('location-inventory-state'), itemKind: stockEdit.item.itemKind, itemId: stockEdit.item.id, locationId: stockEdit.locationId, onHand, minimum, target, reason: 'Office verified physical stock count and replenishment policy' });
      setStockEdit(null);
    }, 'Stock and replenishment policy updated.');
  }

  function openLegacyAllocation(item: InventoryItem) {
    const quantity = item.balances?.[LEGACY_LOCATION_ID]?.onHand ?? 0;
    setLegacyItem(item);
    setLegacyWarehouse(String(quantity));
    setLegacyOffice('0');
  }

  async function saveLegacyAllocation() {
    if (!legacyItem) return;
    const warehouse = Math.max(0, Math.floor(Number(legacyWarehouse) || 0));
    const office = Math.max(0, Math.floor(Number(legacyOffice) || 0));
    await run(`legacy:${legacyItem.id}`, () => allocateLegacyProductStock({
      requestId: createInventoryRequestId('legacy-allocation'),
      itemId: legacyItem.id,
      allocations: [
        { locationId: WAREHOUSE_LOCATION_ID, quantity: warehouse },
        { locationId: OFFICE_LOCATION_ID, quantity: office },
      ],
    }), 'Historical Product stock assigned to real locations without changing company total.');
    setLegacyItem(null);
  }

  function addTransferLine() {
    const item = items.find((candidate) => itemKey(candidate) === lineItemKey);
    const quantity = Number(lineQuantity);
    if (!item || !Number.isFinite(quantity) || quantity <= 0) return;
    if (item.itemKind === 'product' && !Number.isInteger(quantity)) { setError('Products must be transferred in whole units.'); return; }
    setTransferLines((current) => {
      const existing = current.find((line) => line.itemKind === item.itemKind && line.itemId === item.id);
      if (existing) return current.map((line) => line === existing ? { ...line, quantity: line.quantity + quantity } : line);
      return [...current, { itemKind: item.itemKind, itemId: item.id, quantity }];
    });
    setLineQuantity('1');
  }

  async function submitTransfer() {
    if (!transferLines.length) { setError('Add at least one Product or Consumable to the transfer.'); return; }
    if (sourceLocationId === destinationLocationId) { setError('Source and destination must be different.'); return; }
    await run('transfer:create', async () => {
      await createInventoryTransfer({
        requestId: createInventoryRequestId('transfer'),
        sourceLocationId,
        destinationLocationId,
        assignedPickupName: pickupName,
        note: transferNote,
        lines: transferLines,
      });
      setTransferLines([]); setPickupName(''); setTransferNote('');
    }, 'Transfer requested and source stock reserved.');
  }

  function draftQuantity(transfer: InventoryTransfer, lineId: string, stage: 'picked' | 'received', fallback: number) {
    return quantityDrafts[`${transfer.id}:${lineId}:${stage}`] ?? String(fallback);
  }
  function setDraftQuantity(transfer: InventoryTransfer, lineId: string, stage: 'picked' | 'received', value: string) {
    setQuantityDrafts((current) => ({ ...current, [`${transfer.id}:${lineId}:${stage}`]: value }));
  }

  async function pickup(transfer: InventoryTransfer) {
    await run(`transfer:pickup:${transfer.id}`, () => pickupInventoryTransfer({
      requestId: createInventoryRequestId('pickup'), transferId: transfer.id,
      lines: transfer.lines.map((line) => ({ lineId: line.lineId, pickedQuantity: Math.max(0, Number(draftQuantity(transfer, line.lineId, 'picked', line.requestedQuantity)) || 0) })),
      note: transferNotes[transfer.id] ?? '',
    }), 'Transfer picked up. Stock is now in transit.');
  }
  async function receive(transfer: InventoryTransfer) {
    await run(`transfer:receive:${transfer.id}`, () => receiveInventoryTransfer({
      requestId: createInventoryRequestId('receive'), transferId: transfer.id,
      lines: transfer.lines.map((line) => ({ lineId: line.lineId, receivedQuantity: Math.max(0, Number(draftQuantity(transfer, line.lineId, 'received', line.pickedQuantity)) || 0) })),
      discrepancyNote: transferNotes[transfer.id] ?? '',
    }), 'Transfer received and destination stock updated.');
  }
  async function cancelTransfer(transfer: InventoryTransfer) {
    await run(`transfer:cancel:${transfer.id}`, () => cancelInventoryTransfer({ requestId: createInventoryRequestId('transfer-cancel'), transferId: transfer.id, reason: transferNotes[transfer.id] || 'Cancelled by office before pickup' }), 'Transfer cancelled and reservation released.');
  }

  function beginToolEdit(asset: InventoryToolAsset) {
    const catalog = snapshot?.toolCatalog.find((tool) => tool.id === asset.toolCatalogId);
    const purchaseCost = Number.isFinite(Number(asset.purchaseCost)) ? Number(asset.purchaseCost) : Number(catalog?.standardCost || 0);
    if (typeof window !== 'undefined' && !toolProfileHistoryEntry.current) {
      const currentState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
      window.history.pushState({ ...currentState, inventoryOverlay: 'tool-profile', inventoryToolId: asset.id }, '', window.location.href);
      toolProfileHistoryEntry.current = true;
    }
    setMobileToolAction('summary');
    setToolEdit({
      asset,
      condition: asset.condition || 'No inspeccionada',
      notes: asset.notes || '',
      purchaseCost: String(purchaseCost),
      quantityExpected: String(toolExpectedQuantity(asset)),
      quantityPresent: String(toolPresentQuantity(asset)),
      destinationLocationId: '',
      transferReason: '',
      transferConfirmed: false,
    });
  }

  async function saveToolDetails() {
    if (!toolEdit) return;
    const purchaseCost = Number(toolEdit.purchaseCost);
    if (!Number.isFinite(purchaseCost) || purchaseCost < 0) { setError('Tool value must be zero or greater.'); return; }
    const quantityExpected = Number(toolEdit.quantityExpected);
    const quantityPresent = Number(toolEdit.quantityPresent);
    if (toolEdit.asset.trackingMode === 'quantity' && (!Number.isInteger(quantityExpected) || !Number.isInteger(quantityPresent) || quantityExpected < 0 || quantityPresent < 0 || quantityPresent > quantityExpected)) {
      setError('Quantity present and assigned must be whole numbers, and present cannot exceed assigned.');
      return;
    }
    await run(`tool-edit:${toolEdit.asset.id}`, async () => {
      await updateInventoryToolDetails({
        requestId: createInventoryRequestId('tool-details'),
        assetId: toolEdit.asset.id,
        condition: toolEdit.condition,
        notes: toolEdit.notes,
        purchaseCost,
        ...(toolEdit.asset.trackingMode === 'quantity' ? { quantityExpected, quantityPresent } : {}),
      });
      closeToolProfile();
    }, 'Tool details updated.');
  }

  async function moveTool() {
    if (!toolEdit) return;
    if (!toolCanTransfer(toolEdit.asset)) { setError('This tool cannot be transferred from its current tracking or operational state.'); return; }
    if (!toolEdit.destinationLocationId) { setError('Choose a destination for the tool.'); return; }
    if (!toolEdit.transferReason.trim()) { setError('A transfer reason is required.'); return; }
    if (!toolEdit.transferConfirmed) { setError('Confirm the transfer summary before moving the tool.'); return; }
    await run(`tool-move:${toolEdit.asset.id}`, async () => {
      await moveInventoryTool({
        requestId: createInventoryRequestId('tool-move'),
        assetId: toolEdit.asset.id,
        destinationLocationId: toolEdit.destinationLocationId,
        reason: toolEdit.transferReason,
      });
      closeToolProfile();
    }, 'Tool transferred and movement recorded.');
  }

  function addToolDraftFor(vanId: string, catalog?: InventoryToolCatalogItem): AddToolDraft {
    const trackingMode = catalog?.trackingMode ?? 'individual';
    const recommendedQuantity = Math.max(1, Math.floor(Number(catalog?.recommendedQuantity) || 1));
    const referenceCost = Math.max(0, Number(catalog?.standardCost) || 0);
    return {
      requestId: createInventoryRequestId('van-tool'),
      vanId,
      catalogId: catalog?.id ?? '',
      search: catalog ? toolCatalogName(catalog) : '',
      creatingNew: false,
      name: catalog ? toolCatalogName(catalog) : '',
      description: catalog?.description ?? '',
      category: catalog?.category ?? '',
      toolCost: String(referenceCost),
      trackingMode,
      recommendedQuantity: String(recommendedQuantity),
      condition: '',
      quantity: trackingMode === 'individual' ? '1' : String(recommendedQuantity),
      notes: '',
    };
  }

  function openAddTool(catalog?: InventoryToolCatalogItem) {
    if (!activeVan || backgroundToolJobRunning) return;
    setError('');
    setNotice('');
    setAddToolPhoto(null);
    setAddToolPhotoPreview('');
    setAddToolDraft(addToolDraftFor(activeVan.id, catalog));
  }

  function closeAddTool() {
    setError('');
    setAddToolDraft(null);
    setAddToolPhoto(null);
    setAddToolPhotoPreview('');
  }

  function chooseCatalogForAdd(catalog: InventoryToolCatalogItem) {
    setAddToolDraft((current) => current ? {
      ...addToolDraftFor(current.vanId, catalog),
      requestId: current.requestId,
      condition: current.condition,
      notes: current.notes,
    } : current);
  }

  function beginNewToolTemplate() {
    setAddToolDraft((current) => current ? {
      ...current,
      catalogId: '',
      creatingNew: true,
      name: current.search.trim(),
      description: '',
      category: '',
      toolCost: '0',
      trackingMode: 'individual',
      recommendedQuantity: '1',
      quantity: '1',
    } : current);
  }

  function chooseAddToolPhoto(file?: File) {
    setAddToolPhoto(file ?? null);
    setAddToolPhotoPreview(file ? URL.createObjectURL(file) : '');
    setAddToolDraft((current) => current ? { ...current, requestId: createInventoryRequestId('van-tool') } : current);
  }

  async function runBackgroundAddTool(task: BackgroundAddToolTask) {
    setBackgroundToolJob({ requestId: task.requestId, label: task.label, vanLabel: task.vanLabel, status: task.uploadedPhoto ? 'saving' : 'uploading', task });
    let retryTask = task;
    try {
      const photo = task.uploadedPhoto ?? await uploadVanToolPhoto({ file: task.file, requestId: task.requestId, vanId: task.input.vanId });
      retryTask = { ...task, uploadedPhoto: photo };
      setBackgroundToolJob((current) => current?.requestId === task.requestId
        ? { ...current, status: 'saving', task: retryTask, error: undefined }
        : current);
      const result = await addInventoryToolToVan({
        ...task.input,
        photoUrl: photo.downloadUrl,
        photoStoragePath: photo.storagePath,
        thumbnailUrl: photo.thumbnailUrl,
        thumbnailStoragePath: photo.thumbnailStoragePath,
      });
      await refresh();
      const successMessage = `${toolCatalogName(result.catalog)} added to ${task.vanLabel} with a new physical photo.`;
      setNotice(successMessage);
      setBackgroundToolJob((current) => current?.requestId === task.requestId
        ? { requestId: task.requestId, label: task.label, vanLabel: task.vanLabel, status: 'complete' }
        : current);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The tool could not be added to this Van.';
      setBackgroundToolJob((current) => current?.requestId === task.requestId
        ? { ...current, status: 'failed', task: retryTask, error: message }
        : current);
    }
  }

  function retryBackgroundAddTool() {
    if (!backgroundToolJob?.task || backgroundToolJobRunning) return;
    const task = backgroundToolJob.task;
    setError('');
    setNotice('');
    setBackgroundToolJob({ requestId: task.requestId, label: task.label, vanLabel: task.vanLabel, status: task.uploadedPhoto ? 'saving' : 'uploading', task });
    window.setTimeout(() => { void runBackgroundAddTool(task); }, 0);
  }

  function submitAddTool() {
    if (!addToolDraft) return;
    const existingCatalog = addToolDraft.catalogId
      ? activeToolCatalog.find((catalog) => catalog.id === addToolDraft.catalogId)
      : undefined;
    if (!addToolDraft.creatingNew && !existingCatalog) { setError('Choose a tool template or create a new one.'); return; }
    if (addToolDraft.creatingNew && !addToolDraft.name.trim()) { setError('Enter a name for the new tool template.'); return; }
    if (addToolDraft.creatingNew && !addToolDraft.category.trim()) { setError('Enter a category for the new tool template.'); return; }
    const duplicateCatalog = addToolDraft.creatingNew
      ? activeToolCatalog.find((catalog) => normalizedToolCatalogName(toolCatalogName(catalog)) === normalizedToolCatalogName(addToolDraft.name))
      : undefined;
    if (duplicateCatalog) { setError(`“${toolCatalogName(duplicateCatalog)}” already exists. Select that shared template instead of creating a duplicate.`); return; }
    if (!addToolDraft.condition) { setError('Choose the physical condition of this tool.'); return; }
    if (!addToolPhoto) { setError('Take or choose a fresh photo of the tool being added to this Van.'); return; }

    const toolCost = Number(addToolDraft.toolCost);
    const recommendedQuantity = Number(addToolDraft.recommendedQuantity);
    const requestedQuantity = addToolDraft.trackingMode === 'individual' ? 1 : Number(addToolDraft.quantity);
    if (!Number.isFinite(toolCost) || toolCost < 0) { setError('Tool cost must be zero or greater.'); return; }
    if (addToolDraft.creatingNew && (!Number.isInteger(recommendedQuantity) || recommendedQuantity < 1)) { setError('Recommended quantity must be a whole number of at least one.'); return; }
    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1) { setError('Quantity must be a whole number of at least one.'); return; }

    const targetVan = vans.find((van) => van.id === addToolDraft.vanId);
    const task: BackgroundAddToolTask = {
      requestId: addToolDraft.requestId,
      label: addToolDraft.creatingNew ? addToolDraft.name.trim() : toolCatalogName(existingCatalog),
      vanLabel: targetVan?.name || addToolDraft.vanId,
      file: addToolPhoto,
      input: {
        requestId: addToolDraft.requestId,
        vanId: addToolDraft.vanId,
        ...(addToolDraft.creatingNew ? {
          newCatalog: {
            name: addToolDraft.name.trim(),
            ...(addToolDraft.description.trim() ? { description: addToolDraft.description.trim() } : {}),
            category: addToolDraft.category.trim(),
            standardCost: toolCost,
            trackingMode: addToolDraft.trackingMode,
            recommendedQuantity,
          },
        } : { toolCatalogId: existingCatalog!.id }),
        condition: addToolDraft.condition,
        purchaseCost: toolCost,
        quantity: requestedQuantity,
        ...(addToolDraft.notes.trim() ? { notes: addToolDraft.notes.trim() } : {}),
      },
    };
    setError('');
    setNotice('');
    setBackgroundToolJob({ requestId: task.requestId, label: task.label, vanLabel: task.vanLabel, status: 'uploading', task });
    closeAddTool();
    window.setTimeout(() => { void runBackgroundAddTool(task); }, 0);
  }

  function StockTable({ locationId, itemKind, title }: { locationId: string; itemKind?: InventoryItem['itemKind']; title?: string }) {
    const location = locations.find((candidate) => candidate.id === locationId);
    const visibleItems = items.filter((item) => !itemKind || item.itemKind === itemKind);
    return <section className={styles.panel}>
      <header className={styles.panelHead}><div><strong>{title || location?.name || locationId}</strong><span>{itemKind === 'product' ? 'Sellable products' : itemKind === 'material' ? 'Operational consumables' : 'Products and consumables'} at this physical location</span></div><b>{visibleItems.filter((item) => balance(item, locationId).onHand > 0).length} stocked lines</b></header>
      <div className={styles.tableWrap}><table><thead><tr><th>Item</th><th>Type</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Min</th><th>Target</th><th /></tr></thead><tbody>
        {visibleItems.map((item) => { const value = balance(item, locationId); return <tr key={`${locationId}:${itemKey(item)}`}>
          <td><strong>{item.name}</strong><small>{item.sku || item.category}</small></td><td>{item.itemKind === 'product' ? 'Product' : 'Consumable'}</td><td>{value.onHand}</td><td>{value.reserved}</td><td><b>{available(value)}</b></td><td>{value.minimum}</td><td>{value.target}</td><td><button type="button" onClick={() => beginStockEdit(item, locationId)}>Count / Par</button></td>
        </tr>; })}
      </tbody></table></div>
      {!visibleItems.length ? <p className={styles.empty}>No active inventory items are available in this category.</p> : null}
    </section>;
  }

  function renderToolTable({ locationId, allowAdd = false }: { locationId?: string; allowAdd?: boolean }) {
    const visibleTools = [...(locationId ? toolsAt(locationId) : activeToolAssets)]
      .sort((a, b) => (a.assetCode || a.id).localeCompare(b.assetCode || b.id, undefined, { numeric: true, sensitivity: 'base' }));
    const normalizedQuery = mobileToolQuery.trim().toLowerCase();
    const mobileVisibleTools = normalizedQuery ? visibleTools.filter((asset) => {
      const catalog = snapshot?.toolCatalog.find((tool) => tool.id === asset.toolCatalogId);
      return [asset.assetCode, asset.id, catalog?.name, catalog?.category, asset.condition, asset.operationalStatus]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    }) : visibleTools;
    const assignedUnits = visibleTools.reduce((sum, asset) => sum + toolExpectedQuantity(asset), 0);
    const missingUnits = visibleTools.reduce((sum, asset) => sum + toolMissingQuantity(asset), 0);
    const serviceDue = visibleTools.filter(toolNeedsService).length;
    const assetValue = visibleTools.reduce((sum, asset) => {
      const catalog = snapshot?.toolCatalog.find((tool) => tool.id === asset.toolCatalogId);
      const unitCost = Number.isFinite(Number(asset.purchaseCost)) ? Number(asset.purchaseCost) : Number(catalog?.standardCost || 0);
      return sum + unitCost * toolExpectedQuantity(asset);
    }, 0);
    return <section className={styles.panel}>
      <header className={styles.panelHead}><div><strong>{locationId ? `${locationLabel(locations, locationId)} tools` : 'Tool assets'}</strong><span>{locationId ? 'Physically assigned to this Van' : 'Real asset details, stored photos and controlled editing'}</span></div><div className={styles.panelHeadActions}><b>{quantity(assignedUnits)} assigned · {visibleTools.length} records</b>{allowAdd ? <button type="button" className={styles.addToolButton} disabled={backgroundToolJobRunning} onClick={() => openAddTool()}>{backgroundToolJobRunning ? 'Adding tool…' : '+ Add Tool'}</button> : null}</div></header>
      {locationId && allowAdd ? <div className={styles.mobileToolMetrics} aria-label="Van tool summary">
        <article><span className={styles.blue}><InventoryIcon name="tool" /></span><div><small>Total tools</small><strong>{quantity(assignedUnits)}</strong></div></article>
        <article><span className={missingUnits ? styles.red : styles.green}><InventoryIcon name="warning" /></span><div><small>Missing</small><strong>{quantity(missingUnits)}</strong></div></article>
        <article><span className={serviceDue ? styles.orange : styles.green}><InventoryIcon name="warning" /></span><div><small>Service / damage</small><strong>{quantity(serviceDue)}</strong></div></article>
        <article><span className={styles.purple}><InventoryIcon name="package" /></span><div><small>Asset value</small><strong>{money(assetValue)}</strong></div></article>
      </div> : null}
      <div className={styles.mobileToolSearch}><label><InventoryIcon name="overview" /><input type="search" value={mobileToolQuery} onChange={(event) => setMobileToolQuery(event.target.value)} placeholder="Search tools or asset ID" aria-label="Search tools or asset ID" /></label><span>{mobileVisibleTools.length} items</span></div>
      <div className={styles.mobileToolList}>{mobileVisibleTools.map((asset) => {
        const catalog = snapshot?.toolCatalog.find((tool) => tool.id === asset.toolCatalogId);
        const expected = toolExpectedQuantity(asset);
        const present = toolPresentQuantity(asset);
        const missing = toolMissingQuantity(asset);
        const recommended = toolRecommendedQuantity(asset, catalog);
        const unitCost = Number.isFinite(Number(asset.purchaseCost)) ? Number(asset.purchaseCost) : Number(catalog?.standardCost || 0);
        const isMissing = missing > 0;
        return <article key={`mobile:${asset.id}`} className={styles.mobileToolRow}>
          <ToolPhoto asset={asset} onOpen={setToolLightbox} />
          <button type="button" className={styles.mobileToolOpen} onClick={() => beginToolEdit(asset)}>
            <span className={styles.mobileToolCopy}><strong>{catalog?.name || asset.toolCatalogId || 'Tool'}</strong><small>{asset.assetCode || asset.id} · {asset.condition || 'No inspeccionada'}</small><span><b>Qty {present}/{expected}</b><b>{money(unitCost)}{expected > 1 ? ' ea.' : ''}</b></span><small>Recommended {recommended}</small></span>
            <span className={`${styles.mobileToolStatus} ${isMissing ? styles.mobileToolStatusAlert : ''}`}><small>{isMissing ? `${missing} missing` : `${present} available`}</small><i aria-hidden="true">›</i></span>
          </button>
        </article>;
      })}{!mobileVisibleTools.length ? <p className={styles.empty}>No tools match this search.</p> : null}</div>
      <div className={`${styles.tableWrap} ${styles.toolTable} ${styles.desktopToolTable}`}><table><thead><tr><th>Photo</th><th>Asset / tool</th><th>Use</th><th>Quantity</th><th>Value</th><th>Status</th><th>Location</th><th>Comments</th><th /></tr></thead><tbody>{visibleTools.map((asset) => {
        const catalog = snapshot?.toolCatalog.find((tool) => tool.id === asset.toolCatalogId);
        const expected = toolExpectedQuantity(asset);
        const present = toolPresentQuantity(asset);
        const missing = toolMissingQuantity(asset);
        const recommended = toolRecommendedQuantity(asset, catalog);
        const unitCost = Number.isFinite(Number(asset.purchaseCost)) ? Number(asset.purchaseCost) : Number(catalog?.standardCost || 0);
        return <tr key={asset.id}>
          <td><ToolPhoto asset={asset} onOpen={setToolLightbox} /></td>
          <td><strong>{asset.assetCode || asset.id}</strong><small>{catalog?.name || asset.toolCatalogId || 'Tool'}{catalog?.category ? ` · ${catalog.category}` : ''}</small></td>
          <td>{asset.condition || 'No inspeccionada'}</td>
          <td><strong>{present} / {expected}</strong><small>{missing} missing · {recommended} recommended</small></td>
          <td>{money(unitCost)}{expected > 1 ? <small>{money(unitCost * expected)} total</small> : null}</td>
          <td><strong>{asset.operationalStatus || '—'}</strong><small>{present} available · {missing} missing</small></td>
          <td>{locationLabel(locations, asset.inventoryLocationId || asset.locationId || asset.vanId || '')}</td>
          <td className={styles.toolNotes}>{asset.notes || '—'}</td>
          <td><button type="button" onClick={() => beginToolEdit(asset)}>Edit</button></td>
        </tr>;
      })}</tbody></table></div>
      {!visibleTools.length ? <p className={styles.empty}>No active tool assets are assigned to this location.</p> : null}
    </section>;
  }

  function MissingToolTemplates() {
    if (!activeVan) return null;
    return <section className={`${styles.panel} ${styles.missingToolTemplates}`}>
      <header className={styles.panelHead}><div><strong>Templates in other Vans</strong><span>Shared catalog tools not physically assigned to {activeVan.name}</span></div><b>{missingVanToolTemplates.length} available</b></header>
      {missingVanToolTemplates.length ? <div className={styles.missingToolGrid}>{missingVanToolTemplates.map(({ catalog, vans: templateVans }) => <article key={catalog.id} className={styles.missingToolCard}>
        <span className={styles.missingToolIcon}><InventoryIcon name="tool" /></span>
        <div className={styles.missingToolCopy}><strong>{toolCatalogName(catalog)}</strong><small>{catalog.description || catalog.category || 'No shared description'}</small><div><span>Cost</span><b>{money(Number(catalog.standardCost) || 0)}</b></div><p><span>Currently in</span>{templateVans.map((van) => van.name).join(', ')}</p></div>
        <button type="button" disabled={backgroundToolJobRunning} onClick={() => openAddTool(catalog)}>{backgroundToolJobRunning ? 'Adding tool…' : 'Add to this Van'}</button>
      </article>)}</div> : <p className={styles.empty}>Every shared tool template already has an assignment in this Van.</p>}
    </section>;
  }

  function AddToolDrawer() {
    if (!addToolDraft) return null;
    const targetVan = vans.find((van) => van.id === addToolDraft.vanId);
    const hasTemplateChoice = addToolDraft.creatingNew || Boolean(selectedAddToolCatalog);
    const showCatalogResults = Boolean(addToolDraft.search.trim()) && !hasTemplateChoice;
    return <div className={styles.toolDrawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) closeAddTool(); }}>
      <section className={`${styles.toolDrawer} ${styles.addToolDrawer}`} role="dialog" aria-modal="true" aria-labelledby="add-tool-title">
        <header><div><span>New physical Van assignment</span><h2 id="add-tool-title">Add Tool</h2><small>{targetVan?.name || addToolDraft.vanId} · fresh photo required</small></div><button type="button" aria-label="Close add tool" onClick={closeAddTool}>×</button></header>
        <div className={styles.addToolBody}>
          {error ? <div className={styles.addToolError} role="alert">{error}</div> : null}
          <section className={styles.catalogChooser}>
            <header><strong>1. Find a shared tool template</strong><span>Search once, then use a match or create the missing template.</span></header>
            <label className={styles.catalogSearch}><InventoryIcon name="overview" /><input type="search" autoFocus value={addToolDraft.search} onChange={(event) => setAddToolDraft({ ...addToolDraft, search: event.target.value, catalogId: '', creatingNew: false })} placeholder="Search name, description or category" /></label>
            {showCatalogResults ? <div className={styles.catalogResults}>{filteredToolCatalog.map((catalog) => {
              const coverage = catalogVanCoverage.get(catalog.id) ?? [];
              const isSelected = addToolDraft.catalogId === catalog.id && !addToolDraft.creatingNew;
              return <button key={catalog.id} type="button" className={isSelected ? styles.catalogResultSelected : ''} onClick={() => chooseCatalogForAdd(catalog)}>
                <span className={styles.catalogResultIcon}><InventoryIcon name="tool" /></span><span><strong>{toolCatalogName(catalog)}</strong><small>{catalog.description || catalog.category || 'No shared description'}</small><em>{coverage.length ? `In ${coverage.map((van) => van.name).join(', ')}` : 'No current Van assignment'}</em></span><b>{money(Number(catalog.standardCost) || 0)}</b>
              </button>;
            })}{!filteredToolCatalog.length ? <p>No matching shared templates.</p> : null}</div> : null}
            <button type="button" className={styles.newCatalogButton} onClick={beginNewToolTemplate}>+ Create a new template{addToolDraft.search.trim() ? ` for “${addToolDraft.search.trim()}”` : ''}</button>
          </section>

          {hasTemplateChoice ? <>
            {addToolDraft.creatingNew ? <section className={styles.addToolSection}><header><strong>Shared template details</strong><span>These fields can be reused by every Van.</span></header><div className={styles.addToolGrid}>
              <label>Name<input value={addToolDraft.name} maxLength={160} onChange={(event) => setAddToolDraft({ ...addToolDraft, name: event.target.value })} /></label>
              <label>Category<input value={addToolDraft.category} maxLength={120} onChange={(event) => setAddToolDraft({ ...addToolDraft, category: event.target.value })} /></label>
              <label className={styles.wide}>Description<textarea rows={3} maxLength={1000} value={addToolDraft.description} onChange={(event) => setAddToolDraft({ ...addToolDraft, description: event.target.value })} placeholder="What this tool is and what it is used for" /></label>
              <label>Tracking<select value={addToolDraft.trackingMode} onChange={(event) => { const trackingMode = event.target.value as AddToolDraft['trackingMode']; setAddToolDraft({ ...addToolDraft, trackingMode, quantity: trackingMode === 'individual' ? '1' : addToolDraft.recommendedQuantity }); }}><option value="individual">Individual asset</option><option value="quantity">Quantity</option></select></label>
              <label>Recommended quantity<input type="number" min="1" step="1" value={addToolDraft.recommendedQuantity} onChange={(event) => setAddToolDraft({ ...addToolDraft, recommendedQuantity: event.target.value, ...(addToolDraft.trackingMode === 'quantity' ? { quantity: event.target.value } : {}) })} /></label>
            </div></section> : selectedAddToolCatalog ? <section className={styles.selectedCatalogCard}><span className={styles.catalogResultIcon}><InventoryIcon name="tool" /></span><div><small>Selected shared template</small><strong>{toolCatalogName(selectedAddToolCatalog)}</strong><p>{selectedAddToolCatalog.description || 'No shared description'}</p><span>{selectedAddToolCatalog.category || 'Uncategorized'} · {selectedAddToolCatalog.trackingMode === 'quantity' ? 'Quantity tracked' : 'Individual asset'} · {money(Number(selectedAddToolCatalog.standardCost) || 0)}</span></div><button type="button" onClick={() => setAddToolDraft({ ...addToolDraft, catalogId: '', search: '', creatingNew: false })}>Change</button></section> : null}

            <section className={styles.addToolSection}><header><strong>2. This physical assignment</strong><span>Condition, cost and quantity belong to {targetVan?.name || 'this Van'}.</span></header><div className={styles.addToolGrid}>
              <label>Condition<select value={addToolDraft.condition} onChange={(event) => setAddToolDraft({ ...addToolDraft, condition: event.target.value })}><option value="">Choose condition…</option>{TOOL_CONDITIONS.map((condition) => <option key={condition} value={condition}>{condition}</option>)}</select></label>
              <label>Tool cost (Afl.)<input type="number" min="0" step="0.01" value={addToolDraft.toolCost} onChange={(event) => setAddToolDraft({ ...addToolDraft, toolCost: event.target.value })} /></label>
              <label>Quantity<input type="number" min="1" step="1" disabled={addToolDraft.trackingMode === 'individual'} value={addToolDraft.trackingMode === 'individual' ? '1' : addToolDraft.quantity} onChange={(event) => setAddToolDraft({ ...addToolDraft, quantity: event.target.value })} /><small>{addToolDraft.trackingMode === 'individual' ? 'One individual asset per add.' : 'Adds this many physical units.'}</small></label>
              <label className={styles.wide}>Notes<textarea rows={3} value={addToolDraft.notes} onChange={(event) => setAddToolDraft({ ...addToolDraft, notes: event.target.value })} placeholder="Optional assignment notes" /></label>
            </div></section>

            <section className={styles.addToolSection}><header><strong>3. Fresh photo for this Van</strong><span>Another Van’s photo is never reused. The thumbnail is generated automatically.</span></header><label className={`${styles.addToolPhotoField} ${addToolPhotoPreview ? styles.addToolPhotoReady : ''}`}>
              {addToolPhotoPreview ? <img src={addToolPhotoPreview} alt="New tool photo preview" /> : <span><InventoryIcon name="tool" /><strong>Take or choose a photo</strong><small>Image only · optimized before upload</small></span>}
              <input type="file" accept="image/*" capture="environment" onChange={(event) => chooseAddToolPhoto(event.target.files?.[0])} />
              {addToolPhotoPreview ? <b>Replace photo</b> : null}
            </label></section>
          </> : <p className={styles.addToolPrompt}>Choose a shared template above or create a new one to continue.</p>}
        </div>
        <footer className={styles.addToolFooter}><span>{addToolWriteAvailable ? 'The form closes immediately; photo processing continues in the background.' : 'Preview ready · final saving activates with Inventory Authority v2.'}</span><div><button type="button" onClick={closeAddTool}>Cancel</button><button type="button" className={styles.primary} disabled={!hasTemplateChoice || !addToolWriteAvailable} onClick={submitAddTool}>Add Tool & continue</button></div></footer>
      </section>
    </div>;
  }

  function MetricCard({ icon, label, value, detail, tone = 'blue' }: { icon: InventoryIconName; label: string; value: string | number; detail: string; tone?: 'blue' | 'purple' | 'green' | 'orange' | 'red' }) {
    return <article className={styles.metricCard}><span className={`${styles.metricIcon} ${styles[tone]}`}><InventoryIcon name={icon} /></span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
  }

  function VanStatusChip({ status }: { status: VanInventoryStatus }) {
    return <span className={`${styles.statusChip} ${styles[status.tone]}`}><i />{status.label}</span>;
  }

  function ActivityList({ rows, emptyText }: { rows: InventorySnapshot['movements']; emptyText: string }) {
    return <div className={styles.activityList}>{rows.slice(0, 5).map((row) => <article key={row.id}><span className={styles.activityIcon}><InventoryIcon name={row.type.includes('transfer') ? 'transfer' : row.type.includes('tool') ? 'tool' : 'movement'} /></span><div><strong>{row.itemName}</strong><small>{row.type.replaceAll('_', ' ')} · {quantity(row.quantity)}</small></div><time>{dateTime(row.occurredAt)}</time></article>)}{!rows.length ? <p className={styles.empty}>{emptyText}</p> : null}</div>;
  }

  function VanWorkspaceRow({ icon, title, description, value, tone, onClick }: { icon: InventoryIconName; title: string; description: string; value?: string; tone?: 'purple' | 'green' | 'orange'; onClick: () => void }) {
    return <button type="button" className={`${styles.vanWorkspaceRow} ${tone ? styles[`row${tone[0].toUpperCase()}${tone.slice(1)}`] : ''}`} onClick={onClick}><span className={styles.workspaceRowIcon}><InventoryIcon name={icon} /></span><span className={styles.workspaceRowCopy}><strong>{title}</strong><small>{description}</small></span>{value ? <b>{value}</b> : null}<i aria-hidden="true">›</i></button>;
  }

  function openMobileVanTools() {
    if (!activeVan) { openView('tools'); return; }
    openVanSection('tools');
    setMobileToolQuery('');
  }

  function MobileBottomNav() {
    const buttons: Array<{ label: string; icon: InventoryIconName; active: boolean; onClick: () => void }> = [
      { label: 'Inventory', icon: 'overview', active: view === 'overview' || view === 'warehouse' || view === 'office', onClick: () => openView('overview') },
      { label: 'Vans', icon: 'van', active: view === 'vans' && vanSection === 'workspace', onClick: () => openView('vans') },
      { label: 'Tools', icon: 'tool', active: view === 'tools' || (view === 'vans' && vanSection === 'tools'), onClick: openMobileVanTools },
      { label: 'Activity', icon: 'movement', active: view === 'movements', onClick: () => openView('movements') },
      { label: 'Alerts', icon: 'warning', active: view === 'replenishment', onClick: () => openView('replenishment') },
    ];
    return <nav className={styles.mobileBottomNav} aria-label="Inventory mobile navigation">{buttons.map((button) => <button key={button.label} type="button" className={button.active ? styles.mobileNavActive : ''} onClick={button.onClick}><InventoryIcon name={button.icon} /><span>{button.label}</span></button>)}</nav>;
  }

  function MobileOverview() {
    return <section className={styles.mobileOverview}>
      <header className={styles.mobilePageHeader}><div><span className={styles.eyebrow}>Inventory control</span><h1>Inventory</h1></div><button type="button" aria-label="Refresh live inventory" disabled={isPending('refresh')} onClick={() => void refreshInventory()}>↻</button></header>
      <nav className={styles.mobileLocationNav} aria-label="Inventory locations"><button type="button" onClick={() => openView('warehouse')}><InventoryIcon name="warehouse" />Warehouse</button><button type="button" onClick={() => openView('office')}><InventoryIcon name="office" />Office</button><button type="button" className={styles.mobileLocationActive} onClick={() => openView('vans')}><InventoryIcon name="van" />Vans</button></nav>

      <section className={styles.mobileSection}><header><h2>Overview</h2><button type="button" onClick={() => openView('tools')}>View all</button></header><div className={styles.mobileMetricGrid}>
        <button type="button" onClick={() => openView('warehouse')}><span className={styles.blue}><InventoryIcon name="package" /></span><b>{products.length}</b><small>Products</small></button>
        <button type="button" onClick={() => openView('office')}><span className={styles.purple}><InventoryIcon name="bottle" /></span><b>{materials.length}</b><small>Consumables</small></button>
        <button type="button" onClick={() => openView('tools')}><span className={styles.orange}><InventoryIcon name="tool" /></span><b>{quantity(toolsAssignedToVans.reduce((sum, asset) => sum + toolExpectedQuantity(asset), 0))}</b><small>Tools</small></button>
        <button type="button" onClick={() => openView('transfers')}><span className={styles.green}><InventoryIcon name="transfer" /></span><b>{openTransfers.length}</b><small>Transfers</small></button>
      </div></section>

      <section className={styles.mobileSection}><header><h2>Quick access</h2></header><div className={styles.mobileQuickGrid}>
        <button type="button" onClick={() => openView('vans')}><span><InventoryIcon name="van" /></span><b>Van inventory</b><small>{vans.length} active vans</small></button>
        <button type="button" onClick={() => openView('warehouse')}><span><InventoryIcon name="warehouse" /></span><b>Stock counts</b><small>Count / par</small></button>
        <button type="button" onClick={() => openView('transfers')}><span><InventoryIcon name="transfer" /></span><b>Transfers</b><small>{openTransfers.length} open</small></button>
        <button type="button" onClick={() => openView('replenishment')}><span><InventoryIcon name="warning" /></span><b>Alerts</b><small>{snapshot?.replenishment.length ?? 0} to review</small></button>
      </div></section>

      {activeVan ? <section className={styles.mobileSection}><header><h2>Selected Van</h2><button type="button" onClick={() => openView('vans')}>See all</button></header><button type="button" className={styles.mobileVanCard} onClick={() => openView('vans')}><VanThumbnail imageUrl={activeVanProfile?.imageUrl} name={activeVan.name} size="small" /><span><strong>{activeVan.name}</strong><small>{activeVanCrew.length ? activeVanCrew.slice(0, 2).join(', ') + (activeVanCrew.length > 2 ? ` +${activeVanCrew.length - 2}` : '') : 'Crew unassigned'}</small></span><VanStatusChip status={statusForVan(activeVan)} /><i aria-hidden="true">›</i></button></section> : null}
    </section>;
  }

  function MobileLocationWorkspace({ locationId, kind }: { locationId: string; kind: 'warehouse' | 'office' }) {
    const location = locations.find((candidate) => candidate.id === locationId);
    const locationItems = [...items].sort((left, right) => {
      const stockDifference = balance(right, locationId).onHand - balance(left, locationId).onHand;
      return stockDifference || left.name.localeCompare(right.name);
    });
    const totalOnHand = locationItems.reduce((sum, item) => sum + Number(balance(item, locationId).onHand || 0), 0);
    const totalReserved = locationItems.reduce((sum, item) => sum + Number(balance(item, locationId).reserved || 0), 0);
    const lowStock = locationItems.filter((item) => {
      const value = balance(item, locationId);
      return value.minimum > 0 && available(value) > 0 && available(value) <= value.minimum;
    }).length;
    const outOfStock = locationItems.filter((item) => {
      const value = balance(item, locationId);
      return value.minimum > 0 && available(value) <= 0;
    }).length;
    const stockValue = locationItems.reduce((sum, item) => {
      const unitValue = item.itemKind === 'product' ? Number(item.price || 0) : Number(item.cost || 0);
      return sum + unitValue * Number(balance(item, locationId).onHand || 0);
    }, 0);
    const locationTransfers = openTransfers.filter((transfer) => transferTouches(locationId, transfer));
    const imageSrc = kind === 'warehouse' ? '/images/inventory/inventory-warehouse.webp' : '/images/inventory/inventory-office.webp';
    const title = kind === 'warehouse' ? 'Warehouse' : 'Office';
    const subtitle = kind === 'warehouse' ? 'Main warehouse stock' : 'Office supplies & small equipment';

    return <section className={styles.mobileLocationWorkspace}>
      <header className={styles.mobilePageHeader}><div><span className={styles.eyebrow}>Inventory control</span><h1>{title}</h1></div><button type="button" aria-label={`Refresh ${title} inventory`} disabled={isPending('refresh')} onClick={() => void refreshInventory()}>↻</button></header>
      <nav className={styles.mobileLocationNav} aria-label="Inventory locations"><button type="button" className={kind === 'warehouse' ? styles.mobileLocationActive : ''} onClick={() => openView('warehouse')}><InventoryIcon name="warehouse" />Warehouse</button><button type="button" className={kind === 'office' ? styles.mobileLocationActive : ''} onClick={() => openView('office')}><InventoryIcon name="office" />Office</button><button type="button" onClick={() => openView('vans')}><InventoryIcon name="van" />Vans</button></nav>

      <article className={styles.mobileLocationCard}><div className={styles.mobileLocationVisual}><Image src={imageSrc} alt="" fill sizes="104px" unoptimized /></div><div><span>{location?.name || title}</span><strong>{subtitle}</strong><small>{locationItems.filter((item) => balance(item, locationId).onHand > 0).length} stocked lines · {quantity(Math.max(0, totalOnHand - totalReserved))} available units</small></div><span className={`${styles.statusChip} ${styles.ready}`}><i />Live</span></article>

      <section className={styles.mobileSection}><header><div><h2>Location overview</h2><p>Real stock at this physical location.</p></div></header><div className={styles.mobileLocationMetrics}>
        <article><span className={styles.blue}><InventoryIcon name="package" /></span><div><small>Units on hand</small><strong>{quantity(totalOnHand)}</strong></div></article>
        <article><span className={lowStock ? styles.orange : styles.green}><InventoryIcon name="warning" /></span><div><small>Low stock</small><strong>{lowStock}</strong></div></article>
        <article><span className={outOfStock ? styles.red : styles.green}><InventoryIcon name="warning" /></span><div><small>Out of stock</small><strong>{outOfStock}</strong></div></article>
        <article><span className={styles.purple}><InventoryIcon name="package" /></span><div><small>Stock value</small><strong>{money(stockValue)}</strong></div></article>
      </div></section>

      <section className={styles.mobileSection}><header><div><h2>Stock at this location</h2><p>Count, availability and par levels.</p></div><span className={styles.mobileSectionCount}>{locationItems.length} items</span></header><div className={styles.mobileStockList}>
        {locationItems.map((item) => {
          const value = balance(item, locationId);
          const availableUnits = available(value);
          const needsStock = value.minimum > 0 && availableUnits <= value.minimum;
          return <article className={styles.mobileStockRow} key={`${kind}:${itemKey(item)}`}><span className={item.itemKind === 'product' ? styles.blue : styles.purple}><InventoryIcon name={item.itemKind === 'product' ? 'package' : 'bottle'} /></span><div><strong>{item.name}</strong><small>{item.sku || item.category || (item.itemKind === 'product' ? 'Product' : 'Consumable')}</small><p><b>{quantity(value.onHand)} on hand</b><span>{quantity(availableUnits)} available · par {quantity(value.target)}</span></p></div><div><span className={needsStock ? styles.stockAttention : styles.stockReady}>{availableUnits <= 0 ? 'Out' : needsStock ? 'Low' : 'Ready'}</span><button type="button" onClick={() => beginStockEdit(item, locationId)}>Count</button></div></article>;
        })}
        {!locationItems.length ? <p className={styles.empty}>No active items are configured for this location.</p> : null}
      </div></section>

      <section className={styles.mobileSection}><header><h2>Quick actions</h2></header><div className={styles.mobileLocationActions}><button type="button" onClick={() => openView('transfers')}><InventoryIcon name="transfer" /><span><b>Transfers</b><small>{locationTransfers.length} open</small></span><i>›</i></button><button type="button" onClick={() => openView('movements')}><InventoryIcon name="movement" /><span><b>Movements</b><small>View location history</small></span><i>›</i></button></div></section>
    </section>;
  }

  function MobileVanWorkspace() {
    if (!activeVan) return <section className={styles.mobileVanWorkspace}><p className={styles.empty}>No active Van inventory locations are available.</p></section>;
    return <section className={styles.mobileVanWorkspace}>
      <header className={styles.mobilePageHeader}><div><span className={styles.eyebrow}>Van inventory</span><h1>{activeVan.name}</h1></div><button type="button" aria-label="Refresh Van inventory" disabled={isPending('refresh')} onClick={() => void refreshInventory()}>↻</button></header>
      <label className={styles.mobileVanSelector}><VanThumbnail imageUrl={activeVanProfile?.imageUrl} name={activeVan.name} size="small" /><span><small>Selected Van</small><select value={activeVan.id} onChange={(event) => setActiveVanId(event.target.value)}>{vans.map((van) => <option key={van.id} value={van.id}>{van.name}</option>)}</select><b>{activeVanCrew.length ? activeVanCrew.slice(0, 2).join(', ') + (activeVanCrew.length > 2 ? ` +${activeVanCrew.length - 2}` : '') : 'Crew unassigned'}</b></span><VanStatusChip status={statusForVan(activeVan)} /></label>
      <section className={styles.mobileSection}><header><div><h2>Choose a view</h2><p>Open only the information you need.</p></div></header><div className={styles.mobileVanGrid}>
        <button type="button" onClick={() => openVanSection('overview')}><span><InventoryIcon name="overview" /></span><b>Overview</b><small>{onHandAt(activeVan.id)} units</small></button>
        <button type="button" onClick={() => openVanSection('consumables')}><span className={styles.purple}><InventoryIcon name="bottle" /></span><b>Consumables</b><small>{onHandAt(activeVan.id, 'material')} on hand</small></button>
        <button type="button" onClick={() => openVanSection('products')}><span className={styles.green}><InventoryIcon name="package" /></span><b>Products</b><small>{onHandAt(activeVan.id, 'product')} on hand</small></button>
        <button type="button" onClick={openMobileVanTools}><span className={styles.orange}><InventoryIcon name="tool" /></span><b>Tools</b><small>{quantity(activeVanTools.reduce((sum, asset) => sum + toolQuantity(asset), 0))} assigned</small></button>
        <button type="button" onClick={() => openView('transfers')}><span><InventoryIcon name="transfer" /></span><b>Transfers</b><small>{activeVanTransfers.length} open</small></button>
        <button type="button" onClick={() => openView('replenishment')}><span><InventoryIcon name="warning" /></span><b>Alerts</b><small>{activeVanReplenishment.length} to review</small></button>
      </div></section>
    </section>;
  }

  const tabs: Array<{ id: View; label: string }> = [
    ['overview', 'Overview'], ['warehouse', 'Warehouse'], ['office', 'Office'], ['vans', 'Vans'], ['tools', 'Tools'], ['transfers', 'Transfers'], ['replenishment', 'Replenishment'], ['movements', 'Movements'],
  ].map(([id, label]) => ({ id: id as View, label }));

  if (loading) return <InventoryLoadingSkeleton />;
  if (!snapshot) return <section className={styles.page}><div className={styles.state}>{error || 'Inventory is unavailable.'}<button type="button" onClick={() => { setLoading(true); void refresh(); }}>Retry</button></div></section>;

  return <section className={styles.page}>
    <header className={`${styles.hero} ${view === 'overview' ? styles.overviewHero : ''} ${view === 'vans' ? styles.vanHero : ''} ${view === 'warehouse' || view === 'office' ? styles.locationHero : ''}`}>
      <div><span className={styles.eyebrow}>{view === 'vans' ? 'Inventory · Mobile warehouses' : 'Inventory · One authority'}</span><h1>{view === 'vans' ? 'Van Inventory Workspace' : 'Inventory Control'}</h1><p>{view === 'vans' ? 'Select a Van and choose the inventory view you want to manage.' : 'One authority for Warehouse, Office, Vans, Products, Consumables and Tools.'}</p></div>
      {view === 'overview' ? <details className={styles.actionMenu}><summary>Inventory actions <span>⌄</span></summary><div><button type="button" onClick={() => openView('warehouse')}>Open Warehouse</button><button type="button" onClick={() => openView('office')}>Open Office</button><button type="button" onClick={() => openView('tools')}>Open Tools</button><button type="button" onClick={() => openView('transfers')}>Manage transfers</button><button type="button" onClick={() => openView('replenishment')}>View replenishment</button><button type="button" onClick={() => openView('movements')}>View movements</button><button type="button" disabled={isPending('refresh')} onClick={() => void refreshInventory()}>{isPending('refresh') ? 'Refreshing…' : 'Refresh live inventory'}</button></div></details> : <div className={styles.heroActions}><button type="button" onClick={() => openView(view === 'vans' && vanSection !== 'workspace' ? 'vans' : 'overview')}>{view === 'vans' && vanSection !== 'workspace' ? '← Van workspace' : '← Inventory Control'}</button><button type="button" className={styles.primary} disabled={isPending('refresh')} onClick={() => void refreshInventory()}>{isPending('refresh') ? 'Refreshing…' : 'Refresh'}</button></div>}
    </header>

    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {operationsUnavailable ? <div className={styles.enrichmentNotice}>Van profile details are temporarily unavailable. Live inventory quantities and operations remain available.</div> : null}
    {legacyProducts.length ? <div className={styles.warning}><strong>{legacyProducts.length} Product{legacyProducts.length === 1 ? '' : 's'} have historical stock without a known location.</strong><span>Assign the full quantity between Warehouse and Office once. The system will not guess or duplicate it.</span></div> : null}

    {view !== 'overview' && view !== 'vans' ? <nav className={styles.tabs}>{tabs.map((tab) => <button key={tab.id} type="button" className={view === tab.id ? styles.activeTab : ''} onClick={() => openView(tab.id)}>{tab.label}</button>)}</nav> : null}

    {view === 'overview' ? <><MobileOverview /><div className={styles.desktopOverview}>
      <div className={styles.metrics}>
        <MetricCard icon="package" label="Total Products" value={products.length} detail={`${quantity(companyProductUnits)} units on hand`} />
        <MetricCard icon="bottle" label="Consumables" value={materials.length} detail="Canonical material records" tone="purple" />
        <MetricCard icon="van" label="Active Vans" value={vans.length} detail={`${vans.length} inventory locations`} tone="green" />
        <MetricCard icon="tool" label="Tools Assigned" value={quantity(toolsAssignedToVans.reduce((sum, asset) => sum + toolExpectedQuantity(asset), 0))} detail={`${toolsAssignedToVans.length} active asset records`} tone="orange" />
        <MetricCard icon="transfer" label="Open Transfers" value={openTransfers.length} detail="Requested + in transit" />
        <MetricCard icon="warning" label="Replenishment Alerts" value={snapshot.replenishment.length} detail="Below configured minimum" tone="red" />
      </div>

      <div className={styles.overviewTopGrid}>
        <section className={`${styles.panel} ${styles.workspacePanel}`}><header className={styles.panelHead}><div><strong>Choose an inventory workspace</strong><span>Select where you want to view and manage inventory.</span></div></header><div className={styles.workspaceCards}>
          <article className={styles.workspaceCard}><div className={`${styles.workspaceVisual} ${styles.warehouseVisual}`}><Image src="/images/inventory/inventory-warehouse.webp" alt="Warehouse inventory workspace" fill sizes="28vw" unoptimized /></div><h2>Warehouse</h2><p>View, store and manage inventory in the main warehouse.</p><ul><li>Bulk stock management</li><li>Receiving & put-away</li><li>Stock adjustments</li><li>Cycle counts</li></ul><button type="button" onClick={() => openView('warehouse')}>Open Warehouse</button></article>
          <article className={styles.workspaceCard}><div className={`${styles.workspaceVisual} ${styles.officeVisual}`}><Image src="/images/inventory/inventory-office.webp" alt="Office inventory workspace" fill sizes="28vw" unoptimized /></div><h2>Office</h2><p>Manage office inventory and operational consumables.</p><ul><li>Office consumables</li><li>Small tools & equipment</li><li>Administrative stock</li><li>Usage tracking</li></ul><button type="button" onClick={() => openView('office')}>Open Office</button></article>
          <article className={`${styles.workspaceCard} ${styles.workspaceCardActive}`}><VanThumbnail name="DEMAC" size="large" /><h2>Vans</h2><p>Access Van inventory including products, consumables and tools.</p><ul><li>Van stock & locations</li><li>Consumables by Van</li><li>Tools assigned</li><li>Stock transfers</li></ul><button type="button" className={styles.primary} onClick={() => openView('vans')}>Open Vans</button></article>
        </div><div className={styles.workspaceHint}><span>ⓘ</span>Select a workspace to view inventory details, adjust stock or initiate transfers.</div></section>

        <section className={`${styles.panel} ${styles.vanDirectory}`}><header className={styles.panelHead}><div><strong>Van directory</strong><span>Select a Van to open its inventory workspace.</span></div></header><div className={styles.vanDirectoryList}>{vans.map((van) => { const profile = profileForVan(van); const crew = crewForVan(van); const status = statusForVan(van); return <button type="button" key={van.id} onClick={() => { setActiveVanId(van.id); openView('vans'); }}><VanThumbnail imageUrl={profile?.imageUrl} name={van.name} size="small" /><span><strong>{van.name}</strong><small>{crew.length ? crew.join(' · ') : operationsUnavailable ? 'Crew details unavailable' : 'Crew unassigned'}</small></span><VanStatusChip status={status} /><i aria-hidden="true">›</i></button>; })}{!vans.length ? <p className={styles.empty}>No active Van inventory locations are available.</p> : null}</div>{vans.length ? <button type="button" className={styles.directoryFooter} onClick={() => openView('vans')}><InventoryIcon name="overview" /> View all Vans</button> : null}</section>
      </div>

      <div className={styles.overviewBottomGrid}>
        <section className={`${styles.panel} ${styles.snapshotPanel}`}><header className={styles.panelHead}><div><strong>Inventory snapshot (all locations)</strong><span>Canonical quantities and value estimates.</span></div></header><div className={styles.snapshotTable}><div className={styles.snapshotHead}><span>Category</span><span>Total Items</span><span>On Hand</span><span>Committed</span><span>Available</span><span>Low Stock</span><span>Out of Stock</span><span>Value (Est.)</span></div>{inventorySnapshotRows.map((row) => <div className={styles.snapshotRow} key={row.label}><strong>{row.label}</strong><span>{quantity(row.items)}</span><span>{quantity(row.onHand)}</span><span>{quantity(row.reserved)}</span><span>{quantity(row.available)}</span><span className={row.alerts ? styles.warnValue : ''}>{quantity(row.alerts)}</span><span className={row.out ? styles.dangerValue : ''}>{quantity(row.out)}</span><span>{money(row.value)}</span></div>)}</div></section>
        <section className={`${styles.panel} ${styles.recentPanel}`}><header className={styles.panelHead}><div><strong>Recent activity</strong><span>Latest canonical inventory movements.</span></div><button type="button" onClick={() => openView('movements')}>View all</button></header><ActivityList rows={snapshot.movements} emptyText="No inventory movements have been recorded yet." /></section>
      </div>

      {legacyProducts.length ? <section className={styles.panel}><header className={styles.panelHead}><div><strong>Historical stock location assignment</strong><span>One-time controlled reclassification — company total does not change</span></div></header><div className={styles.list}>{legacyProducts.map((item) => <div key={item.id}><strong>{item.name}</strong><span>{item.balances[LEGACY_LOCATION_ID].onHand} unassigned units</span><button type="button" onClick={() => openLegacyAllocation(item)}>Assign locations</button></div>)}</div></section> : null}
    </div></> : null}

    {view === 'warehouse' ? <><MobileLocationWorkspace locationId={WAREHOUSE_LOCATION_ID} kind="warehouse" /><div className={styles.desktopLocationWorkspace}><StockTable locationId={WAREHOUSE_LOCATION_ID} /></div></> : null}
    {view === 'office' ? <><MobileLocationWorkspace locationId={OFFICE_LOCATION_ID} kind="office" /><div className={styles.desktopLocationWorkspace}><StockTable locationId={OFFICE_LOCATION_ID} /></div></> : null}

    {view === 'vans' ? !activeVan ? <div className={styles.state}>No active Vans were found in canonical inventory.</div> : <>
      {vanSection === 'workspace' ? <MobileVanWorkspace /> : null}
      <div className={vanSection === 'workspace' ? styles.desktopVanOnly : styles.vanDesktopOrDetail}>
      <div className={styles.vanSelectorBar}><label className={styles.vanSelector}><VanThumbnail imageUrl={activeVanProfile?.imageUrl} name={activeVan.name} size="small" /><span><small>Selected Van</small><select value={activeVan.id} onChange={(event) => { setActiveVanId(event.target.value); openVanSection('workspace'); }}>{vans.map((van) => <option key={van.id} value={van.id}>{van.name}</option>)}</select></span></label><div className={styles.vanStatusStrip}><VanStatusChip status={statusForVan(activeVan)} />{activeVanReplenishment.length ? <span className={styles.alertChip}><InventoryIcon name="warning" />{activeVanReplenishment.length} replenishment alert{activeVanReplenishment.length === 1 ? '' : 's'}</span> : <span className={styles.clearChip}>No replenishment exceptions</span>}</div></div>

      {vanSection === 'workspace' ? <div className={styles.vanWorkspaceGrid}>
        <section className={styles.vanWorkspaceMenu}><header><strong>Choose an inventory view</strong><span>Select a category below to view and manage inventory for the selected Van.</span></header>
          <VanWorkspaceRow icon="overview" title="Overview" description="View all products and consumables stocked in this Van." value={`${items.filter((item) => balance(item, activeVan.id).onHand > 0).length} stocked lines`} onClick={() => openVanSection('overview')} />
          <VanWorkspaceRow icon="bottle" title="Consumables" description="Manage filters, fittings, chemicals and other frequently used items." value={`${quantity(onHandAt(activeVan.id, 'material'))} on hand`} tone="purple" onClick={() => openVanSection('consumables')} />
          <VanWorkspaceRow icon="package" title="Products for Sale" description="Manage equipment, parts and accessories physically stocked in this Van." value={`${quantity(onHandAt(activeVan.id, 'product'))} on hand`} tone="green" onClick={() => openVanSection('products')} />
          <VanWorkspaceRow icon="tool" title="Tools" description="Manage tools and equipment assigned to this Van." value={`${quantity(activeVanTools.reduce((sum, asset) => sum + toolQuantity(asset), 0))} assigned`} tone="orange" onClick={() => openVanSection('tools')} />
          <VanWorkspaceRow icon="warning" title="Replenishment" description="Review missing or low-stock items and target quantities." value={activeVanReplenishment.length ? `${activeVanReplenishment.length} alerts` : 'No alerts'} onClick={() => openView('replenishment')} />
          <VanWorkspaceRow icon="transfer" title="Transfers" description="View and manage open transfers to and from this Van." value={`${activeVanTransfers.length} open`} onClick={() => openView('transfers')} />
          <VanWorkspaceRow icon="movement" title="Movements" description="View inventory movements, usage history and adjustments." value={`${activeVanMovements.length} events`} onClick={() => openView('movements')} />
        </section>

        <aside className={styles.vanContext}><section className={styles.vanSummary}><header><strong>{activeVan.name} Summary</strong></header><div className={styles.vanIdentity}><VanThumbnail imageUrl={activeVanProfile?.imageUrl} name={activeVan.name} size="medium" /><span><strong>{activeVan.name}{activeVanCrew.length ? ` — ${activeVanCrew.join(' & ')}` : ''}</strong><small>{[activeVanProfile?.make, activeVanProfile?.model, activeVanProfile?.plate].filter(Boolean).join(' · ') || 'Canonical Van inventory location'}</small></span><VanStatusChip status={statusForVan(activeVan)} /></div><div className={styles.summaryStats}>
          <div><InventoryIcon name="package" /><span>Products on hand</span><strong>{quantity(onHandAt(activeVan.id, 'product'))}</strong><small>{quantity(Math.max(0, onHandAt(activeVan.id, 'product') - reservedAt(activeVan.id, 'product')))} available</small></div>
          <div><InventoryIcon name="bottle" /><span>Consumables on hand</span><strong>{quantity(onHandAt(activeVan.id, 'material'))}</strong><small>{quantity(Math.max(0, onHandAt(activeVan.id, 'material') - reservedAt(activeVan.id, 'material')))} available</small></div>
          <div><InventoryIcon name="tool" /><span>Tools assigned</span><strong>{quantity(activeVanTools.reduce((sum, asset) => sum + toolQuantity(asset), 0))}</strong><small>Active assets</small></div>
          <div><InventoryIcon name="transfer" /><span>Open transfers</span><strong>{activeVanTransfers.length}</strong><button type="button" onClick={() => openView('transfers')}>View transfers</button></div>
          <div><InventoryIcon name="warning" /><span>Missing tools</span><strong>{quantity(activeVanMissingTools.reduce((sum, asset) => sum + toolMissingQuantity(asset), 0))}</strong><button type="button" onClick={() => openVanSection('tools')}>View tools</button></div>
          <div><InventoryIcon name="warning" /><span>Low stock alerts</span><strong>{activeVanReplenishment.length}</strong><button type="button" onClick={() => openView('replenishment')}>View alerts</button></div>
        </div></section><section className={`${styles.panel} ${styles.vanActivity}`}><header className={styles.panelHead}><div><strong>Recent activity</strong><span>Movements involving {activeVan.name}.</span></div><button type="button" onClick={() => openView('movements')}>View all</button></header><ActivityList rows={activeVanMovements} emptyText={`No inventory movements recorded for ${activeVan.name}.`} /></section></aside>
      </div> : <div className={styles.vanDetail}><div className={styles.vanDetailHeader}><button type="button" onClick={() => openVanSection('workspace')}>← Choose inventory view</button><span>{activeVan.name}</span></div>{vanSection === 'overview' ? <StockTable locationId={activeVan.id} title={`${activeVan.name} · Overview`} /> : null}{vanSection === 'consumables' ? <StockTable locationId={activeVan.id} itemKind="material" title={`${activeVan.name} · Consumables`} /> : null}{vanSection === 'products' ? <StockTable locationId={activeVan.id} itemKind="product" title={`${activeVan.name} · Products for Sale`} /> : null}{vanSection === 'tools' ? <div className={styles.vanToolsSections}>{renderToolTable({ locationId: activeVan.id, allowAdd: true })}{MissingToolTemplates()}</div> : null}</div>}
      </div>
    </> : null}

    {view === 'tools' ? renderToolTable({}) : null}

    {view === 'transfers' ? <div className={styles.grid2}>
      <section className={styles.panel}><header className={styles.panelHead}><div><strong>Create transfer</strong><span>One order: Requested → In transit → Completed</span></div></header><div className={styles.form}>
        <label>From<select value={sourceLocationId} onChange={(event) => setSourceLocationId(event.target.value)}>{normalLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>To<select value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}>{normalLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>Authorized pickup person<input value={pickupName} onChange={(event) => setPickupName(event.target.value)} placeholder="Name" /></label>
        <label className={styles.wide}>Note<input value={transferNote} onChange={(event) => setTransferNote(event.target.value)} placeholder="Optional transfer instructions" /></label>
        <div className={styles.lineBuilder}><select value={lineItemKey} onChange={(event) => setLineItemKey(event.target.value)}>{items.map((item) => <option key={itemKey(item)} value={itemKey(item)}>{item.name} · {item.itemKind === 'product' ? 'Product' : 'Consumable'}</option>)}</select><input type="number" min={selectedTransferItem?.itemKind === 'product' ? 1 : 0.001} step={selectedTransferItem?.itemKind === 'product' ? 1 : 0.001} value={lineQuantity} onChange={(event) => setLineQuantity(event.target.value)} /><button type="button" onClick={addTransferLine}>Add</button></div>
        <div className={styles.transferDraft}>{transferLines.map((line) => { const item = items.find((candidate) => candidate.itemKind === line.itemKind && candidate.id === line.itemId); return <div key={`${line.itemKind}:${line.itemId}`}><span>{line.quantity} × {item?.name || line.itemId}</span><button type="button" onClick={() => setTransferLines((current) => current.filter((candidate) => candidate !== line))}>Remove</button></div>; })}{!transferLines.length ? <span>No items added yet.</span> : null}</div>
        <button type="button" className={styles.primary} disabled={isPending('transfer:create') || !transferLines.length} onClick={() => void submitTransfer()}>{isPending('transfer:create') ? 'Creating…' : 'Create Transfer Request'}</button>
      </div></section>
      <section className={styles.transferStack}>{snapshot.transfers.map((transfer) => <article className={styles.transferCard} key={transfer.id}><header><div><span>{transferStatus(transfer.status)}</span><strong>{transfer.sourceLocationName} → {transfer.destinationLocationName}</strong></div><small>{dateTime(transfer.requestedAt)}</small></header>{transfer.assignedPickupName ? <p>Pickup: <b>{transfer.assignedPickupName}</b></p> : null}<div className={styles.transferLines}>{transfer.lines.map((line) => <div key={line.lineId}><strong>{line.itemName}</strong><span>Requested {line.requestedQuantity}{transfer.status !== 'requested' ? ` · Picked ${line.pickedQuantity}` : ''}{transfer.status === 'completed' ? ` · Received ${line.receivedQuantity}` : ''}</span>{transfer.status === 'requested' ? <input type="number" min="0" step={line.itemKind === 'product' ? 1 : 0.001} max={line.requestedQuantity} value={draftQuantity(transfer, line.lineId, 'picked', line.requestedQuantity)} onChange={(event) => setDraftQuantity(transfer, line.lineId, 'picked', event.target.value)} /> : null}{transfer.status === 'in_transit' ? <input type="number" min="0" step={line.itemKind === 'product' ? 1 : 0.001} max={line.pickedQuantity} value={draftQuantity(transfer, line.lineId, 'received', line.pickedQuantity)} onChange={(event) => setDraftQuantity(transfer, line.lineId, 'received', event.target.value)} /> : null}</div>)}</div>{transfer.status === 'requested' || transfer.status === 'in_transit' ? <textarea value={transferNotes[transfer.id] ?? ''} onChange={(event) => setTransferNotes((current) => ({ ...current, [transfer.id]: event.target.value }))} placeholder={transfer.status === 'in_transit' ? 'Required if received quantity differs from picked quantity' : 'Pickup / cancellation note'} /> : null}<footer>{transfer.status === 'requested' ? <><button type="button" disabled={isTransferPending(transfer.id)} onClick={() => void cancelTransfer(transfer)}>{isPending(`transfer:cancel:${transfer.id}`) ? 'Cancelling…' : 'Cancel'}</button><button type="button" className={styles.primary} disabled={isTransferPending(transfer.id)} onClick={() => void pickup(transfer)}>{isPending(`transfer:pickup:${transfer.id}`) ? 'Confirming…' : 'Confirm Pickup'}</button></> : null}{transfer.status === 'in_transit' ? <button type="button" className={styles.primary} disabled={isTransferPending(transfer.id)} onClick={() => void receive(transfer)}>{isPending(`transfer:receive:${transfer.id}`) ? 'Receiving…' : 'Receive & Complete'}</button> : null}{transfer.status === 'completed' ? <span>{transfer.hasDiscrepancy ? 'Completed with discrepancy' : `Received ${dateTime(transfer.receivedAt)}`}</span> : null}</footer></article>)}</section>
    </div> : null}

    {view === 'replenishment' ? <section className={styles.panel}><header className={styles.panelHead}><div><strong>Van replenishment</strong><span>Derived automatically from available stock vs min / target</span></div><b>{snapshot.replenishment.length} alerts</b></header><div className={styles.tableWrap}><table><thead><tr><th>Item</th><th>Van</th><th>On hand</th><th>Reserved</th><th>Min</th><th>Target</th><th>Replenish</th></tr></thead><tbody>{snapshot.replenishment.map((row) => <tr key={`${row.locationId}:${row.itemKind}:${row.itemId}`}><td><strong>{row.itemName}</strong></td><td>{locationLabel(locations, row.locationId)}</td><td>{row.onHand}</td><td>{row.reserved}</td><td>{row.minimum}</td><td>{row.target}</td><td><b>{row.needed}</b></td></tr>)}</tbody></table></div>{!snapshot.replenishment.length ? <p className={styles.empty}>All configured van stock is above minimum.</p> : null}</section> : null}

    {view === 'movements' ? <section className={styles.panel}><header className={styles.panelHead}><div><strong>Inventory movement audit</strong><span>Immutable events; not another balance source</span></div></header><div className={styles.tableWrap}><table><thead><tr><th>When</th><th>Item</th><th>Movement</th><th>Qty</th><th>From</th><th>To</th><th>By</th></tr></thead><tbody>{snapshot.movements.map((row) => <tr key={row.id}><td>{dateTime(row.occurredAt)}</td><td><strong>{row.itemName}</strong></td><td>{row.type.replaceAll('_', ' ')}</td><td>{row.quantity}</td><td>{row.sourceLocationId ? locationLabel(locations, row.sourceLocationId) : '—'}</td><td>{row.destinationLocationId ? locationLabel(locations, row.destinationLocationId) : '—'}</td><td>{row.performedByName || '—'}</td></tr>)}</tbody></table></div></section> : null}

    <MobileBottomNav />

    {backgroundToolJob ? <aside
      className={`${styles.backgroundToolJob} ${backgroundToolJob.status === 'failed' ? styles.backgroundToolJobFailed : backgroundToolJob.status === 'complete' ? styles.backgroundToolJobComplete : styles.backgroundToolJobRunning}`}
      role={backgroundToolJob.status === 'failed' ? 'alert' : 'status'}
      aria-live={backgroundToolJob.status === 'failed' ? 'assertive' : 'polite'}
    >
      <span className={styles.backgroundToolJobIcon} aria-hidden="true"><InventoryIcon name={backgroundToolJob.status === 'failed' ? 'warning' : 'tool'} /></span>
      <div className={styles.backgroundToolJobCopy}>
        <strong>{backgroundToolJob.status === 'complete' ? `${backgroundToolJob.label} added` : `Adding ${backgroundToolJob.label}`}</strong>
        <span>{backgroundToolJob.status === 'uploading'
          ? 'Preparing and uploading the photo in the background…'
          : backgroundToolJob.status === 'saving'
            ? 'Photo uploaded. Saving the tool in Inventory…'
            : backgroundToolJob.status === 'complete'
              ? `Saved successfully in ${backgroundToolJob.vanLabel}.`
              : backgroundToolJob.error || 'The tool could not be added.'}</span>
        {backgroundToolJobRunning ? <small>You can continue working while this finishes.</small> : null}
      </div>
      {backgroundToolJob.status === 'failed' ? <div className={styles.backgroundToolJobActions}><button type="button" onClick={retryBackgroundAddTool}>Retry</button><button type="button" onClick={() => setBackgroundToolJob(null)}>Dismiss</button></div> : null}
      {backgroundToolJob.status === 'complete' ? <button type="button" className={styles.backgroundToolJobDismiss} onClick={() => setBackgroundToolJob(null)}>Done</button> : null}
    </aside> : null}

    {stockEdit ? <div className={styles.modalBackdrop}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="stock-edit-title"><header><div><span>Physical stock · {locationLabel(locations, stockEdit.locationId)}</span><h2 id="stock-edit-title">{stockEdit.item.name}</h2></div><button type="button" aria-label="Close stock editor" onClick={() => setStockEdit(null)}>×</button></header><div className={styles.form}><label>On hand<input type="number" min="0" step={stockEdit.item.itemKind === 'product' ? 1 : 0.001} value={stockEdit.onHand} onChange={(event) => setStockEdit({ ...stockEdit, onHand: event.target.value })} /></label><label>Minimum<input type="number" min="0" step={stockEdit.item.itemKind === 'product' ? 1 : 0.001} value={stockEdit.minimum} onChange={(event) => setStockEdit({ ...stockEdit, minimum: event.target.value })} /></label><label>Target<input type="number" min="0" step={stockEdit.item.itemKind === 'product' ? 1 : 0.001} value={stockEdit.target} onChange={(event) => setStockEdit({ ...stockEdit, target: event.target.value })} /></label><p className={styles.wide}>Reserved stock cannot be counted below its committed quantity. Van min/target drives replenishment automatically.</p><footer className={styles.wide}><button type="button" onClick={() => setStockEdit(null)}>Cancel</button><button type="button" className={styles.primary} disabled={isPending(`stock:${stockEdit.locationId}:${itemKey(stockEdit.item)}`)} onClick={() => void saveStockEdit()}>{isPending(`stock:${stockEdit.locationId}:${itemKey(stockEdit.item)}`) ? 'Saving…' : 'Save verified count'}</button></footer></div></section></div> : null}

    {legacyItem ? <div className={styles.modalBackdrop}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="legacy-allocation-title"><header><div><span>Historical stock assignment</span><h2 id="legacy-allocation-title">{legacyItem.name}</h2></div><button type="button" aria-label="Close historical stock assignment" onClick={() => setLegacyItem(null)}>×</button></header><div className={styles.form}><p className={styles.wide}>Unassigned total: <b>{legacyItem.balances[LEGACY_LOCATION_ID]?.onHand ?? 0}</b>. Warehouse + Office must equal this exact quantity.</p><label>Warehouse<input type="number" min="0" value={legacyWarehouse} onChange={(event) => setLegacyWarehouse(event.target.value)} /></label><label>Office<input type="number" min="0" value={legacyOffice} onChange={(event) => setLegacyOffice(event.target.value)} /></label><footer className={styles.wide}><button type="button" onClick={() => setLegacyItem(null)}>Cancel</button><button type="button" className={styles.primary} disabled={isPending(`legacy:${legacyItem.id}`)} onClick={() => void saveLegacyAllocation()}>{isPending(`legacy:${legacyItem.id}`) ? 'Assigning…' : 'Assign locations'}</button></footer></div></section></div> : null}

    {AddToolDrawer()}

    {toolEdit ? <div className={styles.toolDrawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) closeToolProfile(); }}><section className={styles.toolDrawer} role="dialog" aria-modal="true" aria-labelledby="tool-edit-title">
      <header><div><span>Tool asset profile</span><h2 id="tool-edit-title">{snapshot.toolCatalog.find((tool) => tool.id === toolEdit.asset.toolCatalogId)?.name || toolEdit.asset.toolCatalogId || 'Tool'}</h2><small>{toolEdit.asset.assetCode || toolEdit.asset.id}</small></div><button type="button" aria-label="Close tool editor" onClick={closeToolProfile}>×</button></header>
      <div className={styles.toolDrawerBody}>
        <section className={styles.toolIdentityCard}><ToolPhoto asset={toolEdit.asset} onOpen={setToolLightbox} mode="detail" /><div><strong>{toolEdit.asset.assetCode || toolEdit.asset.id}</strong><span>{snapshot.toolCatalog.find((tool) => tool.id === toolEdit.asset.toolCatalogId)?.category || 'Tool asset'}</span><small>{locationLabel(locations, toolEdit.asset.inventoryLocationId || toolEdit.asset.locationId || toolEdit.asset.vanId || '')} · {toolEdit.asset.operationalStatus || 'Status unavailable'}</small></div></section>

        <div className={`${styles.mobileToolSummary} ${mobileToolAction !== 'summary' ? styles.mobileToolSummaryHidden : ''}`}>
          <div className={styles.mobileToolFacts}>
            <div><span>Location</span><strong>{locationLabel(locations, toolEdit.asset.inventoryLocationId || toolEdit.asset.locationId || toolEdit.asset.vanId || '')}</strong></div>
            <div><span>Quantity</span><strong>{toolPresentQuantity(toolEdit.asset)} / {toolExpectedQuantity(toolEdit.asset)}</strong></div>
            <div><span>Condition</span><strong>{toolEdit.condition}</strong></div>
            <div><span>Tool cost</span><strong>{money(Number(toolEdit.purchaseCost) || 0)}</strong></div>
          </div>
          <section className={styles.mobileToolNotes}><strong>Notes</strong><p>{toolEdit.notes || 'No comments recorded for this tool.'}</p></section>
          <div className={styles.mobileToolActions}><button type="button" className={styles.primary} onClick={() => setMobileToolAction('edit')}><span aria-hidden="true">✎</span>Edit details</button><button type="button" disabled={!toolCanTransfer(toolEdit.asset)} onClick={() => setMobileToolAction('transfer')}><InventoryIcon name="transfer" />Start transfer</button><small>Transfers require a destination, reason and confirmation.</small></div>
        </div>

        <section className={`${styles.toolEditSection} ${mobileToolAction === 'edit' ? styles.mobileActionActive : ''}`}><header><button type="button" className={styles.mobileActionBack} onClick={() => setMobileToolAction('summary')}>← Details</button><strong>Tool details</strong><span>Update the real information stored for this asset.</span></header><div className={styles.toolEditGrid}>
          <label>Use / condition<select value={toolEdit.condition} onChange={(event) => setToolEdit({ ...toolEdit, condition: event.target.value })}>{TOOL_CONDITIONS.map((condition) => <option key={condition} value={condition}>{condition}</option>)}</select></label>
          <label>Tool cost (Afl.)<input type="number" min="0" step="0.01" value={toolEdit.purchaseCost} onChange={(event) => setToolEdit({ ...toolEdit, purchaseCost: event.target.value })} /></label>
          {toolEdit.asset.trackingMode === 'quantity' ? <><label>Assigned quantity<input type="number" min="0" step="1" value={toolEdit.quantityExpected} onChange={(event) => setToolEdit({ ...toolEdit, quantityExpected: event.target.value })} /></label><label>Present quantity<input type="number" min="0" step="1" max={toolEdit.quantityExpected} value={toolEdit.quantityPresent} onChange={(event) => setToolEdit({ ...toolEdit, quantityPresent: event.target.value })} /></label></> : <div className={styles.toolReadOnlyFact}><span>Quantity</span><strong>{toolPresentQuantity(toolEdit.asset)} / 1</strong><small>Individual tracked asset</small></div>}
          <label className={styles.wide}>Comments / observations<textarea rows={4} value={toolEdit.notes} onChange={(event) => setToolEdit({ ...toolEdit, notes: event.target.value })} placeholder="Use, condition, damage or other relevant details" /></label>
        </div><footer><button type="button" onClick={closeToolProfile}>Cancel</button><button type="button" className={styles.primary} disabled={isPending(`tool-edit:${toolEdit.asset.id}`)} onClick={() => void saveToolDetails()}>{isPending(`tool-edit:${toolEdit.asset.id}`) ? 'Saving…' : 'Save details'}</button></footer></section>

        <section className={`${styles.toolTransferSection} ${mobileToolAction === 'transfer' ? styles.mobileActionActive : ''}`}><header><button type="button" className={styles.mobileActionBack} onClick={() => setMobileToolAction('summary')}>← Details</button><strong>Transfer tool</strong><span>Separate controlled action — destination and reason are required.</span></header>
          {toolCanTransfer(toolEdit.asset) ? <div className={styles.toolTransferForm}>
            <label>Destination<select value={toolEdit.destinationLocationId} onChange={(event) => setToolEdit({ ...toolEdit, destinationLocationId: event.target.value, transferConfirmed: false })}><option value="">Choose a location…</option>{normalLocations.filter((location) => location.id !== (toolEdit.asset.inventoryLocationId || toolEdit.asset.locationId || toolEdit.asset.vanId)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <label>Transfer reason<textarea rows={3} value={toolEdit.transferReason} onChange={(event) => setToolEdit({ ...toolEdit, transferReason: event.target.value, transferConfirmed: false })} placeholder="Why is this tool being moved?" /></label>
            {toolEdit.destinationLocationId ? <div className={styles.transferSummary}><span>Transfer summary</span><strong>{locationLabel(locations, toolEdit.asset.inventoryLocationId || toolEdit.asset.locationId || toolEdit.asset.vanId || '')} → {locationLabel(locations, toolEdit.destinationLocationId)}</strong></div> : null}
            <label className={styles.confirmTransfer}><input type="checkbox" checked={toolEdit.transferConfirmed} onChange={(event) => setToolEdit({ ...toolEdit, transferConfirmed: event.target.checked })} /><span>I reviewed the destination and confirm this transfer.</span></label>
            <button type="button" className={styles.transferButton} disabled={isPending(`tool-move:${toolEdit.asset.id}`) || !toolEdit.destinationLocationId || !toolEdit.transferReason.trim() || !toolEdit.transferConfirmed} onClick={() => void moveTool()}>{isPending(`tool-move:${toolEdit.asset.id}`) ? 'Transferring…' : 'Confirm transfer'}</button>
          </div> : <div className={styles.transferBlocked}><InventoryIcon name="warning" /><div><strong>Transfer unavailable for this record</strong><span>{toolEdit.asset.trackingMode === 'quantity' ? 'Quantity-tracked tools require a controlled quantity transfer workflow.' : 'Loaned, missing, repair or retired tools must be resolved before transfer.'}</span></div></div>}
        </section>
      </div>
    </section></div> : null}

    {toolLightbox ? <div className={styles.photoLightbox} role="dialog" aria-modal="true" aria-label="Tool photo"><button type="button" aria-label="Close tool photo" onClick={() => setToolLightbox('')}>×</button><div><Image loader={passthroughImageLoader} src={toolLightbox} alt="Tool condition evidence" fill sizes="100vw" unoptimized /></div></div> : null}
  </section>;
}
