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
requireCondition(canonical.presetId === 'standard_service', 'Canonical appointmentPresetId must drive the displayed preset.');
requireCondition(canonical.totalQuantity === 2, 'Canonical airConditionerCount must drive appointment quantity.');
requireCondition(canonical.customer === 'Christian', 'Canonical clientId must resolve the customer label.');
requireCondition(canonical.site === 'Star Media Office', 'Canonical propertyId must resolve the site label.');
requireCondition(canonical.assignments[0].start === '08:30', 'Canonical start time must be preserved.');
requireCondition(canonical.assignments[0].end === '10:30', 'Canonical appointmentDurationMinutes must preserve the full occupied window.');
requireCondition(canonical.bookedByName === 'Christian', 'Canonical createdByName must be shown as the booking operator.');
requireCondition(canonical.bookedBySource === 'office-scheduling', 'Canonical booking source must be preserved.');
requireCondition(bookingActorLabel({ appointmentId: 'APT-MAYA', source: 'demac-customer-agent' }) === 'Maya', 'Customer Agent bookings must display Maya even when an AI booking has no human createdByName.');

const operationalDay = buildOperationalWeek(canonical.dateKey).find((day) => day.dateKey === canonical.dateKey);
requireCondition(Boolean(operationalDay), 'The live appointment date must resolve to an operational day.');
const dragCandidates = liveDragMoveCandidates(operationalDay!, canonical, canonical.assignments);
requireCondition(dragCandidates.length > 0, 'A single-van live appointment must expose valid same-day drag targets.');
requireCondition(dragCandidates.every((slot) => slot.start !== '10:30' && slot.start !== '15:30'), 'Drag UI must not advertise starts that cannot fit the complete two-hour appointment.');
const target = dragCandidates.find((slot) => slot.vanId !== canonical.primaryVanId) ?? dragCandidates[0];
requireCondition(Boolean(target), 'A valid move target must be available for projection coverage.');
requireCondition(liveMoveTargetKey(target.vanId, target.start) === `${target.vanId}|${target.start}`, 'Live move target keys must be deterministic.');
const projectedMove = projectCommittedLiveMove({
  appointment: canonical,
  slot: target,
  dateKey: canonical.dateKey,
  actor: { id: 'user-office', name: 'Office User' },
});
requireCondition(projectedMove.record.primaryVanId === target.vanId, 'A server-confirmed drag must project the destination van into the board immediately.');
requireCondition(projectedMove.record.assignments[0].start === target.start, 'A server-confirmed drag must project the destination time into the board immediately.');

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
requireCondition(supportedAppointments.length === 1, 'Primary and support work orders must remain one appointment.');
requireCondition(supportedAppointments[0].supportVanId === 'VAN-2', 'Canonical support van must be recognized.');
const supportAssignment = supportedAppointments[0].assignments.find((assignment) => !assignment.isPrimaryAssignment);
requireCondition(supportAssignment?.supportForJobId === 'WO-APT-CANONICAL-1-1', 'Canonical parentWorkOrderId must link the support assignment to the primary job.');
requireCondition(liveDragMoveCandidates(operationalDay!, supportedAppointments[0], supportedAppointments[0].assignments).length === 0, 'A multi-van booking must not enter the simple drag workflow.');

const rescheduledWithStaleSupport = projectLiveSchedulingAppointments([
  canonicalWorkOrders[0],
  {
    ...canonicalWorkOrders[0],
    id: 'WO-APT-CANONICAL-1-2',
    vanId: 'VAN-2',
    appointmentAssignmentRole: 'support',
    parentWorkOrderId: 'WO-APT-CANONICAL-1-1',
    airConditionerCount: 1,
    appointmentDurationMinutes: 60,
    status: 'Cancelada',
  },
], clients, properties);
requireCondition(rescheduledWithStaleSupport[0].assignments.length === 1, 'A stale cancelled support work order must not remain in the active appointment projection.');
requireCondition(rescheduledWithStaleSupport[0].totalQuantity === 2, 'A stale cancelled support work order must not inflate the active appointment quantity.');
requireCondition(!rescheduledWithStaleSupport[0].supportVanId, 'A stale cancelled support work order must not show a support van after reschedule.');

const legacyAppointments = projectLiveSchedulingAppointments([
  {
    id: 'WO-LEGACY-1',
    appointmentId: 'APT-LEGACY-1',
    clientId: 'CLIENT-STAR-MEDIA',
    propertyId: 'PROPERTY-STAR-MEDIA',
    date: '2026-08-18',
    time: '13:30',
    status: 'Confirmada',
    van: 'VAN-3',
    presetId: 'diagnostic',
    assignmentRole: 'primary',
    quantity: 1,
    duration: 60,
  },
], clients, properties);
requireCondition(legacyAppointments.length === 1, 'Legacy scheduling records must remain readable during migration.');
requireCondition(legacyAppointments[0].primaryVanId === 'VAN-3', 'Legacy van field compatibility must be retained.');
requireCondition(legacyAppointments[0].presetId === 'diagnostic', 'Legacy presetId compatibility must be retained.');

const fleetRecords = [
  { id: 'v4', name: 'Van 4', active: true },
  { id: 'van-1783800405341', name: 'Van 4', active: true },
];
requireCondition(resolveCanonicalVanId('v4', fleetRecords) === 'VAN-4', 'Short van aliases must resolve to the canonical fleet id.');
requireCondition(resolveCanonicalVanId('van-1783800405341', fleetRecords) === 'VAN-4', 'Legacy generated van ids must resolve through their fleet record name instead of creating another visual lane.');

const duplicatedVanAppointment = projectLiveSchedulingAppointments([
  {
    ...canonicalWorkOrders[0],
    id: 'WO-APT-FLEET-ALIAS-1',
    appointmentId: 'APT-FLEET-ALIAS',
    vanId: 'van-1783800405341',
  },
], clients, properties, fleetRecords);
requireCondition(duplicatedVanAppointment.length === 1, 'A booking assigned through a legacy van document must remain visible.');
requireCondition(duplicatedVanAppointment[0].primaryVanId === 'VAN-4', 'A duplicate Van 4 document must project onto the single canonical VAN-4 lane.');

console.log('Live scheduling acceptance passed: canonical fleet lanes, valid drag targets, immediate committed move projection, creator attribution, and legacy compatibility.');
