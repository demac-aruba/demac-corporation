import type { BrowserAppointmentRecord } from './browser-operational';
import {
  liveOperationalStartTimes,
  liveOperationalWindowAllows,
  liveVanIsHalfDay,
  liveVanOperationallyAvailable,
  type LiveOperationalCapacityState,
} from './live-operational-capacity';
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
 * Manual LIVE drag is a direct office dispatch action rather than an automatic route
 * recommendation. It preserves the appointment's canonical duration and accepts every
 * same-day destination where the complete block fits, does not overlap another active
 * appointment, and remains inside canonical company/van operating capacity.
 *
 * Route preference, customer preference and wall clock do not remove drag targets.
 * Half-days, company closures, maintenance and out-of-service status do, because those
 * are hard operational capacity rules enforced by Booking Authority at commit time.
 */
export function liveOperationalMoveCapacityCandidates(
  day: OperationalDay,
  appointment: BrowserAppointmentRecord,
  jobs: CalendarDispatchJob[],
  capacityState: LiveOperationalCapacityState | null = null,
): CandidateSlot[] {
  if (!day.isOpen || appointment.status === 'cancelled' || appointment.assignments.length !== 1) return [];

  const settings = getRuntimeSchedulingSettings();
  const duration = canonicalAppointmentDurationMinutes(appointment);
  if (!duration) return [];
  const baseStarts = day.weekday === 'Sat' ? ['09:00', '10:00', '11:00', '12:00'] : settings.serviceStartTimes;
  const assignmentIds = new Set(appointment.assignments.map((assignment) => assignment.id));
  const otherJobs = jobs.filter((job) => !assignmentIds.has(job.id) && job.status !== 'cancelled');
  const candidates: CandidateSlot[] = [];

  for (const van of previewVans.filter((resource) => resource.active)) {
    if (!liveVanOperationallyAvailable(capacityState, van.id, day.dateKey)) continue;
    const halfDay = liveVanIsHalfDay(capacityState, van.id, day.dateKey);
    const starts = liveOperationalStartTimes(capacityState, van.id, day.dateKey, baseStarts);
    for (const start of starts) {
      const end = minutesToTime(timeToMinutes(start) + duration);
      // A canonical half-day is one continuous morning work window through its cutoff;
      // do not re-apply the normal full-day lunch boundary inside that shorter window.
      if (!halfDay && !workingWindowAllows(day, start, end)) continue;
      if (!liveOperationalWindowAllows(capacityState, van.id, day.dateKey, start, end)) continue;
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
