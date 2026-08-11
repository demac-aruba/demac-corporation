'use client';

import { useEffect, useMemo, useState } from 'react';
import { BROWSER_BILLING_DRAFTS_KEY, type BrowserBillingDraft } from '../../lib/browser-billing';
import { loadBrowserValue, saveBrowserValue } from '../../lib/browser-store';
import { applyAllocationSuggestion, BROWSER_BANK_PAYMENTS_KEY, BROWSER_PAYMENT_ALLOCATIONS_KEY, BROWSER_RECEIVABLES_KEY, derivePreviewReceivables, suggestPaymentAllocation, type BrowserBankPayment, type BrowserPaymentAllocation, type BrowserReceivableInvoice } from '../../lib/browser-receivables';
import styles from './browser-payment-allocation.module.css';

function formatAfl(value: number) {
  return `Afl. ${value.toLocaleString('en-US', { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function paymentStatusLabel(value: BrowserBankPayment['status']) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function BrowserPaymentAllocation() {
  const [invoices, setInvoices] = useState<BrowserReceivableInvoice[]>([]);
  const [payments, setPayments] = useState<BrowserBankPayment[]>([]);
  const [allocations, setAllocations] = useState<BrowserPaymentAllocation[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [customerKey, setCustomerKey] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [sender, setSender] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const drafts = loadBrowserValue<BrowserBillingDraft[]>(BROWSER_BILLING_DRAFTS_KEY, []);
    const currentInvoices = loadBrowserValue<BrowserReceivableInvoice[]>(BROWSER_RECEIVABLES_KEY, []);
    const stagedInvoices = derivePreviewReceivables(drafts, currentInvoices);
    const currentPayments = loadBrowserValue<BrowserBankPayment[]>(BROWSER_BANK_PAYMENTS_KEY, []);
    const currentAllocations = loadBrowserValue<BrowserPaymentAllocation[]>(BROWSER_PAYMENT_ALLOCATIONS_KEY, []);
    setInvoices(stagedInvoices);
    setPayments(currentPayments);
    setAllocations(currentAllocations);
    setSelectedPaymentId(currentPayments[0]?.id ?? null);
    saveBrowserValue(BROWSER_RECEIVABLES_KEY, stagedInvoices);
  }, []);

  const customerOptions = useMemo(() => {
    const map = new Map<string, { key: string; customerId?: string; customer: string; open: number }>();
    for (const invoice of invoices.filter((item) => item.openBalance > 0)) {
      const key = invoice.customerId || invoice.customer;
      const current = map.get(key) ?? { key, customerId: invoice.customerId, customer: invoice.customer, open: 0 };
      current.open += invoice.openBalance;
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => a.customer.localeCompare(b.customer));
  }, [invoices]);

  const selectedPayment = payments.find((payment) => payment.id === selectedPaymentId) ?? payments[0];
  const suggestion = useMemo(() => selectedPayment ? suggestPaymentAllocation(selectedPayment, invoices) : null, [invoices, selectedPayment]);
  const totalOpen = useMemo(() => invoices.reduce((sum, invoice) => sum + invoice.openBalance, 0), [invoices]);
  const totalUnapplied = useMemo(() => payments.reduce((sum, payment) => sum + payment.unappliedAmount, 0), [payments]);
  const selectedCustomerBalance = suggestion?.remainingCustomerBalance ?? 0;

  const createPayment = () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setNotice('Enter a valid incoming transfer amount greater than zero.');
      return;
    }
    const customer = customerOptions.find((option) => option.key === customerKey);
    const id = `PAY-${Date.now().toString().slice(-8)}`;
    const payment: BrowserBankPayment = {
      id,
      customerId: customer?.customerId,
      customer: customer?.customer,
      sender: sender.trim() || customer?.customer,
      reference: reference.trim() || undefined,
      amount: numericAmount,
      allocatedAmount: 0,
      unappliedAmount: numericAmount,
      status: 'detected',
      receivedAt: new Date().toISOString(),
    };
    const next = [payment, ...payments];
    setPayments(next);
    saveBrowserValue(BROWSER_BANK_PAYMENTS_KEY, next);
    setSelectedPaymentId(id);
    setAmount('');
    setReference('');
    setSender('');
    setNotice(`Incoming transfer ${id} staged for matching. No allocation was posted automatically.`);
  };

  const applySuggestion = () => {
    if (!selectedPayment || !suggestion || !suggestion.allocations.length) return;
    const result = applyAllocationSuggestion(selectedPayment, invoices, allocations, suggestion);
    const nextPayments = payments.map((payment) => payment.id === result.payment.id ? result.payment : payment);
    setInvoices(result.invoices);
    setPayments(nextPayments);
    setAllocations(result.allocations);
    saveBrowserValue(BROWSER_RECEIVABLES_KEY, result.invoices);
    saveBrowserValue(BROWSER_BANK_PAYMENTS_KEY, nextPayments);
    saveBrowserValue(BROWSER_PAYMENT_ALLOCATIONS_KEY, result.allocations);
    setNotice(`${selectedPayment.id} allocation applied by operator. Remaining payment: ${formatAfl(result.payment.unappliedAmount)}. Remaining customer balance: ${formatAfl(suggestion.remainingCustomerBalance)}.`);
  };

  return (
    <section className={styles.workspace}>
      <header><div><span>RECEIVABLES INTELLIGENCE</span><h2>Payment Matching & Allocation</h2><p>Exact references and exact invoice combinations can be suggested. Ambiguous or partial transfers remain operator-controlled.</p></div><b>{payments.length} detected transfer{payments.length === 1 ? '' : 's'}</b></header>
      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      <div className={styles.metrics}><article><span>Preview Receivables</span><strong>{formatAfl(totalOpen)}</strong><small>{invoices.filter((invoice) => invoice.openBalance > 0).length} open / partial invoices</small></article><article><span>Detected Payments</span><strong>{payments.length}</strong><small>Browser bank staging</small></article><article><span>Unapplied Cash</span><strong className={totalUnapplied ? styles.warn : ''}>{formatAfl(totalUnapplied)}</strong><small>Still requires allocation</small></article><article><span>Allocation Records</span><strong>{allocations.length}</strong><small>Append-style evidence</small></article></div>

      <section className={styles.newPayment}><div><strong>Stage Incoming Transfer</strong><span>Testing only · simulates a read-only detected bank transaction</span></div><label>Customer<select value={customerKey} onChange={(event) => setCustomerKey(event.target.value)}><option value="">Unknown / not identified yet</option>{customerOptions.map((option) => <option value={option.key} key={option.key}>{option.customer} · open {formatAfl(option.open)}</option>)}</select></label><label>Amount<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label><label>Reference<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Invoice/reference text" /></label><label>Sender<input value={sender} onChange={(event) => setSender(event.target.value)} placeholder="Bank sender name" /></label><button type="button" onClick={createPayment}>Detect Transfer</button></section>

      <div className={styles.layout}>
        <aside className={styles.paymentList}>{payments.length ? payments.map((payment) => <button type="button" className={selectedPayment?.id === payment.id ? styles.active : ''} key={payment.id} onClick={() => { setSelectedPaymentId(payment.id); setNotice(null); }}><div><strong>{payment.id}</strong><span>{payment.customer || payment.sender || 'Unidentified sender'}</span><small>{new Date(payment.receivedAt).toLocaleString()}</small></div><div><b>{formatAfl(payment.amount)}</b><em className={payment.status === 'allocated' ? styles.good : styles.warn}>{paymentStatusLabel(payment.status)}</em></div></button>) : <div className={styles.empty}><strong>No detected payments yet</strong><span>Stage a transfer above to test the allocation engine.</span></div>}</aside>

        <main className={styles.detail}>
          {selectedPayment && suggestion ? <>
            <div className={styles.detailHead}><div><span>{selectedPayment.id}</span><h3>{selectedPayment.customer || selectedPayment.sender || 'Unidentified payment'}</h3><p>{formatAfl(selectedPayment.amount)} received · {formatAfl(selectedPayment.unappliedAmount)} currently unapplied</p></div><b className={suggestion.confidence === 'high' ? styles.high : suggestion.confidence === 'medium' ? styles.medium : suggestion.confidence === 'low' ? styles.low : styles.none}>{suggestion.confidence.toUpperCase()} CONFIDENCE</b></div>

            <section className={styles.suggestion}><span>ALLOCATION SUGGESTION</span><strong>{suggestion.explanation}</strong><div className={styles.suggestionMetrics}><div><span>Suggested allocation</span><b>{formatAfl(suggestion.allocatedAmount)}</b></div><div><span>Payment remains</span><b>{formatAfl(suggestion.remainingPayment)}</b></div><div><span>Customer balance after</span><b>{formatAfl(selectedCustomerBalance)}</b></div></div></section>

            <div className={styles.invoiceTable}><div className={`${styles.row} ${styles.head}`}><span>Invoice</span><span>Original</span><span>Open</span><span>Suggested</span><span>Status</span></div>{invoices.filter((invoice) => {
              if (selectedPayment.customerId) return invoice.customerId === selectedPayment.customerId;
              if (selectedPayment.customer) return invoice.customer === selectedPayment.customer;
              return invoice.openBalance > 0;
            }).map((invoice) => {
              const suggested = suggestion.allocations.find((allocation) => allocation.invoiceId === invoice.id)?.amount ?? 0;
              return <div className={styles.row} key={invoice.id}><div><strong>{invoice.id}</strong><small>{invoice.workOrderId}</small></div><span>{formatAfl(invoice.amount)}</span><strong>{formatAfl(invoice.openBalance)}</strong><b className={suggested ? styles.suggestedAmount : ''}>{suggested ? formatAfl(suggested) : '—'}</b><em className={invoice.status === 'paid' ? styles.good : invoice.status === 'partial' ? styles.warn : ''}>{invoice.status}</em></div>;
            })}</div>

            <section className={styles.policy}><article><span>1</span><div><strong>Explicit reference first</strong><p>If the bank reference identifies an invoice, ERP Next suggests that invoice first.</p></div></article><article><span>2</span><div><strong>Exact combination next</strong><p>A payment equal to multiple open balances can be suggested as an aggregate allocation.</p></div></article><article><span>3</span><div><strong>Oldest invoice is only a fallback suggestion</strong><p>Partial/ambiguous payments are not auto-posted. The operator must explicitly approve the fallback.</p></div></article></section>

            <footer><div><span>Allocation method</span><strong>{suggestion.method.replaceAll('_', ' ')}</strong><small>{suggestion.confidence === 'low' ? 'Operator confirmation required because this is not an exact match.' : 'Operator confirmation is still required in the current maturity phase.'}</small></div><button type="button" disabled={!suggestion.allocations.length || selectedPayment.unappliedAmount <= 0} onClick={applySuggestion}>Apply Suggested Allocation</button></footer>
          </> : <div className={styles.emptyDetail}><strong>Select or stage a payment</strong><p>ERP Next will show exact-reference, exact-combination or operator-fallback allocation logic here.</p></div>}
        </main>
      </div>
      <div className={styles.guardrail}><span>ACCOUNTING / BANK GUARDRAIL</span><strong>These are browser preview receivables and detected-transfer simulations. No bank transaction, QBO invoice or accounting entry is created or altered by this workspace.</strong></div>
    </section>
  );
}
