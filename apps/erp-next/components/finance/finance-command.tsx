'use client';

import { useMemo, useState } from 'react';
import { budgetPace, previewBudgetLines, previewExpenseCaptures, previewFinanceSnapshot, previewVendorBills } from '../../lib/finance';
import styles from './finance-command.module.css';

type Tab = 'Overview' | 'Receivables' | 'Payables' | 'Budgets' | 'Expense Capture' | 'QuickBooks';
const tabs: Tab[] = ['Overview', 'Receivables', 'Payables', 'Budgets', 'Expense Capture', 'QuickBooks'];

function awg(value: number) { return `Afl. ${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`; }

export function FinanceCommand() {
  const [tab, setTab] = useState<Tab>('Overview');
  const snapshot = previewFinanceSnapshot;
  const grossProfit = snapshot.invoicedRevenue * snapshot.grossMarginPct / 100;
  const collectionRate = snapshot.invoicedRevenue ? snapshot.collectedRevenue / snapshot.invoicedRevenue * 100 : 0;
  const budget = useMemo(() => previewBudgetLines.map((line) => ({ ...line, ...budgetPace(line) })), []);

  return <section className={styles.page}>
    <header className={styles.head}>
      <div><span className={styles.eyebrow}>Finance · Management truth</span><h1>Finance Center</h1><p>Cash, receivables, payables, budget pace, source documents and accounting sync — with ERP operational truth kept separate from QuickBooks accounting authority.</p></div>
      <div className={styles.actions}><button type="button">Export</button><button className={styles.primary} type="button">+ Capture expense</button></div>
    </header>

    <div className={styles.metrics}>
      <article className={styles.metric}><span>Cash position</span><strong>{awg(snapshot.cash)}</strong><small>Bank-confirmed + reconciled view</small><i style={{ width: '78%' }} /></article>
      <article className={styles.metric}><span>Accounts receivable</span><strong>{awg(snapshot.accountsReceivable)}</strong><small>{collectionRate.toFixed(1)}% collection vs invoiced</small><i style={{ width: `${Math.min(100, collectionRate)}%` }} /></article>
      <article className={styles.metric}><span>Accounts payable</span><strong>{awg(snapshot.accountsPayable)}</strong><small>{awg(snapshot.billsDue7Days)} due in next 7 days</small><i style={{ width: '48%' }} /></article>
      <article className={styles.metric}><span>Gross margin</span><strong>{snapshot.grossMarginPct.toFixed(1)}%</strong><small>{awg(grossProfit)} estimated gross profit</small><i style={{ width: `${snapshot.grossMarginPct}%` }} /></article>
    </div>

    <nav className={styles.tabs}>{tabs.map((item) => <button type="button" key={item} onClick={() => setTab(item)} className={tab === item ? styles.active : ''}>{item}</button>)}</nav>

    {tab === 'Overview' ? <Overview /> : null}
    {tab === 'Receivables' ? <Receivables /> : null}
    {tab === 'Payables' ? <Payables /> : null}
    {tab === 'Budgets' ? <Budgets budget={budget} /> : null}
    {tab === 'Expense Capture' ? <ExpenseCapture /> : null}
    {tab === 'QuickBooks' ? <QuickBooks /> : null}
  </section>;
}

function Overview() {
  const s = previewFinanceSnapshot;
  return <div className={styles.grid}>
    <section className={styles.panel}><header><div><strong>Management P&L signals</strong><span>Operational month-to-date preview</span></div><button type="button">Open report</button></header><div className={styles.rows}>
      <div className={styles.row}><div><strong>Invoiced revenue</strong><small>Customer invoices generated</small></div><b>{awg(s.invoicedRevenue)}</b><span>100%</span><em className={styles.pill}>Revenue</em><span /></div>
      <div className={styles.row}><div><strong>Collected revenue</strong><small>Cash received against customer balances</small></div><b>{awg(s.collectedRevenue)}</b><span>{(s.collectedRevenue / s.invoicedRevenue * 100).toFixed(1)}%</span><em className={styles.pill}>Cash</em><span /></div>
      <div className={styles.row}><div><strong>Operating expenses</strong><small>Approved / posted operational spend</small></div><b>{awg(s.expenses)}</b><span>{(s.expenses / s.invoicedRevenue * 100).toFixed(1)}%</span><em className={styles.pill}>Expense</em><span /></div>
      <div className={styles.row}><div><strong>Unallocated customer payments</strong><small>Cash detected but not yet applied to invoice(s)</small></div><b className={s.unallocatedPayments ? styles.warning : ''}>{awg(s.unallocatedPayments)}</b><span>Needs review</span><em className={styles.pill}>Control</em><span /></div>
    </div></section>
    <aside className={styles.side}>
      <section className={styles.panel}><header><div><strong>Finance Intelligence</strong><span>Explainable management signals</span></div></header><div className={styles.insight}><span>Working capital</span><strong>AR exceeds AP by {awg(s.accountsReceivable - s.accountsPayable)}</strong><p>Healthy direction, but collections timing still matters because receivables are not the same as cash.</p></div><div className={styles.insight}><span>Control queue</span><strong>{awg(s.unallocatedPayments)} awaiting allocation</strong><p>Payments stay unallocated when invoice matching is ambiguous. The ERP should never invent an accounting allocation.</p></div><div className={styles.insight}><span>Accounting boundary</span><strong>QuickBooks remains system of record</strong><p>ERP Next prepares and reconciles operational financial events; accounting postings sync through governed adapters.</p></div></section>
    </aside>
  </div>;
}

function Receivables() {
  const rows = [
    ['Ocean View Villas', 'INV-2108 + INV-2114 + INV-2120', 14000, 'Afl. 13,000 payment detected', 'Afl. 1,000 remains'],
    ['ABC Aruba N.V.', 'INV-2197', 8750, 'Due Aug 18', 'Open'],
    ['Maria Croes', 'INV-2210', 450, 'Due Aug 12', 'Reminder eligible'],
  ];
  return <section className={styles.panel}><header><div><strong>Accounts Receivable</strong><span>Customer-level running balance and invoice allocation</span></div><button type="button">Collections queue</button></header><div className={styles.rows}>{rows.map((row) => <div className={styles.row} key={String(row[0])}><div><strong>{row[0]}</strong><small>{row[1]}</small></div><b>{awg(Number(row[2]))}</b><span>{row[3]}</span><em className={styles.pill}>{row[4]}</em><span /></div>)}</div></section>;
}

function Payables() {
  return <section className={styles.panel}><header><div><strong>Accounts Payable</strong><span>Supplier bills, PO linkage and payment readiness</span></div><button type="button">New vendor bill</button></header><div className={styles.rows}>{previewVendorBills.map((bill) => <div className={styles.row} key={bill.id}><div><strong>{bill.invoiceNumber}</strong><small>{bill.supplierId} · due {bill.dueDate}</small></div><b>{awg(bill.outstanding.amount)}</b><span>{bill.purchaseOrderId ?? 'No PO'}</span><em className={styles.pill}>{bill.status.replace('_', ' ')}</em><button type="button">Review</button></div>)}</div></section>;
}

function Budgets({ budget }: { budget: Array<(typeof previewBudgetLines)[number] & ReturnType<typeof budgetPace>> }) {
  return <div className={styles.grid}><section className={styles.panel}><header><div><strong>Budget vs Actual</strong><span>Pace compared with elapsed month</span></div></header><div className={styles.budget}>{budget.map((line) => <article key={line.category}><div className={styles.budgetHead}><strong>{line.category}</strong><span>{awg(line.actual)} / {awg(line.budget)}</span></div><div className={styles.track}><i style={{ width: `${Math.min(100, line.spendPct)}%` }} /></div><small>{line.spendPct.toFixed(1)}% spent · month {line.monthProgressPct}% elapsed · pace {line.paceDelta >= 0 ? '+' : ''}{line.paceDelta.toFixed(1)} pts · projected {awg(line.projectedMonthEnd)}</small></article>)}</div></section><aside className={styles.side}><section className={styles.panel}><header><div><strong>Budget Intelligence</strong><span>Exception-first review</span></div></header>{budget.sort((a,b)=>b.paceDelta-a.paceDelta).slice(0,3).map((line)=><div className={styles.insight} key={line.category}><span>{line.paceDelta > 5 ? 'Ahead of spend pace' : 'Within pace'}</span><strong>{line.category}: {line.paceDelta >= 0 ? '+' : ''}{line.paceDelta.toFixed(1)} pts</strong><p>Projected month-end spend is {awg(line.projectedMonthEnd)} if current pace continues.</p></div>)}</section></aside></div>;
}

function ExpenseCapture() {
  return <div className={styles.cards}>{previewExpenseCaptures.map((capture) => <article className={styles.capture} key={capture.id}><div><div><strong>{capture.vendorName ?? 'Unknown vendor'}</strong><p>{capture.id} · {capture.source.replace('_', ' ')}</p></div><b>{awg(capture.total.amount)}</b></div>{capture.transcript ? <p>“{capture.transcript}”</p> : null}<ul>{capture.lines.map((line, index) => <li key={`${capture.id}-${index}`}>{line.description} — {awg(line.amount.amount)} · {line.classification}</li>)}</ul><footer><span>AI confidence {(capture.confidence * 100).toFixed(0)}%</span><em className={styles.pill}>{capture.status.replace('_',' ')}</em></footer></article>)}</div>;
}

function QuickBooks() {
  return <div className={styles.grid}><section className={styles.panel}><header><div><strong>QuickBooks Online Sync</strong><span>Accounting authority boundary</span></div><button type="button">Run sync preview</button></header><div className={styles.rows}><div className={styles.row}><div><strong>Customer invoices</strong><small>ERP operational invoice → QBO accounting invoice</small></div><b>128</b><span>126 synced</span><em className={styles.pill}>2 review</em><span /></div><div className={styles.row}><div><strong>Customer payments</strong><small>Confirmed allocation only</small></div><b>94</b><span>91 synced</span><em className={styles.pill}>3 review</em><span /></div><div className={styles.row}><div><strong>Vendor bills / expenses</strong><small>Approved evidence-backed expenses only</small></div><b>67</b><span>64 synced</span><em className={styles.pill}>3 review</em><span /></div></div></section><aside className={styles.side}><section className={styles.panel}><div className={styles.callout}><strong>ERP calculates operational truth; QBO owns accounting books.</strong><p>No silent journal entries, refunds, write-offs or accounting deletes. High-impact financial actions remain approval controlled.</p></div></section></aside></div>;
}
