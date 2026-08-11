import { BROWSER_BILLING_DRAFTS_KEY, type BrowserBillingDraft } from './browser-billing';
import type { BrowserFieldExecutionRecord, BrowserOfficeReviewRecord } from './browser-field';
import { BROWSER_INVENTORY_MOVEMENTS_KEY, type BrowserInventoryMovement } from './browser-inventory-ledger';
import type { BrowserAppointmentRecord, BrowserWorkOrderRecord } from './browser-operational';
import { BROWSER_BANK_PAYMENTS_KEY, BROWSER_RECEIVABLES_KEY, type BrowserBankPayment, type BrowserReceivableInvoice } from './browser-receivables';
import { BROWSER_REPORT_DELIVERIES_KEY, type BrowserReportDeliveryRecord } from './browser-report-delivery';
import { browserKeys, loadBrowserValue } from './browser-store';
import { loadWorkOrderScopes } from './browser-workorder-scope';

export type BrowserCommandCenterSnapshot = {
  appointments: { holds: number; confirmed: number };
  workOrders: { total: number; scoped: number; scopeMissing: number; fieldSubmitted: number; inField: number };
  reviews: { pending: number; approved: number; returned: number };
  deliveries: { sent: number; approvedWaiting: number };
  inventory: { movementCount: number; switches: number; refrigerantLb: number; sourceWorkOrders: number };
  billing: { drafts: number; readyForQbo: number; pricingReview: number; knownSubtotal: number };
  receivables: { openBalance: number; openInvoices: number; unappliedCash: number; detectedPayments: number };
  attention: Array<{ severity: 'critical' | 'warning' | 'opportunity' | 'information'; title: string; detail: string; href: string }>;
};

export function loadBrowserCommandCenterSnapshot(): BrowserCommandCenterSnapshot {
  const appointments = loadBrowserValue<BrowserAppointmentRecord[]>(browserKeys.appointments, []);
  const workOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
  const fieldExecutions = loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []);
  const reviews = loadBrowserValue<BrowserOfficeReviewRecord[]>(browserKeys.officeReviews, []);
  const deliveries = loadBrowserValue<BrowserReportDeliveryRecord[]>(BROWSER_REPORT_DELIVERIES_KEY, []);
  const inventory = loadBrowserValue<BrowserInventoryMovement[]>(BROWSER_INVENTORY_MOVEMENTS_KEY, []);
  const billing = loadBrowserValue<BrowserBillingDraft[]>(BROWSER_BILLING_DRAFTS_KEY, []);
  const receivables = loadBrowserValue<BrowserReceivableInvoice[]>(BROWSER_RECEIVABLES_KEY, []);
  const payments = loadBrowserValue<BrowserBankPayment[]>(BROWSER_BANK_PAYMENTS_KEY, []);
  const scopes = loadWorkOrderScopes();

  const scopedIds = new Set(scopes.filter((scope) => scope.status === 'complete' && scope.items.length === scope.expectedQuantity).map((scope) => scope.workOrderId));
  const submittedIds = new Set(fieldExecutions.filter((execution) => execution.technicianStatus === 'submitted').map((execution) => execution.workOrderId));
  const inFieldIds = new Set(fieldExecutions.filter((execution) => execution.technicianStatus === 'in_progress').map((execution) => execution.workOrderId));
  const approvedReviewIds = new Set(reviews.filter((review) => review.status === 'approved').map((review) => review.id));
  const sentReviewIds = new Set(deliveries.map((delivery) => delivery.reviewId));

  const openBalance = receivables.reduce((sum, invoice) => sum + invoice.openBalance, 0);
  const unappliedCash = payments.reduce((sum, payment) => sum + payment.unappliedAmount, 0);
  const knownSubtotal = billing.reduce((sum, draft) => sum + draft.knownSubtotal, 0);
  const switches = inventory.filter((movement) => movement.itemCode === 'SW-220V').reduce((sum, movement) => sum + movement.quantity, 0);
  const refrigerantLb = inventory.filter((movement) => movement.itemCode === 'REFRIGERANT').reduce((sum, movement) => sum + movement.quantity, 0);
  const sourceWorkOrders = new Set(inventory.map((movement) => movement.workOrderId)).size;
  const scopeMissing = workOrders.filter((order) => !scopedIds.has(order.id)).length;
  const pendingReviews = reviews.filter((review) => review.status === 'pending').length;
  const pricingReview = billing.filter((draft) => !draft.pricingComplete).length;
  const approvedWaiting = reviews.filter((review) => approvedReviewIds.has(review.id) && !sentReviewIds.has(review.id)).length;

  const attention: BrowserCommandCenterSnapshot['attention'] = [];
  if (scopeMissing) attention.push({ severity: 'warning', title: `${scopeMissing} Work Order${scopeMissing === 1 ? '' : 's'} need exact HVAC scope`, detail: 'Field execution should not proceed with inferred property equipment.', href: '/work-orders/scope/' });
  if (pendingReviews) attention.push({ severity: 'warning', title: `${pendingReviews} field report${pendingReviews === 1 ? '' : 's'} await Office Review`, detail: 'Technician submission is complete, but customer delivery remains blocked until office approval.', href: '/work-orders/' });
  if (approvedWaiting) attention.push({ severity: 'information', title: `${approvedWaiting} approved report${approvedWaiting === 1 ? '' : 's'} ready for customer delivery`, detail: 'A human delivery action is still required.', href: '/communications/' });
  if (pricingReview) attention.push({ severity: 'warning', title: `${pricingReview} billing draft${pricingReview === 1 ? '' : 's'} need pricing review`, detail: 'ERP Next refused to guess an ungoverned sell price.', href: '/invoices/' });
  if (unappliedCash > 0) attention.push({ severity: 'critical', title: `Afl. ${unappliedCash.toLocaleString('en-US')} unapplied cash`, detail: 'Detected customer payments still need allocation/reconciliation.', href: '/payments/' });
  if (workOrders.length && workOrders.length === submittedIds.size) attention.push({ severity: 'opportunity', title: 'All browser Work Orders are field-submitted', detail: 'The current test chain has no open field-execution backlog.', href: '/field/' });
  if (!attention.length) attention.push({ severity: 'information', title: 'No browser workflow exceptions detected', detail: 'Create live test transactions to exercise exception-first management signals.', href: '/dashboard/' });

  return {
    appointments: {
      holds: appointments.filter((appointment) => appointment.status === 'temporary_hold').length,
      confirmed: appointments.filter((appointment) => appointment.status === 'confirmed').length,
    },
    workOrders: {
      total: workOrders.length,
      scoped: workOrders.filter((order) => scopedIds.has(order.id)).length,
      scopeMissing,
      fieldSubmitted: submittedIds.size,
      inField: inFieldIds.size,
    },
    reviews: {
      pending: pendingReviews,
      approved: reviews.filter((review) => review.status === 'approved').length,
      returned: reviews.filter((review) => review.status === 'returned').length,
    },
    deliveries: { sent: deliveries.length, approvedWaiting },
    inventory: { movementCount: inventory.length, switches, refrigerantLb, sourceWorkOrders },
    billing: {
      drafts: billing.length,
      readyForQbo: billing.filter((draft) => draft.status === 'ready_for_qbo').length,
      pricingReview,
      knownSubtotal,
    },
    receivables: {
      openBalance,
      openInvoices: receivables.filter((invoice) => invoice.openBalance > 0).length,
      unappliedCash,
      detectedPayments: payments.length,
    },
    attention,
  };
}
