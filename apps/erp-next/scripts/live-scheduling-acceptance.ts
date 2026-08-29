import {
  liveOperationalWindowAllows,
  liveVanCrew,
  liveVanIsHalfDay,
  type LiveOperationalCapacityState,
} from '../lib/live-operational-capacity';
import { bookingActorLabel, projectLiveSchedulingAppointments, resolveCanonicalVanId } from '../lib/live-scheduling';
import { afterHoursTargetForVan, availableSlotAction } from '../lib/live-scheduling-interactions';
import {
  liveDragMoveCandidates,
  liveMoveTargetKey,
  projectCommittedLiveMove,
} from '../lib/live-scheduling-move';
import { buildOperationalWeek, findCandidateSlotsForDay, jobOwnsCapacityStart } from '../lib/scheduling-capacity';

function requireCondition(condition: unknown, message: string) {
  if (!condition) throw new Error(`Live scheduling acceptance failed: ${message}`);
}

const canonicalWorkOrders = [
  {
    id: 'WO-APT-CANONICAL-1-1',
    appointmentId: 'APT-CANONICAL-1',
    clientId: 'CLIENT-STAR-MEDIA',
    propertyId: 'PROPERTY-STAR-MEDIA',
    serviceId: 'service-standard',
    date: '2026-08-18',
    time: '08:30',
    status: 'Confirmada',
    vanId: 'VAN-1',
    appointmentPresetId: 'standard_service',
    appointmentWorkLabel: 'Standard Service',
    appointmentAssignmentRole: 'primary',
    airConditionerCount: 2,
    appointmentDurationMinutes: 120,
    scheduledSlots: 2,
    problem: 'Servicio estándar para 2 aires acondicionados.',
    zone: 'Santa Cruz',
    confirmedAt: '2026-08-17T20:49:00.000Z',
    createdAt: '2026-08-17T20:49:00.000Z',
    updatedAt: '2026-08-17T20:49:00.000Z',
  },
];

const clients = [
  { id: 'CLIENT-STAR-MEDIA', name: 'Christian', company: 'Star Media DirecTV', phone: '+2975550000', whatsapp: '+2975550000', email: 'office@example.com', preferredLanguage: 'Papiamento' },
];

const properties = [
  { id: 'PROPERTY-STAR-MEDIA', name: 'Star Media Office', address: 'Santa Cruz 54 C, local 1', operationalZone: 'Santa Cruz', accessInstructions: 'Use front entrance.' },
];

const authorityAppointments = [
  { appointmentId: 'APT-CANONICAL-1', source: 'office-scheduling', createdBy: 'user-christian', createdByName: 'Christian' },
];

const canonicalAppointments = projectLiveSchedulingAppointments(canonicalWorkOrders, clients, properties, [], authorityAppointments);
requireCondition(canonicalAppointments.length === 1, 'A canonical Booking Authority work order must appear as one live appointment.');
const canonical = canonicalAppointments[0];
requireCondition(canonical.id === 'APT-CANONICAL-1', 'Canonical appointmentId must be preserved.');
requireCondition(canonical.primaryVanId === 'VAN-1', 'Canonical vanId must be projected into the live schedule.');
requireCondition(canonical.assignments[0].start === '08:30', 'Canonical start time must be preserved.');
requireCondition(canonical.assignments[0].end === '10:30', 'Canonical elapsed duration must be preserved.');
requireCondition(canonical.scheduledSlotCount === 2, 'Numeric Work Order scheduledSlots must remain capacity/history metadata.');
requireCondition(canonical.bookedByName === 'Christian', 'Canonical booking operator must be preserved.');
requireCondition(bookingActorLabel({ appointmentId: 'APT-MAYA', source: 'demac-customer-agent' }) === 'Maya', 'Customer Agent bookings must display Maya.');

const sixService = projectLiveSchedulingAppointments([{
  ...canonicalWorkOrders[0],
  id: 'WO-APT-SIX-1',
  appointmentId: 'APT-SIX',
  airConditionerCount: 6,
  appointmentDurationMinutes: 360,
  appointmentEndTime: '14:30',
  scheduledSlots: 6,
}], clients, properties)[0];
requireCondition(sixService.assignments[0].end === '14:30', 'Six Standard Services must keep the canonical 08:30–14:30 elapsed work interval.');
requireCondition(sixService.assignments[0].capacitySlotStarts?.length === 6, 'Six Standard Services must own all six normal Van capacity starts.');
requireCondition(jobOwnsCapacityStart(sixService.assignments[0], '15:30'), 'Six Standard Services must not expose the 15:30 capacity start as available.');

const threeService = projectLiveSchedulingAppointments([{
  ...canonicalWorkOrders[0],
  id: 'WO-APT-THREE-1',
  appointmentId: 'APT-THREE',
  time: '09:30',
  airConditionerCount: 3,
  appointmentDurationMinutes: 180,
  appointmentEndTime: '12:30',
  scheduledSlots: 3,
}], clients, properties)[0];
requireCondition(threeService.assignments[0].end === '12:30', 'Three Standard Services must keep three real elapsed work hours.');
requireCondition(
  threeService.assignments[0].capacitySlotStarts?.join(',') === '09:30,10:30,13:30',
  'Three Standard Services must retain exactly three capacity spots when lunch removes a sellable anchor.',
);
requireCondition(jobOwnsCapacityStart(threeService.assignments[0], '13:30'), 'The third owned capacity spot must project into the live Van lane.');
requireCondition(!jobOwnsCapacityStart(threeService.assignments[0], '14:30'), 'Three Standard Services must not consume a fourth capacity spot.');

const perVanAfterHoursTarget = afterHoursTargetForVan('2026-08-18', { id: 'VAN-3', name: 'Van 3' });
requireCondition(perVanAfterHoursTarget.vanId === 'VAN-3' && perVanAfterHoursTarget.vanName === 'Van 3', 'Per-Van after-hours creation must preserve the lane-selected Van.');
requireCondition(perVanAfterHoursTarget.start === '17:00' && perVanAfterHoursTarget.end === '', 'After-hours creation must reuse canonical booking with a 5 PM default and no fabricated end time.');
requireCondition(availableSlotAction('card') === 'book' && availableSlotAction('book') === 'book', 'Available card background and BOOK must open normal booking.');
requireCondition(availableSlotAction('support') === 'support', 'The explicit SUPPORT action must remain isolated from normal booking.');

// Regression for an AM → PM drag created before operational-move v3. Duration is the
// timing authority, so a stale pre-move end snapshot must not hide the actual span.
const staleMovedWorkOrders = [{
  ...canonicalWorkOrders[0],
  id: 'WO-APT-STALE-MOVE-1',
  appointmentId: 'APT-STALE-MOVE',
  date: '2026-09-01',
  time: '13:30',
  vanId: 'VAN-3',
  appointmentEndTime: '11:30',
  scheduledSlots: 3,
  appointmentDurationMinutes: 180,
  airConditionerCount: 3,
  zone: 'Paradera / Hooiberg',
}];
const staleMovedAppointments = projectLiveSchedulingAppointments(staleMovedWorkOrders, clients, properties);
const staleMoved = staleMovedAppointments[0];
requireCondition(Boolean(staleMoved), 'A moved appointment with a stale pre-fix Work Order end snapshot must remain visible.');
requireCondition(staleMoved.primaryVanId === 'VAN-3', 'The recovered moved appointment must remain assigned to Van 3.');
requireCondition(staleMoved.assignments[0].start === '13:30', 'The recovered moved appointment must preserve its PM start time.');
requireCondition(staleMoved.assignments[0].end === '16:30', '13:30 plus three real hours must project to 16:30 despite a stale stored end.');
requireCondition(staleMoved.scheduledSlotCount === 3, 'The recovered moved appointment must preserve its capacity/history slot count.');

// Continuous-time regression: six real work hours beginning at 08:30 end at 14:30.
// Lunch is not a sellable start but does not add a synthetic hour to the appointment.
const commercialWorkOrders = [{
  ...canonicalWorkOrders[0],
  id: 'WO-APT-COMMERCIAL-1-1',
  appointmentId: 'APT-COMMERCIAL-1',
  serviceId: '',
  date: '2026-08-21',
  appointmentPresetId: 'commercial_service',
  appointmentWorkType: 'commercial_service',
  appointmentWorkLabel: 'Commercial Service',
  airConditionerCount: 2,
  appointmentDurationMinutes: 360,
  scheduledSlots: 6,
  appointmentWorkItems: [{
    id: 'commercial-work',
    presetId: 'commercial_service',
    label: 'Commercial Service',
    quantity: 2,
    durationMinutes: 360,
    durationMinutesPerUnit: 180,
    durationMode: 'per_unit',
  }],
  problem: 'Commercial Service × 2.',
}];
const commercialAppointments = projectLiveSchedulingAppointments(commercialWorkOrders, clients, properties);
const commercial = commercialAppointments[0];
requireCondition(Boolean(commercial), 'Commercial Service work order must project into Live Scheduling.');
requireCondition(commercial.workTypeId === 'commercial_service', 'Live Scheduling must preserve the operational Commercial Service identity instead of coercing it to Other.');
requireCondition(commercial.workLabel === 'Commercial Service', 'Live Scheduling must display the Work Order label snapshot.');
requireCondition(commercial.durationMinutesPerUnit === 180, 'Commercial Service must retain its three-hour per-unit snapshot.');
requireCondition(commercial.scheduledDurationMinutes === 360, 'Two Commercial Services must retain six total work hours.');
requireCondition(commercial.scheduledSlotCount === 6, 'Legacy scheduledSlots remains available as capacity/history metadata.');
requireCondition(commercial.assignments[0].start === '08:30' && commercial.assignments[0].end === '14:30', 'Six real hours starting at 08:30 must end at 14:30 without adding a synthetic lunch hour.');
requireCondition(commercial.propertyAddress === 'Santa Cruz 54 C, local 1', 'Live appointment details must expose canonical property address without a duplicate appointment copy.');
requireCondition(commercial.customerWhatsapp === '+2975550000', 'Live appointment details must expose canonical CRM WhatsApp contact.');

const operationalDay = buildOperationalWeek(canonical.dateKey).find((day) => day.dateKey === canonical.dateKey);
requireCondition(Boolean(operationalDay), 'The live appointment date must resolve to an operational day.');

const baseCapacity: LiveOperationalCapacityState = {
  vans: new Map([
    ['VAN-1', { id: 'VAN-1', active: true, status: '', responsibleStaffId: 'STAFF-TECH-1', regularHelperId: 'STAFF-HELPER-1' }],
    ['VAN-2', { id: 'VAN-2', active: true, status: '' }],
    ['VAN-3', { id: 'VAN-3', active: true, status: '' }],
    ['VAN-4', { id: 'VAN-4', active: true, status: '' }],
  ]),
  staffProfiles: [
    { id: 'STAFF-TECH-1', name: 'Miguel Technician', active: true },
    { id: 'STAFF-HELPER-1', name: 'Rafael Helper', active: true },
    { id: 'STAFF-TECH-OVERRIDE', name: 'Daily Technician', active: true },
  ],
  dailyAssignments: [],
  halfDaySchedules: [],
  calendarClosures: [],
  closedWeekdays: [0],
};

const octoberWeek = buildOperationalWeek('2026-10-03');
const saturday = octoberWeek.find((day) => day.dateKey === '2026-10-03');
const sunday = octoberWeek.find((day) => day.dateKey === '2026-10-04');
requireCondition(Boolean(saturday) && saturday!.isOpen, 'Saturday must remain a normal open operating day.');
requireCondition(saturday!.shiftLabel === '8:00 AM–5:00 PM', 'Saturday must display the configured normal full-day shift instead of a global 1 PM close.');
requireCondition(Boolean(sunday) && !sunday!.isOpen, 'Sunday must remain the global closed day.');
const saturdayRequest = {
  customer: 'Saturday Customer',
  site: 'Saturday Property',
  sector: 'Santa Cruz',
  presetId: 'standard_service' as const,
  quantity: 1,
  restriction: { halfDay: 'pm' as const },
};
const saturdayCandidates = findCandidateSlotsForDay(saturday!, saturdayRequest, []);
requireCondition(saturdayCandidates.length > 0 && saturdayCandidates.every((slot) => ['13:30', '14:30', '15:30'].includes(slot.start)), 'Saturday PM requests must use the normal afternoon work starts.');
requireCondition(findCandidateSlotsForDay(sunday!, saturdayRequest, []).length === 0, 'Sunday must not expose candidate work capacity.');
const saturdayHalfDayCapacity: LiveOperationalCapacityState = {
  ...baseCapacity,
  halfDaySchedules: [{
    id: 'HALF-SAT-VAN2',
    active: true,
    vanId: 'VAN-2',
    weekday: 6,
    workdayStart: '08:00',
    workdayEnd: '13:00',
  }],
};
requireCondition(liveOperationalWindowAllows(saturdayHalfDayCapacity, 'VAN-1', '2026-10-03', '13:30', '14:30'), 'A van without a Saturday exception must keep normal afternoon capacity.');
requireCondition(!liveOperationalWindowAllows(saturdayHalfDayCapacity, 'VAN-2', '2026-10-03', '13:30', '14:30'), 'Only the van explicitly configured for a Saturday half-day may close after 1 PM.');

const regularCrew = liveVanCrew(baseCapacity, 'VAN-1', canonical.dateKey);
requireCondition(regularCrew.label === 'Miguel Technician · Rafael Helper', 'Live van headers must show the regular technician first and helper second.');
const dailyCrewCapacity: LiveOperationalCapacityState = {
  ...baseCapacity,
  dailyAssignments: [{
    id: 'DAILY-CREW-VAN1',
    date: canonical.dateKey,
    vanId: 'VAN-1',
    driverStaffId: 'STAFF-TECH-OVERRIDE',
    helperStaffId: 'STAFF-HELPER-1',
  }],
};
requireCondition(liveVanCrew(dailyCrewCapacity, 'VAN-1', canonical.dateKey).label === 'Daily Technician · Rafael Helper', 'A daily crew override must replace the regular technician without changing the helper ordering.');

const dragCandidates = liveDragMoveCandidates(operationalDay!, canonical, canonical.assignments, baseCapacity);
requireCondition(dragCandidates.length > 0, 'A single-van appointment must expose same-day drag targets.');
requireCondition(dragCandidates.some((slot) => slot.start === '09:30'), 'Past wall-clock time must not hide a physically open manual destination.');
requireCondition(dragCandidates.some((slot) => slot.start === '10:30' && slot.end === '12:30'), 'A two-hour block must be allowed at 10:30 because lunch is not a hard conflict.');
requireCondition(dragCandidates.every((slot) => slot.start !== '15:30'), 'A two-hour block must not be offered at 15:30 because it exceeds the operating-day end.');

const target = dragCandidates.find((slot) => slot.vanId !== canonical.primaryVanId) ?? dragCandidates[0];
requireCondition(Boolean(target), 'A valid target must exist for committed projection coverage.');
requireCondition(liveMoveTargetKey(target.vanId, target.start) === `${target.vanId}|${target.start}`, 'Move target keys must be deterministic.');
const projectedMove = projectCommittedLiveMove({
  appointment: canonical,
  slot: target,
  dateKey: canonical.dateKey,
  actor: { id: 'user-office', name: 'Office User' },
});
requireCondition(projectedMove.record.primaryVanId === target.vanId, 'Committed move projection must update the destination van immediately.');
requireCondition(projectedMove.record.assignments[0].start === target.start, 'Committed move projection must update the destination time immediately.');

const halfDayCapacity: LiveOperationalCapacityState = {
  ...baseCapacity,
  halfDaySchedules: [{
    id: 'HALF-TUE-VAN2',
    active: true,
    vanId: 'VAN-2',
    weekday: 2,
    workdayStart: '08:00',
    workdayEnd: '13:00',
    extraMorningSlot: '11:30',
  }],
};
requireCondition(liveVanIsHalfDay(halfDayCapacity, 'VAN-2', canonical.dateKey), 'Tuesday must resolve as Van 2 weekly half-day.');
requireCondition(liveOperationalWindowAllows(halfDayCapacity, 'VAN-2', canonical.dateKey, '11:30', '12:30'), 'The canonical extra 11:30 half-day slot must remain available when a one-hour appointment fits.');
requireCondition(!liveOperationalWindowAllows(halfDayCapacity, 'VAN-2', canonical.dateKey, '13:30', '14:30'), 'Van 2 afternoon must be closed on its Tuesday half-day.');

function appointmentAt(id: string, customer: string, vanId: string, start: string, end: string, quantity: number) {
  return {
    ...canonical,
    id,
    customer,
    primaryVanId: vanId,
    totalQuantity: quantity,
    scheduledDurationMinutes: Math.max(1, Math.round((new Date(`1970-01-01T${end}:00Z`).getTime() - new Date(`1970-01-01T${start}:00Z`).getTime()) / 60_000)),
    scheduledSlotCount: Math.max(1, Math.ceil((new Date(`1970-01-01T${end}:00Z`).getTime() - new Date(`1970-01-01T${start}:00Z`).getTime()) / 3_600_000)),
    assignments: canonical.assignments.map((assignment) => ({
      ...assignment,
      id: `${id}-PRIMARY`,
      customer,
      vanId,
      start,
      end,
      quantity,
    })),
  };
}

const christianPm = appointmentAt('APT-CHRISTIAN-PM', 'Christian', 'VAN-3', '13:30', '15:30', 2);
const maribelVan1Am = appointmentAt('APT-MARIBEL-V1-AM', 'Maribel Marquez', 'VAN-1', '08:30', '11:30', 3);
const maribelVan1Pm = appointmentAt('APT-MARIBEL-V1-PM', 'Maribel Marquez', 'VAN-1', '13:30', '16:30', 3);
const maribelVan4Pm = appointmentAt('APT-MARIBEL-V4-PM', 'Maribel Marquez', 'VAN-4', '13:30', '16:30', 3);
const screenshotJobs = [
  ...christianPm.assignments,
  ...maribelVan1Am.assignments,
  ...maribelVan1Pm.assignments,
  ...maribelVan4Pm.assignments,
];

const christianTargets = new Set(liveDragMoveCandidates(operationalDay!, christianPm, screenshotJobs, halfDayCapacity).map((slot) => liveMoveTargetKey(slot.vanId, slot.start)));
requireCondition(christianTargets.has('VAN-2|08:30'), 'A two-hour appointment must still fit Van 2 Tuesday morning when capacity is open.');
requireCondition(!christianTargets.has('VAN-2|13:30') && !christianTargets.has('VAN-2|14:30'), 'Van 2 Tuesday afternoon must not be offered as a drag target because its canonical half-day ends at 1 PM.');

const oneHour = appointmentAt('APT-ONE-HOUR', 'Quick Visit', 'VAN-3', '13:30', '14:30', 1);
const oneHourTargets = new Set(liveDragMoveCandidates(operationalDay!, oneHour, oneHour.assignments, halfDayCapacity).map((slot) => liveMoveTargetKey(slot.vanId, slot.start)));
requireCondition(oneHourTargets.has('VAN-2|11:30'), 'A one-hour appointment must be able to use Van 2 canonical 11:30 extra morning slot.');
requireCondition(!oneHourTargets.has('VAN-2|13:30'), 'A one-hour appointment must not be offered Van 2 after the 1 PM half-day cutoff.');

const maintenanceCapacity: LiveOperationalCapacityState = {
  ...baseCapacity,
  vans: new Map(baseCapacity.vans),
  dailyAssignments: [{ id: 'TUE-VAN2', date: canonical.dateKey, vanId: 'VAN-2', status: 'Mantenimiento' }],
};
const maintenanceTargets = new Set(liveDragMoveCandidates(operationalDay!, christianPm, screenshotJobs, maintenanceCapacity).map((slot) => liveMoveTargetKey(slot.vanId, slot.start)));
requireCondition(![...maintenanceTargets].some((key) => key.startsWith('VAN-2|')), 'A van in maintenance must not be exposed as a drag target that Booking Authority will reject.');

const closedDateCapacity: LiveOperationalCapacityState = {
  ...baseCapacity,
  calendarClosures: [{ id: 'CLOSED-AUG18', active: true, date: canonical.dateKey, reason: 'Company closed' }],
};
requireCondition(liveDragMoveCandidates(operationalDay!, christianPm, screenshotJobs, closedDateCapacity).length === 0, 'A canonical company closure must remove all manual drag destinations for that date.');

const realVan2ConflictJobs = [
  ...screenshotJobs,
  { ...canonical.assignments[0], id: 'WO-REAL-VAN2-AM', customer: 'Other Customer', vanId: 'VAN-2', start: '08:30', end: '09:30' },
];
const conflictTargets = new Set(liveDragMoveCandidates(operationalDay!, christianPm, realVan2ConflictJobs, halfDayCapacity).map((slot) => liveMoveTargetKey(slot.vanId, slot.start)));
requireCondition(!conflictTargets.has('VAN-2|08:30'), 'A real visible Van 2 overlap must still block manual drag inside otherwise open half-day capacity.');

const supportWorkOrders = [
  canonicalWorkOrders[0],
  {
    ...canonicalWorkOrders[0],
    id: 'WO-APT-CANONICAL-1-2',
    vanId: 'VAN-2',
    appointmentAssignmentRole: 'support',
    parentWorkOrderId: 'WO-APT-CANONICAL-1-1',
    airConditionerCount: 1,
    appointmentDurationMinutes: 60,
    scheduledSlots: 1,
  },
];
const supportedAppointments = projectLiveSchedulingAppointments(supportWorkOrders, clients, properties);
requireCondition(supportedAppointments[0].assignments.length === 2, 'Primary and support work orders must remain linked as one appointment.');
requireCondition(liveDragMoveCandidates(operationalDay!, supportedAppointments[0], supportedAppointments[0].assignments, baseCapacity).length === 0, 'Multi-van bookings must not enter simple drag.');

const fleetRecords = [
  { id: 'v4', name: 'Van 4', active: true },
  { id: 'van-1783800405341', name: 'Van 4', active: true },
];
requireCondition(resolveCanonicalVanId('v4', fleetRecords) === 'VAN-4', 'Short van aliases must resolve to canonical Van 4.');
requireCondition(resolveCanonicalVanId('van-1783800405341', fleetRecords) === 'VAN-4', 'Legacy duplicate van documents must resolve to one physical lane.');

console.log('Live scheduling acceptance passed: canonical duration drives elapsed work time while scheduled slot ownership drives capacity; flexible lunch, per-Van after-hours targeting, full-card booking, full-day Saturdays, half-days, closures and communication ownership remain protected.');
