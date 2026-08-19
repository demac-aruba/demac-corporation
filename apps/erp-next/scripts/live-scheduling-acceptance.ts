import {
  liveOperationalWindowAllows,
  liveVanIsHalfDay,
  type LiveOperationalCapacityState,
} from '../lib/live-operational-capacity';
import { bookingActorLabel, projectLiveSchedulingAppointments, resolveCanonicalVanId } from '../lib/live-scheduling';
import {
  liveDragMoveCandidates,
  liveMoveTargetKey,
  projectCommittedLiveMove,
} from '../lib/live-scheduling-move';
import { buildOperationalWeek } from '../lib/scheduling-capacity';

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
    appointmentAssignmentRole: 'primary',
    airConditionerCount: 2,
    appointmentDurationMinutes: 120,
    problem: 'Servicio estándar para 2 aires acondicionados.',
    zone: 'Santa Cruz',
    confirmedAt: '2026-08-17T20:49:00.000Z',
    createdAt: '2026-08-17T20:49:00.000Z',
    updatedAt: '2026-08-17T20:49:00.000Z',
  },
];

const clients = [
  { id: 'CLIENT-STAR-MEDIA', name: 'Christian', company: 'Star Media DirecTV' },
];

const properties = [
  { id: 'PROPERTY-STAR-MEDIA', name: 'Star Media Office', address: 'Santa Cruz 54 C, local 1', operationalZone: 'Santa Cruz' },
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
requireCondition(canonical.assignments[0].end === '10:30', 'Canonical appointment duration must be preserved.');
requireCondition(canonical.bookedByName === 'Christian', 'Canonical booking operator must be preserved.');
requireCondition(bookingActorLabel({ appointmentId: 'APT-MAYA', source: 'demac-customer-agent' }) === 'Maya', 'Customer Agent bookings must display Maya.');

const operationalDay = buildOperationalWeek(canonical.dateKey).find((day) => day.dateKey === canonical.dateKey);
requireCondition(Boolean(operationalDay), 'The live appointment date must resolve to an operational day.');

const baseCapacity: LiveOperationalCapacityState = {
  vans: new Map([
    ['VAN-1', { id: 'VAN-1', active: true, status: '' }],
    ['VAN-2', { id: 'VAN-2', active: true, status: '' }],
    ['VAN-3', { id: 'VAN-3', active: true, status: '' }],
    ['VAN-4', { id: 'VAN-4', active: true, status: '' }],
  ]),
  dailyAssignments: [],
  halfDaySchedules: [],
  calendarClosures: [],
  closedWeekdays: [0],
};

const dragCandidates = liveDragMoveCandidates(operationalDay!, canonical, canonical.assignments, baseCapacity);
requireCondition(dragCandidates.length > 0, 'A single-van appointment must expose same-day drag targets.');
requireCondition(dragCandidates.some((slot) => slot.start === '09:30'), 'Past wall-clock time must not hide a physically open manual destination.');
requireCondition(dragCandidates.every((slot) => slot.start !== '10:30' && slot.start !== '15:30'), 'A two-hour block must not be offered where it cannot fit continuously before lunch or day end.');

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

// Exact business-rule regression for Aug 18: Van 2 works Tuesday morning and is off after 1 PM.
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

console.log('Live scheduling acceptance passed: agenda and drag targets share canonical van half-days, closures and hard operational capacity while preserving same-day manual scheduling flexibility inside those windows.');
