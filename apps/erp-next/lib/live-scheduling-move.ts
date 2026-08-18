import type { BrowserAppointmentRecord } from './browser-operational';
import type { LiveOperationalCapacityState } from './live-operational-capacity';
import type { CandidateSlot } from './scheduling';
import {
  getRuntimeSchedulingSettings,
  halfDayForTime,
  minutesToTime,
  previewVans,
  timeToMinutes,
} from './scheduling';
import type { CalendarDispatchJob, OperationalDay } from './scheduling-capacity';
import {
  applyAppointmentScheduleChange,
  appointmentSnapshot,
  type AppointmentActor,
} from './scheduling-appointment-lifecycle';

export function liveMoveTargetKey(vanId: string, start: string) {
  return `${vanId}|${start}`;
}

function workingWindowAllows(day: OperationalDay, start: string, end: string) {
  const settings = getRuntimeSchedulingSettings();
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);

  if (day.weekday === 'Sat') {
    return startMinutes >= timeToMinutes('09:00') && endMinutes <= timeToMinutes('13:00');
  }

  const lunchStart = timeToMinutes(settings.lunchStart);
  const lunchEnd = timeToMinutes(settings.lunchEnd);
  const dayEnd = timeToMinutes(settings.workdayEnd);
  if (startMinutes < lunchStart) return endMinutes <= lunchStart;
  return startMinutes >= lunchEnd && endMinutes <= dayEnd;
}

function overlaps(start: string, end: string, job: CalendarDispatchJob) {
  return timeToMinutes(start) < timeToMinutes(job.end) && timeToMinutes(end) > timeToMinutes(job.start);
}

function canonicalAppointmentDurationMinutes(appointment: BrowserAppointmentRecord) {
  const assignment = appointment.assignments[0];
  if (!assignment) return 0;
  const duration = timeToMinutes(assignment.end) - timeToMinutes(assignment.start);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

/**
 * Manual LIVE drag is a direct office dispatch action, not an automatic booking
 * recommendation. There is one scheduling rule: preserve the appointment's canonical
 * duration and allow every visible same-day van/time destination where the complete
 * block fits without overlapping another active appointment.
 *
 * Route preference, customer preference, wall clock, half-day, maintenance, staffing
 * and recommendation metadata do not remove drag destinations. The optional capacity
 * argument is retained only for call-site compatibility and is deliberately ignored.
 */
export function liveOperationalMoveCapacityCandidates(
  day: OperationalDay,
  appointment: BrowserAppointmentRecord,
  jobs: CalendarDispatchJob[],
  _capacityState: LiveOperationalCapacityState | null = null,
): CandidateSlot[] {
  if (!day.isOpen || appointment.status === 'cancelled' || appointment.assignments.length !== 1) return [];

  const settings = getRuntimeSchedulingSettings();
  const duration = canonicalAppointmentDurationMinutes(appointment);
  if (!duration) return [];
  const starts = day.weekday === 'Sat' ? ['09:00', '10:00', '11:00', '12:00'] : settings.serviceStartTimes;
  const assignmentIds = new Set(appointment.assignments.map((assignment) => assignment.id));
  const otherJobs = jobs.filter((job) => !assignmentIds.has(job.id) && job.status !== 'cancelled');
  const candidates: CandidateSlot[] = [];

  for (const van of previewVans.filter((resource) => resource.active)) {
    for (const start of starts) {
      const end = minutesToTime(timeToMinutes(start) + duration);
      if (!workingWindowAllows(day, start, end)) continue;
      if (otherJobs.some((job) => job.vanId === van.id && overlaps(start, end, job))) continue;

      candidates.push({
        vanId: van.id,
        start,
        end,
        segment: halfDayForTime(start),
        sector: appointment.sector,
        score: 0,
        reasons: ['Manual operational move: complete canonical block fits visible free capacity'],
        requiresSupportVan: false,
        primaryUnits: appointment.totalQuantity,
      });
    }
  }

  return candidates.sort((left, right) => left.vanId.localeCompare(right.vanId) || timeToMinutes(left.start) - timeToMinutes(right.start));
}

export function liveDragMoveCandidates(
  day: OperationalDay,
  appointment: BrowserAppointmentRecord | undefined,
  jobs: CalendarDispatchJob[],
  capacityState: LiveOperationalCapacityState | null = null,
): CandidateSlot[] {
  if (!appointment || appointment.status === 'cancelled' || appointment.assignments.length !== 1) return [];
  const current = appointmentSnapshot(appointment);
  return liveOperationalMoveCapacityCandidates(day, appointment, jobs, capacityState)
    .filter((slot) => !(slot.vanId === current.primaryVanId && slot.start === current.primaryStart));
}

export function projectCommittedLiveMove(args: {
  appointment: BrowserAppointmentRecord;
  slot: CandidateSlot;
  dateKey: string;
  actor?: AppointmentActor;
}) {
  return applyAppointmentScheduleChange({
    record: args.appointment,
    slot: args.slot,
    dateKey: args.dateKey,
    kind: 'operational_move',
    actor: args.actor,
    reason: 'Confirmed live drag-and-drop operational move',
  });
}
