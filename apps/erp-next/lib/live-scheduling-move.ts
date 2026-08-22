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

function overlaps(start: string, end: string, job: CalendarDispatchJob) {
  return timeToMinutes(start) < timeToMinutes(job.end) && timeToMinutes(end) > timeToMinutes(job.start);
}

function canonicalAppointmentSlotCount(appointment: BrowserAppointmentRecord) {
  const stored = Number(appointment.scheduledSlotCount || 0);
  if (Number.isFinite(stored) && stored > 0) return Math.max(1, Math.ceil(stored));
  const duration = Number(appointment.scheduledDurationMinutes || 0);
  if (Number.isFinite(duration) && duration > 0) return Math.max(1, Math.ceil(duration / 60));
  const assignment = appointment.assignments[0];
  if (!assignment) return 0;
  const wallClock = timeToMinutes(assignment.end) - timeToMinutes(assignment.start);
  return Number.isFinite(wallClock) && wallClock > 0 ? Math.max(1, Math.ceil(wallClock / 60)) : 0;
}

function contiguousOperatingBlocks(starts: string[]) {
  const ordered = [...starts].sort((left, right) => timeToMinutes(left) - timeToMinutes(right));
  const blocks: string[][] = [];
  for (const start of ordered) {
    const current = blocks[blocks.length - 1];
    const previous = current?.[current.length - 1];
    if (!current || !previous || timeToMinutes(start) - timeToMinutes(previous) !== 60) {
      blocks.push([start]);
    } else {
      current.push(start);
    }
  }
  return blocks;
}

function endForOperationalSlots(starts: string[], start: string, slotCount: number) {
  if (slotCount < 1) return '';
  for (const block of contiguousOperatingBlocks(starts)) {
    const index = block.indexOf(start);
    if (index < 0 || index + slotCount > block.length) continue;
    const last = block[index + slotCount - 1];
    return minutesToTime(timeToMinutes(last) + 60);
  }
  return '';
}

/**
 * Manual LIVE drag is a direct office dispatch action rather than an automatic route
 * recommendation. It preserves the appointment's canonical slot count and accepts every
 * same-day destination where those exact operating slots fit inside one continuous dispatch
 * block. This mirrors the server operational-move boundary so the browser never offers a
 * destination that Booking Authority will reject. Booking Authority remains the commit-time
 * source of truth for company/van capacity and revalidates the move.
 */
export function liveOperationalMoveCapacityCandidates(
  day: OperationalDay,
  appointment: BrowserAppointmentRecord,
  jobs: CalendarDispatchJob[],
  capacityState: LiveOperationalCapacityState | null = null,
): CandidateSlot[] {
  if (!day.isOpen || appointment.status === 'cancelled' || appointment.assignments.length !== 1) return [];

  const settings = getRuntimeSchedulingSettings();
  const slotCount = canonicalAppointmentSlotCount(appointment);
  if (!slotCount) return [];
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
      const end = endForOperationalSlots(starts, start, slotCount);
      if (!end) continue;
      if (!liveOperationalWindowAllows(capacityState, van.id, day.dateKey, start, end)) continue;
      if (otherJobs.some((job) => job.vanId === van.id && overlaps(start, end, job))) continue;

      candidates.push({
        vanId: van.id,
        start,
        end,
        segment: halfDay ? halfDayForTime(start) : timeToMinutes(start) < 12 * 60 && timeToMinutes(end) > 13 * 60 ? 'full_day' : halfDayForTime(start),
        sector: appointment.sector,
        score: 0,
        reasons: ['Manual operational move: canonical occupied-slot count fits one continuous live dispatch block'],
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
