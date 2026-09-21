import type { BrowserAppointmentRecord } from './browser-operational';
/** Fixed-placement editing must keep the loaded primary placement. Work is displayed
 * from this canonical GET, never reconstructed from the board projection. */
export function requireObservedAppointment(display: BrowserAppointmentRecord, canonical: Record<string, unknown>) {
  const assignments = Array.isArray(canonical.assignments) ? canonical.assignments as Record<string, unknown>[] : [];
  const primary = assignments.find(row => row.role !== 'support') || assignments[0];
  const visible = display.assignments.find(row => row.isPrimaryAssignment && row.status !== 'cancelled');
  const samePlacement = primary && visible && visible.vanId === primary.vanId && visible.start === (primary.time || canonical.startTime);
  if ((canonical.id || canonical.appointmentId) !== display.id || canonical.customerId !== display.customerId
      || canonical.propertyId !== display.siteId || canonical.date !== display.dateKey || !samePlacement
      || (['confirmed', 'temporary_hold', 'cancelled'].includes(String(canonical.status)) && canonical.status !== display.status)) {
    throw new Error('This appointment changed after Scheduling was loaded. Close this view, refresh Scheduling and review the current work before changing it.');
  }
  const token = canonical.lifecycleToken;
  if (typeof token !== 'string' || !/^ba1-[a-f0-9]{64}$/.test(token)) throw new Error('Reload this appointment before changing it.');
  return token;
}
