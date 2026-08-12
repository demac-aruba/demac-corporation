import type { BrowserAppointmentHistoryEvent, BrowserAppointmentRecord, BrowserAppointmentScheduleSnapshot, BrowserWorkOrderRecord } from './browser-operational';
import { createBrowserWorkOrder } from './browser-operational';
import type { BookingRequest, CandidateSlot, WorkPresetId } from './scheduling';
import { customerFacingDescription, halfDayForTime, timeToMinutes } from './scheduling';
import type { CalendarDispatchJob, OperationalDay } from './scheduling-capacity';
import { buildOperationalWeek, findCandidateSlotsForDay } from './scheduling-capacity';

export type AppointmentActor = { id?: string; name?: string };

export type AppointmentDetailsUpdate = {
  presetId: WorkPresetId;
  totalQuantity: number;
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

function rebuildAssignments(record: BrowserAppointmentRecord, slot: CandidateSlot, dateKey: string): CalendarDispatchJob[] {
  const oldPrimary = record.assignments.find((assignment) => assignment.isPrimaryAssignment) ?? record.assignments[0];
  const oldSupport = record.assignments.find((assignment) => !assignment.isPrimaryAssignment);
  const primaryId = oldPrimary?.id ?? `${record.id}-P`;
  const status = record.status === 'confirmed' ? 'confirmed' : 'temporary_hold';
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
    quantity: slot.primaryUnits ?? record.totalQuantity,
    status,
    readiness: oldPrimary?.readiness ?? 'at_risk',
    isPrimaryAssignment: true,
    customerCommunicationOwner: true,
  };

  if (!slot.requiresSupportVan || !slot.supportVanId) return [primary];

  const support: CalendarDispatchJob = {
    ...primary,
    id: oldSupport?.id ?? `${record.id}-S`,
    start: slot.supportStart ?? slot.start,
    end: slot.supportEnd ?? slot.end,
    segment: slot.supportSegment ?? halfDayForTime(slot.supportStart ?? slot.start),
    vanId: slot.supportVanId,
    quantity: slot.supportUnits ?? Math.max(1, record.totalQuantity - (slot.primaryUnits ?? record.totalQuantity)),
    readiness: oldSupport?.readiness ?? primary.readiness,
    isPrimaryAssignment: false,
    customerCommunicationOwner: false,
    supportForJobId: primaryId,
  };
  return [primary, support];
}

export function validMoveCandidates(day: OperationalDay, record: BrowserAppointmentRecord, jobs: CalendarDispatchJob[]) {
  if (record.status === 'cancelled' || record.dateKey !== day.dateKey) return [];
  return findCandidateSlotsForDay(day, appointmentRequest(record), jobsWithoutAppointment(record, jobs));
}

export function validSupportMoveCandidates(day: OperationalDay, record: BrowserAppointmentRecord, supportAssignmentId: string, jobs: CalendarDispatchJob[]) {
  if (record.status === 'cancelled' || record.dateKey !== day.dateKey) return [];
  const support = record.assignments.find((assignment) => assignment.id === supportAssignmentId && !assignment.isPrimaryAssignment);
  const primary = record.assignments.find((assignment) => assignment.isPrimaryAssignment) ?? record.assignments[0];
  if (!support || !primary) return [];

  const supportDuration = timeToMinutes(support.end) - timeToMinutes(support.start);
  if (supportDuration <= 0) return [];

  const request = appointmentRequest(record, { presetId: support.presetId, quantity: support.quantity });
  return findCandidateSlotsForDay(day, request, jobsWithoutAssignment(support.id, jobs))
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
  return { day, slots: findCandidateSlotsForDay(day, appointmentRequest(record), jobs) };
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
  const assignments = args.record.assignments.map((assignment) => assignment.id === support.id ? {
    ...assignment,
    vanId: args.slot.vanId,
    start: args.slot.start,
    end: args.slot.end,
    segment: args.slot.segment,
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
  const quantity = Math.max(1, Math.min(14, Math.round(args.update.totalQuantity)));
  const workLines = [{ id: args.record.workLines?.[0]?.id ?? 'work-1', presetId: args.update.presetId, quantity }];
  const candidateRecord: BrowserAppointmentRecord = {
    ...args.record,
    presetId: args.update.presetId,
    totalQuantity: quantity,
    workLines,
    technicianInstructions: args.update.technicianInstructions?.trim() || undefined,
    customerFacingDescription: customerFacingDescription({ presetId: args.update.presetId, quantity, workLines }),
  };
  const current = appointmentSnapshot(args.record);
  const options = findCandidateSlotsForDay(args.day, appointmentRequest(candidateRecord), jobsWithoutAppointment(args.record, args.jobs));
  const exact = options.find((slot) => slot.vanId === current.primaryVanId && slot.start === current.primaryStart);
  if (!exact) {
    return { ok: false as const, message: 'The edited service or quantity no longer fits the current schedule. Use Move / Reassign or Reschedule to choose a valid work spot.' };
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