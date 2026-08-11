export type BankTransactionDirection = 'incoming' | 'outgoing';
export type BankTransactionStatus = 'new' | 'suggested' | 'matched' | 'partially_allocated' | 'unmatched' | 'ignored';
export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';

export type BankTransaction = {
  id: string;
  accountId: string;
  postedAt: string;
  direction: BankTransactionDirection;
  amount: number;
  currency: 'AWG' | 'USD';
  counterparty: string;
  description: string;
  reference?: string;
  status: BankTransactionStatus;
  source: 'read_only_gateway' | 'csv' | 'xlsx' | 'manual';
};

export type OpenInvoice = {
  id: string;
  customerId: string;
  customer: string;
  invoiceNumber: string;
  issuedAt: string;
  dueAt: string;
  originalAmount: number;
  outstanding: number;
  currency: 'AWG' | 'USD';
};

export type PaymentAllocation = {
  invoiceId: string;
  amount: number;
};

export type PaymentMatchSuggestion = {
  transactionId: string;
  customerId?: string;
  customer?: string;
  confidence: MatchConfidence;
  score: number;
  allocations: PaymentAllocation[];
  unallocated: number;
  reasons: string[];
  requiresHumanReview: boolean;
};

export type ReconciliationSummary = {
  bankTransactions: number;
  erpTransactions: number;
  autoReconciled: number;
  review: number;
  missing: number;
};

export const previewAccounts = [
  { id: 'BANK-603089', name: 'Best Dish Network', number: '6030890190', bank: 'Aruba Bank', mode: 'read-only' },
  { id: 'BANK-603368', name: 'DEMAC', number: '6033680190', bank: 'Aruba Bank', mode: 'read-only' },
] as const;

export const previewInvoices: OpenInvoice[] = [
  { id: 'INV-A', customerId: 'C-1201', customer: 'Ocean View Villas', invoiceNumber: 'INV-2108', issuedAt: '2026-07-15', dueAt: '2026-07-30', originalAmount: 5000, outstanding: 5000, currency: 'AWG' },
  { id: 'INV-B', customerId: 'C-1201', customer: 'Ocean View Villas', invoiceNumber: 'INV-2114', issuedAt: '2026-07-20', dueAt: '2026-08-04', originalAmount: 8000, outstanding: 8000, currency: 'AWG' },
  { id: 'INV-C', customerId: 'C-1201', customer: 'Ocean View Villas', invoiceNumber: 'INV-2120', issuedAt: '2026-07-25', dueAt: '2026-08-09', originalAmount: 1000, outstanding: 1000, currency: 'AWG' },
  { id: 'INV-D', customerId: 'C-1042', customer: 'ABC Aruba N.V.', invoiceNumber: 'INV-2197', issuedAt: '2026-08-03', dueAt: '2026-08-18', originalAmount: 8750, outstanding: 8750, currency: 'AWG' },
  { id: 'INV-E', customerId: 'C-0741', customer: 'Maria Croes', invoiceNumber: 'INV-2210', issuedAt: '2026-08-05', dueAt: '2026-08-12', originalAmount: 450, outstanding: 450, currency: 'AWG' },
];

export const previewBankTransactions: BankTransaction[] = [
  { id: 'BT-9001', accountId: 'BANK-603368', postedAt: '2026-08-10T09:02:00-04:00', direction: 'incoming', amount: 13000, currency: 'AWG', counterparty: 'Ocean View Villas N.V.', description: 'Payment invoices 2108 2114', reference: '2108-2114', status: 'suggested', source: 'read_only_gateway' },
  { id: 'BT-9002', accountId: 'BANK-603368', postedAt: '2026-08-10T10:36:00-04:00', direction: 'incoming', amount: 8750, currency: 'AWG', counterparty: 'ABC Aruba NV', description: 'INV2197', reference: 'INV2197', status: 'suggested', source: 'read_only_gateway' },
  { id: 'BT-9003', accountId: 'BANK-603368', postedAt: '2026-08-10T11:51:00-04:00', direction: 'incoming', amount: 4000, currency: 'AWG', counterparty: 'Ocean View Villas N.V.', description: 'payment', status: 'unmatched', source: 'read_only_gateway' },
  { id: 'BT-9004', accountId: 'BANK-603368', postedAt: '2026-08-10T12:18:00-04:00', direction: 'outgoing', amount: 1840, currency: 'AWG', counterparty: 'Island Industrial Supplies', description: 'supplier invoice IIS-2198', reference: 'IIS-2198', status: 'suggested', source: 'read_only_gateway' },
];

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function exactCombination(target: number, invoices: OpenInvoice[]) {
  const candidates = invoices.filter((invoice) => invoice.outstanding > 0);
  for (let mask = 1; mask < 1 << candidates.length; mask += 1) {
    const group = candidates.filter((_, index) => Boolean(mask & (1 << index)));
    const total = group.reduce((sum, invoice) => sum + invoice.outstanding, 0);
    if (Math.abs(total - target) < 0.01) return group;
  }
  return [];
}

export function suggestIncomingPaymentMatch(transaction: BankTransaction, invoices: OpenInvoice[]): PaymentMatchSuggestion {
  if (transaction.direction !== 'incoming') return { transactionId: transaction.id, confidence: 'none', score: 0, allocations: [], unallocated: transaction.amount, reasons: ['Transaction is not an incoming customer payment'], requiresHumanReview: true };

  const ref = normalized(`${transaction.reference ?? ''} ${transaction.description}`);
  const explicit = invoices.filter((invoice) => ref.includes(normalized(invoice.invoiceNumber)) || ref.includes(normalized(invoice.invoiceNumber.replace('INV-', ''))));
  if (explicit.length) {
    let remaining = transaction.amount;
    const allocations: PaymentAllocation[] = [];
    explicit.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt)).forEach((invoice) => {
      const amount = Math.min(invoice.outstanding, remaining);
      if (amount > 0) allocations.push({ invoiceId: invoice.id, amount });
      remaining -= amount;
    });
    const customerIds = new Set(explicit.map((invoice) => invoice.customerId));
    const customer = explicit[0];
    return { transactionId: transaction.id, customerId: customerIds.size === 1 ? customer.customerId : undefined, customer: customerIds.size === 1 ? customer.customer : undefined, confidence: customerIds.size === 1 && remaining === 0 ? 'high' : 'medium', score: customerIds.size === 1 && remaining === 0 ? 99 : 82, allocations, unallocated: Math.max(0, remaining), reasons: ['Invoice reference found in bank transaction', 'Allocation follows explicit referenced invoice(s)'], requiresHumanReview: customerIds.size !== 1 || remaining !== 0 };
  }

  const counterparty = normalized(transaction.counterparty);
  const sameCustomer = invoices.filter((invoice) => counterparty.includes(normalized(invoice.customer)) || normalized(invoice.customer).includes(counterparty));
  if (sameCustomer.length) {
    const combo = exactCombination(transaction.amount, sameCustomer);
    if (combo.length) {
      return { transactionId: transaction.id, customerId: combo[0].customerId, customer: combo[0].customer, confidence: 'high', score: 94, allocations: combo.map((invoice) => ({ invoiceId: invoice.id, amount: invoice.outstanding })), unallocated: 0, reasons: ['Known customer/counterparty match', 'Payment equals exact combination of open invoices'], requiresHumanReview: false };
    }
    const oldest = [...sameCustomer].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
    let remaining = transaction.amount;
    const allocations: PaymentAllocation[] = [];
    for (const invoice of oldest) {
      if (remaining <= 0) break;
      const amount = Math.min(invoice.outstanding, remaining);
      allocations.push({ invoiceId: invoice.id, amount });
      remaining -= amount;
    }
    return { transactionId: transaction.id, customerId: oldest[0].customerId, customer: oldest[0].customer, confidence: 'medium', score: 68, allocations, unallocated: Math.max(0, remaining), reasons: ['Known customer/counterparty match', 'No exact invoice combination; oldest-first allocation is suggestion only'], requiresHumanReview: true };
  }

  return { transactionId: transaction.id, confidence: 'none', score: 15, allocations: [], unallocated: transaction.amount, reasons: ['No reliable customer or invoice reference match'], requiresHumanReview: true };
}

export function customerRemainingBalance(customerId: string, invoices: OpenInvoice[], allocations: PaymentAllocation[]) {
  const byInvoice = new Map(allocations.map((allocation) => [allocation.invoiceId, allocation.amount]));
  return invoices.filter((invoice) => invoice.customerId === customerId).reduce((sum, invoice) => sum + Math.max(0, invoice.outstanding - (byInvoice.get(invoice.id) ?? 0)), 0);
}

export const previewReconciliation: ReconciliationSummary = {
  bankTransactions: 487,
  erpTransactions: 487,
  autoReconciled: 482,
  review: 5,
  missing: 0,
};
