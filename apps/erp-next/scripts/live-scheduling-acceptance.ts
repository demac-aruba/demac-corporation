import type { LiveOperationalCapacityState } from '../lib/live-operational-capacity';
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

const dragCandidates = liveDragMoveCandidates(operationalDay!, canonical, canonical.assignments);
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

const hiddenMetadata: LiveOperationalCapacityState = {
  vans: new Map([
    ['VAN-1', { id: 'VAN-1', active: true, status: '' }],
    ['VAN-2', { id: 'VAN-2', active: true, status: 'Mantenimiento' }],
    ['VAN-3', { id: 'VAN-3', active: true, status: '' }],
    ['VAN-4', { id: 'VAN-4', active: true, status: '' }],
  ]),
  dailyAssignments: [{ id: 'TUE-VAN2', date: canonical.dateKey, vanId: 'VAN-2', status: 'Mantenimiento' }],
  halfDaySchedules: [{ id: 'HALF-TUE-VAN2', active: true, vanId: 'VAN-2', weekday: 2 }],
};

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

// Exact regression for the Aug 18 screenshots: Van 2 afternoon is visually empty.
// Manual drag must never remove it because of half-day, maintenance, staffing or routing metadata.
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

const christianTargets = new Set(liveDragMoveCandidates(operationalDay!, christianPm, screenshotJobs, hiddenMetadata).map((slot) => liveMoveTargetKey(slot.vanId, slot.start)));
requireCondition(christianTargets.has('VAN-2|13:30'), 'Christian 2-hour appointment must be movable to empty Van 2 at 1:30 PM.');
requireCondition(christianTargets.has('VAN-2|14:30'), 'Christian 2-hour appointment must be movable to empty Van 2 at 2:30 PM.');

const maribelV4Targets = new Set(liveDragMoveCandidates(operationalDay!, maribelVan4Pm, screenshotJobs, hiddenMetadata).map((slot) => liveMoveTargetKey(slot.vanId, slot.start)));
requireCondition(maribelV4Targets.has('VAN-2|13:30'), 'Maribel 3-hour Van 4 appointment must be movable to empty Van 2 at 1:30 PM.');
requireCondition(!maribelV4Targets.has('VAN-2|14:30'), 'A 3-hour appointment must not start at 2:30 PM because it would exceed the visible day capacity.');

const maribelV1Targets = new Set(liveDragMoveCandidates(operationalDay!, maribelVan1Pm, screenshotJobs, hiddenMetadata).map((slot) => liveMoveTargetKey(slot.vanId, slot.start)));
requireCondition(maribelV1Targets.has('VAN-2|13:30'), 'Maribel 3-hour Van 1 appointment must be movable to empty Van 2 at 1:30 PM.');

const realVan2ConflictJobs = [
  ...screenshotJobs,
  { ...canonical.assignments[0], id: 'WO-REAL-VAN2-PM', customer: 'Other Customer', vanId: 'VAN-2', start: '14:30', end: '15:30' },
];
const conflictTargets = new Set(liveDragMoveCandidates(operationalDay!, christianPm, realVan2ConflictJobs, hiddenMetadata).map((slot) => liveMoveTargetKey(slot.vanId, slot.start)));
requireCondition(!conflictTargets.has('VAN-2|13:30') && !conflictTargets.has('VAN-2|14:30'), 'A real visible Van 2 overlap must still block manual drag.');

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
requireCondition(liveDragMoveCandidates(operationalDay!, supportedAppointments[0], supportedAppointments[0].assignments).length === 0, 'Multi-van bookings must not enter simple drag.');

const fleetRecords = [
  { id: 'v4', name: 'Van 4', active: true },
  { id: 'van-1783800405341', name: 'Van 4', active: true },
];
requireCondition(resolveCanonicalVanId('v4', fleetRecords) === 'VAN-4', 'Short van aliases must resolve to canonical Van 4.');
requireCondition(resolveCanonicalVanId('van-1783800405341', fleetRecords) === 'VAN-4', 'Legacy duplicate van documents must resolve to one physical lane.');

console.log('Live scheduling acceptance passed: manual drag uses one rule—visible free same-day capacity for the complete canonical appointment block.');
