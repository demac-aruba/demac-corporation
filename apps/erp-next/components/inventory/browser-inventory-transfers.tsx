'use client';

import { useMemo, useState } from 'react';
import { BROWSER_INVENTORY_MOVEMENTS_KEY, type BrowserInventoryMovement } from '../../lib/browser-inventory-ledger';
import { deriveBrowserLocationBalances, loadBrowserInventoryOpeningBalances, type InventoryPreviewLocationId } from '../../lib/browser-inventory-readiness';
import { approveBrowserInventoryTransfer, cancelBrowserInventoryTransfer, createBrowserInventoryTransfer, issueBrowserInventoryTransfer, loadBrowserInventoryTransfers, receiveBrowserInventoryTransfer, type BrowserInventoryTransfer } from '../../lib/browser-inventory-transfers';
import { loadBrowserValue } from '../../lib/browser-store';
import styles from './browser-inventory-transfers.module.css';

const locations: Array<{ id: InventoryPreviewLocationId; name: string }> = [
  { id: 'WH-MAIN', name: 'Main Warehouse · Santa Cruz' },
  { id: 'VAN-1', name: 'Van 1' }, { id: 'VAN-2', name: 'Van 2' }, { id: 'VAN-3', name: 'Van 3' }, { id: 'VAN-4', name: 'Van 4' },
];

function when(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status: BrowserInventoryTransfer['status']) {
  return status === 'issued' ? 'IN TRANSIT' : status.toUpperCase();
}

export function BrowserInventoryTransfers() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [source, setSource] = useState<InventoryPreviewLocationId>('WH-MAIN');
  const [destination, setDestination] = useState<InventoryPreviewLocationId>('VAN-2');
  const [itemCode, setItemCode] = useState('SW-220V');
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  const data = useMemo(() => {
    const opening = loadBrowserInventoryOpeningBalances();
    const movements = loadBrowserValue<BrowserInventoryMovement[]>(BROWSER_INVENTORY_MOVEMENTS_KEY, []);
    return { opening, movements, balances: deriveBrowserLocationBalances(opening, movements), transfers: loadBrowserInventoryTransfers() };
  }, [refreshKey]);

  const sourceLines = data.balances.filter((line) => line.locationId === source);
  const selectedLine = sourceLines.find((line) => line.itemCode === itemCode) ?? sourceLines[0];
  const openTransfers = data.transfers.filter((item) => item.status !== 'received' && item.status !== 'cancelled');
  const inTransit = data.transfers.filter((item) => item.status === 'issued').length;

  const act = (fn: () => BrowserInventoryTransfer, success: (transfer: BrowserInventoryTransfer) => string) => {
    try {
      const transfer = fn();
      setNotice(success(transfer));
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Transfer action could not be completed.');
    }
  };

  const create = () => {
    if (!selectedLine) return;
    act(() => createBrowserInventoryTransfer({ sourceLocationId: source, destinationLocationId: destination, requestedBy: 'Operations', lines: [{ itemCode: selectedLine.itemCode, itemName: selectedLine.itemName, quantity, unit: selectedLine.unit }] }), (transfer) => `${transfer.id} requested. No stock moved yet.`);
  };

  return (
    <section className={styles.workspace}>
      <header><div><span>INVENTORY CUSTODY · TRANSFER LEDGER</span><h2>Office ↔ Van Stock Transfers</h2><p>Request, approve, issue and receive are separate custody events. Issued stock leaves the source immediately and remains in transit until the destination confirms receipt.</p></div><b>{openTransfers.length} open · {inTransit} in transit</b></header>
      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      <section className={styles.creator}>
        <div><strong>New Transfer Request</strong><span>One-line preview request; multi-line transfer UI follows the same record model.</span></div>
        <label>From<select value={source} onChange={(event) => { const next = event.target.value as InventoryPreviewLocationId; setSource(next); const first = data.balances.find((line) => line.locationId === next); if (first) setItemCode(first.itemCode); }} >{locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
        <label>To<select value={destination} onChange={(event) => setDestination(event.target.value as InventoryPreviewLocationId)}>{locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
        <label>Item<select value={selectedLine?.itemCode ?? ''} onChange={(event) => setItemCode(event.target.value)}>{sourceLines.map((line) => <option value={line.itemCode} key={line.itemCode}>{line.itemName} · {line.current} {line.unit} current</option>)}</select></label>
        <label>Qty<input type="number" min="0.1" step={selectedLine?.unit === 'lb' ? '0.1' : '1'} value={quantity} onChange={(event) => setQuantity(Math.max(0, Number(event.target.value) || 0))} /></label>
        <button type="button" disabled={!selectedLine || source === destination || quantity <= 0} onClick={create}>Request Transfer</button>
      </section>

      <div className={styles.tableWrap}><div className={styles.table}>
        <div className={`${styles.row} ${styles.head}`}><span>Transfer</span><span>Route</span><span>Lines</span><span>Requested</span><span>Custody</span><span>Status</span><span>Action</span></div>
        {data.transfers.length ? data.transfers.map((transfer) => {
          const nextAction = transfer.status === 'requested' ? 'Approve' : transfer.status === 'approved' ? 'Issue' : transfer.status === 'issued' ? 'Confirm Receipt' : null;
          return <div className={styles.row} key={transfer.id}>
            <div><strong>{transfer.id}</strong><small>by {transfer.requestedBy}</small></div>
            <div><strong>{transfer.sourceLocationId} → {transfer.destinationLocationId}</strong><small>{transfer.status === 'issued' ? 'Physical custody in transit' : 'Location ledger transfer'}</small></div>
            <div>{transfer.lines.map((line) => <span key={line.itemCode}>{line.quantity} {line.unit} · {line.itemName}</span>)}</div>
            <span>{when(transfer.requestedAt)}</span>
            <div><small>Approved: {transfer.approvedBy ?? '—'}</small><small>Issued: {transfer.issuedBy ?? '—'}</small><small>Received: {transfer.receivedBy ?? '—'}</small></div>
            <b className={styles[transfer.status]}>{statusLabel(transfer.status)}</b>
            <div className={styles.actions}>{nextAction ? <button type="button" onClick={() => {
              if (transfer.status === 'requested') act(() => approveBrowserInventoryTransfer(transfer.id), (value) => `${value.id} approved. Stock has not moved yet.`);
              else if (transfer.status === 'approved') act(() => issueBrowserInventoryTransfer(transfer.id, data.balances), (value) => `${value.id} issued. Source balance decreased and stock is now in transit.`);
              else if (transfer.status === 'issued') act(() => receiveBrowserInventoryTransfer(transfer.id), (value) => `${value.id} received. Destination balance increased.`);
            }}>{nextAction}</button> : <span>—</span>}{(transfer.status === 'requested' || transfer.status === 'approved') ? <button type="button" className={styles.cancel} onClick={() => act(() => cancelBrowserInventoryTransfer(transfer.id), (value) => `${value.id} cancelled before issue; no stock movement posted.`)}>Cancel</button> : null}</div>
          </div>;
        }) : <div className={styles.empty}><strong>No browser transfer records yet</strong><p>Create a request above. Stock will not move until the transfer is approved and issued.</p></div>}
      </div></div>

      <footer><div><span>ISSUE</span><strong>Posts transfer-out movement from source → in transit.</strong></div><div><span>RECEIPT</span><strong>Posts transfer-in movement from in transit → destination.</strong></div><p>Stable movement IDs make retries/idempotent reads safe in the browser preview. Production will use authenticated custody actors and server timestamps.</p></footer>
    </section>
  );
}
