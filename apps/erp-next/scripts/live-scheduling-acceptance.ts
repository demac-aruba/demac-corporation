import { projectLiveSchedulingAppointments } from '../lib/live-scheduling';

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

const canonicalAppointments = projectLiveSchedulingAppointments(canonicalWorkOrders, clients, properties);
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

console.log('Live scheduling acceptance passed: canonical Booking Authority fields project correctly without breaking legacy records.');