/** Structured evidence from the existing Office API. Other consumers still receive an Error. */
export class OfficeBookingResponseError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly reason = '') {
    super(message);
    this.name = 'OfficeBookingResponseError';
  }
}

/** Narrow pre-commit failures only. Unknown errors must never invite replacement bookings. */
export function definiteCreateRejection(error: unknown): boolean {
  if (!(error instanceof OfficeBookingResponseError)) return false;
  // Authentication can expire after an earlier commit; it never proves absence of that booking.
  if (error.status !== 409) return false;
  if (['slot_conflict', 'availability_changed', 'offer_expired', 'offer_not_open', 'option_not_found',
    'customer_not_found', 'property_not_found', 'property_customer_mismatch'].includes(error.code)) return true;
  return error.code === 'invalid_request' && ['version_conflict', 'project_not_schedulable',
    'unknown_project_phase', 'project_phase_reconciliation_required', 'project_reconciliation_required',
    'project_booking_not_active'].includes(error.reason);
}
