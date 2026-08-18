import type { BrowserAppointmentRecord } from './browser-operational';
import type { CandidateSlot } from './scheduling';
import type { CalendarDispatchJob, OperationalDay } from './scheduling-capacity';
import {
  applyAppointmentScheduleChange,
  appointmentSnapshot,
  type AppointmentActor,
  validMoveCandidates,
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

export function liveDragMoveCandidates(
  day: OperationalDay,
  appointment: BrowserAppointmentRecord | undefined,
  jobs: CalendarDispatchJob[],
  now = new Date(),
): CandidateSlot[] {
  if (!appointment || appointment.status === 'cancelled' || appointment.assignments.length !== 1) return [];
  const current = appointmentSnapshot(appointment);
  return validMoveCandidates(day, appointment, jobs)
    .filter((slot) => !slot.requiresSupportVan)
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
