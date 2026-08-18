import type { BrowserAppointmentRecord } from './browser-operational';
import type { CandidateSlot } from './scheduling';
import {
  calculateDurationMinutes,
  getRuntimeSchedulingSettings,
  halfDayForTime,
  minutesToTime,
  previewVans,
  timeToMinutes,
} from './scheduling';
import type { CalendarDispatchJob, OperationalDay } from './scheduling-capacity';
import {
  applyAppointmentScheduleChange,
  appointmentRequest,
  appointmentSnapshot,
  type AppointmentActor,
} from './scheduling-appointment-lifecycle';

export function liveMoveTargetKey(vanId: string, start: string) {
  return `${vanId}|${start}`;
}

function arubaClock(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Aruba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${read('hour')}:${read('minute')}`,
  };
}

export function liveOperationalMoveTimeAllowed(args: {
  dateKey: string;
  targetStart: string;
  currentDateKey: string;
  currentStart: string;
  now?: Date;
}) {
  const current = arubaClock(args.now ?? new Date());
  if (args.dateKey > current.date) return true;
  if (args.dateKey < current.date) return false;
  if (args.targetStart > current.time) return true;
  return args.dateKey === args.currentDateKey && args.targetStart === args.currentStart;
}

function restrictionAllows(start: string, appointment: BrowserAppointmentRecord) {
  const restriction = appointment.bookingRestriction;
  if (!restriction) return true;
  if (restriction.halfDay && halfDayForTime(start) !== restriction.halfDay) return false;
  if (restriction.notBefore && timeToMinutes(start) < timeToMinutes(restriction.notBefore)) return false;
  if (restriction.notAfter && timeToMinutes(start) > timeToMinutes(restriction.notAfter)) return false;
  return true;
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
  const dayEnd = timeToMinutes(settings.workdayEnd) - settings.routeMarginMinutes;
  if (startMinutes < 12 * 60) return endMinutes <= lunchStart - settings.routeMarginMinutes;
  return startMinutes >= lunchEnd && endMinutes <= dayEnd;
}

function overlaps(start: string, end: string, job: CalendarDispatchJob) {
  return timeToMinutes(start) < timeToMinutes(job.end) && timeToMinutes(end) > timeToMinutes(job.start);
}

/**
 * Manual LIVE drag is an operator dispatch action, not a booking recommendation search.
 * Enumerate every physically valid single-van target instead of reusing the ranked/capped
 * recommendation list. Booking Authority still revalidates the exact target before commit.
 */
export function liveOperationalMoveCapacityCandidates(
  day: OperationalDay,
  appointment: BrowserAppointmentRecord,
  jobs: CalendarDispatchJob[],
): CandidateSlot[] {
  if (!day.isOpen || appointment.status === 'cancelled' || appointment.assignments.length !== 1) return [];

  const settings = getRuntimeSchedulingSettings();
  const request = appointmentRequest(appointment);
  const duration = calculateDurationMinutes(request, settings);
  const starts = day.weekday === 'Sat' ? ['09:00', '10:00', '11:00', '12:00'] : settings.serviceStartTimes;
  const assignmentIds = new Set(appointment.assignments.map((assignment) => assignment.id));
  const otherJobs = jobs.filter((job) => !assignmentIds.has(job.id) && job.status !== 'cancelled');
  const candidates: CandidateSlot[] = [];

  for (const van of previewVans.filter((resource) => resource.active)) {
    for (const start of starts) {
      if (!restrictionAllows(start, appointment)) continue;
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
        reasons: ['Manual operational move: complete hard-capacity window is free'],
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
  now = new Date(),
): CandidateSlot[] {
  if (!appointment || appointment.status === 'cancelled' || appointment.assignments.length !== 1) return [];
  const current = appointmentSnapshot(appointment);
  return liveOperationalMoveCapacityCandidates(day, appointment, jobs)
    .filter((slot) => !(slot.vanId === current.primaryVanId && slot.start === current.primaryStart))
    .filter((slot) => liveOperationalMoveTimeAllowed({
      dateKey: day.dateKey,
      targetStart: slot.start,
      currentDateKey: current.dateKey,
      currentStart: current.primaryStart,
      now,
    }));
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
