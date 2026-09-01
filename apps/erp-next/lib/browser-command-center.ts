import { BROWSER_BILLING_DRAFTS_KEY, type BrowserBillingDraft } from './browser-billing';
import { canonicalCrewReadinessRoster, type CanonicalOperationsState } from './canonical-operations';
import type { BrowserFieldExecutionRecord, BrowserOfficeReviewRecord } from './browser-field';
import { BROWSER_INVENTORY_MOVEMENTS_KEY, type BrowserInventoryMovement } from './browser-inventory-ledger';
import { deriveBrowserJobReadiness, fieldStartDecision, loadDispatchAtRiskReleases } from './browser-job-readiness';
import type { BrowserAppointmentRecord, BrowserWorkOrderRecord } from './browser-operational';
import { BROWSER_BANK_PAYMENTS_KEY, BROWSER_RECEIVABLES_KEY, type BrowserBankPayment, type BrowserReceivableInvoice } from './browser-receivables';
import { BROWSER_REPORT_DELIVERIES_KEY, type BrowserReportDeliveryRecord } from './browser-report-delivery';
import { browserKeys, loadBrowserValue } from './browser-store';
import { loadWorkOrderScopes } from './browser-workorder-scope';

export type BrowserCommandCenterSnapshot = {
  appointments: { holds: number; confirmed: number };
  workOrders: {
    total: number;
    scoped: number;
    scopeMissing: number;
    fieldSubmitted: number;
    inField: number;
    dispatchReady: number;
    dispatchAtRisk: number;
    dispatchAtRiskHold: number;
    dispatchReleasedAtRisk: number;
    dispatchBlocked: number;
    startedUnderAtRiskRelease: number;
    dispatchReleaseHistory: number;
  };
  reviews: { pending: number; approved: number; returned: number };
  deliveries: { sent: number; approvedWaiting: number };
  inventory: { movementCount: number; switches: number; refrigerantLb: number; sourceWorkOrders: number };
  billing: { drafts: number; readyForQbo: number; pricingReview: number; knownSubtotal: number };
  receivables: { openBalance: number; openInvoices: number; unappliedCash: number; detectedPayments: number };
  attention: Array<{ severity: 'critical' | 'warning' | 'opportunity' | 'information'; title: string; detail: string; href: string }>;
};

export function loadBrowserCommandCenterSnapshot(canonicalOperations: CanonicalOperationsState | null = null): BrowserCommandCenterSnapshot {
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
  const dispatchReleases = loadDispatchAtRiskReleases();

  const scopedIds = new Set(scopes.filter((scope) => scope.status === 'complete' && scope.items.length === scope.expectedQuantity).map((scope) => scope.workOrderId));
  const submittedIds = new Set(fieldExecutions.filter((execution) => execution.technicianStatus === 'submitted').map((execution) => execution.workOrderId));
  const inFieldIds = new Set(fieldExecutions.filter((execution) => execution.technicianStatus === 'in_progress').map((execution) => execution.workOrderId));
  const approvedReviewIds = new Set(reviews.filter((review) => review.status === 'approved').map((review) => review.id));
  const sentReviewIds = new Set(deliveries.map((delivery) => delivery.reviewId));
  const activeWorkOrders = workOrders.filter((order) => !submittedIds.has(order.id));
  const activeReadiness = activeWorkOrders.map((order) => deriveBrowserJobReadiness(order, {
    appointments,
    executions: fieldExecutions,
    crewRoster: canonicalOperations ? canonicalCrewReadinessRoster(canonicalOperations, order.scheduledDate) : [],
  }));
  const dispatchReady = activeReadiness.filter((item) => item.status === 'ready').length;
  const dispatchAtRiskStates = activeReadiness.filter((item) => item.status === 'at_risk');
  const dispatchAtRisk = dispatchAtRiskStates.length;
  const dispatchReleasedAtRisk = dispatchAtRiskStates.filter((item) => fieldStartDecision(item, dispatchReleases).mode === 'released_at_risk').length;
  const dispatchAtRiskHold = Math.max(0, dispatchAtRisk - dispatchReleasedAtRisk);
  const dispatchBlocked = activeReadiness.filter((item) => item.status === 'blocked').length;
  const startedUnderAtRiskRelease = fieldExecutions.filter((execution) => Boolean(execution.startedAt) && execution.startAuthority === 'released_at_risk').length;

  const openBalance = receivables.reduce((sum, invoice) => sum + invoice.openBalance, 0);
  const unappliedCash = payments.reduce((sum, payment) => sum + payment.unappliedAmount, 0);
  const knownSubtotal = billing.reduce((sum, draft) => sum + draft.knownSubtotal, 0);
  const switches = inventory.filter((movement) => movement.movementType === 'job_consumption' && movement.itemCode === 'SW-220V').reduce((sum, movement) => sum + movement.quantity, 0);
  const refrigerantLb = inventory.filter((movement) => movement.movementType === 'job_consumption' && movement.itemCode === 'REFRIGERANT').reduce((sum, movement) => sum + movement.quantity, 0);
  const sourceWorkOrders = new Set(inventory.map((movement) => movement.workOrderId).filter((value): value is string => Boolean(value))).size;
  const scopeMissing = workOrders.filter((order) => !scopedIds.has(order.id)).length;
  const pendingReviews = reviews.filter((review) => review.status === 'pending').length;
  const pricingReview = billing.filter((draft) => !draft.pricingComplete).length;
  const approvedWaiting = reviews.filter((review) => approvedReviewIds.has(review.id) && !sentReviewIds.has(review.id)).length;

  const attention: BrowserCommandCenterSnapshot['attention'] = [];
  if (dispatchBlocked) {
    const first = activeReadiness.find((item) => item.status === 'blocked');
    const reason = first?.blockers[0]?.reason ?? 'At least one hard readiness dimension is blocked.';
    attention.push({ severity: 'critical', title: `${dispatchBlocked} Work Order${dispatchBlocked === 1 ? '' : 's'} BLOCKED for dispatch`, detail: reason, href: '/work-orders/' });
  }
  if (dispatchAtRiskHold) {
    const first = dispatchAtRiskStates.find((item) => fieldStartDecision(item, dispatchReleases).mode === 'at_risk_hold');
    const reason = first?.risks[0]?.reason ?? 'One or more pre-dispatch facts remain unresolved and no valid release exists.';
    attention.push({ severity: 'warning', title: `${dispatchAtRiskHold} AT RISK Work Order${dispatchAtRiskHold === 1 ? '' : 's'} awaiting Operations release`, detail: reason, href: '/work-orders/' });
  }
  if (dispatchReleasedAtRisk) attention.push({ severity: 'information', title: `${dispatchReleasedAtRisk} AT RISK Work Order${dispatchReleasedAtRisk === 1 ? '' : 's'} released by Operations`, detail: 'These jobs remain visibly AT RISK, but a valid risk-snapshot release currently authorizes Field start.', href: '/work-orders/' });
  if (startedUnderAtRiskRelease) attention.push({ severity: 'information', title: `${startedUnderAtRiskRelease} Work Order${startedUnderAtRiskRelease === 1 ? '' : 's'} started under AT RISK authority`, detail: 'Field start evidence is linked to the exact Operations release used at start time.', href: '/audit/' });
  if (dispatchReady) attention.push({ severity: 'opportunity', title: `${dispatchReady} Work Order${dispatchReady === 1 ? '' : 's'} dispatch READY`, detail: 'All consolidated readiness dimensions are currently resolved for these open jobs.', href: '/work-orders/' });
  if (pendingReviews) attention.push({ severity: 'warning', title: `${pendingReviews} field report${pendingReviews === 1 ? '' : 's'} await Office Review`, detail: 'Technician submission is complete, but customer delivery remains blocked until office approval.', href: '/work-orders/' });
  if (approvedWaiting) attention.push({ severity: 'information', title: `${approvedWaiting} approved report${approvedWaiting === 1 ? '' : 's'} ready for customer delivery`, detail: 'A human delivery action is still required.', href: '/communications/' });
  if (pricingReview) attention.push({ severity: 'warning', title: `${pricingReview} billing draft${pricingReview === 1 ? '' : 's'} need pricing review`, detail: 'ERP Next refused to guess an ungoverned sell price.', href: '/invoices/' });
  if (unappliedCash > 0) attention.push({ severity: 'critical', title: `Afl. ${unappliedCash.toLocaleString('en-US')} unapplied cash`, detail: 'Detected customer payments still need allocation/reconciliation.', href: '/payments/' });
  if (workOrders.length && activeWorkOrders.length === 0) attention.push({ severity: 'opportunity', title: 'All browser Work Orders are field-submitted', detail: 'The current test chain has no open pre-dispatch/field backlog.', href: '/field/' });
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
      dispatchReady,
      dispatchAtRisk,
      dispatchAtRiskHold,
      dispatchReleasedAtRisk,
      dispatchBlocked,
      startedUnderAtRiskRelease,
      dispatchReleaseHistory: dispatchReleases.length,
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
