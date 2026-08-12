import type { BrowserAppointmentRecord } from '../lib/browser-operational';
import { createBrowserWorkOrder } from '../lib/browser-operational';
import type { CalendarDispatchJob } from '../lib/scheduling-capacity';
import { buildOperationalWeek } from '../lib/scheduling-capacity';
import {
  applyAppointmentScheduleChange,
  cancelAppointment,
  recordOperationalIssue,
  syncWorkOrderFromAppointment,
  updateAppointmentDetails,
  validMoveCandidates,
  validRescheduleCandidates,
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
const threeHourJobs = threeHour.assignments;
const moveOptions = validMoveCandidates(day, threeHour, threeHourJobs);
const sameTimeVan2 = moveOptions.find((slot) => slot.vanId === 'VAN-2' && slot.start === '13:30');
requireCondition(Boolean(sameTimeVan2), 'A three-hour appointment should be reassignable to another free van at the same customer-facing time.');

const reassigned = applyAppointmentScheduleChange({ record: threeHour, slot: sameTimeVan2!, dateKey, kind: 'operational_move', actor, reason: 'Capacity optimization' });
requireCondition(reassigned.record.id === threeHour.id, 'Operational move must preserve the appointment ID.');
requireCondition(reassigned.record.primaryVanId === 'VAN-2', 'Operational move must update the primary van.');
requireCondition(!reassigned.customerNotificationRecommended, 'Same-time van-only reassignment should not recommend a customer notification.');
requireCondition(reassigned.record.lifecycleHistory?.at(-1)?.kind === 'operational_move', 'Operational move must append an audit event.');

const laterSlot = moveOptions.find((slot) => slot.vanId === 'VAN-2' && slot.start === '08:30');
requireCondition(Boolean(laterSlot), 'A valid alternate-time move should be available on a free van.');
const timeChanged = applyAppointmentScheduleChange({ record: threeHour, slot: laterSlot!, dateKey, kind: 'operational_move', actor });
requireCondition(timeChanged.customerNotificationRecommended, 'Changing the promised appointment time must recommend customer communication.');

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
const nextDaySlot = rescheduleOptions.find((slot) => slot.vanId === 'VAN-1' && slot.start === '13:30');
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

console.log('Appointment lifecycle acceptance passed: details capacity revalidation, operational move, customer-facing time awareness, cancellation, issue logging, reschedule, Work Order sync and linked Primary + Support movement verified.');
