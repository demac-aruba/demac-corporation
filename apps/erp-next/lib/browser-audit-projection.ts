import { BROWSER_BILLING_DRAFTS_KEY, type BrowserBillingDraft } from './browser-billing';
import type { BrowserFieldExecutionRecord, BrowserOfficeReviewRecord } from './browser-field';
import { BROWSER_INVENTORY_MOVEMENTS_KEY, type BrowserInventoryMovement } from './browser-inventory-ledger';
import type { BrowserAppointmentRecord, BrowserWorkOrderRecord } from './browser-operational';
import { BROWSER_BANK_PAYMENTS_KEY, BROWSER_PAYMENT_ALLOCATIONS_KEY, type BrowserBankPayment, type BrowserPaymentAllocation } from './browser-receivables';
import { BROWSER_REPORT_DELIVERIES_KEY, type BrowserReportDeliveryRecord } from './browser-report-delivery';
import { browserKeys, loadBrowserValue } from './browser-store';
import { loadWorkOrderScopes } from './browser-workorder-scope';

export type BrowserAuditProjectionEvent = {
  id: string;
  occurredAt: string;
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: string;
  detail: string;
  importance: 'normal' | 'sensitive' | 'financial';
};

export function loadBrowserAuditProjection(): BrowserAuditProjectionEvent[] {
  const appointments = loadBrowserValue<BrowserAppointmentRecord[]>(browserKeys.appointments, []);
  const workOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
  const scopes = loadWorkOrderScopes();
  const field = loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []);
  const reviews = loadBrowserValue<BrowserOfficeReviewRecord[]>(browserKeys.officeReviews, []);
  const deliveries = loadBrowserValue<BrowserReportDeliveryRecord[]>(BROWSER_REPORT_DELIVERIES_KEY, []);
  const inventory = loadBrowserValue<BrowserInventoryMovement[]>(BROWSER_INVENTORY_MOVEMENTS_KEY, []);
  const billing = loadBrowserValue<BrowserBillingDraft[]>(BROWSER_BILLING_DRAFTS_KEY, []);
  const payments = loadBrowserValue<BrowserBankPayment[]>(BROWSER_BANK_PAYMENTS_KEY, []);
  const allocations = loadBrowserValue<BrowserPaymentAllocation[]>(BROWSER_PAYMENT_ALLOCATIONS_KEY, []);

  const events: BrowserAuditProjectionEvent[] = [];

  for (const appointment of appointments) {
    events.push({ id: `AUD-${appointment.id}-create`, occurredAt: appointment.createdAt, module: 'Scheduling', action: 'Appointment created', entityType: 'Appointment', entityId: appointment.id, actor: 'Office / Preview', detail: `${appointment.customer} · ${appointment.site} · ${appointment.status}`, importance: 'normal' });
    if (appointment.confirmedAt) events.push({ id: `AUD-${appointment.id}-confirm`, occurredAt: appointment.confirmedAt, module: 'Scheduling', action: 'Appointment confirmed', entityType: 'Appointment', entityId: appointment.id, actor: 'Office / Preview', detail: `Converted to ${appointment.workOrderId ?? 'Work Order'}; primary communication owner preserved.`, importance: 'sensitive' });
  }

  for (const order of workOrders) events.push({ id: `AUD-${order.id}`, occurredAt: order.createdAt, module: 'Work Orders', action: 'Work Order created', entityType: 'WorkOrder', entityId: order.id, actor: 'System handoff', detail: `${order.customerFacingDescription} · ${order.primaryVanId}${order.supportVanId ? ` + ${order.supportVanId}` : ''}`, importance: 'normal' });

  for (const scope of scopes) events.push({ id: `AUD-SCOPE-${scope.workOrderId}`, occurredAt: scope.updatedAt, module: 'Work Orders', action: 'Equipment scope saved', entityType: 'WorkOrderScope', entityId: scope.workOrderId, actor: 'Office / Preview', detail: `${scope.items.length}/${scope.expectedQuantity} exact equipment item(s) · ${scope.mode.replaceAll('_', ' ')}`, importance: 'sensitive' });

  for (const execution of field) {
    if (execution.startedAt) events.push({ id: `AUD-${execution.workOrderId}-field-start`, occurredAt: execution.startedAt, module: 'Field', action: 'Field execution started', entityType: 'FieldExecution', entityId: execution.workOrderId, actor: 'Technician / Preview', detail: `${execution.equipment.length} equipment record(s) opened for execution.`, importance: 'normal' });
    if (execution.submittedAt) events.push({ id: `AUD-${execution.workOrderId}-field-submit`, occurredAt: execution.submittedAt, module: 'Field', action: 'Field report submitted', entityType: 'FieldExecution', entityId: execution.workOrderId, actor: 'Technician / Preview', detail: `Submitted to Office Review with ${execution.equipment.length} equipment record(s).`, importance: 'sensitive' });
  }

  for (const review of reviews) {
    const at = review.reviewedAt ?? review.submittedAt;
    events.push({ id: `AUD-${review.id}-${review.status}`, occurredAt: at, module: 'Office Review', action: `Report ${review.status}`, entityType: 'OfficeReview', entityId: review.id, actor: review.status === 'pending' ? 'System handoff' : 'Office / Preview', detail: `${review.workOrderId} · ${review.language}${review.reviewerNote ? ` · note: ${review.reviewerNote}` : ''}`, importance: 'sensitive' });
  }

  for (const delivery of deliveries) events.push({ id: `AUD-${delivery.id}`, occurredAt: delivery.sentAt, module: 'Communications', action: 'Customer report marked sent', entityType: 'ReportDelivery', entityId: delivery.id, actor: 'Office / Preview', detail: `${delivery.workOrderId} · ${delivery.channel} · ${delivery.language}`, importance: 'sensitive' });

  for (const movement of inventory) events.push({ id: `AUD-${movement.id}`, occurredAt: movement.occurredAt, module: 'Inventory', action: 'Job consumption posted', entityType: 'InventoryMovement', entityId: movement.id, actor: 'Field/system projection', detail: `${movement.quantity} ${movement.unit} ${movement.itemName} · ${movement.sourceLocation} → ${movement.destination}`, importance: 'financial' });

  for (const draft of billing) events.push({ id: `AUD-${draft.id}-${draft.status}`, occurredAt: draft.updatedAt, module: 'Finance', action: draft.status === 'ready_for_qbo' ? 'Billing draft approved for QBO handoff' : 'Billing draft generated', entityType: 'BillingDraft', entityId: draft.id, actor: 'Office / Finance Preview', detail: `Known subtotal Afl. ${draft.knownSubtotal.toLocaleString('en-US')} · pricing ${draft.pricingComplete ? 'complete' : 'review required'}`, importance: 'financial' });

  for (const payment of payments) events.push({ id: `AUD-${payment.id}`, occurredAt: payment.receivedAt, module: 'Finance', action: 'Incoming payment detected', entityType: 'Payment', entityId: payment.id, actor: 'Bank staging / Preview', detail: `Afl. ${payment.amount.toLocaleString('en-US')} · allocated ${payment.allocatedAmount.toLocaleString('en-US')} · unapplied ${payment.unappliedAmount.toLocaleString('en-US')}`, importance: 'financial' });

  for (const allocation of allocations) events.push({ id: `AUD-${allocation.id}`, occurredAt: allocation.createdAt, module: 'Finance', action: 'Payment allocation applied', entityType: 'PaymentAllocation', entityId: allocation.id, actor: 'Finance operator / Preview', detail: `Afl. ${allocation.amount.toLocaleString('en-US')} · ${allocation.paymentId} → ${allocation.invoiceId} · ${allocation.method.replaceAll('_', ' ')}`, importance: 'financial' });

  return events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
