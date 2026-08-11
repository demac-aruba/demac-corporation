'use client';

import { useMemo, useState } from 'react';
import { loadBrowserCommandCenterSnapshot } from '../../lib/browser-command-center';
import styles from './browser-live-command-center.module.css';

function afl(value: number) {
  return `Afl. ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export function BrowserLiveCommandCenter() {
  const [refreshKey, setRefreshKey] = useState(0);
  const snapshot = useMemo(() => loadBrowserCommandCenterSnapshot(), [refreshKey]);
  const workProgress = snapshot.workOrders.total ? Math.round((snapshot.workOrders.fieldSubmitted / snapshot.workOrders.total) * 100) : 0;
  const activeDispatch = snapshot.workOrders.dispatchReady + snapshot.workOrders.dispatchAtRisk + snapshot.workOrders.dispatchBlocked;
  const readinessProgress = activeDispatch ? Math.round((snapshot.workOrders.dispatchReady / activeDispatch) * 100) : 100;
  const reviewTotal = snapshot.reviews.pending + snapshot.reviews.approved + snapshot.reviews.returned;
  const reviewProgress = reviewTotal ? Math.round((snapshot.reviews.approved / reviewTotal) * 100) : 0;

  return (
    <section className={styles.command}>
      <header><div><span>LIVE TEST OPERATIONS · CROSS-MODULE PROJECTION</span><h2>ERP Next Workflow Command Center</h2><p>This panel is calculated from the browser-persistent transactions you create while testing the live ERP—not from hard-coded dashboard examples.</p></div><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Refresh Live Data</button></header>
      <div className={styles.kpis}>
        <article><div><span>Confirmed Appointments</span><b>{snapshot.appointments.holds ? `${snapshot.appointments.holds} hold${snapshot.appointments.holds === 1 ? '' : 's'}` : 'No holds'}</b></div><strong>{snapshot.appointments.confirmed}</strong><small>Persistent scheduling records</small><i><em style={{ width: `${Math.min(100, snapshot.appointments.confirmed * 16)}%` }} /></i></article>
        <article><div><span>Work Orders Field-Submitted</span><b>{snapshot.workOrders.inField} in progress</b></div><strong>{snapshot.workOrders.fieldSubmitted}/{snapshot.workOrders.total}</strong><small>{workProgress}% of test Work Orders</small><i><em style={{ width: `${workProgress}%` }} /></i></article>
        <article><div><span>Dispatch Readiness</span><b className={snapshot.workOrders.dispatchBlocked || snapshot.workOrders.dispatchAtRiskHold ? styles.warning : styles.good}>{snapshot.workOrders.dispatchBlocked} blocked · {snapshot.workOrders.dispatchAtRiskHold} hold · {snapshot.workOrders.dispatchReleasedAtRisk} released risk</b></div><strong>{snapshot.workOrders.dispatchReady}/{activeDispatch}</strong><small>{readinessProgress}% of open Work Orders READY</small><i><em style={{ width: `${readinessProgress}%` }} /></i></article>
        <article><div><span>Office Review Approved</span><b>{snapshot.reviews.pending} pending</b></div><strong>{snapshot.reviews.approved}/{reviewTotal}</strong><small>{reviewProgress}% approved</small><i><em style={{ width: `${reviewProgress}%` }} /></i></article>
      </div>

      <div className={styles.grid}>
        <section className={styles.flow}>
          <div className={styles.sectionHead}><div><strong>Operational Chain</strong><span>One business record flowing through the system</span></div></div>
          <div className={styles.flowSteps}>
            <a href="/scheduling/"><span>01</span><div><strong>Scheduling</strong><small>{snapshot.appointments.confirmed} confirmed · {snapshot.appointments.holds} holds</small></div></a>
            <a href="/work-orders/"><span>02</span><div><strong>Work Orders</strong><small>{snapshot.workOrders.dispatchReady} ready · {snapshot.workOrders.dispatchAtRiskHold} risk hold · {snapshot.workOrders.dispatchReleasedAtRisk} risk released · {snapshot.workOrders.dispatchBlocked} blocked</small></div></a>
            <a href="/field/"><span>03</span><div><strong>Field</strong><small>{snapshot.workOrders.inField} active · {snapshot.workOrders.fieldSubmitted} submitted · {snapshot.workOrders.startedUnderAtRiskRelease} started under risk release</small></div></a>
            <a href="/work-orders/"><span>04</span><div><strong>Office Review</strong><small>{snapshot.reviews.pending} pending · {snapshot.reviews.approved} approved</small></div></a>
            <a href="/communications/"><span>05</span><div><strong>Customer Delivery</strong><small>{snapshot.deliveries.sent} sent · {snapshot.deliveries.approvedWaiting} ready</small></div></a>
            <a href="/inventory/"><span>06</span><div><strong>Inventory</strong><small>{snapshot.inventory.movementCount} movements · {snapshot.inventory.sourceWorkOrders} jobs posted</small></div></a>
            <a href="/invoices/"><span>07</span><div><strong>Billing</strong><small>{snapshot.billing.drafts} drafts · {snapshot.billing.readyForQbo} QBO-ready</small></div></a>
            <a href="/payments/"><span>08</span><div><strong>Receivables</strong><small>{snapshot.receivables.openInvoices} open · {afl(snapshot.receivables.unappliedCash)} unapplied</small></div></a>
          </div>
        </section>

        <section className={styles.attention}>
          <div className={styles.sectionHead}><div><strong>Management Attention Queue</strong><span>Derived from consolidated live workflow state</span></div><b>{snapshot.attention.length}</b></div>
          <div className={styles.alerts}>{snapshot.attention.map((alert, index) => <a href={alert.href} className={`${styles.alert} ${styles[alert.severity]}`} key={`${alert.title}-${index}`}><i /><div><div><strong>{alert.title}</strong><b>{alert.severity}</b></div><p>{alert.detail}</p></div></a>)}</div>
        </section>
      </div>

      <div className={styles.financeStrip}><article><span>Exact HVAC Scope</span><strong>{snapshot.workOrders.scoped}/{snapshot.workOrders.total}</strong><small>{snapshot.workOrders.scopeMissing} Work Order(s) still missing scope</small></article><article><span>Dispatch Release History</span><strong>{snapshot.workOrders.dispatchReleaseHistory}</strong><small>{snapshot.workOrders.startedUnderAtRiskRelease} Field start(s) linked to AT RISK release</small></article><article><span>Known Billing Subtotal</span><strong>{afl(snapshot.billing.knownSubtotal)}</strong><small>{snapshot.billing.pricingReview} draft(s) still require pricing review</small></article><article><span>Unapplied Cash</span><strong className={snapshot.receivables.unappliedCash ? styles.warning : styles.good}>{afl(snapshot.receivables.unappliedCash)}</strong><small>{snapshot.receivables.detectedPayments} detected payment(s)</small></article></div>

      <footer><span>BROWSER TEST DATA</span><strong>Dispatch readiness, Operations releases and Field start authority now project from the same evidence chain. This still does not claim production financial/audit truth; Firebase/QBO/bank adapters will replace browser readers with authoritative data and durable identity/timestamps.</strong></footer>
    </section>
  );
}
