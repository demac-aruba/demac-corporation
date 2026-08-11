'use client';

import { useEffect, useMemo, useState } from 'react';
import { browserKeys, loadBrowserValue, saveBrowserValue } from '../../lib/browser-store';
import type { BrowserFieldExecutionRecord } from '../../lib/browser-field';
import type { BrowserWorkOrderRecord } from '../../lib/browser-operational';
import { BROWSER_INVENTORY_MOVEMENTS_KEY, deriveFieldConsumption, mergeInventoryMovements, type BrowserInventoryMovement } from '../../lib/browser-inventory-ledger';
import styles from './browser-field-consumption.module.css';

export function BrowserFieldConsumption() {
  const [movements, setMovements] = useState<BrowserInventoryMovement[]>([]);
  const [syncedCount, setSyncedCount] = useState(0);

  useEffect(() => {
    const existing = loadBrowserValue<BrowserInventoryMovement[]>(BROWSER_INVENTORY_MOVEMENTS_KEY, []);
    const orders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    const executions = loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []);
    const derived = executions.flatMap((execution) => {
      const order = orders.find((candidate) => candidate.id === execution.workOrderId);
      return order ? deriveFieldConsumption(order, execution) : [];
    });
    const merged = mergeInventoryMovements(existing, derived);
    saveBrowserValue(BROWSER_INVENTORY_MOVEMENTS_KEY, merged);
    setMovements(merged);
    setSyncedCount(Math.max(0, merged.length - existing.length));
  }, []);

  const summary = useMemo(() => {
    const switches = movements.filter((movement) => movement.itemCode === 'SW-220V').reduce((sum, movement) => sum + movement.quantity, 0);
    const refrigerant = movements.filter((movement) => movement.itemCode === 'REFRIGERANT').reduce((sum, movement) => sum + movement.quantity, 0);
    const workOrders = new Set(movements.map((movement) => movement.workOrderId)).size;
    return { switches, refrigerant, workOrders };
  }, [movements]);

  return (
    <section className={styles.ledger}>
      <header><div><span>FIELD → INVENTORY BRIDGE</span><h2>Job Consumption Ledger</h2><p>Submitted technician add-ons are converted into idempotent inventory-consumption movements so office staff do not re-enter the same materials.</p></div><b>{movements.length} movement{movements.length === 1 ? '' : 's'}</b></header>
      <div className={styles.metrics}><article><span>Work Orders Posted</span><strong>{summary.workOrders}</strong><small>Browser test ledger</small></article><article><span>220V Switches</span><strong>{summary.switches}</strong><small>Consumed from assigned vans</small></article><article><span>Refrigerant</span><strong>{summary.refrigerant.toFixed(1)} lb</strong><small>Measured job consumption</small></article><article><span>New This Sync</span><strong>{syncedCount}</strong><small>Idempotent import</small></article></div>
      {movements.length ? <div className={styles.tableWrap}><div className={styles.table}><div className={`${styles.row} ${styles.head}`}><span>Movement</span><span>Work Order</span><span>Item</span><span>Quantity</span><span>From</span><span>To</span><span>Source</span></div>{movements.slice(0,12).map((movement) => <div className={styles.row} key={movement.id}><div><strong>{movement.id}</strong><small>{new Date(movement.occurredAt).toLocaleString()}</small></div><strong>{movement.workOrderId}</strong><div><strong>{movement.itemName}</strong><small>{movement.itemCode}</small></div><strong>{movement.quantity} {movement.unit}</strong><span>{movement.sourceLocation}</span><span>{movement.destination}</span><b>Field execution</b></div>)}</div></div> : <div className={styles.empty}><strong>No field consumption posted yet</strong><p>When a Scheduling-created Work Order is executed and submitted from the Field App with add-ons/materials, those movements will appear here automatically.</p></div>}
      <footer><div><span>Current mode</span><strong>Browser preview ledger</strong></div><p>The Firebase inventory ledger will use the same idempotent movement IDs and will update real van balances only after the transaction/security layer is activated.</p></footer>
    </section>
  );
}
