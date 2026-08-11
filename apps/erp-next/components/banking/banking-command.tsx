'use client';

import { useMemo, useState } from 'react';
import { customerRemainingBalance, previewAccounts, previewBankTransactions, previewInvoices, previewReconciliation, suggestIncomingPaymentMatch } from '../../lib/banking';
import styles from './banking-command.module.css';

type Filter = 'all' | 'incoming' | 'outgoing' | 'review';
function awg(value: number) { return `Afl. ${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`; }

export function BankingCommand({ mode = 'banking' }: { mode?: 'banking' | 'payments' }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const suggestions = useMemo(() => previewBankTransactions.map((tx) => ({ tx, suggestion: suggestIncomingPaymentMatch(tx, previewInvoices) })), []);
  const visible = suggestions.filter(({ tx, suggestion }) => filter === 'all' || filter === 'incoming' && tx.direction === 'incoming' || filter === 'outgoing' && tx.direction === 'outgoing' || filter === 'review' && suggestion.requiresHumanReview);

  const ocean = suggestions.find(({ tx }) => tx.id === 'BT-9001');
  const remaining = ocean?.suggestion.customerId ? customerRemainingBalance(ocean.suggestion.customerId, previewInvoices, ocean.suggestion.allocations) : 0;

  return <section className={styles.page}>
    <header className={styles.head}>
      <div><span>{mode === 'payments' ? 'Finance · Customer payments' : 'Banking · Read-only intelligence gateway'}</span><h1>{mode === 'payments' ? 'Payments & Allocation' : 'Banking Monitor'}</h1><p>{mode === 'payments' ? 'Incoming payments are matched to customer balances with explicit references first, exact invoice combinations second and human review whenever the evidence is ambiguous.' : 'Bank transactions are observed through read-only sources and reconciled against ERP evidence. This layer can never initiate a bank transfer.'}</p></div>
      <div className={styles.actions}><button type="button">Import CSV / Excel</button><button className={styles.primary} type="button">Reconcile now</button></div>
    </header>

    <div className={styles.metrics}>
      <article className={styles.metric}><span>Bank transactions</span><strong>{previewReconciliation.bankTransactions}</strong><small>Current reconciliation set</small></article>
      <article className={styles.metric}><span>ERP transactions</span><strong>{previewReconciliation.erpTransactions}</strong><small>Expected operational records</small></article>
      <article className={styles.metric}><span>Auto reconciled</span><strong className={styles.good}>{previewReconciliation.autoReconciled}</strong><small>{(previewReconciliation.autoReconciled / previewReconciliation.bankTransactions * 100).toFixed(1)}% exact / governed</small></article>
      <article className={styles.metric}><span>Needs review</span><strong className={previewReconciliation.review ? styles.warning : ''}>{previewReconciliation.review}</strong><small>Human allocation / evidence</small></article>
      <article className={styles.metric}><span>Missing</span><strong className={previewReconciliation.missing ? styles.danger : styles.good}>{previewReconciliation.missing}</strong><small>Bank vs ERP gap</small></article>
    </div>

    <div className={styles.toolbar}><div>{(['all','incoming','outgoing','review'] as Filter[]).map((value)=><button type="button" key={value} onClick={()=>setFilter(value)} className={filter===value?styles.active:''}>{value}</button>)}</div><span className={styles.pill}>AI suggests · operator governs</span></div>

    <div className={styles.grid}>
      <main className={styles.panel}><header><div><strong>{mode === 'payments' ? 'Payment Matching Queue' : 'Bank Transaction Feed'}</strong><span>Read-only banking evidence + deterministic matching</span></div><button type="button">Export reconciliation</button></header>{visible.map(({ tx, suggestion }) => <article className={styles.match} key={tx.id}><div className={styles.matchTop}><div><strong>{tx.counterparty}</strong><p>{tx.postedAt} · {tx.description} · {tx.source.replaceAll('_',' ')}</p></div><b className={tx.direction === 'incoming' ? styles.incoming : styles.outgoing}>{tx.direction === 'incoming' ? '+' : '-'}{awg(tx.amount)}</b></div>{tx.direction === 'incoming' ? <><p>Match confidence: <strong>{suggestion.confidence.toUpperCase()} · {suggestion.score}%</strong> · {suggestion.reasons.join(' · ')}</p>{suggestion.allocations.map((allocation) => { const invoice = previewInvoices.find((item) => item.id === allocation.invoiceId); return <div className={styles.allocation} key={allocation.invoiceId}><span>{invoice?.customer} · {invoice?.invoiceNumber}</span><strong>{awg(allocation.amount)}</strong></div>; })}{suggestion.unallocated > 0 ? <div className={styles.allocation}><span>Unallocated amount</span><strong className={styles.warning}>{awg(suggestion.unallocated)}</strong></div> : null}<div className={styles.allocation}><span>{suggestion.requiresHumanReview ? 'Human confirmation required' : confirmed.includes(tx.id) ? 'Allocation confirmed' : 'Eligible for controlled confirmation'}</span><button type="button" disabled={confirmed.includes(tx.id)} onClick={()=>setConfirmed((current)=>[...current,tx.id])}>{confirmed.includes(tx.id)?'Confirmed':'Confirm allocation'}</button></div></> : <p>Outgoing transaction should reconcile to supplier bill / expense / payroll / approved operating evidence before accounting sync.</p>}</article>)}</main>

      <aside className={styles.side}>
        <section className={styles.panel}><header><div><strong>Bank Accounts</strong><span>Connector authority</span></div></header><div className={styles.accounts}>{previewAccounts.map((account)=><article className={styles.account} key={account.id}><span>AB</span><div><strong>{account.name}</strong><small>{account.bank} · {account.number}</small></div><b>{account.mode}</b></article>)}</div></section>
        <section className={styles.panel}><header><div><strong>Payment Intelligence</strong><span>Explainable examples</span></div></header><div className={styles.insight}><span>Exact combination</span><strong>Ocean View: Afl. 13,000 → Afl. 5,000 + Afl. 8,000</strong><p>The remaining Afl. 1,000 invoice stays open. Customer balance after the suggested allocation: <b>{awg(remaining)}</b>.</p></div><div className={styles.insight}><span>Ambiguous payment</span><strong>Afl. 4,000 against Afl. 14,000 open</strong><p>No exact invoice combination exists. The system may suggest oldest-first for review but must not silently decide.</p></div><div className={styles.insight}><span>Reference-first policy</span><strong>Explicit invoice references beat inference</strong><p>Matching order: explicit references → exact combinations → known sender/account patterns → oldest-invoice suggestion → human review.</p></div></section>
        <section className={styles.panel}><div className={styles.callout}><strong>Security boundary: read-only banking.</strong><p>No bank password, Soft Token or transfer authority is stored by ERP Next. Human authorized banking access remains outside the ERP; CSV/Excel import is the official fallback reconciliation source.</p></div></section>
      </aside>
    </div>
  </section>;
}
