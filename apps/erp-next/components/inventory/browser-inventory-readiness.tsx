'use client';

import { useMemo, useState } from 'react';
import { deriveBrowserLocationBalances, deriveVanReadiness, loadBrowserInventoryOpeningBalances, restockToPar, syncSubmittedFieldConsumption, type InventoryPreviewLocationId } from '../../lib/browser-inventory-readiness';
import styles from './browser-inventory-readiness.module.css';

const locationNames: Record<InventoryPreviewLocationId, string> = {
  'WH-MAIN': 'Main Warehouse · Santa Cruz',
  'VAN-1': 'Van 1',
  'VAN-2': 'Van 2',
  'VAN-3': 'Van 3',
  'VAN-4': 'Van 4',
};

function amount(value: number, unit: string) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`;
}

function signed(value: number, unit: string) {
  if (!value) return `0 ${unit}`;
  return `${value > 0 ? '+' : ''}${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`;
}

export function BrowserInventoryReadiness() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeLocation, setActiveLocation] = useState<InventoryPreviewLocationId>('VAN-1');
  const snapshot = useMemo(() => {
    const opening = loadBrowserInventoryOpeningBalances();
    const sync = syncSubmittedFieldConsumption();
    const balances = deriveBrowserLocationBalances(opening, sync.movements);
    return { balances, readiness: deriveVanReadiness(balances), movements: sync.movements, newlyPosted: sync.newlyPosted };
  }, [refreshKey]);

  const activeLines = snapshot.balances.filter((line) => line.locationId === activeLocation);
  const vanReadiness = snapshot.readiness.find((item) => item.locationId === activeLocation);
  const lowCount = snapshot.balances.filter((line) => line.locationId !== 'WH-MAIN' && line.status !== 'ok').length;
  const blockedVans = snapshot.readiness.filter((item) => item.status === 'blocked').length;
  const atRiskVans = snapshot.readiness.filter((item) => item.status === 'at_risk').length;
  const jobMovements = snapshot.movements.filter((movement) => movement.movementType === 'job_consumption');
  const transferMovements = snapshot.movements.filter((movement) => movement.movementType === 'transfer_out' || movement.movementType === 'transfer_in');

  return (
    <section className={styles.workspace}>
      <header>
        <div><span>INVENTORY TRUTH · LOCATION LEDGER</span><h2>Van Stock Balance & Readiness</h2><p>Current stock is derived from opening balance, completed transfer custody events and submitted job consumption. The screen never edits the current balance directly.</p></div>
        <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Refresh Ledger</button>
      </header>

      <div className={styles.metrics}>
        <article><span>Mobile Warehouses</span><strong>4</strong><small>Van 1–4 tracked separately</small></article>
        <article><span>Vans At Risk</span><strong className={atRiskVans ? styles.warnText : ''}>{atRiskVans}</strong><small>Below configured minimum</small></article>
        <article><span>Blocked by Essential Stock</span><strong className={blockedVans ? styles.dangerText : ''}>{blockedVans}</strong><small>Essential tracked line reached zero</small></article>
        <article><span>Ledger Movements</span><strong>{snapshot.movements.length}</strong><small>{jobMovements.length} job · {transferMovements.length} transfer custody</small></article>
      </div>

      <div className={styles.vanGrid}>
        {snapshot.readiness.map((van) => <button type="button" key={van.locationId} className={`${styles.vanCard} ${activeLocation === van.locationId ? styles.active : ''}`} onClick={() => setActiveLocation(van.locationId)}>
          <div><span>{van.locationId}</span><strong>{locationNames[van.locationId]}</strong><small>{van.currentLines.length} tracked lines</small></div>
          <b className={van.status === 'ready' ? styles.ready : van.status === 'blocked' ? styles.blocked : styles.risk}>{van.status.replace('_', ' ')}</b>
          <p>{van.lowLines.length ? `${van.lowLines.length} line(s) below minimum` : 'All configured lines at/above minimum'}</p>
        </button>)}
        <button type="button" className={`${styles.vanCard} ${activeLocation === 'WH-MAIN' ? styles.active : ''}`} onClick={() => setActiveLocation('WH-MAIN')}>
          <div><span>WH-MAIN</span><strong>Main Warehouse</strong><small>{snapshot.balances.filter((line) => line.locationId === 'WH-MAIN').length} tracked lines</small></div>
          <b className={styles.neutral}>warehouse</b>
          <p>Source stock for van replenishment</p>
        </button>
      </div>

      <div className={styles.layout}>
        <main className={styles.stockPanel}>
          <div className={styles.sectionHead}><div><strong>{locationNames[activeLocation]}</strong><span>Opening + transfers − job consumption → current</span></div><b>{activeLines.filter((line) => line.status !== 'ok').length} attention</b></div>
          <div className={styles.tableWrap}><div className={styles.table}>
            <div className={`${styles.row} ${styles.head}`}><span>Item</span><span>Opening</span><span>Job Used</span><span>Transfer Net</span><span>Current</span><span>Min / Par / Target</span><span>Restock to Par</span><span>Status</span></div>
            {activeLines.map((line) => <div className={styles.row} key={`${line.locationId}-${line.itemCode}`}>
              <div><strong>{line.itemName}</strong><small>{line.itemCode}{line.essentialForVanReadiness ? ' · essential readiness line' : ''}</small></div>
              <span>{amount(line.openingQuantity, line.unit)}</span>
              <span>{amount(line.consumed, line.unit)}</span>
              <span>{signed(line.transferredIn - line.transferredOut, line.unit)}<small>+{line.transferredIn} / −{line.transferredOut}</small></span>
              <strong>{amount(line.current, line.unit)}</strong>
              <span>{line.minimum} / {line.par} / {line.target}</span>
              <b>{amount(restockToPar(line), line.unit)}</b>
              <em className={line.status === 'ok' ? styles.ready : line.status === 'empty' ? styles.blocked : styles.risk}>{line.status}</em>
            </div>)}
          </div></div>
        </main>

        <aside className={styles.sideRail}>
          <section><span>VAN STOCK READINESS</span><strong>{activeLocation === 'WH-MAIN' ? 'Warehouse reference' : (vanReadiness?.status ?? 'not evaluated').replace('_', ' ')}</strong><p>{activeLocation === 'WH-MAIN' ? 'Warehouse health does not represent field-job readiness by itself.' : vanReadiness?.status === 'blocked' ? 'At least one essential configured stock line is empty.' : vanReadiness?.status === 'at_risk' ? 'The van can operate, but one or more tracked lines are below minimum.' : 'All tracked lines are at or above configured minimum.'}</p></section>
          <section><span>FIELD → INVENTORY</span><strong>{jobMovements.length} job movement(s)</strong><p>Only submitted Field Execution add-ons create job-consumption movements. Stable IDs prevent duplicate posting.</p></section>
          <section><span>TRANSFER CUSTODY</span><strong>{transferMovements.length} custody movement(s)</strong><p>Issue removes stock from source. Receipt adds it to destination. In-transit stock belongs to neither location’s on-hand balance.</p></section>
          <section><span>JOB READINESS GUARDRAIL</span><strong>No material requirement = no invented blocker</strong><p>This stock readiness does not claim a specific Work Order is READY or BLOCKED until that Work Order contains explicit required materials/parts.</p></section>
        </aside>
      </div>

      <footer><div><span>DERIVATION RULE</span><strong>Current = Opening + Transfer In − Transfer Out − Job Consumption.</strong></div><p>Receipts, returns and approved cycle-count adjustments will extend the same ledger; they will not become arbitrary direct balance edits.</p></footer>
      {lowCount ? <div className={styles.banner}><strong>{lowCount} mobile stock line(s) are below minimum.</strong><span>Transfer Ledger can move available office/van stock toward replenishment.</span></div> : null}
    </section>
  );
}
