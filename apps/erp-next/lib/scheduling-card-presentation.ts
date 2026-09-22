import type { BrowserAppointmentRecord } from './browser-operational';
import type { CalendarDispatchJob } from './scheduling-capacity';
import type { SchedulingProjectLabel } from './scheduling-project-labels';

export function schedulingWorkSummary(appointment: BrowserAppointmentRecord | undefined, assignmentQuantity?: number, project?: SchedulingProjectLabel) {
  if (project) return ['Project', project.name, ...project.phaseNames].join(' · ');
  const lines = appointment?.workSummaryLines;
  if (lines?.length) {
    // Appointment-level line quantities must not be presented as per-Van quantities.
    if (assignmentQuantity !== undefined && lines.length > 1) return lines.map((line) => line.label).join(' + ');
    return lines.map((line) => {
      const quantity = line.quantity === undefined ? undefined : assignmentQuantity ?? line.quantity;
      return quantity === undefined ? line.label : `${line.label} · ${quantity} ${line.quantityUnit || 'service'}${quantity === 1 ? '' : 's'}`;
    }).join(' + ');
  }
  return appointment?.workLabel || 'Work details pending verification';
}

export function assignmentReservedSlots(job: Pick<CalendarDispatchJob, 'capacitySlotStarts'>) {
  // Never use the appointment total, elapsed wall time, or the rendered segment span.
  const slots = new Set(job.capacitySlotStarts ?? []);
  return slots.size || undefined;
}

export function hasServiceWorkEstimate(appointment: BrowserAppointmentRecord | undefined, project?: SchedulingProjectLabel) {
  return !project && appointment?.serviceWorkEstimateAvailable === true;
}

export function assignmentReservationLabel(job: Pick<CalendarDispatchJob, 'capacitySlotStarts'>) {
  const count = assignmentReservedSlots(job);
  return count ? `${count} slot${count === 1 ? '' : 's'} reserved` : 'Reserved slots pending verification';
}
