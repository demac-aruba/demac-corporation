'use client';

import { useMemo, useState } from 'react';
import { previewPurchaseOrders, previewSuppliers, purchaseOrderCurrency, purchaseOrderTotal, purchasingPriority } from '../../lib/finance';
import styles from './finance-command.module.css';

function money(value: number, currency: string) { return currency === 'USD' ? `$ ${value.toLocaleString('en-US')}` : `Afl. ${value.toLocaleString('en-US')}`; }

export function PurchasingCommand() {
  const [notice, setNotice] = useState<string | null>(null);
  const recommendations = useMemo(() => [
    { item: 'R410A 25 lb cylinder', location: 'Main Warehouse', projectedAvailable: 1, minimum: 3, target: 6, leadTimeDays: 4, bookedDemand: 2 },
    { item: 'Electrical tape', location: 'Main Warehouse', projectedAvailable: 18, minimum: 24, target: 60, leadTimeDays: 3, bookedDemand: 8 },
    { item: 'Adina Optima 18K', location: 'Main Warehouse', projectedAvailable: 2, minimum: 4, target: 12, leadTimeDays: 14, bookedDemand: 5 },
  ].map((row) => ({ ...row, ...purchasingPriority(row) })), []);

  const totalOpen = previewPurchaseOrders.reduce((sum, po) => sum + purchaseOrderTotal(po), 0);
  const pending = previewPurchaseOrders.filter((po) => po.status === 'pending_approval').length;

  return <section className={styles.page}>
    <header className={styles.head}><div><span className={styles.eyebrow}>Purchasing · Inventory driven</span><h1>Purchasing Center</h1><p>Demand from booked work, van replenishment, supplier lead time and approved project needs becomes controlled purchasing — not manual guesswork.</p></div><div className={styles.actions}><button type="button">Supplier history</button><button className={styles.primary} type="button" onClick={() => setNotice('Draft purchase order created in preview. Approval is required before supplier commitment.')}>+ New purchase order</button></div></header>
    {notice ? <div className={styles.callout}><strong>{notice}</strong></div> : null}
    <div className={styles.metrics}>
      <article className={styles.metric}><span>Open purchase orders</span><strong>{previewPurchaseOrders.length}</strong><small>{money(totalOpen, 'AWG')} equivalent preview</small><i style={{ width: '62%' }} /></article>
      <article className={styles.metric}><span>Pending approval</span><strong className={pending ? styles.warning : ''}>{pending}</strong><small>Requires authorized approval</small><i style={{ width: `${pending * 25}%` }} /></article>
      <article className={styles.metric}><span>Replenishment alerts</span><strong>{recommendations.filter((r) => r.recommendedQty > 0).length}</strong><small>Based on projected availability</small><i style={{ width: '48%' }} /></article>
      <article className={styles.metric}><span>Active suppliers</span><strong>{previewSuppliers.filter((s) => s.active).length}</strong><small>Lead time + terms tracked</small><i style={{ width: '76%' }} /></article>
    </div>

    <div className={styles.purchaseLayout}>
      <section className={styles.panel}><header><div><strong>Purchase Orders</strong><span>Request → approval → supplier → receipt → bill</span></div><button type="button">All POs</button></header>{previewPurchaseOrders.map((po) => { const supplier = previewSuppliers.find((s) => s.id === po.supplierId); const currency = purchaseOrderCurrency(po); return <article className={styles.po} key={po.id}><div className={styles.poHead}><div><span>{po.id} · {po.status.replace('_',' ')}</span><strong>{supplier?.name ?? po.supplierId}</strong></div><b>{money(purchaseOrderTotal(po), currency)}</b></div><ul>{po.lines.map((line) => <li key={line.id}>{line.quantity} × {line.description} · received {line.receivedQuantity}/{line.quantity}</li>)}</ul><footer><span>Requested by {po.requestedBy}{po.approvedBy ? ` · approved by ${po.approvedBy}` : ''}</span><span>{po.expectedAt ? `ETA ${po.expectedAt}` : 'ETA pending'}</span></footer></article>; })}</section>

      <aside className={styles.side}>
        <section className={styles.panel}><header><div><strong>Recommended Purchases</strong><span>Explainable inventory forecast</span></div></header>{recommendations.map((row) => <div className={styles.insight} key={row.item}><span>{row.priority}</span><strong>{row.item} · buy {row.recommendedQty}</strong><p>{row.location}: projected {row.projectedAvailable}, minimum {row.minimum}, target {row.target}, booked demand {row.bookedDemand}, supplier lead time {row.leadTimeDays} days.</p></div>)}</section>
        <section className={styles.panel}><header><div><strong>Supplier Master</strong><span>Commercial memory</span></div></header>{previewSuppliers.map((supplier) => <div className={styles.supplier} key={supplier.id}><div><strong>{supplier.name}</strong><small>{supplier.category} · {supplier.currency}</small></div><b>{supplier.leadTimeDays}d</b><span>{supplier.paymentTermsDays}d terms</span></div>)}</section>
        <section className={styles.panel}><div className={styles.callout}><strong>Three-way match required for controlled AP.</strong><p>Approved PO → confirmed inventory/service receipt → supplier bill. Differences are review items, not silent accounting adjustments.</p></div></section>
      </aside>
    </div>
  </section>;
}
