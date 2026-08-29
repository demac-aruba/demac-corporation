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
import { jobOwnsCapacityStart, type CalendarDispatchJob, type OperationalDay } from './scheduling-capacity';
import {
  applyAppointmentScheduleChange,
  appointmentSnapshot,
  type AppointmentActor,
} from './scheduling-appointment-lifecycle';

export function liveMoveTargetKey(vanId: string, start: string) {
  return `${vanId}|${start}`;
}

function canonicalAppointmentDurationMinutes(appointment: BrowserAppointmentRecord) {
  const duration = Number(appointment.scheduledDurationMinutes || 0);
  if (Number.isFinite(duration) && duration > 0) return Math.max(1, Math.round(duration));
  const stored = Number(appointment.scheduledSlotCount || 0);
  if (Number.isFinite(stored) && stored > 0) return Math.max(1, Math.ceil(stored) * 60);
  const assignment = appointment.assignments[0];
  if (!assignment) return 0;
  const wallClock = timeToMinutes(assignment.end) - timeToMinutes(assignment.start);
  return Number.isFinite(wallClock) && wallClock > 0 ? wallClock : 0;
}

function canonicalCapacitySlotCount(appointment: BrowserAppointmentRecord) {
  const stored = Number(appointment.scheduledSlotCount || 0);
  if (Number.isFinite(stored) && stored > 0) return Math.max(1, Math.ceil(stored));
  return Math.max(1, Math.ceil(canonicalAppointmentDurationMinutes(appointment) / 60));
}

function elapsedTimeOverlaps(start: string, end: string, job: CalendarDispatchJob) {
  return timeToMinutes(start) < timeToMinutes(job.end) && timeToMinutes(end) > timeToMinutes(job.start);
}

/**
 * Manual LIVE drag is a direct office dispatch action rather than an automatic route
 * recommendation. Canonical duration is elapsed work time. Lunch remains unavailable as
 * an independent appointment start because it is absent from serviceStartTimes, but a
 * long job may span lunch without receiving a synthetic extra hour. Booking Authority
 * remains the commit-time source of truth and revalidates both elapsed time and owned
 * service-capacity slots.
 */
export function liveOperationalMoveCapacityCandidates(
  day: OperationalDay,
  appointment: BrowserAppointmentRecord,
  jobs: CalendarDispatchJob[],
  capacityState: LiveOperationalCapacityState | null = null,
): CandidateSlot[] {
  if (!day.isOpen || appointment.status === 'cancelled' || appointment.assignments.length !== 1) return [];

  const settings = getRuntimeSchedulingSettings();
  const durationMinutes = canonicalAppointmentDurationMinutes(appointment);
  const capacitySlotCount = canonicalCapacitySlotCount(appointment);
  if (!durationMinutes) return [];
  const dayEnd = timeToMinutes(settings.workdayEnd) - settings.routeMarginMinutes;
  // Monday through Saturday share the same canonical service starts. Per-van half-days
  // are applied below by liveOperationalStartTimes/liveOperationalWindowAllows.
  const baseStarts = settings.serviceStartTimes;
  const assignmentIds = new Set(appointment.assignments.map((assignment) => assignment.id));
  const otherJobs = jobs.filter((job) => !assignmentIds.has(job.id) && job.status !== 'cancelled');
  const candidates: CandidateSlot[] = [];

  for (const van of previewVans.filter((resource) => resource.active)) {
    if (!liveVanOperationallyAvailable(capacityState, van.id, day.dateKey)) continue;
    const halfDay = liveVanIsHalfDay(capacityState, van.id, day.dateKey);
    const starts = liveOperationalStartTimes(capacityState, van.id, day.dateKey, baseStarts);
    for (const start of starts) {
      const end = minutesToTime(timeToMinutes(start) + durationMinutes);
      const startIndex = starts.indexOf(start);
      const ownedStarts = startIndex < 0 ? [] : starts.slice(startIndex, startIndex + capacitySlotCount);
      if (ownedStarts.length !== capacitySlotCount) continue;
      if (timeToMinutes(end) > dayEnd) continue;
      if (!liveOperationalWindowAllows(capacityState, van.id, day.dateKey, start, end)) continue;
      if (otherJobs.some((job) => job.vanId === van.id && (
        elapsedTimeOverlaps(start, end, job)
        || ownedStarts.some((ownedStart) => jobOwnsCapacityStart(job, ownedStart))
      ))) continue;

      candidates.push({
        vanId: van.id,
        start,
        end,
        segment: halfDay ? halfDayForTime(start) : timeToMinutes(start) < 12 * 60 && timeToMinutes(end) > 13 * 60 ? 'full_day' : halfDayForTime(start),
        sector: appointment.sector,
        score: 0,
        reasons: ['Manual operational move: elapsed work and owned service-capacity slots both fit'],
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
