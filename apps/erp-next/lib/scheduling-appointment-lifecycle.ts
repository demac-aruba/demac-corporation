/**
 * LEGACY BROWSER SIMULATOR — acceptance/demo state only.
 * Product scheduling commits and availability use Office Booking Authority.
 */
import type { BrowserAppointmentHistoryEvent, BrowserAppointmentRecord, BrowserAppointmentScheduleSnapshot, BrowserWorkOrderRecord } from './browser-operational';
import { createBrowserWorkOrder } from './browser-operational';
import type { BookingRequest, BookingWorkLine, CandidateSlot, WorkPresetId } from './scheduling';
import { customerFacingDescription, getRuntimeSchedulingSettings, halfDayForTime, minutesToTime, timeToMinutes } from './scheduling';
import type { CalendarDispatchJob, OperationalDay } from './scheduling-capacity';
import { buildOperationalWeek, findCandidateSlotsForDay } from './scheduling-capacity';
import { legacySchedulingSimulatorVans } from './legacy-scheduling-simulator-fixtures';

export type AppointmentActor = { id?: string; name?: string };

export type AppointmentDetailsUpdate = {
  presetId?: WorkPresetId;
  totalQuantity?: number;
  workLines?: BookingWorkLine[];
  technicianInstructions?: string;
};

function historyId(kind: BrowserAppointmentHistoryEvent['kind']) {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function appointmentRequest(record: BrowserAppointmentRecord, overrides?: Partial<Pick<BookingRequest, 'presetId' | 'quantity'>>): BookingRequest {
  const hasOverride = Boolean(overrides?.presetId !== undefined || overrides?.quantity !== undefined);
  return {
    customer: record.customer,
    site: record.site,
    sector: record.sector,
    presetId: overrides?.presetId ?? record.presetId,
    quantity: overrides?.quantity ?? record.totalQuantity,
    workLines: hasOverride ? undefined : record.workLines,
    restriction: hasOverride ? undefined : record.bookingRestriction,
  };
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

function event(args: Omit<BrowserAppointmentHistoryEvent, 'id' | 'at'> & { kind: BrowserAppointmentHistoryEvent['kind'] }): BrowserAppointmentHistoryEvent {
  return {
    id: historyId(args.kind),
    at: new Date().toISOString(),
    ...args,
  };
}

function jobsWithoutAppointment(record: BrowserAppointmentRecord, jobs: CalendarDispatchJob[]) {
  const assignmentIds = new Set(record.assignments.map((assignment) => assignment.id));
  return jobs.filter((job) => !assignmentIds.has(job.id));
}

function jobsWithoutAssignment(assignmentId: string, jobs: CalendarDispatchJob[]) {
  return jobs.filter((job) => job.id !== assignmentId);
}

function positiveSlotCount(value: unknown) {
  const count = Number(value || 0);
  return Number.isFinite(count) && count > 0 ? Math.max(1, Math.ceil(count)) : 0;
}

function projectedAssignmentCapacity(args: {
  previous?: CalendarDispatchJob;
  start: string;
  end: string;
  preferredSlotCount?: number;
  preserveExisting?: boolean;
}) {
  const unchangedWindow = Boolean(args.preserveExisting && args.previous?.start === args.start && args.previous.end === args.end);
  const previousStarts = args.preserveExisting ? args.previous?.capacitySlotStarts?.filter(Boolean) ?? [] : [];
  const preferredSlotCount = positiveSlotCount(args.preferredSlotCount);
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

function rebuildAssignments(record: BrowserAppointmentRecord, slot: CandidateSlot, dateKey: string): CalendarDispatchJob[] {
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
      ? positiveSlotCount(oldPrimary?.capacitySlotStarts?.length) || positiveSlotCount(record.scheduledSlotCount)
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
      ? positiveSlotCount(oldSupport?.capacitySlotStarts?.length)
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

export function validMoveCandidates(day: OperationalDay, record: BrowserAppointmentRecord, jobs: CalendarDispatchJob[]) {
  if (record.status === 'cancelled' || record.dateKey !== day.dateKey) return [];
  return findCandidateSlotsForDay(day, appointmentRequest(record), jobsWithoutAppointment(record, jobs), legacySchedulingSimulatorVans);
}

export function validSupportMoveCandidates(day: OperationalDay, record: BrowserAppointmentRecord, supportAssignmentId: string, jobs: CalendarDispatchJob[]) {
  if (record.status === 'cancelled' || record.dateKey !== day.dateKey) return [];
  const support = record.assignments.find((assignment) => assignment.id === supportAssignmentId && !assignment.isPrimaryAssignment);
  const primary = record.assignments.find((assignment) => assignment.isPrimaryAssignment) ?? record.assignments[0];
  if (!support || !primary) return [];

  const supportDuration = timeToMinutes(support.end) - timeToMinutes(support.start);
  if (supportDuration <= 0) return [];

  const request = appointmentRequest(record, { presetId: support.presetId, quantity: support.quantity });
  return findCandidateSlotsForDay(day, request, jobsWithoutAssignment(support.id, jobs), legacySchedulingSimulatorVans)
    .filter((slot) => !slot.requiresSupportVan)
    .filter((slot) => slot.vanId !== primary.vanId)
    .filter((slot) => timeToMinutes(slot.end) - timeToMinutes(slot.start) === supportDuration)
    .filter((slot) => timeToMinutes(slot.start) >= timeToMinutes(primary.start) && timeToMinutes(slot.end) <= timeToMinutes(primary.end))
    .map((slot) => ({
      ...slot,
      reasons: [...slot.reasons, 'Support-only move; primary appointment remains unchanged'],
    }));
}

export function validRescheduleCandidates(dateKey: string, record: BrowserAppointmentRecord, targetJobs: CalendarDispatchJob[]) {
  const day = buildOperationalWeek(dateKey).find((item) => item.dateKey === dateKey);
  if (!day || !day.isOpen) return { day, slots: [] as CandidateSlot[] };
  const jobs = dateKey === record.dateKey ? jobsWithoutAppointment(record, targetJobs) : targetJobs;
  return { day, slots: findCandidateSlotsForDay(day, appointmentRequest(record), jobs, legacySchedulingSimulatorVans) };
}

export function applyAppointmentScheduleChange(args: {
  record: BrowserAppointmentRecord;
  slot: CandidateSlot;
  dateKey: string;
  kind: 'operational_move' | 'customer_reschedule' | 'undo_move';
  actor?: AppointmentActor;
  reason?: string;
  note?: string;
}) {
  const from = appointmentSnapshot(args.record);
  const assignments = rebuildAssignments(args.record, args.slot, args.dateKey);
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
    event({
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

export function applySupportAssignmentMove(args: {
  record: BrowserAppointmentRecord;
  supportAssignmentId: string;
  slot: CandidateSlot;
  actor?: AppointmentActor;
  reason?: string;
  kind?: 'support_move' | 'undo_move';
}) {
  const support = args.record.assignments.find((assignment) => assignment.id === args.supportAssignmentId && !assignment.isPrimaryAssignment);
  const primary = args.record.assignments.find((assignment) => assignment.isPrimaryAssignment) ?? args.record.assignments[0];
  if (!support || !primary) return { ok: false as const, message: 'The selected support assignment no longer exists.' };

  const from = appointmentSnapshot(args.record);
  const supportCapacity = projectedAssignmentCapacity({
    previous: support,
    start: args.slot.start,
    end: args.slot.end,
    preserveExisting: true,
    preferredSlotCount: positiveSlotCount(support.capacitySlotStarts?.length),
  });
  const assignments = args.record.assignments.map((assignment) => assignment.id === support.id ? {
    ...assignment,
    vanId: args.slot.vanId,
    start: args.slot.start,
    end: args.slot.end,
    segment: args.slot.segment,
    ...supportCapacity,
  } : assignment);
  const base: BrowserAppointmentRecord = {
    ...args.record,
    assignments,
    supportVanId: args.slot.vanId,
    updatedAt: new Date().toISOString(),
  };
  const to = appointmentSnapshot(base);
  const next: BrowserAppointmentRecord = {
    ...base,
    lifecycleHistory: [
      ...(args.record.lifecycleHistory ?? []),
      event({
        kind: args.kind ?? 'support_move',
        actorId: args.actor?.id,
        actorName: args.actor?.name,
        reason: args.reason,
        note: `Support assignment ${support.id}: ${support.vanId} ${support.start}–${support.end} → ${args.slot.vanId} ${args.slot.start}–${args.slot.end}`,
        from,
        to,
        customerNotificationRecommended: false,
      }),
    ],
  };
  return { ok: true as const, record: next, customerNotificationRecommended: false, from, to };
}

export function updateAppointmentDetails(args: {
  record: BrowserAppointmentRecord;
  update: AppointmentDetailsUpdate;
  day: OperationalDay;
  jobs: CalendarDispatchJob[];
  actor?: AppointmentActor;
}) {
  const incomingLines = args.update.workLines?.map((line, index) => ({
    ...line,
    id: line.id || `work-${index + 1}`,
    quantity: Math.max(1, Math.round(line.quantity)),
  })).filter((line) => Boolean(line.presetId));
  const legacyQuantity = Math.max(1, Math.round(args.update.totalQuantity ?? args.record.totalQuantity));
  const legacyPreset = args.update.presetId ?? args.record.presetId;
  const workLines: BookingWorkLine[] = incomingLines?.length
    ? incomingLines
    : [{ id: args.record.workLines?.[0]?.id ?? 'work-1', presetId: legacyPreset, quantity: legacyQuantity }];
  const totalQuantity = workLines.reduce((sum, line) => sum + line.quantity, 0);
  const primaryPreset = workLines[0]?.presetId ?? legacyPreset;
  const candidateRecord: BrowserAppointmentRecord = {
    ...args.record,
    presetId: primaryPreset,
    totalQuantity,
    workLines,
    technicianInstructions: args.update.technicianInstructions?.trim() || undefined,
    customerFacingDescription: customerFacingDescription({ presetId: primaryPreset, quantity: totalQuantity, workLines }),
  };
  const current = appointmentSnapshot(args.record);
  const options = findCandidateSlotsForDay(args.day, appointmentRequest(candidateRecord), jobsWithoutAppointment(args.record, args.jobs), legacySchedulingSimulatorVans);
  const exact = options.find((slot) => slot.vanId === current.primaryVanId && slot.start === current.primaryStart);
  if (!exact) {
    return { ok: false as const, message: 'The edited appointment scope no longer fits the current schedule. Use Move / Reassign or Reschedule to choose a valid work spot.' };
  }
  const assignments = rebuildAssignments(candidateRecord, exact, args.record.dateKey);
  const next: BrowserAppointmentRecord = {
    ...candidateRecord,
    assignments,
    primaryVanId: exact.vanId,
    supportVanId: exact.supportVanId,
    updatedAt: new Date().toISOString(),
    lifecycleHistory: [
      ...(args.record.lifecycleHistory ?? []),
      event({
        kind: 'details_edited',
        actorId: args.actor?.id,
        actorName: args.actor?.name,
        note: `${workLines.length} work line${workLines.length === 1 ? '' : 's'} · ${customerFacingDescription({ presetId: primaryPreset, quantity: totalQuantity, workLines })}`,
        from: appointmentSnapshot(args.record),
        to: appointmentSnapshot({ ...candidateRecord, assignments, primaryVanId: exact.vanId, supportVanId: exact.supportVanId }),
      }),
    ],
  };
  return { ok: true as const, record: next };
}

export function cancelAppointment(args: { record: BrowserAppointmentRecord; reason: string; note?: string; actor?: AppointmentActor }) {
  const now = new Date().toISOString();
  return {
    ...args.record,
    status: 'cancelled' as const,
    cancellationReason: args.reason,
    cancellationNote: args.note?.trim() || undefined,
    cancelledAt: now,
    updatedAt: now,
    lifecycleHistory: [
      ...(args.record.lifecycleHistory ?? []),
      event({
        kind: 'cancelled',
        actorId: args.actor?.id,
        actorName: args.actor?.name,
        reason: args.reason,
        note: args.note?.trim() || undefined,
        from: appointmentSnapshot(args.record),
      }),
    ],
  } satisfies BrowserAppointmentRecord;
}

export function recordOperationalIssue(args: { record: BrowserAppointmentRecord; reason: string; note?: string; actor?: AppointmentActor }) {
  return {
    ...args.record,
    updatedAt: new Date().toISOString(),
    lifecycleHistory: [
      ...(args.record.lifecycleHistory ?? []),
      event({
        kind: 'operational_issue',
        actorId: args.actor?.id,
        actorName: args.actor?.name,
        reason: args.reason,
        note: args.note?.trim() || undefined,
        from: appointmentSnapshot(args.record),
      }),
    ],
  } satisfies BrowserAppointmentRecord;
}

export function appendLifecycleEvent(record: BrowserAppointmentRecord, entry: Omit<BrowserAppointmentHistoryEvent, 'id' | 'at'>) {
  return {
    ...record,
    updatedAt: new Date().toISOString(),
    lifecycleHistory: [...(record.lifecycleHistory ?? []), event(entry)],
  };
}

export function syncWorkOrderFromAppointment(order: BrowserWorkOrderRecord, appointment: BrowserAppointmentRecord): BrowserWorkOrderRecord {
  const projected = createBrowserWorkOrder(appointment);
  return {
    ...order,
    ...projected,
    id: order.id,
    createdAt: order.createdAt,
    updatedAt: appointment.updatedAt ?? new Date().toISOString(),
  };
}
