import type { BrowserAppointmentRecord } from './browser-operational';
import { arubaBookingClock } from './scheduling-backdating';

export type RegularHistoricalCapacitySource = {
  date: string;
  start: string;
  vanId: string;
  currentSlots: number;
  workOrderId: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pastArubaDate(date: string, now: Date): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < arubaBookingClock(now).dateKey;
}

/** A board affordance only; Booking Authority remains the final eligibility decision. */
export function canOfferRegularHistoricalCapacityCorrection(
  appointment: BrowserAppointmentRecord,
  projectLinked: boolean,
  now = new Date(),
): boolean {
  const workOrderIds = appointment.workOrderIds?.length
    ? appointment.workOrderIds : appointment.workOrderId ? [appointment.workOrderId] : [];
  return !projectLinked && appointment.status === 'confirmed'
    && pastArubaDate(appointment.dateKey, now)
    && Boolean(appointment.customerId && appointment.siteId)
    && (appointment.durationMinutesPerUnit === undefined || appointment.durationMinutesPerUnit === 60)
    && appointment.assignments.length === 1
    && Boolean(appointment.assignments[0]?.vanId)
    && workOrderIds.length === 1;
}

/** Verify the current count from a fresh canonical Appointment, never the rendered board. */
export function regularHistoricalCapacitySource(
  appointment: Record<string, unknown>,
  now = new Date(),
): RegularHistoricalCapacitySource | null {
  const date = string(appointment.date);
  const start = string(appointment.startTime);
  const assignments = appointment.assignments;
  const workOrderIds = appointment.workOrderIds;
  if (appointment.bookingAuthorityVersion !== 1 || appointment.status !== 'confirmed'
    || !pastArubaDate(date, now) || !start
    || !string(appointment.customerId) || !string(appointment.propertyId)
    || appointment.projectId || appointment.projectPhaseId || appointment.projectName || appointment.project
    || !Array.isArray(assignments) || assignments.length !== 1
    || !Array.isArray(workOrderIds) || workOrderIds.length !== 1) return null;
  const assignment = record(assignments[0]);
  const vanId = string(assignment?.vanId);
  const currentSlots = assignment?.slots;
  const quantity = assignment?.quantity;
  const durationMinutes = assignment?.durationMinutes;
  const previousCorrection = string(appointment.regularCapacityCorrectionRequestId);
  const workOrderId = string(workOrderIds[0]);
  if (!assignment || !vanId || vanId !== string(appointment.primaryVanId)
    || (assignment.time && string(assignment.time) !== start)
    || !Number.isSafeInteger(currentSlots) || Number(currentSlots) < 1 || Number(currentSlots) > 6
    || !Number.isSafeInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 6
    || Number(durationMinutes) !== Number(currentSlots) * 60
    || (!previousCorrection && Number(quantity) !== Number(currentSlots))
    || !workOrderId) return null;
  return { date, start, vanId, currentSlots: Number(currentSlots), workOrderId };
}
