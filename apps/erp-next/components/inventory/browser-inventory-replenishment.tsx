'use client';

import { useMemo, useState } from 'react';
import { BROWSER_INVENTORY_MOVEMENTS_KEY, type BrowserInventoryMovement } from '../../lib/browser-inventory-ledger';
import { deriveBrowserLocationBalances, loadBrowserInventoryOpeningBalances } from '../../lib/browser-inventory-readiness';
import { buildBrowserReplenishmentSuggestions } from '../../lib/browser-inventory-replenishment';
import { createBrowserInventoryTransfer, loadBrowserInventoryTransfers } from '../../lib/browser-inventory-transfers';
import { loadBrowserValue } from '../../lib/browser-store';
import styles from './browser-inventory-replenishment.module.css';

function qty(value: number, unit: string) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`;
}

export function BrowserInventoryReplenishment() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const snapshot = useMemo(() => {
    const opening = loadBrowserInventoryOpeningBalances();
    const movements = loadBrowserValue<BrowserInventoryMovement[]>(BROWSER_INVENTORY_MOVEMENTS_KEY, []);
    const balances = deriveBrowserLocationBalances(opening, movements);
    const transfers = loadBrowserInventoryTransfers();
    return { balances, transfers, suggestions: buildBrowserReplenishmentSuggestions(balances, transfers) };
  }, [refreshKey]);

  const transferSuggestions = snapshot.suggestions.filter((item) => item.action === 'transfer');
  const purchaseRequired = snapshot.suggestions.filter((item) => item.action === 'purchase_required');
  const critical = snapshot.suggestions.filter((item) => item.priority === 'critical').length;

  const prepareTransfer = (suggestionId: string) => {
    const suggestion = snapshot.suggestions.find((item) => item.id === suggestionId);
    if (!suggestion || suggestion.action !== 'transfer' || !suggestion.sourceLocationId) return;
    try {
      const transfer = createBrowserInventoryTransfer({
        sourceLocationId: suggestion.sourceLocationId,
        destinationLocationId: suggestion.destinationLocationId,
        requestedBy: 'Replenishment Intelligence · operator prepared',
        lines: [{ itemCode: suggestion.itemCode, itemName: suggestion.itemName, quantity: suggestion.suggestedQuantity, unit: suggestion.unit }],
      });
      setNotice(`${transfer.id} prepared as REQUESTED only. Nothing was approved, issued or moved automatically.`);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to prepare replenishment transfer.');
    }
  };

  return (
    <section className={styles.workspace}>
      <header><div><span>INVENTORY INTELLIGENCE · REPLENISHMENT</span><h2>Van Replenishment Suggestions</h2><p>ERP Next looks for internal surplus first, preserves donor minimum/par policy, and escalates uncovered quantities to Purchasing instead of inventing stock.</p></div><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Recalculate</button></header>
      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      <div className={styles.metrics}><article><span>Transfer Suggestions</span><strong>{transferSuggestions.length}</strong><small>Internal replenishment available</small></article><article><span>Purchase Required</span><strong className={purchaseRequired.length ? styles.warnText : ''}>{purchaseRequired.length}</strong><small>Internal safe surplus insufficient</small></article><article><span>Critical Signals</span><strong className={critical ? styles.dangerText : ''}>{critical}</strong><small>Essential line effectively empty</small></article><article><span>Open Transfers Considered</span><strong>{snapshot.transfers.filter((item) => item.status !== 'received' && item.status !== 'cancelled').length}</strong><small>Prevents duplicate replenishment</small></article></div>

      {snapshot.suggestions.length ? <div className={styles.grid}>{snapshot.suggestions.map((suggestion) => <article className={styles.card} key={suggestion.id}>
        <header><div><span>{suggestion.destinationLocationId}</span><strong>{suggestion.itemName}</strong><small>{suggestion.itemCode}</small></div><b className={suggestion.priority === 'critical' ? styles.critical : suggestion.priority === 'warning' ? styles.warning : styles.routine}>{suggestion.priority}</b></header>
        <div className={styles.balanceRow}><div><span>Current</span><strong>{qty(suggestion.current, suggestion.unit)}</strong></div><div><span>Effective + planned</span><strong>{qty(suggestion.effectiveCurrent, suggestion.unit)}</strong></div><div><span>Min / Par</span><strong>{suggestion.minimum} / {suggestion.par}</strong></div></div>
        <section className={styles.recommendation}><span>{suggestion.action === 'transfer' ? 'RECOMMENDED TRANSFER' : 'PURCHASE REQUIRED'}</span><strong>{suggestion.action === 'transfer' ? `${suggestion.sourceLocationId} → ${suggestion.destinationLocationId}` : `Acquire ${qty(suggestion.suggestedQuantity, suggestion.unit)}`}</strong><p>{suggestion.action === 'transfer' ? `Move ${qty(suggestion.suggestedQuantity, suggestion.unit)} toward par. ` : ''}{suggestion.reason}</p></section>
        <footer>{suggestion.action === 'transfer' ? <><div><span>Suggested quantity</span><strong>{qty(suggestion.suggestedQuantity, suggestion.unit)}</strong></div><button type="button" onClick={() => prepareTransfer(suggestion.id)}>Prepare Transfer Request</button></> : <><div><span>Uncovered need</span><strong>{qty(suggestion.remainingUncovered, suggestion.unit)}</strong></div><b>Purchasing queue required</b></>}</footer>
      </article>)}</div> : <div className={styles.empty}><strong>No replenishment suggested</strong><p>All mobile locations are at/above par after considering current balances and open transfer commitments.</p></div>}

      <div className={styles.guardrail}><div><span>AUTOMATION BOUNDARY</span><strong>“Prepare Transfer Request” creates status REQUESTED only.</strong><p>Approval, physical issue and receipt remain separate human custody actions. The intelligence layer cannot move inventory by itself.</p></div><div><span>DONOR POLICY</span><strong>Warehouse preserves minimum; donor vans preserve par.</strong><p>Van-to-van proposals only use true surplus above the donor van’s own par after existing commitments.</p></div></div>
    </section>
  );
}
