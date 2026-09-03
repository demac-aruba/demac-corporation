import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { FieldScheduleJob, FieldVisitStatus } from '../lib/field-authority-contract';
import {
  FIELD_EXPERIENCE_STAGES,
  fieldExperienceStageForJob,
  fieldExperienceStageForStatus,
  fieldExperienceStepState,
  fieldRouteWithoutNextJob,
  isFieldJobCompleted,
  isFieldJobInProgress,
  selectNextFieldJob,
} from '../lib/field-ui-flow';

function job(
  id: string,
  time: string,
  status = 'Confirmada',
  visitStatus?: FieldVisitStatus,
): FieldScheduleJob {
  return {
    id,
    workOrderId: id,
    appointmentId: `appointment-${id}`,
    date: '2026-09-03',
    time,
    status,
    customerId: `customer-${id}`,
    customerName: `Cliente ${id}`,
    propertyId: `property-${id}`,
    address: `Dirección ${id}`,
    plannedWork: [],
    estimatedQuantity: 1,
    vanId: 'VAN-1',
    responsibility: 'lead',
    assignmentSource: 'daily_assignment',
    allowedActions: ['read'],
    fieldVisit: visitStatus ? {
      id: `visit-${id}`,
      appointmentId: `appointment-${id}`,
      workOrderId: id,
      customerId: `customer-${id}`,
      propertyId: `property-${id}`,
      scheduledScopeSnapshot: {
        appointmentId: `appointment-${id}`,
        capturedAt: '2026-09-03T08:00:00.000Z',
        estimatedUnitCount: 1,
        workLines: [],
      },
      status: visitStatus,
      participatingStaffIds: ['staff-1'],
      requiresSecondVisit: false,
      createdAt: '2026-09-03T08:00:00.000Z',
      createdBy: 'staff-1',
      updatedAt: '2026-09-03T08:00:00.000Z',
      updatedBy: 'staff-1',
      version: 1,
      availableTransitions: [],
    } : null,
    canPrepareVisit: !visitStatus,
    canCreateReturnVisit: false,
  };
}

assert.deepEqual(
  FIELD_EXPERIENCE_STAGES.map((step) => [step.id, step.label]),
  [['arrival', 'Llegada'], ['service', 'Servicio'], ['close', 'Cierre']],
  'the technician experience exposes exactly three visual steps',
);

for (const status of ['scheduled', 'en_route', 'on_site'] as const) {
  assert.equal(fieldExperienceStageForStatus(status), 'arrival');
}
for (const status of ['in_progress', 'pending', 'requires_return_visit'] as const) {
  assert.equal(fieldExperienceStageForStatus(status), 'service');
}
for (const status of ['ready_for_office_review', 'completed', 'no_access', 'cancelled'] as const) {
  assert.equal(fieldExperienceStageForStatus(status), 'close');
}
assert.equal(fieldExperienceStageForJob(job('legacy-progress', '09:00', 'En proceso')), 'service');
assert.equal(fieldExperienceStageForJob(job('legacy-complete', '09:00', 'Completada')), 'close');
assert.equal(fieldExperienceStepState('arrival', 'service'), 'complete');
assert.equal(fieldExperienceStepState('service', 'service'), 'current');
assert.equal(fieldExperienceStepState('close', 'service'), 'upcoming');

const completed = job('completed', '08:00', 'Completada', 'completed');
const upcoming = job('upcoming', '11:00');
const later = job('later', '14:00');
const active = job('active', '09:00', 'En proceso', 'in_progress');
const todayJobs = [completed, upcoming, active, later];

assert.equal(isFieldJobCompleted(completed), true);
assert.equal(isFieldJobInProgress(active), true);
assert.equal(selectNextFieldJob(todayJobs, '10:00')?.id, 'active', 'an active job wins over a later appointment');
assert.equal(selectNextFieldJob([completed, upcoming, later], '10:00')?.id, 'upcoming', 'the next future appointment is selected');
assert.equal(selectNextFieldJob([completed], '10:00'), null, 'completed work is not highlighted as next');
assert.deepEqual(
  fieldRouteWithoutNextJob(todayJobs, active).map((item) => item.id),
  ['completed', 'upcoming', 'later'],
  'the highlighted job is excluded from the remaining route without dropping completed history',
);
assert.deepEqual(todayJobs.map((item) => item.id), ['completed', 'upcoming', 'active', 'later'], 'helpers do not mutate the schedule');

const homeSource = readFileSync('components/field/technician-field-home.tsx', 'utf8');
const simulatorSource = readFileSync('components/field/field-admin-simulator.tsx', 'utf8');
assert.match(homeSource, /Solo hoy/, 'the route explicitly communicates the current-day boundary');
assert.doesNotMatch(homeSource, /Mañana|Semana/, 'the technician home does not expose future-day navigation');
assert.doesNotMatch(simulatorSource, /Todas las Vans/i, 'the temporary selector never offers an all-Vans identity');

console.log('Field technician experience acceptance passed.');
