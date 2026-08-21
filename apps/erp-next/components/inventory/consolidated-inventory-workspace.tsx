'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  OFFICE_LOCATION_ID,
  WAREHOUSE_LOCATION_ID,
} from '../../lib/inventory';
import {
  allocateLegacyProductStock,
  cancelInventoryTransfer,
  createInventoryRequestId,
  createInventoryTransfer,
  getInventorySnapshot,
  moveInventoryTool,
  pickupInventoryTransfer,
  receiveInventoryTransfer,
  setInventoryLocationPolicy,
  setInventoryStockLevel,
  type InventoryBalance,
  type InventoryItem,
  type InventoryLocation,
  type InventorySnapshot,
  type InventoryTransfer,
} from '../../lib/inventory-authority';
import styles from './consolidated-inventory-workspace.module.css';

const LEGACY_LOCATION_ID = 'LEGACY-UNASSIGNED';
type View = 'overview' | 'warehouse' | 'office' | 'vans' | 'tools' | 'transfers' | 'replenishment' | 'movements';
type StockEdit = { item: InventoryItem; locationId: string; onHand: string; minimum: string; target: string };
type TransferDraftLine = { itemKind: 'product' | 'material'; itemId: string; quantity: number };

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

export function ConsolidatedInventoryWorkspace() {
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<View>('overview');
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
  const [toolDestinations, setToolDestinations] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const next = await getInventorySnapshot();
      setSnapshot(next);
      setError('');
      const firstVan = next.locations.find((location) => location.type === 'van')?.id ?? '';
      setActiveVanId((current) => current && next.locations.some((location) => location.id === current) ? current : firstVan);
      setLineItemKey((current) => current && next.items.some((item) => itemKey(item) === current) ? current : (next.items[0] ? itemKey(next.items[0]) : ''));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inventory could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const locations = snapshot?.locations ?? [];
  const normalLocations = locations.filter((location) => location.type !== 'legacy');
  const vans = normalLocations.filter((location) => location.type === 'van');
  const items = useMemo(() => (snapshot?.items ?? []).filter((item) => item.active !== false), [snapshot]);
  const products = items.filter((item) => item.itemKind === 'product');
  const materials = items.filter((item) => item.itemKind === 'material');
  const openTransfers = (snapshot?.transfers ?? []).filter((transfer) => transfer.status === 'requested' || transfer.status === 'in_transit');
  const companyUnits = items.reduce((total, item) => total + Object.values(item.balances || {}).reduce((sum, row) => sum + Number(row.onHand || 0), 0), 0);
  const legacyProducts = products.filter((item) => (item.balances?.[LEGACY_LOCATION_ID]?.onHand ?? 0) > 0);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await action();
      setNotice(success);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inventory operation failed.');
    } finally { setBusy(false); }
  }

  function beginStockEdit(item: InventoryItem, locationId: string) {
    const current = balance(item, locationId);
    setStockEdit({ item, locationId, onHand: String(current.onHand), minimum: String(current.minimum), target: String(current.target) });
  }

  async function saveStockEdit() {
    if (!stockEdit) return;
    const onHand = Math.max(0, Math.floor(Number(stockEdit.onHand) || 0));
    const minimum = Math.max(0, Math.floor(Number(stockEdit.minimum) || 0));
    const target = Math.max(minimum, Math.floor(Number(stockEdit.target) || 0));
    await run(async () => {
      await setInventoryStockLevel({ requestId: createInventoryRequestId('stock-count'), itemKind: stockEdit.item.itemKind, itemId: stockEdit.item.id, locationId: stockEdit.locationId, onHand, reason: 'Office verified physical stock count' });
      await setInventoryLocationPolicy({ requestId: createInventoryRequestId('stock-policy'), itemKind: stockEdit.item.itemKind, itemId: stockEdit.item.id, locationId: stockEdit.locationId, minimum, target });
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
    await run(() => allocateLegacyProductStock({
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
    const quantity = Math.max(1, Math.floor(Number(lineQuantity) || 1));
    if (!item) return;
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
    await run(async () => {
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
    await run(() => pickupInventoryTransfer({
      requestId: createInventoryRequestId('pickup'), transferId: transfer.id,
      lines: transfer.lines.map((line) => ({ lineId: line.lineId, pickedQuantity: Math.max(0, Math.floor(Number(draftQuantity(transfer, line.lineId, 'picked', line.requestedQuantity)) || 0)) })),
      note: transferNotes[transfer.id] ?? '',
    }), 'Transfer picked up. Stock is now in transit.');
  }
  async function receive(transfer: InventoryTransfer) {
    await run(() => receiveInventoryTransfer({
      requestId: createInventoryRequestId('receive'), transferId: transfer.id,
      lines: transfer.lines.map((line) => ({ lineId: line.lineId, receivedQuantity: Math.max(0, Math.floor(Number(draftQuantity(transfer, line.lineId, 'received', line.pickedQuantity)) || 0)) })),
      discrepancyNote: transferNotes[transfer.id] ?? '',
    }), 'Transfer received and destination stock updated.');
  }
  async function cancelTransfer(transfer: InventoryTransfer) {
    await run(() => cancelInventoryTransfer({ requestId: createInventoryRequestId('transfer-cancel'), transferId: transfer.id, reason: transferNotes[transfer.id] || 'Cancelled by office before pickup' }), 'Transfer cancelled and reservation released.');
  }

  async function moveTool(assetId: string) {
    const destination = toolDestinations[assetId];
    if (!destination) { setError('Choose a destination for the tool.'); return; }
    await run(() => moveInventoryTool({ requestId: createInventoryRequestId('tool-move'), assetId, destinationLocationId: destination, reason: 'Inventory location reassignment' }), 'Tool location updated.');
  }

  function StockTable({ locationId }: { locationId: string }) {
    const location = locations.find((candidate) => candidate.id === locationId);
    return <section className={styles.panel}>
      <header className={styles.panelHead}><div><strong>{location?.name ?? locationId}</strong><span>Products and consumables at this physical location</span></div><b>{items.reduce((sum, item) => sum + balance(item, locationId).onHand, 0)} units</b></header>
      <div className={styles.tableWrap}><table><thead><tr><th>Item</th><th>Type</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Min</th><th>Target</th><th /></tr></thead><tbody>
        {items.map((item) => { const value = balance(item, locationId); return <tr key={`${locationId}:${itemKey(item)}`}>
          <td><strong>{item.name}</strong><small>{item.sku || item.category}</small></td><td>{item.itemKind === 'product' ? 'Product' : 'Consumable'}</td><td>{value.onHand}</td><td>{value.reserved}</td><td><b>{available(value)}</b></td><td>{value.minimum}</td><td>{value.target}</td><td><button type="button" onClick={() => beginStockEdit(item, locationId)}>Count / Par</button></td>
        </tr>; })}
      </tbody></table></div>
    </section>;
  }

  const tabs: Array<{ id: View; label: string }> = [
    ['overview', 'Overview'], ['warehouse', 'Warehouse'], ['office', 'Office'], ['vans', 'Vans'], ['tools', 'Tools'], ['transfers', 'Transfers'], ['replenishment', 'Replenishment'], ['movements', 'Movements'],
  ].map(([id, label]) => ({ id: id as View, label }));

  if (loading) return <section className={styles.page}><div className={styles.state}>Loading consolidated inventory…</div></section>;
  if (!snapshot) return <section className={styles.page}><div className={styles.state}>{error || 'Inventory is unavailable.'}<button type="button" onClick={() => { setLoading(true); void refresh(); }}>Retry</button></div></section>;

  return <section className={styles.page}>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}>Inventory · One authority</span><h1>Inventory Control</h1><p>Products, consumables and tools across Warehouse, Office and Vans. Locations are views of the same inventory — not separate databases.</p></div>
      <button type="button" className={styles.primary} disabled={busy} onClick={() => void refresh()}>{busy ? 'Working…' : 'Refresh inventory'}</button>
    </header>

    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}
    {legacyProducts.length ? <div className={styles.warning}><strong>{legacyProducts.length} Product{legacyProducts.length === 1 ? '' : 's'} have historical stock without a known location.</strong><span>Assign the full quantity between Warehouse and Office once. The system will not guess or duplicate it.</span></div> : null}

    <nav className={styles.tabs}>{tabs.map((tab) => <button key={tab.id} type="button" className={view === tab.id ? styles.activeTab : ''} onClick={() => setView(tab.id)}>{tab.label}</button>)}</nav>

    {view === 'overview' ? <>
      <div className={styles.metrics}>
        <article><span>Products</span><strong>{products.length}</strong><small>Canonical Services & Products catalog</small></article>
        <article><span>Consumables</span><strong>{materials.length}</strong><small>Existing warehouseInventory catalog</small></article>
        <article><span>Physical stock</span><strong>{companyUnits}</strong><small>Across all locations</small></article>
        <article><span>Open transfers</span><strong>{openTransfers.length}</strong><small>Requested + in transit</small></article>
        <article><span>Van replenishment</span><strong>{snapshot.replenishment.length}</strong><small>Derived from min / target</small></article>
      </div>
      <div className={styles.grid2}>
        <section className={styles.panel}><header className={styles.panelHead}><div><strong>Physical locations</strong><span>Warehouse and Office are first-class locations alongside Vans</span></div></header><div className={styles.locationCards}>{normalLocations.map((location) => <button key={location.id} type="button" onClick={() => { if (location.type === 'warehouse') setView('warehouse'); else if (location.type === 'office') setView('office'); else { setActiveVanId(location.id); setView('vans'); } }}><strong>{location.name}</strong><span>{items.reduce((sum, item) => sum + balance(item, location.id).onHand, 0)} units</span></button>)}</div></section>
        <section className={styles.panel}><header className={styles.panelHead}><div><strong>Needs attention</strong><span>Only exceptions, not a second inventory list</span></div></header><div className={styles.list}>{snapshot.replenishment.slice(0, 8).map((row) => <div key={`${row.locationId}:${row.itemId}`}><strong>{row.itemName}</strong><span>{locationLabel(locations, row.locationId)} · {row.onHand} on hand · replenish {row.needed}</span></div>)}{!snapshot.replenishment.length ? <p className={styles.empty}>No van replenishment alerts.</p> : null}</div></section>
      </div>
      {legacyProducts.length ? <section className={styles.panel}><header className={styles.panelHead}><div><strong>Historical stock location assignment</strong><span>One-time controlled reclassification — company total does not change</span></div></header><div className={styles.list}>{legacyProducts.map((item) => <div key={item.id}><strong>{item.name}</strong><span>{item.balances[LEGACY_LOCATION_ID].onHand} unassigned units</span><button type="button" onClick={() => openLegacyAllocation(item)}>Assign locations</button></div>)}</div></section> : null}
    </> : null}

    {view === 'warehouse' ? <StockTable locationId={WAREHOUSE_LOCATION_ID} /> : null}
    {view === 'office' ? <StockTable locationId={OFFICE_LOCATION_ID} /> : null}
    {view === 'vans' ? <><div className={styles.toolbar}><label>Van<select value={activeVanId} onChange={(event) => setActiveVanId(event.target.value)}>{vans.map((van) => <option key={van.id} value={van.id}>{van.name}</option>)}</select></label></div>{activeVanId ? <StockTable locationId={activeVanId} /> : <div className={styles.state}>No active vans found.</div>}</> : null}

    {view === 'tools' ? <section className={styles.panel}><header className={styles.panelHead}><div><strong>Tool assets</strong><span>Same physical asset, one current location</span></div><b>{snapshot.toolAssets.length} assets</b></header><div className={styles.tableWrap}><table><thead><tr><th>Asset</th><th>Tool</th><th>Location</th><th>Status</th><th>Move to</th><th /></tr></thead><tbody>{snapshot.toolAssets.map((asset) => { const catalog = snapshot.toolCatalog.find((tool) => tool.id === asset.toolCatalogId); return <tr key={asset.id}><td><strong>{asset.assetCode || asset.id}</strong></td><td>{catalog?.name || asset.toolCatalogId || 'Tool'}</td><td>{locationLabel(locations, asset.inventoryLocationId || '')}</td><td>{asset.operationalStatus || asset.condition || '—'}</td><td><select value={toolDestinations[asset.id] ?? ''} onChange={(event) => setToolDestinations((current) => ({ ...current, [asset.id]: event.target.value }))}><option value="">Choose…</option>{normalLocations.filter((location) => location.id !== asset.inventoryLocationId).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></td><td><button type="button" disabled={busy || !toolDestinations[asset.id]} onClick={() => void moveTool(asset.id)}>Move</button></td></tr>; })}</tbody></table></div></section> : null}

    {view === 'transfers' ? <div className={styles.grid2}>
      <section className={styles.panel}><header className={styles.panelHead}><div><strong>Create transfer</strong><span>One order: Requested → In transit → Completed</span></div></header><div className={styles.form}>
        <label>From<select value={sourceLocationId} onChange={(event) => setSourceLocationId(event.target.value)}>{normalLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>To<select value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}>{normalLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>Authorized pickup person<input value={pickupName} onChange={(event) => setPickupName(event.target.value)} placeholder="Name" /></label>
        <label className={styles.wide}>Note<input value={transferNote} onChange={(event) => setTransferNote(event.target.value)} placeholder="Optional transfer instructions" /></label>
        <div className={styles.lineBuilder}><select value={lineItemKey} onChange={(event) => setLineItemKey(event.target.value)}>{items.map((item) => <option key={itemKey(item)} value={itemKey(item)}>{item.name} · {item.itemKind === 'product' ? 'Product' : 'Consumable'}</option>)}</select><input type="number" min="1" value={lineQuantity} onChange={(event) => setLineQuantity(event.target.value)} /><button type="button" onClick={addTransferLine}>Add</button></div>
        <div className={styles.transferDraft}>{transferLines.map((line) => { const item = items.find((candidate) => candidate.itemKind === line.itemKind && candidate.id === line.itemId); return <div key={`${line.itemKind}:${line.itemId}`}><span>{line.quantity} × {item?.name || line.itemId}</span><button type="button" onClick={() => setTransferLines((current) => current.filter((candidate) => candidate !== line))}>Remove</button></div>; })}{!transferLines.length ? <span>No items added yet.</span> : null}</div>
        <button type="button" className={styles.primary} disabled={busy || !transferLines.length} onClick={() => void submitTransfer()}>Create Transfer Request</button>
      </div></section>
      <section className={styles.transferStack}>{snapshot.transfers.map((transfer) => <article className={styles.transferCard} key={transfer.id}><header><div><span>{transferStatus(transfer.status)}</span><strong>{transfer.sourceLocationName} → {transfer.destinationLocationName}</strong></div><small>{dateTime(transfer.requestedAt)}</small></header>{transfer.assignedPickupName ? <p>Pickup: <b>{transfer.assignedPickupName}</b></p> : null}<div className={styles.transferLines}>{transfer.lines.map((line) => <div key={line.lineId}><strong>{line.itemName}</strong><span>Requested {line.requestedQuantity}{transfer.status !== 'requested' ? ` · Picked ${line.pickedQuantity}` : ''}{transfer.status === 'completed' ? ` · Received ${line.receivedQuantity}` : ''}</span>{transfer.status === 'requested' ? <input type="number" min="0" max={line.requestedQuantity} value={draftQuantity(transfer, line.lineId, 'picked', line.requestedQuantity)} onChange={(event) => setDraftQuantity(transfer, line.lineId, 'picked', event.target.value)} /> : null}{transfer.status === 'in_transit' ? <input type="number" min="0" max={line.pickedQuantity} value={draftQuantity(transfer, line.lineId, 'received', line.pickedQuantity)} onChange={(event) => setDraftQuantity(transfer, line.lineId, 'received', event.target.value)} /> : null}</div>)}</div>{transfer.status === 'requested' || transfer.status === 'in_transit' ? <textarea value={transferNotes[transfer.id] ?? ''} onChange={(event) => setTransferNotes((current) => ({ ...current, [transfer.id]: event.target.value }))} placeholder={transfer.status === 'in_transit' ? 'Required if received quantity differs from picked quantity' : 'Pickup / cancellation note'} /> : null}<footer>{transfer.status === 'requested' ? <><button type="button" disabled={busy} onClick={() => void cancelTransfer(transfer)}>Cancel</button><button type="button" className={styles.primary} disabled={busy} onClick={() => void pickup(transfer)}>Confirm Pickup</button></> : null}{transfer.status === 'in_transit' ? <button type="button" className={styles.primary} disabled={busy} onClick={() => void receive(transfer)}>Receive & Complete</button> : null}{transfer.status === 'completed' ? <span>{transfer.hasDiscrepancy ? 'Completed with discrepancy' : `Received ${dateTime(transfer.receivedAt)}`}</span> : null}</footer></article>)}</section>
    </div> : null}

    {view === 'replenishment' ? <section className={styles.panel}><header className={styles.panelHead}><div><strong>Van replenishment</strong><span>Derived automatically from available stock vs min / target</span></div><b>{snapshot.replenishment.length} alerts</b></header><div className={styles.tableWrap}><table><thead><tr><th>Item</th><th>Van</th><th>On hand</th><th>Reserved</th><th>Min</th><th>Target</th><th>Replenish</th></tr></thead><tbody>{snapshot.replenishment.map((row) => <tr key={`${row.locationId}:${row.itemKind}:${row.itemId}`}><td><strong>{row.itemName}</strong></td><td>{locationLabel(locations, row.locationId)}</td><td>{row.onHand}</td><td>{row.reserved}</td><td>{row.minimum}</td><td>{row.target}</td><td><b>{row.needed}</b></td></tr>)}</tbody></table></div>{!snapshot.replenishment.length ? <p className={styles.empty}>All configured van stock is above minimum.</p> : null}</section> : null}

    {view === 'movements' ? <section className={styles.panel}><header className={styles.panelHead}><div><strong>Inventory movement audit</strong><span>Immutable events; not another balance source</span></div></header><div className={styles.tableWrap}><table><thead><tr><th>When</th><th>Item</th><th>Movement</th><th>Qty</th><th>From</th><th>To</th><th>By</th></tr></thead><tbody>{snapshot.movements.map((row) => <tr key={row.id}><td>{dateTime(row.occurredAt)}</td><td><strong>{row.itemName}</strong></td><td>{row.type.replaceAll('_', ' ')}</td><td>{row.quantity}</td><td>{row.sourceLocationId ? locationLabel(locations, row.sourceLocationId) : '—'}</td><td>{row.destinationLocationId ? locationLabel(locations, row.destinationLocationId) : '—'}</td><td>{row.performedByName || '—'}</td></tr>)}</tbody></table></div></section> : null}

    {stockEdit ? <div className={styles.modalBackdrop}><section className={styles.modal}><header><div><span>Physical stock · {locationLabel(locations, stockEdit.locationId)}</span><h2>{stockEdit.item.name}</h2></div><button type="button" onClick={() => setStockEdit(null)}>×</button></header><div className={styles.form}><label>On hand<input type="number" min="0" value={stockEdit.onHand} onChange={(event) => setStockEdit({ ...stockEdit, onHand: event.target.value })} /></label><label>Minimum<input type="number" min="0" value={stockEdit.minimum} onChange={(event) => setStockEdit({ ...stockEdit, minimum: event.target.value })} /></label><label>Target<input type="number" min="0" value={stockEdit.target} onChange={(event) => setStockEdit({ ...stockEdit, target: event.target.value })} /></label><p className={styles.wide}>Reserved stock cannot be counted below its committed quantity. Van min/target drives replenishment automatically.</p><footer className={styles.wide}><button type="button" onClick={() => setStockEdit(null)}>Cancel</button><button type="button" className={styles.primary} disabled={busy} onClick={() => void saveStockEdit()}>Save verified count</button></footer></div></section></div> : null}

    {legacyItem ? <div className={styles.modalBackdrop}><section className={styles.modal}><header><div><span>Historical stock assignment</span><h2>{legacyItem.name}</h2></div><button type="button" onClick={() => setLegacyItem(null)}>×</button></header><div className={styles.form}><p className={styles.wide}>Unassigned total: <b>{legacyItem.balances[LEGACY_LOCATION_ID]?.onHand ?? 0}</b>. Warehouse + Office must equal this exact quantity.</p><label>Warehouse<input type="number" min="0" value={legacyWarehouse} onChange={(event) => setLegacyWarehouse(event.target.value)} /></label><label>Office<input type="number" min="0" value={legacyOffice} onChange={(event) => setLegacyOffice(event.target.value)} /></label><footer className={styles.wide}><button type="button" onClick={() => setLegacyItem(null)}>Cancel</button><button type="button" className={styles.primary} disabled={busy} onClick={() => void saveLegacyAllocation()}>Assign locations</button></footer></div></section></div> : null}
  </section>;
}
