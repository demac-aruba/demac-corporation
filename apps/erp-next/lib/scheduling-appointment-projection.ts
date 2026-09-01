import type { BrowserAppointmentHistoryEvent, BrowserAppointmentRecord, BrowserAppointmentScheduleSnapshot } from './browser-operational';
import type { CandidateSlot } from './scheduling';
import { getRuntimeSchedulingSettings, halfDayForTime, minutesToTime, timeToMinutes } from './scheduling';
import type { CalendarDispatchJob } from './scheduling-capacity';

export type AppointmentActor = { id?: string; name?: string };

function historyId(kind: BrowserAppointmentHistoryEvent['kind']) {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function appointmentSnapshot(record: BrowserAppointmentRecord): BrowserAppointmentScheduleSnapshot {
  const primary = record.assignments.find((assignment) => assignment.isPrimaryAssignment) ?? record.assignments[0];
  const support = record.assignments.find((assignment) => !assignment.isPrimaryAssignment);
  return {
    dateKey: record.dateKey,
    primaryVanId: primary?.vanId ?? record.primaryVanId,
    primaryStart: primary?.start ?? '08:30',
    primaryEnd: primary?.end ?? '09:30',
    supportVanId: support?.vanId ?? record.supportVanId,
    supportStart: support?.start,
    supportEnd: support?.end,
  };
}

export function schedulingLifecycleEvent(args: Omit<BrowserAppointmentHistoryEvent, 'id' | 'at'> & { kind: BrowserAppointmentHistoryEvent['kind'] }): BrowserAppointmentHistoryEvent {
  return {
    id: historyId(args.kind),
    at: new Date().toISOString(),
    ...args,
  };
}

export function positiveSchedulingSlotCount(value: unknown) {
  const count = Number(value || 0);
  return Number.isFinite(count) && count > 0 ? Math.max(1, Math.ceil(count)) : 0;
}

export function projectedAssignmentCapacity(args: {
  previous?: CalendarDispatchJob;
  start: string;
  end: string;
  preferredSlotCount?: number;
  preserveExisting?: boolean;
}) {
  const unchangedWindow = Boolean(args.preserveExisting && args.previous?.start === args.start && args.previous.end === args.end);
  const previousStarts = args.preserveExisting ? args.previous?.capacitySlotStarts?.filter(Boolean) ?? [] : [];
  const preferredSlotCount = positiveSchedulingSlotCount(args.preferredSlotCount);
  const elapsedSlotCount = Math.max(1, Math.ceil((timeToMinutes(args.end) - timeToMinutes(args.start)) / 60));
  const schedule = getRuntimeSchedulingSettings().serviceStartTimes;
  const startIndex = schedule.indexOf(args.start);
  const derivedSlotCount = startIndex >= 0 ? Math.min(elapsedSlotCount, schedule.length - startIndex) : elapsedSlotCount;
  const slotCount = preferredSlotCount || derivedSlotCount;
  const capacitySlotStarts = unchangedWindow && previousStarts.length
    ? [...previousStarts]
    : startIndex >= 0
      ? schedule.slice(startIndex, startIndex + slotCount)
      : slotCount === 1
        ? [args.start]
        : [];
  const capacityEndFromStarts = capacitySlotStarts.length
    ? minutesToTime(Math.max(...capacitySlotStarts.map(timeToMinutes)) + 60)
    : args.end;
  const possibleEnds = [args.end, capacityEndFromStarts];
  if (unchangedWindow && args.previous?.capacityEnd) possibleEnds.push(args.previous.capacityEnd);
  const capacityEnd = possibleEnds.reduce((latest, current) => (
    timeToMinutes(current) > timeToMinutes(latest) ? current : latest
  ), args.end);
  return { capacitySlotStarts, capacityEnd };
}

export function rebuildProjectedAssignments(record: BrowserAppointmentRecord, slot: CandidateSlot, dateKey: string): CalendarDispatchJob[] {
  const oldPrimary = record.assignments.find((assignment) => assignment.isPrimaryAssignment) ?? record.assignments[0];
  const oldSupport = record.assignments.find((assignment) => !assignment.isPrimaryAssignment);
  const primaryId = oldPrimary?.id ?? `${record.id}-P`;
  const status = record.status === 'confirmed' ? 'confirmed' : 'temporary_hold';
  const primaryQuantity = slot.primaryUnits ?? record.totalQuantity;
  const primaryCapacity = projectedAssignmentCapacity({
    previous: oldPrimary,
    start: slot.start,
    end: slot.end,
    preserveExisting: oldPrimary?.quantity === primaryQuantity,
    preferredSlotCount: oldPrimary?.quantity === primaryQuantity
      ? positiveSchedulingSlotCount(oldPrimary?.capacitySlotStarts?.length) || positiveSchedulingSlotCount(record.scheduledSlotCount)
      : undefined,
  });
  const primary: CalendarDispatchJob = {
    dateKey,
    id: primaryId,
    customer: record.customer,
    site: record.site,
    sector: record.sector,
    start: slot.start,
    end: slot.end,
    segment: slot.segment,
    vanId: slot.vanId,
    presetId: record.presetId,
    quantity: primaryQuantity,
    status,
    readiness: oldPrimary?.readiness ?? 'at_risk',
    isPrimaryAssignment: true,
    customerCommunicationOwner: true,
    ...primaryCapacity,
  };

  if (!slot.requiresSupportVan || !slot.supportVanId) return [primary];

  const supportStart = slot.supportStart ?? slot.start;
  const supportEnd = slot.supportEnd ?? slot.end;
  const supportQuantity = slot.supportUnits ?? Math.max(1, record.totalQuantity - primaryQuantity);
  const supportCapacity = projectedAssignmentCapacity({
    previous: oldSupport,
    start: supportStart,
    end: supportEnd,
    preserveExisting: oldSupport?.quantity === supportQuantity,
    preferredSlotCount: oldSupport?.quantity === supportQuantity
      ? positiveSchedulingSlotCount(oldSupport?.capacitySlotStarts?.length)
      : undefined,
  });
  const support: CalendarDispatchJob = {
    ...primary,
    id: oldSupport?.id ?? `${record.id}-S`,
    start: supportStart,
    end: supportEnd,
    segment: slot.supportSegment ?? halfDayForTime(supportStart),
    vanId: slot.supportVanId,
    quantity: supportQuantity,
    readiness: oldSupport?.readiness ?? primary.readiness,
    isPrimaryAssignment: false,
    customerCommunicationOwner: false,
    supportForJobId: primaryId,
    ...supportCapacity,
  };
  return [primary, support];
}

/**
 * Applies only a local projection after Office Booking Authority has committed.
 * It never validates availability and never writes canonical scheduling data.
 */
export function applyAuthoritativeAppointmentProjection(args: {
  record: BrowserAppointmentRecord;
  slot: CandidateSlot;
  dateKey: string;
  kind: 'operational_move' | 'customer_reschedule' | 'undo_move';
  actor?: AppointmentActor;
  reason?: string;
  note?: string;
}) {
  const from = appointmentSnapshot(args.record);
  const assignments = rebuildProjectedAssignments(args.record, args.slot, args.dateKey);
  const next: BrowserAppointmentRecord = {
    ...args.record,
    dateKey: args.dateKey,
    assignments,
    primaryVanId: args.slot.vanId,
    supportVanId: args.slot.supportVanId,
    updatedAt: new Date().toISOString(),
  };
  const to = appointmentSnapshot(next);
  const customerNotificationRecommended = from.dateKey !== to.dateKey || from.primaryStart !== to.primaryStart;
  next.lifecycleHistory = [
    ...(args.record.lifecycleHistory ?? []),
    schedulingLifecycleEvent({
      kind: args.kind,
      actorId: args.actor?.id,
      actorName: args.actor?.name,
      reason: args.reason,
      note: args.note,
      from,
      to,
      customerNotificationRecommended,
    }),
  ];
  return { record: next, customerNotificationRecommended, from, to };
}
