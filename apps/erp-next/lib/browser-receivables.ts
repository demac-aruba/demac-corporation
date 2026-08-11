import type { BrowserBillingDraft } from './browser-billing';

export const BROWSER_RECEIVABLES_KEY = 'demac.erp-next.finance.receivable-invoices.v1';
export const BROWSER_BANK_PAYMENTS_KEY = 'demac.erp-next.finance.bank-payments.v1';
export const BROWSER_PAYMENT_ALLOCATIONS_KEY = 'demac.erp-next.finance.payment-allocations.v1';

export type BrowserReceivableInvoice = {
  id: string;
  billingDraftId: string;
  workOrderId: string;
  customerId?: string;
  customer: string;
  amount: number;
  openBalance: number;
  status: 'open' | 'partial' | 'paid';
  source: 'erp_preview';
  createdAt: string;
  qboInvoiceId?: string;
};

export type BrowserBankPayment = {
  id: string;
  customerId?: string;
  customer?: string;
  sender?: string;
  reference?: string;
  amount: number;
  allocatedAmount: number;
  unappliedAmount: number;
  status: 'detected' | 'partially_allocated' | 'allocated';
  receivedAt: string;
};

export type BrowserPaymentAllocation = {
  id: string;
  paymentId: string;
  invoiceId: string;
  customerId?: string;
  amount: number;
  method: 'explicit_reference' | 'exact_combination' | 'operator_oldest' | 'manual';
  createdAt: string;
};

export type AllocationSuggestion = {
  paymentId: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  method: BrowserPaymentAllocation['method'] | 'none';
  allocations: Array<{ invoiceId: string; amount: number }>;
  allocatedAmount: number;
  remainingPayment: number;
  remainingCustomerBalance: number;
  explanation: string;
};

function cents(value: number) {
  return Math.round(value * 100);
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

export function derivePreviewReceivables(drafts: BrowserBillingDraft[], existing: BrowserReceivableInvoice[]) {
  const byDraft = new Map(existing.map((invoice) => [invoice.billingDraftId, invoice]));
  for (const draft of drafts.filter((item) => item.status === 'ready_for_qbo' && item.pricingComplete && item.knownSubtotal > 0)) {
    if (byDraft.has(draft.id)) continue;
    const invoice: BrowserReceivableInvoice = {
      id: `PINV-${draft.workOrderId}`,
      billingDraftId: draft.id,
      workOrderId: draft.workOrderId,
      customerId: draft.customerId,
      customer: draft.customer,
      amount: draft.knownSubtotal,
      openBalance: draft.knownSubtotal,
      status: 'open',
      source: 'erp_preview',
      createdAt: new Date().toISOString(),
    };
    byDraft.set(draft.id, invoice);
  }
  return [...byDraft.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function openInvoicesForPayment(payment: BrowserBankPayment, invoices: BrowserReceivableInvoice[]) {
  return invoices
    .filter((invoice) => invoice.openBalance > 0)
    .filter((invoice) => {
      if (payment.customerId) return invoice.customerId === payment.customerId;
      if (payment.customer) return invoice.customer.toLowerCase() === payment.customer.toLowerCase();
      return true;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function exactCombination(invoices: BrowserReceivableInvoice[], amount: number) {
  const target = cents(amount);
  const candidates = invoices.filter((invoice) => invoice.openBalance > 0).slice(0, 14);
  const values = candidates.map((invoice) => cents(invoice.openBalance));

  function walk(index: number, remaining: number, chosen: number[]): number[] | null {
    if (remaining === 0) return chosen;
    if (remaining < 0 || index >= candidates.length) return null;
    const withCurrent = walk(index + 1, remaining - values[index], [...chosen, index]);
    if (withCurrent) return withCurrent;
    return walk(index + 1, remaining, chosen);
  }

  const indexes = walk(0, target, []);
  return indexes?.map((index) => candidates[index]) ?? [];
}

export function suggestPaymentAllocation(payment: BrowserBankPayment, invoices: BrowserReceivableInvoice[]): AllocationSuggestion {
  const open = openInvoicesForPayment(payment, invoices);
  const customerBalance = money(open.reduce((sum, invoice) => sum + invoice.openBalance, 0));
  const reference = (payment.reference ?? '').trim().toLowerCase();

  if (reference) {
    const referenced = open.find((invoice) => reference.includes(invoice.id.toLowerCase()) || (invoice.qboInvoiceId && reference.includes(invoice.qboInvoiceId.toLowerCase())));
    if (referenced) {
      const amount = Math.min(payment.unappliedAmount, referenced.openBalance);
      return {
        paymentId: payment.id,
        confidence: 'high',
        method: 'explicit_reference',
        allocations: [{ invoiceId: referenced.id, amount: money(amount) }],
        allocatedAmount: money(amount),
        remainingPayment: money(payment.unappliedAmount - amount),
        remainingCustomerBalance: money(customerBalance - amount),
        explanation: `The payment reference explicitly identifies ${referenced.id}.`,
      };
    }
  }

  const combination = exactCombination(open, payment.unappliedAmount);
  if (combination.length) {
    const allocations = combination.map((invoice) => ({ invoiceId: invoice.id, amount: invoice.openBalance }));
    const allocatedAmount = money(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
    return {
      paymentId: payment.id,
      confidence: combination.length === 1 ? 'high' : 'medium',
      method: 'exact_combination',
      allocations,
      allocatedAmount,
      remainingPayment: money(payment.unappliedAmount - allocatedAmount),
      remainingCustomerBalance: money(customerBalance - allocatedAmount),
      explanation: combination.length === 1
        ? `Payment amount exactly matches open invoice ${combination[0].id}.`
        : `Payment amount exactly matches ${combination.length} open invoices for the same customer.`,
    };
  }

  const oldest = open[0];
  if (oldest && payment.unappliedAmount > 0) {
    const amount = Math.min(oldest.openBalance, payment.unappliedAmount);
    return {
      paymentId: payment.id,
      confidence: 'low',
      method: 'operator_oldest',
      allocations: [{ invoiceId: oldest.id, amount: money(amount) }],
      allocatedAmount: money(amount),
      remainingPayment: money(payment.unappliedAmount - amount),
      remainingCustomerBalance: money(customerBalance - amount),
      explanation: `No exact reference/combination was found. Applying ${money(amount)} to the oldest open invoice is an operator-confirmed fallback only.`,
    };
  }

  return {
    paymentId: payment.id,
    confidence: 'none',
    method: 'none',
    allocations: [],
    allocatedAmount: 0,
    remainingPayment: payment.unappliedAmount,
    remainingCustomerBalance: customerBalance,
    explanation: 'No eligible open invoice was found. Keep the payment unapplied for review.',
  };
}

export function applyAllocationSuggestion(payment: BrowserBankPayment, invoices: BrowserReceivableInvoice[], existingAllocations: BrowserPaymentAllocation[], suggestion: AllocationSuggestion) {
  const now = new Date().toISOString();
  const allocationRecords: BrowserPaymentAllocation[] = suggestion.allocations.map((allocation) => ({
    id: `ALLOC-${payment.id}-${allocation.invoiceId}`,
    paymentId: payment.id,
    invoiceId: allocation.invoiceId,
    customerId: payment.customerId,
    amount: money(allocation.amount),
    method: suggestion.method === 'none' ? 'manual' : suggestion.method,
    createdAt: now,
  }));
  const allocationMap = new Map(existingAllocations.map((allocation) => [allocation.id, allocation]));
  for (const allocation of allocationRecords) allocationMap.set(allocation.id, allocation);

  const amountByInvoice = new Map<string, number>();
  for (const allocation of allocationRecords) amountByInvoice.set(allocation.invoiceId, (amountByInvoice.get(allocation.invoiceId) ?? 0) + allocation.amount);
  const nextInvoices = invoices.map((invoice) => {
    const applied = amountByInvoice.get(invoice.id) ?? 0;
    if (!applied) return invoice;
    const openBalance = money(Math.max(0, invoice.openBalance - applied));
    return { ...invoice, openBalance, status: openBalance === 0 ? 'paid' as const : 'partial' as const };
  });

  const newlyAllocated = money(allocationRecords.reduce((sum, allocation) => sum + allocation.amount, 0));
  const allocatedAmount = money(payment.allocatedAmount + newlyAllocated);
  const unappliedAmount = money(Math.max(0, payment.amount - allocatedAmount));
  const nextPayment: BrowserBankPayment = {
    ...payment,
    allocatedAmount,
    unappliedAmount,
    status: unappliedAmount === 0 ? 'allocated' : allocatedAmount > 0 ? 'partially_allocated' : 'detected',
  };

  return { invoices: nextInvoices, payment: nextPayment, allocations: [...allocationMap.values()] };
}
