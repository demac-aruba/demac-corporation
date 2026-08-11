'use client';

import { useMemo, useState } from 'react';
import { BROWSER_INVENTORY_MOVEMENTS_KEY, type BrowserInventoryMovement } from '../../lib/browser-inventory-ledger';
import { deriveBrowserLocationBalances, loadBrowserInventoryOpeningBalances } from '../../lib/browser-inventory-readiness';
import { buildBrowserReplenishmentSuggestions } from '../../lib/browser-inventory-replenishment';
import { loadBrowserInventoryTransfers } from '../../lib/browser-inventory-transfers';
import { advancePurchaseRequirement, aggregatePurchaseNeeds, cancelPurchaseRequirement, createPurchaseRequirement, loadBrowserPurchaseRequirements, openRequirementForItem, type AggregatedPurchaseNeed } from '../../lib/browser-purchasing-readiness';
import { loadBrowserValue } from '../../lib/browser-store';
import styles from './browser-purchasing-readiness.module.css';

function amount(value: number, unit: string) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`;
}

function nextLabel(status: string) {
  return status === 'open' ? 'Mark Reviewed' : status === 'reviewed' ? 'Approve for Sourcing' : null;
}

export function BrowserPurchasingReadiness() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const snapshot = useMemo(() => {
    const opening = loadBrowserInventoryOpeningBalances();
    const movements = loadBrowserValue<BrowserInventoryMovement[]>(BROWSER_INVENTORY_MOVEMENTS_KEY, []);
    const balances = deriveBrowserLocationBalances(opening, movements);
    const transfers = loadBrowserInventoryTransfers();
    const replenishment = buildBrowserReplenishmentSuggestions(balances, transfers);
    const needs = aggregatePurchaseNeeds(replenishment);
    const requirements = loadBrowserPurchaseRequirements();
    return { needs, requirements };
  }, [refreshKey]);

  const activeRequirements = snapshot.requirements.filter((item) => item.status !== 'closed' && item.status !== 'cancelled');
  const approved = snapshot.requirements.filter((item) => item.status === 'approved_for_sourcing').length;

  const run = (fn: () => { id: string }, message: (value: { id: string }) => string) => {
    try {
      const value = fn();
      setNotice(message(value));
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Purchasing action could not be completed.');
    }
  };

  const create = (need: AggregatedPurchaseNeed) => run(() => createPurchaseRequirement(need), (requirement) => `${requirement.id} created as an internal Purchase Requirement. No supplier, price or PO was created.`);

  return (
    <section className={styles.workspace}>
      <header><div><span>PURCHASING · READINESS</span><h2>Purchase Requirements</h2><p>Uncovered replenishment needs are grouped by item so Purchasing gets one structured demand signal instead of duplicate van requests.</p></div><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Recalculate Needs</button></header>
      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      <div className={styles.metrics}><article><span>Uncovered Item Needs</span><strong>{snapshot.needs.length}</strong><small>After internal transfer capacity</small></article><article><span>Open Requirements</span><strong>{activeRequirements.length}</strong><small>Not closed/cancelled</small></article><article><span>Approved for Sourcing</span><strong>{approved}</strong><small>Still not a Purchase Order</small></article><article><span>Known Purchase Value</span><strong>—</strong><small>No vendor price evidence yet</small></article></div>

      <div className={styles.layout}>
        <main>
          <div className={styles.sectionHead}><div><strong>Current Purchase Needs</strong><span>Aggregated from inventory shortages that cannot be safely replenished internally</span></div><b>{snapshot.needs.length}</b></div>
          <div className={styles.needGrid}>{snapshot.needs.length ? snapshot.needs.map((need) => {
            const existing = openRequirementForItem(need.itemCode, snapshot.requirements);
            return <article className={styles.needCard} key={need.id}><header><div><span>{need.itemCode}</span><strong>{need.itemName}</strong></div><b className={styles[need.priority]}>{need.priority}</b></header><div className={styles.needAmount}><span>Uncovered quantity</span><strong>{amount(need.totalQuantity, need.unit)}</strong></div><div className={styles.locations}>{need.demandLocations.map((location) => <span key={`${need.itemCode}-${location.locationId}`}>{location.locationId} · {amount(location.quantity, need.unit)}</span>)}</div><p>{need.reason}</p><footer>{existing ? <><div><span>Already staged</span><strong>{existing.id} · {existing.status.replaceAll('_', ' ')}</strong></div><b>Requirement exists</b></> : <><div><span>Evidence state</span><strong>Quantity known · price/vendor unknown</strong></div><button type="button" onClick={() => create(need)}>Create Purchase Requirement</button></>}</footer></article>;
          }) : <div className={styles.empty}><strong>No uncovered purchase need</strong><p>Current internal stock/transfer capacity can satisfy the replenishment projection, or no van is below par.</p></div>}</div>
        </main>

        <aside>
          <div className={styles.sectionHead}><div><strong>Requirement Queue</strong><span>Internal purchasing workflow only</span></div><b>{snapshot.requirements.length}</b></div>
          <div className={styles.queue}>{snapshot.requirements.length ? snapshot.requirements.map((requirement) => <article key={requirement.id}><header><div><strong>{requirement.id}</strong><span>{requirement.itemName}</span></div><b className={styles[requirement.status]}>{requirement.status.replaceAll('_', ' ')}</b></header><div><span>Quantity</span><strong>{amount(requirement.quantityRequested, requirement.unit)}</strong></div><small>{requirement.demandLocations.map((location) => `${location.locationId} ${location.quantity}`).join(' · ')}</small><footer>{nextLabel(requirement.status) ? <button type="button" onClick={() => run(() => advancePurchaseRequirement(requirement.id), (value) => `${value.id} advanced one internal review step. No PO created.`)}>{nextLabel(requirement.status)}</button> : <span>No readiness action</span>}{(requirement.status === 'open' || requirement.status === 'reviewed') ? <button type="button" className={styles.cancel} onClick={() => run(() => cancelPurchaseRequirement(requirement.id), (value) => `${value.id} cancelled before sourcing approval.`)}>Cancel</button> : null}</footer></article>) : <div className={styles.emptySmall}>No purchase requirements staged.</div>}</div>
        </aside>
      </div>

      <div className={styles.guardrail}><section><span>NO PRICE INVENTION</span><strong>Quantity can be operationally known while cost remains unknown.</strong><p>ERP Next leaves vendor, unit cost, tax and payment terms blank until a quote/invoice/approved price source exists.</p></section><section><span>NO AUTO-PO</span><strong>Approved for Sourcing is not Ordered.</strong><p>A future Purchase Order workflow will require supplier selection, commercial review and explicit approval before creating a commitment.</p></section><section><span>AGGREGATED DEMAND</span><strong>Multiple vans can become one item requirement.</strong><p>The requirement preserves destination demand so receipt/replenishment can later distribute stock correctly.</p></section></div>
    </section>
  );
}
