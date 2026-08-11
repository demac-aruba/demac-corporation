export type Currency = 'AWG' | 'USD';
export type PurchaseOrderStatus = 'draft' | 'pending_approval' | 'approved' | 'partially_received' | 'received' | 'closed' | 'cancelled';
export type VendorBillStatus = 'draft' | 'open' | 'partially_paid' | 'paid' | 'overdue' | 'disputed' | 'void';
export type ExpenseStatus = 'captured' | 'review_needed' | 'approved' | 'posted' | 'rejected';
export type ReconciliationConfidence = 'high' | 'medium' | 'low' | 'unmatched';

export type Money = { amount: number; currency: Currency };

export type Supplier = {
  id: string;
  name: string;
  category: 'equipment' | 'parts' | 'consumables' | 'services' | 'utilities' | 'other';
  currency: Currency;
  leadTimeDays: number;
  paymentTermsDays: number;
  active: boolean;
};

export type PurchaseOrderLine = {
  id: string;
  itemId?: string;
  description: string;
  quantity: number;
  unitCost: Money;
  expectedLocationId?: string;
  workOrderId?: string;
  projectId?: string;
  receivedQuantity: number;
};

export type PurchaseOrder = {
  id: string;
  supplierId: string;
  createdAt: string;
  expectedAt?: string;
  status: PurchaseOrderStatus;
  requestedBy: string;
  approvedBy?: string;
  lines: PurchaseOrderLine[];
  notes?: string;
};

export type VendorBill = {
  id: string;
  supplierId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: VendorBillStatus;
  subtotal: Money;
  tax: Money;
  total: Money;
  outstanding: Money;
  purchaseOrderId?: string;
  documentId?: string;
  quickBooksId?: string;
};

export type ExpenseCaptureLine = {
  description: string;
  amount: Money;
  quantity?: number;
  itemId?: string;
  classification: 'inventory' | 'tool' | 'vehicle' | 'fuel' | 'labor' | 'office' | 'marketing' | 'utility' | 'other';
};

export type ExpenseCapture = {
  id: string;
  source: 'voice' | 'receipt_photo' | 'invoice_pdf' | 'manual';
  vendorName?: string;
  capturedAt: string;
  status: ExpenseStatus;
  lines: ExpenseCaptureLine[];
  total: Money;
  sourceDocumentId?: string;
  transcript?: string;
  confidence: number;
};

export type BudgetLine = {
  category: string;
  budget: number;
  actual: number;
  monthProgressPct: number;
};

export type FinanceSnapshot = {
  cash: number;
  accountsReceivable: number;
  accountsPayable: number;
  collectedRevenue: number;
  invoicedRevenue: number;
  expenses: number;
  grossMarginPct: number;
  unallocatedPayments: number;
  billsDue7Days: number;
};

export const previewSuppliers: Supplier[] = [
  { id: 'SUP-001', name: 'Caribbean HVAC Supply', category: 'equipment', currency: 'USD', leadTimeDays: 14, paymentTermsDays: 30, active: true },
  { id: 'SUP-002', name: 'Aruba Technical Parts', category: 'parts', currency: 'AWG', leadTimeDays: 2, paymentTermsDays: 15, active: true },
  { id: 'SUP-003', name: 'Island Industrial Supplies', category: 'consumables', currency: 'AWG', leadTimeDays: 3, paymentTermsDays: 30, active: true },
  { id: 'SUP-004', name: 'SETAR', category: 'utilities', currency: 'AWG', leadTimeDays: 0, paymentTermsDays: 30, active: true },
];

export const previewPurchaseOrders: PurchaseOrder[] = [
  { id: 'PO-24018', supplierId: 'SUP-001', createdAt: '2026-08-07', expectedAt: '2026-08-21', status: 'approved', requestedBy: 'Warehouse', approvedBy: 'Christian', lines: [
    { id: 'L1', itemId: 'AC-OPT-18K', description: 'Adina Optima 18,000 BTU', quantity: 8, unitCost: { amount: 410, currency: 'USD' }, expectedLocationId: 'WH-MAIN', receivedQuantity: 0 },
    { id: 'L2', itemId: 'AC-OPT-24K', description: 'Adina Optima 24,000 BTU', quantity: 6, unitCost: { amount: 515, currency: 'USD' }, expectedLocationId: 'WH-MAIN', receivedQuantity: 0 },
  ] },
  { id: 'PO-24019', supplierId: 'SUP-003', createdAt: '2026-08-09', expectedAt: '2026-08-12', status: 'pending_approval', requestedBy: 'Inventory AI', lines: [
    { id: 'L1', itemId: 'ELEC-TAPE', description: 'Electrical tape', quantity: 48, unitCost: { amount: 3, currency: 'AWG' }, expectedLocationId: 'WH-MAIN', receivedQuantity: 0 },
    { id: 'L2', itemId: 'R410A-25LB', description: 'R410A 25 lb cylinder', quantity: 4, unitCost: { amount: 300, currency: 'AWG' }, expectedLocationId: 'WH-MAIN', receivedQuantity: 0 },
  ] },
];

export const previewVendorBills: VendorBill[] = [
  { id: 'BILL-881', supplierId: 'SUP-002', invoiceNumber: 'ATP-7741', invoiceDate: '2026-08-01', dueDate: '2026-08-16', status: 'open', subtotal: { amount: 3250, currency: 'AWG' }, tax: { amount: 0, currency: 'AWG' }, total: { amount: 3250, currency: 'AWG' }, outstanding: { amount: 3250, currency: 'AWG' }, purchaseOrderId: 'PO-24011' },
  { id: 'BILL-882', supplierId: 'SUP-003', invoiceNumber: 'IIS-2198', invoiceDate: '2026-08-05', dueDate: '2026-09-04', status: 'partially_paid', subtotal: { amount: 1840, currency: 'AWG' }, tax: { amount: 0, currency: 'AWG' }, total: { amount: 1840, currency: 'AWG' }, outstanding: { amount: 740, currency: 'AWG' }, purchaseOrderId: 'PO-24014' },
];

export const previewExpenseCaptures: ExpenseCapture[] = [
  { id: 'EXP-3401', source: 'voice', vendorName: 'Aruba Hardware', capturedAt: '2026-08-10T09:18:00-04:00', status: 'review_needed', total: { amount: 200, currency: 'AWG' }, confidence: 0.91, transcript: '100 florin drill battery, 50 screws and 50 wiring.', lines: [
    { description: 'Drill battery', amount: { amount: 100, currency: 'AWG' }, quantity: 1, classification: 'tool' },
    { description: 'Screws', amount: { amount: 50, currency: 'AWG' }, classification: 'inventory' },
    { description: 'Electrical wiring', amount: { amount: 50, currency: 'AWG' }, classification: 'inventory' },
  ] },
  { id: 'EXP-3402', source: 'receipt_photo', vendorName: 'Gas Station', capturedAt: '2026-08-10T13:24:00-04:00', status: 'approved', total: { amount: 148.2, currency: 'AWG' }, confidence: 0.98, lines: [
    { description: 'Van fuel', amount: { amount: 148.2, currency: 'AWG' }, classification: 'fuel' },
  ] },
];

export const previewFinanceSnapshot: FinanceSnapshot = {
  cash: 184200,
  accountsReceivable: 92350,
  accountsPayable: 28440,
  collectedRevenue: 126800,
  invoicedRevenue: 148500,
  expenses: 61340,
  grossMarginPct: 43.8,
  unallocatedPayments: 7200,
  billsDue7Days: 13680,
};

export const previewBudgetLines: BudgetLine[] = [
  { category: 'Payroll', budget: 42000, actual: 26900, monthProgressPct: 32 },
  { category: 'Inventory & Parts', budget: 30000, actual: 12800, monthProgressPct: 32 },
  { category: 'Fuel & Vehicles', budget: 8500, actual: 3820, monthProgressPct: 32 },
  { category: 'Marketing', budget: 12000, actual: 4680, monthProgressPct: 32 },
  { category: 'Office & Utilities', budget: 9000, actual: 3100, monthProgressPct: 32 },
];

export function purchaseOrderTotal(order: PurchaseOrder) {
  return order.lines.reduce((sum, line) => sum + line.quantity * line.unitCost.amount, 0);
}

export function purchaseOrderCurrency(order: PurchaseOrder): Currency {
  return order.lines[0]?.unitCost.currency ?? 'AWG';
}

export function budgetPace(line: BudgetLine) {
  const spendPct = line.budget > 0 ? (line.actual / line.budget) * 100 : 0;
  return { spendPct, paceDelta: spendPct - line.monthProgressPct, projectedMonthEnd: line.monthProgressPct > 0 ? line.actual / (line.monthProgressPct / 100) : line.actual };
}

export function purchasingPriority(args: { projectedAvailable: number; minimum: number; target: number; leadTimeDays: number; bookedDemand: number }) {
  const shortage = args.minimum - args.projectedAvailable;
  if (shortage <= 0) return { priority: 'normal' as const, recommendedQty: 0 };
  const recommendedQty = Math.max(0, Math.ceil(args.target - args.projectedAvailable + args.bookedDemand * Math.min(1, args.leadTimeDays / 14)));
  return { priority: shortage > args.minimum * 0.5 || args.leadTimeDays >= 10 ? 'critical' as const : 'warning' as const, recommendedQty };
}

export function threeWayMatch(args: { poTotal?: number; receivedValue?: number; billTotal: number; tolerancePct?: number }) {
  const tolerance = args.tolerancePct ?? 1;
  if (args.poTotal == null) return { status: 'review' as const, reason: 'No linked purchase order' };
  if (args.receivedValue == null) return { status: 'review' as const, reason: 'Receipt value not confirmed' };
  const compare = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, a * tolerance / 100);
  if (!compare(args.poTotal, args.billTotal)) return { status: 'blocked' as const, reason: 'Supplier bill does not match approved PO value' };
  if (!compare(args.receivedValue, args.billTotal)) return { status: 'blocked' as const, reason: 'Supplier bill exceeds confirmed receipt value' };
  return { status: 'matched' as const, reason: 'PO, receipt and supplier bill agree within tolerance' };
}
