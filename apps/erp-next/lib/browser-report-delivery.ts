import type { BrowserOfficeReviewRecord } from './browser-field';

export const BROWSER_REPORT_DELIVERIES_KEY = 'demac.erp-next.communications.report-deliveries.v1';

export type ReportDeliveryChannel = 'whatsapp' | 'email';

export type BrowserReportDeliveryRecord = {
  id: string;
  reviewId: string;
  workOrderId: string;
  appointmentId: string;
  customer: string;
  site: string;
  language: BrowserOfficeReviewRecord['language'];
  channel: ReportDeliveryChannel;
  status: 'sent';
  recipient?: string;
  sentAt: string;
  sentBy: 'office';
  note?: string;
};

export function eligibleApprovedReviews(reviews: BrowserOfficeReviewRecord[], deliveries: BrowserReportDeliveryRecord[]) {
  const sentReviewIds = new Set(deliveries.map((delivery) => delivery.reviewId));
  return reviews.filter((review) => review.status === 'approved' && !sentReviewIds.has(review.id));
}

export function createReportDelivery(review: BrowserOfficeReviewRecord, channel: ReportDeliveryChannel, recipient?: string, note?: string): BrowserReportDeliveryRecord {
  return {
    id: `DEL-${review.workOrderId}`,
    reviewId: review.id,
    workOrderId: review.workOrderId,
    appointmentId: review.appointmentId,
    customer: review.customer,
    site: review.site,
    language: review.language,
    channel,
    status: 'sent',
    recipient: recipient?.trim() || undefined,
    sentAt: new Date().toISOString(),
    sentBy: 'office',
    note: note?.trim() || undefined,
  };
}

export function mergeReportDeliveries(existing: BrowserReportDeliveryRecord[], incoming: BrowserReportDeliveryRecord) {
  const byId = new Map(existing.map((delivery) => [delivery.id, delivery]));
  byId.set(incoming.id, incoming);
  return [...byId.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}
