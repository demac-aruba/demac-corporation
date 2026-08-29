import type { BrowserAppointmentRecord } from '../lib/browser-operational';
import { createBrowserWorkOrder } from '../lib/browser-operational';
import type { CandidateSlot } from '../lib/scheduling';
import { minutesToTime, timeToMinutes } from '../lib/scheduling';
import type { CalendarDispatchJob } from '../lib/scheduling-capacity';
import { buildOperationalWeek } from '../lib/scheduling-capacity';
import {
  applyAppointmentScheduleChange,
  applySupportAssignmentMove,
  cancelAppointment,
  recordOperationalIssue,
  syncWorkOrderFromAppointment,
  updateAppointmentDetails,
  validMoveCandidates,
  validRescheduleCandidates,
  validSupportMoveCandidates,
} from '../lib/scheduling-appointment-lifecycle';

function requireCondition(condition: unknown, message: string) {
  if (!condition) throw new Error(`Appointment lifecycle acceptance failed: ${message}`);
}

function appointment(args: {
  id: string;
  dateKey: string;
  vanId: string;
  start: string;
  end: string;
  quantity: number;
  supportVanId?: string;
  supportStart?: string;
  supportEnd?: string;
}): BrowserAppointmentRecord {
  const primaryId = `${args.id}-P`;
  const primaryQuantity = args.supportVanId ? Math.min(7, args.quantity) : args.quantity;
  const primary: CalendarDispatchJob = {
    dateKey: args.dateKey,
    id: primaryId,
    customer: 'Lifecycle Customer',
    site: 'Lifecycle Property',
    sector: 'Noord',
    start: args.start,
    end: args.end,
    segment: args.start < '12:00' ? 'am' : 'pm',
    vanId: args.vanId,
    presetId: 'standard_service',
    quantity: primaryQuantity,
    status: 'confirmed',
    readiness: 'ready',
    isPrimaryAssignment: true,
    customerCommunicationOwner: true,
  };
  const assignments: CalendarDispatchJob[] = [primary];
  if (args.supportVanId) {
    assignments.push({
      ...primary,
      id: `${args.id}-S`,
      vanId: args.supportVanId,
      start: args.supportStart ?? args.start,
      end: args.supportEnd ?? args.end,
      quantity: args.quantity - primaryQuantity,
      isPrimaryAssignment: false,
      customerCommunicationOwner: false,
      supportForJobId: primaryId,
    });
  }
  return {
    id: args.id,
    dateKey: args.dateKey,
    customer: 'Lifecycle Customer',
    site: 'Lifecycle Property',
    sector: 'Noord',
    presetId: 'standard_service',
    totalQuantity: args.quantity,
    customerFacingDescription: `Standard service — ${args.quantity} A/C unit(s)`,
    status: 'confirmed',
    assignments,
    primaryVanId: args.vanId,
    supportVanId: args.supportVanId,
    createdAt: '2026-08-11T12:00:00.000Z',
    confirmedAt: '2026-08-11T12:05:00.000Z',
    workOrderId: `WO-${args.id}`,
  };
}

const dateKey = '2026-08-11';
const day = buildOperationalWeek(dateKey).find((item) => item.dateKey === dateKey)!;
const actor = { id: 'owner-1', name: 'Owner' };

const threeHour = appointment({ id: 'APT-LIFE-1', dateKey, vanId: 'VAN-1', start: '13:30', end: '16:30', quantity: 3 });
threeHour.scheduledSlotCount = 3;
threeHour.assignments[0].capacitySlotStarts = ['13:30', '14:30', '15:30'];
threeHour.assignments[0].capacityEnd = '16:30';
const threeHourJobs = threeHour.assignments;
const moveOptions = validMoveCandidates(day, threeHour, threeHourJobs);
requireCondition(moveOptions.length > 0, 'A three-hour appointment should expose valid browser move recommendations.');
const van2Recommendation = moveOptions.find((slot) => slot.vanId === 'VAN-2');
requireCondition(Boolean(van2Recommendation), 'The browser shortlist should include at least one valid free Van 2 destination.');

// The browser helper intentionally returns a ranked shortlist rather than every physical
// target. Same-time lifecycle semantics are tested explicitly here; the production
// Booking Authority validates the exact Van/time at commit.
const sameTimeVan2: CandidateSlot = {
  ...(van2Recommendation as CandidateSlot),
  vanId: 'VAN-2',
  start: '13:30',
  end: '16:30',
  segment: 'pm',
};
const reassigned = applyAppointmentScheduleChange({ record: threeHour, slot: sameTimeVan2, dateKey, kind: 'operational_move', actor, reason: 'Capacity optimization' });
requireCondition(reassigned.record.id === threeHour.id, 'Operational move must preserve the appointment ID.');
requireCondition(reassigned.record.primaryVanId === 'VAN-2', 'Operational move must update the primary van.');
requireCondition(!reassigned.customerNotificationRecommended, 'Same-time van-only reassignment should not recommend a customer notification.');
requireCondition(reassigned.record.lifecycleHistory?.at(-1)?.kind === 'operational_move', 'Operational move must append an audit event.');
requireCondition(reassigned.record.assignments[0].capacitySlotStarts?.join(',') === '13:30,14:30,15:30', 'Same-time Van reassignment must preserve the canonical capacity starts.');
requireCondition(reassigned.record.assignments[0].capacityEnd === '16:30', 'Same-time Van reassignment must preserve the canonical capacity boundary.');

const laterSlot = moveOptions.find((slot) => slot.vanId === 'VAN-2' && slot.start === '08:30') ?? van2Recommendation;
requireCondition(Boolean(laterSlot), 'A valid alternate-time move should be available on a free van.');
const timeChangedSlot: CandidateSlot = laterSlot!.start === '13:30'
  ? { ...laterSlot!, start: '08:30', end: '11:30', segment: 'am' }
  : laterSlot!;
const timeChanged = applyAppointmentScheduleChange({ record: threeHour, slot: timeChangedSlot, dateKey, kind: 'operational_move', actor });
requireCondition(timeChanged.customerNotificationRecommended, 'Changing the promised appointment time must recommend customer communication.');
requireCondition(timeChanged.record.assignments[0].capacitySlotStarts?.join(',') === '08:30,09:30,10:30', 'Changing time must recompute the optimistic capacity starts at the new destination.');
requireCondition(timeChanged.record.assignments[0].capacityEnd === '11:30', 'Changing time must recompute the optimistic capacity boundary at the new destination.');

const sevenService = appointment({ id: 'APT-LIFE-FULL-DAY', dateKey, vanId: 'VAN-1', start: '08:30', end: '15:30', quantity: 7 });
sevenService.scheduledSlotCount = 6;
sevenService.assignments[0].capacitySlotStarts = ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30'];
sevenService.assignments[0].capacityEnd = '16:30';
const sevenServiceMoved = applyAppointmentScheduleChange({
  record: sevenService,
  slot: {
    vanId: 'VAN-2',
    start: '08:30',
    end: '15:30',
    segment: 'full_day',
    sector: sevenService.sector,
    score: 0,
    reasons: ['Acceptance move'],
    requiresSupportVan: false,
    primaryUnits: 7,
  },
  dateKey,
  kind: 'operational_move',
  actor,
});
requireCondition(sevenServiceMoved.record.assignments[0].end === '15:30', 'A seven-service move must preserve the elapsed work estimate.');
requireCondition(sevenServiceMoved.record.assignments[0].capacitySlotStarts?.length === 6, 'A seven-service move must preserve all six sellable capacity starts.');
requireCondition(sevenServiceMoved.record.assignments[0].capacityEnd === '16:30', 'A seven-service move must preserve the separate full-day capacity boundary.');

const tooLargeEdit = updateAppointmentDetails({ record: threeHour, update: { presetId: 'standard_service', totalQuantity: 4 }, day, jobs: threeHourJobs, actor });
requireCondition(!tooLargeEdit.ok, 'Increasing a 1:30 PM three-hour appointment to four one-hour units must be rejected because it no longer fits the protected workday.');

const issueRecorded = recordOperationalIssue({ record: threeHour, reason: 'No one home / no-show', note: 'Called twice.', actor });
requireCondition(issueRecorded.status === 'confirmed', 'Recording a no-show/access issue must not automatically cancel the appointment.');
requireCondition(issueRecorded.lifecycleHistory?.at(-1)?.kind === 'operational_issue', 'Operational issue must append to history.');

const cancelled = cancelAppointment({ record: threeHour, reason: 'Customer cancelled service', note: 'Customer called office.', actor });
requireCondition(cancelled.status === 'cancelled', 'Cancellation must change appointment status to cancelled.');
requireCondition(cancelled.cancellationReason === 'Customer cancelled service', 'Cancellation reason must be retained.');
requireCondition(cancelled.lifecycleHistory?.at(-1)?.kind === 'cancelled', 'Cancellation must append to immutable history.');

const nextDate = '2026-08-12';
const rescheduleOptions = validRescheduleCandidates(nextDate, threeHour, []).slots;
const nextDaySlot = rescheduleOptions.find((slot) => slot.vanId === 'VAN-1' && slot.start === '13:30') ?? rescheduleOptions[0];
requireCondition(Boolean(nextDaySlot), 'Customer reschedule should calculate valid route-aware capacity on another operational day.');
const rescheduled = applyAppointmentScheduleChange({ record: threeHour, slot: nextDaySlot!, dateKey: nextDate, kind: 'customer_reschedule', actor, reason: 'Customer requested another date' });
requireCondition(rescheduled.record.id === threeHour.id, 'Customer reschedule must preserve the same appointment ID.');
requireCondition(rescheduled.record.dateKey === nextDate, 'Customer reschedule must update the scheduled date.');
requireCondition(rescheduled.record.lifecycleHistory?.at(-1)?.kind === 'customer_reschedule', 'Customer reschedule must append its own audit event.');

const workOrder = createBrowserWorkOrder(threeHour);
const syncedOrder = syncWorkOrderFromAppointment(workOrder, rescheduled.record);
requireCondition(syncedOrder.id === workOrder.id, 'Work Order synchronization must preserve Work Order identity.');
requireCondition(syncedOrder.scheduledDate === nextDate, 'Work Order must follow the appointment reschedule date.');
requireCondition(syncedOrder.scheduleHistory?.at(-1)?.kind === 'customer_reschedule', 'Work Order must receive the appointment schedule history.');

const linked = appointment({ id: 'APT-LIFE-2', dateKey, vanId: 'VAN-3', start: '08:30', end: '16:30', quantity: 8, supportVanId: 'VAN-1', supportStart: '13:30', supportEnd: '14:30' });
const linkedOptions = validMoveCandidates(day, linked, linked.assignments);
const linkedMove = linkedOptions.find((slot) => slot.requiresSupportVan && Boolean(slot.supportVanId));
requireCondition(Boolean(linkedMove), 'An eight-unit linked appointment must remain a linked Primary + Support plan when moved.');
const linkedMoved = applyAppointmentScheduleChange({ record: linked, slot: linkedMove!, dateKey, kind: 'operational_move', actor, reason: 'Dispatch optimization' });
requireCondition(linkedMoved.record.assignments.length === 2, 'Moving a linked appointment must preserve two linked assignments.');
requireCondition(linkedMoved.record.assignments.filter((item) => item.isPrimaryAssignment).length === 1, 'Linked move must preserve exactly one primary assignment.');
requireCondition(linkedMoved.record.assignments.filter((item) => !item.isPrimaryAssignment).length === 1, 'Linked move must preserve exactly one support assignment.');

const supportDragCase = appointment({ id: 'APT-LIFE-3', dateKey, vanId: 'VAN-4', start: '08:30', end: '16:30', quantity: 10, supportVanId: 'VAN-2', supportStart: '13:30', supportEnd: '16:30' });
const supportAssignment = supportDragCase.assignments.find((item) => !item.isPrimaryAssignment)!;
const supportMoveOptions = validSupportMoveCandidates(day, supportDragCase, supportAssignment.id, supportDragCase.assignments);
const moveSupportToVan1 = supportMoveOptions.find((slot) => slot.vanId === 'VAN-1' && slot.start === '13:30') ?? supportMoveOptions.find((slot) => slot.vanId === 'VAN-1');
requireCondition(Boolean(moveSupportToVan1), 'A three-unit support assignment should be movable to an open Van 1 without moving the primary appointment.');
const supportMoved = applySupportAssignmentMove({ record: supportDragCase, supportAssignmentId: supportAssignment.id, slot: moveSupportToVan1!, actor, reason: 'Support drag reassignment' });
requireCondition(supportMoved.ok, 'Support-only reassignment should succeed for a valid target.');
if (supportMoved.ok) {
  const movedPrimary = supportMoved.record.assignments.find((item) => item.isPrimaryAssignment)!;
  const movedSupport = supportMoved.record.assignments.find((item) => !item.isPrimaryAssignment)!;
  const movedSupportCapacityStarts = movedSupport.capacitySlotStarts ?? [];
  const expectedSupportCapacityEnd = minutesToTime(Math.max(
    timeToMinutes(movedSupport.end),
    ...movedSupportCapacityStarts.map((start) => timeToMinutes(start) + 60),
  ));
  requireCondition(movedPrimary.vanId === 'VAN-4' && movedPrimary.start === '08:30', 'Support-only drag must leave the Van 4 primary assignment untouched.');
  requireCondition(movedSupport.vanId === 'VAN-1' && movedSupport.quantity === 3, 'Support-only drag must move exactly the three-unit support block to Van 1.');
  requireCondition(movedSupportCapacityStarts.length === 3 && movedSupportCapacityStarts[0] === movedSupport.start, 'Support-only drag must project all support Van capacity starts at its destination.');
  requireCondition(movedSupport.capacityEnd === expectedSupportCapacityEnd, 'Support-only drag must project the support Van capacity boundary at its destination.');
  requireCondition(supportMoved.record.lifecycleHistory?.at(-1)?.kind === 'support_move', 'Support-only drag must append a support_move audit event.');
  requireCondition(!supportMoved.customerNotificationRecommended, 'Moving support only must not recommend a customer-facing notification when the primary schedule is unchanged.');
  const supportWorkOrder = createBrowserWorkOrder(supportDragCase);
  const syncedSupportOrder = syncWorkOrderFromAppointment(supportWorkOrder, supportMoved.record);
  requireCondition(syncedSupportOrder.primaryVanId === 'VAN-4' && syncedSupportOrder.supportVanId === 'VAN-1', 'Work Order sync must preserve primary Van 4 and update only the support van to Van 1.');
}

console.log('Appointment lifecycle acceptance passed: details capacity revalidation, browser shortlist compatibility, exact move lifecycle semantics, cancellation, issue logging, reschedule, Work Order sync, linked Primary + Support movement and support-only drag reassignment verified.');
