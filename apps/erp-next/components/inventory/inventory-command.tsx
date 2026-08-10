'use client';

import { useMemo, useState } from 'react';
import type { InventoryItem, InventoryLocation, InventoryTransfer, InventoryTransferLine, StockBalance, ToolAsset } from '../../lib/inventory';
import { availableStock, buildStockProjection, evaluateInventoryReadiness, nextTransferStatus, transferRequiresApproval } from '../../lib/inventory';
import styles from './inventory-command.module.css';

type Tab = 'Stock' | 'Vans' | 'Transfers' | 'Tools' | 'Forecast';

const locations: InventoryLocation[] = [
  { id: 'WH-MAIN', name: 'Main Warehouse · Santa Cruz', type: 'warehouse', active: true },
  { id: 'VAN-1', name: 'Van 1', type: 'van', vanId: 'VAN-1', active: true },
  { id: 'VAN-2', name: 'Van 2', type: 'van', vanId: 'VAN-2', active: true },
  { id: 'VAN-3', name: 'Van 3', type: 'van', vanId: 'VAN-3', active: true },
  { id: 'VAN-4', name: 'Van 4', type: 'van', vanId: 'VAN-4', active: true },
  { id: 'QUAR', name: 'Warranty / Quarantine', type: 'quarantine', active: true },
];

const items: InventoryItem[] = [
  { id: 'IT-SW220', sku: 'SW-220V', name: '220V A/C Switch', classification: 'sellable_part', unitOfMeasure: 'ea', trackQuantity: true, trackSerial: false, trackToolCustody: false, reorderable: true },
  { id: 'IT-ARMA', sku: 'ARMA-34', name: 'Armaflex Insulation', classification: 'measured_consumable', unitOfMeasure: 'm', trackQuantity: true, trackSerial: false, trackToolCustody: false, reorderable: true },
  { id: 'IT-WIRE', sku: 'WIRE-6MM', name: '6 mm² Electrical Wire', classification: 'measured_consumable', unitOfMeasure: 'm', trackQuantity: true, trackSerial: false, trackToolCustody: false, reorderable: true },
  { id: 'IT-R32', sku: 'R32-25LB', name: 'R32 Refrigerant', classification: 'measured_consumable', unitOfMeasure: 'lb', trackQuantity: true, trackSerial: false, trackToolCustody: false, reorderable: true },
  { id: 'IT-CAP', sku: 'CAP-45', name: '45 µF Capacitor', classification: 'sellable_part', unitOfMeasure: 'ea', trackQuantity: true, trackSerial: false, trackToolCustody: false, reorderable: true },
  { id: 'IT-PUMP', sku: 'PUMP-DRAIN', name: 'Drain Pump', classification: 'sellable_part', unitOfMeasure: 'ea', trackQuantity: true, trackSerial: false, trackToolCustody: false, reorderable: true },
  { id: 'IT-VAC', sku: 'TOOL-VAC7', name: '7 CFM Vacuum Pump', classification: 'tool', unitOfMeasure: 'asset', trackQuantity: false, trackSerial: true, trackToolCustody: true, reorderable: false },
  { id: 'IT-AC18', sku: 'ADINA-18K', name: 'Adina Optima 18K', classification: 'hvac_equipment', unitOfMeasure: 'ea', trackQuantity: true, trackSerial: true, trackToolCustody: false, reorderable: true },
];

const initialBalances: StockBalance[] = [
  { itemId: 'IT-SW220', locationId: 'WH-MAIN', onHand: 68, reserved: 10, inbound: 40, minimum: 30, par: 80, target: 100 },
  { itemId: 'IT-SW220', locationId: 'VAN-1', onHand: 6, reserved: 1, inbound: 0, minimum: 5, par: 10, target: 12 },
  { itemId: 'IT-SW220', locationId: 'VAN-2', onHand: 3, reserved: 0, inbound: 0, minimum: 5, par: 10, target: 12 },
  { itemId: 'IT-SW220', locationId: 'VAN-3', onHand: 8, reserved: 2, inbound: 0, minimum: 5, par: 10, target: 12 },
  { itemId: 'IT-SW220', locationId: 'VAN-4', onHand: 4, reserved: 0, inbound: 0, minimum: 5, par: 10, target: 12 },
  { itemId: 'IT-ARMA', locationId: 'WH-MAIN', onHand: 92, reserved: 24, inbound: 30, minimum: 40, par: 100, target: 120 },
  { itemId: 'IT-ARMA', locationId: 'VAN-1', onHand: 14, reserved: 4, inbound: 0, minimum: 10, par: 18, target: 22 },
  { itemId: 'IT-ARMA', locationId: 'VAN-2', onHand: 7, reserved: 2, inbound: 0, minimum: 10, par: 18, target: 22 },
  { itemId: 'IT-WIRE', locationId: 'WH-MAIN', onHand: 188, reserved: 42, inbound: 0, minimum: 100, par: 200, target: 260 },
  { itemId: 'IT-WIRE', locationId: 'VAN-1', onHand: 22, reserved: 6, inbound: 0, minimum: 20, par: 35, target: 45 },
  { itemId: 'IT-R32', locationId: 'WH-MAIN', onHand: 41, reserved: 8, inbound: 25, minimum: 20, par: 45, target: 60 },
  { itemId: 'IT-R32', locationId: 'VAN-1', onHand: 9, reserved: 2, inbound: 0, minimum: 5, par: 10, target: 12 },
  { itemId: 'IT-CAP', locationId: 'WH-MAIN', onHand: 18, reserved: 3, inbound: 0, minimum: 12, par: 24, target: 30 },
  { itemId: 'IT-PUMP', locationId: 'WH-MAIN', onHand: 6, reserved: 2, inbound: 0, minimum: 5, par: 10, target: 12 },
  { itemId: 'IT-AC18', locationId: 'WH-MAIN', onHand: 5, reserved: 3, inbound: 8, minimum: 3, par: 8, target: 10 },
];

const initialTransfers: InventoryTransfer[] = [
  { id: 'TR-1048', sourceLocationId: 'WH-MAIN', destinationLocationId: 'VAN-2', status: 'requested', requestedBy: 'Operations', requestedAt: 'Today · 08:10', lines: [{ itemId: 'IT-SW220', itemName: '220V A/C Switch', quantity: 6, unitOfMeasure: 'ea' }, { itemId: 'IT-ARMA', itemName: 'Armaflex Insulation', quantity: 12, unitOfMeasure: 'm' }] },
  { id: 'TR-1047', sourceLocationId: 'VAN-3', destinationLocationId: 'VAN-4', status: 'issued', requestedBy: 'Van 4', approvedBy: 'Operations', issuedBy: 'Van 3', requestedAt: 'Today · 07:42', lines: [{ itemId: 'IT-CAP', itemName: '45 µF Capacitor', quantity: 1, unitOfMeasure: 'ea' }] },
];

const tools: ToolAsset[] = [
  { id: 'TOOL-101', itemId: 'IT-VAC', assetTag: 'DEMAC-VAC-01', serialNumber: 'VP7-8182', condition: 'good', locationId: 'VAN-1', custodianEmployeeId: 'EMP-MR', calibrationDueAt: '2027-02-01' },
  { id: 'TOOL-102', itemId: 'IT-VAC', assetTag: 'DEMAC-VAC-02', serialNumber: 'VP7-8211', condition: 'good', locationId: 'VAN-3', custodianEmployeeId: 'EMP-WA', calibrationDueAt: '2027-02-01' },
];

const jobRequirements = [
  { itemId: 'IT-SW220', itemName: '220V A/C Switch', quantityRequired: 2, unitOfMeasure: 'ea', locationId: 'VAN-2' },
  { itemId: 'IT-ARMA', itemName: 'Armaflex Insulation', quantityRequired: 8, unitOfMeasure: 'm', locationId: 'VAN-2' },
];

function locationName(id: string) { return locations.find((location) => location.id === id)?.name ?? id; }
function itemName(id: string) { return items.find((item) => item.id === id)?.name ?? id; }

export function InventoryCommand() {
  const [tab, setTab] = useState<Tab>('Stock');
  const [balances] = useState(initialBalances);
  const [transfers, setTransfers] = useState(initialTransfers);
  const [activeLocation, setActiveLocation] = useState('WH-MAIN');
  const [transferOpen, setTransferOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const locationBalances = balances.filter((balance) => balance.locationId === activeLocation);
  const shortages = balances.filter((balance) => balance.onHand - balance.reserved < balance.minimum).length;
  const reserved = balances.reduce((sum, balance) => sum + balance.reserved, 0);
  const readiness = evaluateInventoryReadiness(jobRequirements, balances);
  const projections = useMemo(() => balances.filter((balance) => balance.locationId === 'WH-MAIN').map((balance) => buildStockProjection({ itemId: balance.itemId, locationId: balance.locationId, onHand: balance.onHand, inboundTransfer: balance.inbound, reservedJobs: balance.reserved, expectedConsumption: Math.ceil(balance.par * .15), target: balance.target, minimum: balance.minimum })), [balances]);

  const advanceTransfer = (id: string) => {
    setTransfers((current) => current.map((transfer) => transfer.id === id ? { ...transfer, status: nextTransferStatus(transfer.status) } : transfer));
    setNotice(`${id} advanced to the next custody state in preview.`);
  };

  return <section className={styles.page}>
    <header className={styles.pageHeader}><div><span>Inventory · Mobile Warehouses</span><h1>Inventory & Van Stock</h1><p>Warehouse, vans, tools, transfers, reservations and purchasing signals share one auditable location ledger.</p></div><div className={styles.pageActions}><button type="button">Cycle count</button><button type="button" className={styles.primary} onClick={() => setTransferOpen(true)}>+ New transfer</button></div></header>
    {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

    <div className={styles.metrics}><article><span>Inventory Locations</span><strong>6</strong><small>Warehouse · 4 vans · quarantine</small><i style={{ width: '100%' }} /></article><article><span>Below Minimum</span><strong className={shortages ? styles.warning : ''}>{shortages}</strong><small>Location-item shortages</small><i style={{ width: `${Math.min(100, shortages * 20)}%` }} /></article><article><span>Reserved for Jobs</span><strong>{reserved}</strong><small>Units / measured quantities</small><i style={{ width: '46%' }} /></article><article><span>Open Transfers</span><strong>{transfers.filter((transfer) => transfer.status !== 'received' && transfer.status !== 'cancelled').length}</strong><small>Custody confirmations pending</small><i style={{ width: '38%' }} /></article></div>

    <nav className={styles.tabs}>{(['Stock','Vans','Transfers','Tools','Forecast'] as Tab[]).map((item) => <button type="button" key={item} className={tab === item ? styles.tabActive : ''} onClick={() => setTab(item)}>{item}</button>)}</nav>

    {tab === 'Stock' ? <StockTab balances={locationBalances} activeLocation={activeLocation} setActiveLocation={setActiveLocation} /> : null}
    {tab === 'Vans' ? <VansTab balances={balances} setActiveLocation={(id) => { setActiveLocation(id); setTab('Stock'); }} /> : null}
    {tab === 'Transfers' ? <TransfersTab transfers={transfers} onAdvance={advanceTransfer} /> : null}
    {tab === 'Tools' ? <ToolsTab /> : null}
    {tab === 'Forecast' ? <ForecastTab projections={projections} readiness={readiness} /> : null}
    {transferOpen ? <TransferDrawer onClose={() => setTransferOpen(false)} onCreate={(transfer) => { setTransfers((current) => [transfer, ...current]); setTransferOpen(false); setTab('Transfers'); setNotice(`${transfer.id} created as a requested transfer.`); }} /> : null}
  </section>;
}

function StockTab({ balances, activeLocation, setActiveLocation }: { balances: StockBalance[]; activeLocation: string; setActiveLocation: (id: string) => void }) {
  return <div className={styles.workspace}><aside className={styles.locationRail}><header><strong>Locations</strong><span>Stock belongs to location</span></header>{locations.map((location) => <button type="button" key={location.id} className={location.id === activeLocation ? styles.locationActive : ''} onClick={() => setActiveLocation(location.id)}><span>{location.type === 'van' ? location.name.replace('Van ','V') : location.type === 'warehouse' ? 'WH' : 'Q'}</span><div><strong>{location.name}</strong><small>{location.type.replace('_',' ')}</small></div></button>)}</aside><main className={styles.stockPanel}><header><div><strong>{locationName(activeLocation)}</strong><span>On hand, reservations and par levels</span></div><button type="button">Adjust filters</button></header><div className={styles.stockTable}><div className={styles.tableHead}><span>Item</span><span>On hand</span><span>Reserved</span><span>Available</span><span>Min / Par</span><span>Status</span></div>{balances.length ? balances.map((balance) => { const item = items.find((candidate) => candidate.id === balance.itemId); const available = availableStock(balance); const low = available < balance.minimum; return <div className={styles.tableRow} key={`${balance.locationId}-${balance.itemId}`}><div><strong>{item?.name ?? balance.itemId}</strong><small>{item?.sku} · {item?.classification.replace('_',' ')}</small></div><span>{balance.onHand} {item?.unitOfMeasure}</span><span>{balance.reserved}</span><b>{available}</b><span>{balance.minimum} / {balance.par}</span><em className={low ? styles.low : styles.good}>{low ? 'LOW' : 'OK'}</em></div>; }) : <div className={styles.empty}>No stock balances recorded for this location.</div>}</div></main></div>;
}

function VansTab({ balances, setActiveLocation }: { balances: StockBalance[]; setActiveLocation: (id: string) => void }) {
  return <div className={styles.vanGrid}>{locations.filter((location) => location.type === 'van').map((van) => { const stock = balances.filter((balance) => balance.locationId === van.id); const low = stock.filter((balance) => availableStock(balance) < balance.minimum); const healthy = Math.max(0, stock.length - low.length); return <article key={van.id} className={styles.vanCard}><header><div className={styles.vanBadge}>{van.name.replace('Van ','V')}</div><div><strong>{van.name}</strong><span>Mobile warehouse</span></div><b>{low.length ? 'ATTENTION' : 'HEALTHY'}</b></header><div className={styles.vanMetrics}><div><span>Tracked lines</span><strong>{stock.length}</strong></div><div><span>Healthy</span><strong>{healthy}</strong></div><div><span>Below min</span><strong className={low.length ? styles.warning : ''}>{low.length}</strong></div></div><div className={styles.lowList}>{low.length ? low.slice(0,3).map((balance) => <div key={balance.itemId}><span>!</span><div><strong>{itemName(balance.itemId)}</strong><small>{availableStock(balance)} available · min {balance.minimum}</small></div></div>) : <div className={styles.allGood}>✓ Current tracked stock is above minimum.</div>}</div><button type="button" onClick={() => setActiveLocation(van.id)}>Open van stock</button></article>; })}</div>;
}

function TransfersTab({ transfers, onAdvance }: { transfers: InventoryTransfer[]; onAdvance: (id: string) => void }) {
  return <section className={styles.panel}><header><div><strong>Inventory Transfers</strong><span>Requester → approval → issue → transit → receipt</span></div><button type="button">Transfer settings</button></header><div className={styles.transferList}>{transfers.map((transfer) => <article key={transfer.id}><div className={styles.transferRoute}><span>{transfer.id}</span><strong>{locationName(transfer.sourceLocationId)} → {locationName(transfer.destinationLocationId)}</strong><small>{transfer.requestedAt} · Requested by {transfer.requestedBy}</small></div><div className={styles.transferLines}>{transfer.lines.map((line) => <span key={line.itemId}>{line.quantity} {line.unitOfMeasure} · {line.itemName}</span>)}</div><b>{transfer.status.replace('_',' ')}</b><button type="button" disabled={transfer.status === 'received'} onClick={() => onAdvance(transfer.id)}>{transfer.status === 'received' ? 'Received ✓' : 'Advance →'}</button></article>)}</div></section>;
}

function ToolsTab() {
  return <section className={styles.panel}><header><div><strong>Company Tools</strong><span>Assets have custody, condition and calibration history</span></div><button type="button">+ Register tool</button></header><div className={styles.toolGrid}>{tools.map((tool) => <article key={tool.id}><div className={styles.toolIcon}>TL</div><div><span>{tool.assetTag}</span><strong>{itemName(tool.itemId)}</strong><small>{tool.serialNumber} · {locationName(tool.locationId)}</small></div><div><b>{tool.condition}</b><small>Calibration {tool.calibrationDueAt ?? 'N/A'}</small></div></article>)}</div></section>;
}

function ForecastTab({ projections, readiness }: { projections: ReturnType<typeof buildStockProjection>[]; readiness: ReturnType<typeof evaluateInventoryReadiness> }) {
  return <div className={styles.forecastLayout}><main className={styles.panel}><header><div><strong>Projected Warehouse Availability</strong><span>On hand + inbound − reserved jobs − expected consumption</span></div><button type="button">Forecast settings</button></header><div className={styles.projectionList}>{projections.map((projection) => <article key={projection.itemId}><div><strong>{itemName(projection.itemId)}</strong><span>Projected available</span></div><b className={projection.recommendedPurchaseQuantity ? styles.warning : styles.goodText}>{projection.projectedAvailable}</b><div className={styles.projectionMath}><span>{projection.onHand} on hand</span><i>+</i><span>{projection.inboundPurchase + projection.inboundTransfer} inbound</span><i>−</i><span>{projection.reservedJobs} reserved</span><i>−</i><span>{projection.expectedConsumption} expected</span></div><em>{projection.recommendedPurchaseQuantity ? `Recommend purchase ${projection.recommendedPurchaseQuantity}` : 'No purchase recommended'}</em></article>)}</div></main><aside className={styles.intelligence}><div className={styles.aiTitle}><span>AI</span><div><strong>Inventory Intelligence</strong><small>Forecast from ERP facts</small></div></div><section><span>Tomorrow readiness</span><strong className={readiness.status === 'blocked' ? styles.dangerText : styles.goodText}>{readiness.status.toUpperCase()}</strong>{readiness.missing.map((item) => <p key={item.itemId}>Missing {item.shortage} {item.unitOfMeasure} of {item.itemName} on Van 2.</p>)}{readiness.warnings.map((warning) => <p key={warning}>{warning}</p>)}</section><section><span>Suggested transfer</span><strong>Warehouse → Van 2</strong><p>Switches and Armaflex are below the van minimum and a job requirement is already known.</p></section><section><span>Policy</span><strong>Predict, do not guess</strong><p>Recommended purchases and transfers must expose the quantities and inputs behind the recommendation.</p></section></aside></div>;
}

function TransferDrawer({ onClose, onCreate }: { onClose: () => void; onCreate: (transfer: InventoryTransfer) => void }) {
  const [source, setSource] = useState('WH-MAIN');
  const [destination, setDestination] = useState('VAN-2');
  const [itemId, setItemId] = useState('IT-SW220');
  const [quantity, setQuantity] = useState(6);
  const line: InventoryTransferLine = { itemId, itemName: itemName(itemId), quantity, unitOfMeasure: items.find((item) => item.id === itemId)?.unitOfMeasure ?? 'ea' };
  const requiresApproval = transferRequiresApproval([line], items);
  const create = () => onCreate({ id: `TR-${1050 + Date.now() % 1000}`, sourceLocationId: source, destinationLocationId: destination, status: 'requested', lines: [line], requestedBy: 'Current user', requestedAt: 'Now' });
  return <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className={styles.drawer}><header><div><span>Inventory custody</span><h2>New transfer</h2><p>Moving stock changes location ownership only after the required custody confirmations.</p></div><button type="button" onClick={onClose}>×</button></header><div className={styles.drawerBody}><section><strong>Route</strong><div className={styles.formGrid}><label><span>From</span><select value={source} onChange={(event) => setSource(event.target.value)}>{locations.filter((location) => location.active).map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label><label><span>To</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{locations.filter((location) => location.active && location.id !== source).map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label></div></section><section><strong>Transfer line</strong><div className={styles.formGrid}><label className={styles.wide}><span>Item</span><select value={itemId} onChange={(event) => setItemId(event.target.value)}>{items.filter((item) => item.trackQuantity || item.trackToolCustody).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label><span>Quantity</span><input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} /></label></div></section><div className={styles.transferPolicy}><span>{requiresApproval ? 'APPROVAL REQUIRED' : 'STANDARD TRANSFER'}</span><p>{requiresApproval ? 'High-value/serialized equipment or tools require controlled approval/custody confirmations.' : 'Normal stock still records requester, issuer and receiver for audit history.'}</p></div></div><footer><button type="button" onClick={onClose}>Cancel</button><button type="button" className={styles.primary} disabled={source === destination} onClick={create}>Request transfer</button></footer></aside></div>;
}
