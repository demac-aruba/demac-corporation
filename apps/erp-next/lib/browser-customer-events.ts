import { BROWSER_BILLING_DRAFTS_KEY, type BrowserBillingDraft } from './browser-billing';
import type { BrowserFieldExecutionRecord, BrowserOfficeReviewRecord } from './browser-field';
import { BROWSER_DISPATCH_RELEASES_KEY, type BrowserDispatchAtRiskRelease } from './browser-job-readiness';
import type { BrowserAppointmentRecord, BrowserWorkOrderRecord } from './browser-operational';
import { BROWSER_BANK_PAYMENTS_KEY, BROWSER_PAYMENT_ALLOCATIONS_KEY, type BrowserBankPayment, type BrowserPaymentAllocation } from './browser-receivables';
import { BROWSER_REPORT_DELIVERIES_KEY, type BrowserReportDeliveryRecord } from './browser-report-delivery';
import { browserKeys, loadBrowserValue } from './browser-store';

export type CustomerEventTone = 'blue' | 'green' | 'amber' | 'purple' | 'red' | 'neutral';

export type BrowserCustomerEvent = {
  id: string;
  customerId: string;
  occurredAt: string;
  title: string;
  detail: string;
  entityId?: string;
  module: 'Scheduling' | 'Work Orders' | 'Operations' | 'Field' | 'Office Review' | 'Communications' | 'Finance';
  tone: CustomerEventTone;
};

export type CustomerEventSnapshot = {
  events: BrowserCustomerEvent[];
  latestAt?: string;
  openWork: number;
  approvedReports: number;
  sentReports: number;
  detectedPayments: number;
};

function resolveCustomerId(orderId: string, orders: BrowserWorkOrderRecord[]) {
  return orders.find((order) => order.id === orderId)?.customerId;
}

function releaseRiskDimensions(release: BrowserDispatchAtRiskRelease) {
  const labels = release.riskSignature
    .split('|')
    .map((part) => part.split(':')[0]?.replaceAll('_', ' ').trim())
    .filter(Boolean);
  return labels.length ? labels.join(', ') : 'risk snapshot unavailable';
}

export function loadCustomerEventSnapshot(customerId: string): CustomerEventSnapshot {
  const appointments = loadBrowserValue<BrowserAppointmentRecord[]>(browserKeys.appointments, []);
  const orders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
  const fieldExecutions = loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []);
  const reviews = loadBrowserValue<BrowserOfficeReviewRecord[]>(browserKeys.officeReviews, []);
  const deliveries = loadBrowserValue<BrowserReportDeliveryRecord[]>(BROWSER_REPORT_DELIVERIES_KEY, []);
  const billingDrafts = loadBrowserValue<BrowserBillingDraft[]>(BROWSER_BILLING_DRAFTS_KEY, []);
  const payments = loadBrowserValue<BrowserBankPayment[]>(BROWSER_BANK_PAYMENTS_KEY, []);
  const allocations = loadBrowserValue<BrowserPaymentAllocation[]>(BROWSER_PAYMENT_ALLOCATIONS_KEY, []);
  const dispatchReleases = loadBrowserValue<BrowserDispatchAtRiskRelease[]>(BROWSER_DISPATCH_RELEASES_KEY, []);

  const events: BrowserCustomerEvent[] = [];

  for (const appointment of appointments.filter((item) => item.customerId === customerId)) {
    events.push({
      id: `EV-${appointment.id}-created`,
      customerId,
      occurredAt: appointment.createdAt,
      title: appointment.status === 'confirmed' ? 'Appointment confirmed' : 'Appointment placed on temporary hold',
      detail: `${appointment.customerFacingDescription} · ${appointment.site} · ${appointment.primaryVanId}${appointment.supportVanId ? ` + ${appointment.supportVanId}` : ''}`,
      entityId: appointment.id,
      module: 'Scheduling',
      tone: appointment.status === 'confirmed' ? 'green' : 'amber',
    });
    if (appointment.confirmedAt) {
      events.push({
        id: `EV-${appointment.id}-confirmed`,
        customerId,
        occurredAt: appointment.confirmedAt,
        title: 'Appointment converted to Work Order',
        detail: `${appointment.workOrderId ?? 'Work Order'} created without re-entering the customer/property data.`,
        entityId: appointment.workOrderId,
        module: 'Work Orders',
        tone: 'blue',
      });
    }
  }

  for (const order of orders.filter((item) => item.customerId === customerId)) {
    events.push({
      id: `EV-${order.id}-scheduled`,
      customerId,
      occurredAt: order.createdAt,
      title: 'Work Order scheduled',
      detail: `${order.customerFacingDescription} · ${order.scheduledDate} ${order.scheduledStart}–${order.scheduledEnd}`,
      entityId: order.id,
      module: 'Work Orders',
      tone: 'blue',
    });
  }

  for (const release of dispatchReleases) {
    const resolvedCustomerId = resolveCustomerId(release.workOrderId, orders);
    if (resolvedCustomerId !== customerId) continue;
    events.push({
      id: `EV-${release.id}`,
      customerId,
      occurredAt: release.authorizedAt,
      title: 'Operations authorized AT RISK dispatch',
      detail: `${release.workOrderId} · ${release.reason} · accepted risk dimensions: ${releaseRiskDimensions(release)} · authorized by ${release.authorizedBy}`,
      entityId: release.id,
      module: 'Operations',
      tone: 'amber',
    });
  }

  for (const execution of fieldExecutions.filter((item) => item.customerId === customerId)) {
    if (execution.startedAt) events.push({
      id: `EV-${execution.workOrderId}-field-start`,
      customerId,
      occurredAt: execution.startedAt,
      title: 'Technician started field execution',
      detail: `${execution.equipment.length} scoped equipment record(s) · field evidence in progress.`,
      entityId: execution.workOrderId,
      module: 'Field',
      tone: 'purple',
    });
    if (execution.submittedAt) events.push({
      id: `EV-${execution.workOrderId}-field-submit`,
      customerId,
      occurredAt: execution.submittedAt,
      title: 'Technician submitted report to office',
      detail: 'Field completion entered Office Review; nothing was sent to the customer automatically.',
      entityId: execution.workOrderId,
      module: 'Field',
      tone: 'purple',
    });
  }

  for (const review of reviews) {
    const resolvedCustomerId = resolveCustomerId(review.workOrderId, orders);
    if (resolvedCustomerId !== customerId) continue;
    const occurredAt = review.reviewedAt ?? review.submittedAt;
    events.push({
      id: `EV-${review.id}-${review.status}`,
      customerId,
      occurredAt,
      title: review.status === 'approved' ? 'Service report approved by office' : review.status === 'returned' ? 'Service report returned for correction' : 'Service report awaiting Office Review',
      detail: `${review.language} customer-report version · ${review.workOrderId}`,
      entityId: review.id,
      module: 'Office Review',
      tone: review.status === 'approved' ? 'green' : review.status === 'returned' ? 'red' : 'amber',
    });
  }

  for (const delivery of deliveries) {
    const resolvedCustomerId = resolveCustomerId(delivery.workOrderId, orders);
    if (resolvedCustomerId !== customerId) continue;
    events.push({
      id: `EV-${delivery.id}`,
      customerId,
      occurredAt: delivery.sentAt,
      title: `Customer report marked sent via ${delivery.channel === 'whatsapp' ? 'WhatsApp' : 'email'}`,
      detail: `${delivery.language} report · ${delivery.workOrderId}${delivery.recipient ? ` · ${delivery.recipient}` : ''}`,
      entityId: delivery.id,
      module: 'Communications',
      tone: 'green',
    });
  }

  for (const draft of billingDrafts.filter((item) => item.customerId === customerId)) {
    events.push({
      id: `EV-${draft.id}-${draft.status}`,
      customerId,
      occurredAt: draft.updatedAt,
      title: draft.status === 'ready_for_qbo' ? 'Billing draft ready for QBO sync' : 'Billing draft created',
      detail: `${draft.lines.length} billing line(s) · known subtotal Afl. ${draft.knownSubtotal.toLocaleString('en-US')}${draft.pricingComplete ? '' : ' · pricing review required'}`,
      entityId: draft.id,
      module: 'Finance',
      tone: draft.pricingComplete ? 'blue' : 'amber',
    });
  }

  for (const payment of payments.filter((item) => item.customerId === customerId)) {
    events.push({
      id: `EV-${payment.id}`,
      customerId,
      occurredAt: payment.receivedAt,
      title: 'Incoming payment detected',
      detail: `Afl. ${payment.amount.toLocaleString('en-US')} received · Afl. ${payment.unappliedAmount.toLocaleString('en-US')} currently unapplied.`,
      entityId: payment.id,
      module: 'Finance',
      tone: payment.status === 'allocated' ? 'green' : 'amber',
    });
  }

  for (const allocation of allocations.filter((item) => item.customerId === customerId)) {
    events.push({
      id: `EV-${allocation.id}`,
      customerId,
      occurredAt: allocation.createdAt,
      title: 'Payment allocated to invoice',
      detail: `Afl. ${allocation.amount.toLocaleString('en-US')} → ${allocation.invoiceId} · ${allocation.method.replaceAll('_', ' ')}.`,
      entityId: allocation.id,
      module: 'Finance',
      tone: 'green',
    });
  }

  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const customerOrders = orders.filter((order) => order.customerId === customerId);
  const customerReviews = reviews.filter((review) => resolveCustomerId(review.workOrderId, orders) === customerId);
  const customerDeliveries = deliveries.filter((delivery) => resolveCustomerId(delivery.workOrderId, orders) === customerId);
  return {
    events,
    latestAt: events[0]?.occurredAt,
    openWork: customerOrders.filter((order) => !fieldExecutions.some((execution) => execution.workOrderId === order.id && execution.technicianStatus === 'submitted')).length,
    approvedReports: customerReviews.filter((review) => review.status === 'approved').length,
    sentReports: customerDeliveries.length,
    detectedPayments: payments.filter((payment) => payment.customerId === customerId).length,
  };
}
