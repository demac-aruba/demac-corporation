import assert from 'node:assert/strict';
import type { FieldScheduleJob, FieldVisitStatus } from '../lib/field-authority-contract';
import {
  fieldRouteWithoutNextJob,
  isFieldJobCompleted,
  selectNextFieldJob,
} from '../lib/field-ui-flow';

// Synthetic unit-test records; no API, browser session, or production data is used.
function job(id: string, time: string, status = 'Confirmada', visitStatus?: FieldVisitStatus): FieldScheduleJob {
  return {
    id, workOrderId: id, appointmentId: `appointment-${id}`,
    date: '2026-09-23', time, status,
    customerId: `synthetic-customer-${id}`, customerName: `Synthetic ${id}`,
    propertyId: `synthetic-property-${id}`, address: 'Synthetic test address',
    plannedWork: [], estimatedQuantity: 1, vanId: 'synthetic-van',
    responsibility: 'lead', assignmentSource: 'daily_assignment', allowedActions: ['read'],
    fieldVisit: visitStatus ? {
      id: `visit-${id}`, appointmentId: `appointment-${id}`, workOrderId: id,
      customerId: `synthetic-customer-${id}`, propertyId: `synthetic-property-${id}`,
      scheduledScopeSnapshot: {
        appointmentId: `appointment-${id}`, capturedAt: '2026-09-23T12:00:00.000Z',
        estimatedUnitCount: 1, workLines: [],
      },
      status: visitStatus, participatingStaffIds: ['synthetic-staff'], requiresSecondVisit: false,
      createdAt: '2026-09-23T12:00:00.000Z', createdBy: 'synthetic-staff',
      updatedAt: '2026-09-23T12:00:00.000Z', updatedBy: 'synthetic-staff',
      version: 1, availableTransitions: [],
    } : null,
    canPrepareVisit: !visitStatus, canCreateReturnVisit: false,
  };
}

let passed = 0;
function check(name: string, assertion: () => void) {
  try { assertion(); passed += 1; }
  catch (error) { throw new Error(`Field route regression: ${name}`, { cause: error }); }
}

for (const status of [
  'scheduled', 'en_route', 'on_site', 'in_progress', 'pending', 'requires_return_visit',
  'ready_for_office_review', 'no_access', 'cancelled',
] as const) {
  check(`canonical ${status} is not completed by a stale appointment label`, () => {
    assert.equal(isFieldJobCompleted(job(status, '09:00', 'Completada', status)), false);
  });
}
check('canonical completed survives a stale appointment label', () => {
  assert.equal(isFieldJobCompleted(job('done', '09:00', 'Confirmada', 'completed')), true);
});
check('legacy completion fallback remains available without a Field visit', () => {
  assert.equal(isFieldJobCompleted(job('legacy-done', '09:00', 'Completada')), true);
  assert.equal(isFieldJobCompleted(job('legacy-open', '09:00')), false);
});

const early = job('early', '09:00');
const upcoming = job('upcoming', '11:00');
const later = job('later', '14:00');
const active = job('active', '08:00', 'En proceso', 'in_progress');
const completed = job('completed', '08:00', 'Completada', 'completed');
check('earliest future appointment wins regardless of response order', () => {
  assert.equal(selectNextFieldJob([later, upcoming, early], '10:00'), upcoming);
});
check('earliest past appointment is fallback when none remain in the future', () => {
  assert.equal(selectNextFieldJob([later, early, upcoming], '18:00'), early);
});
check('existing future-before-past fallback policy is preserved', () => {
  assert.equal(selectNextFieldJob([early, upcoming], '10:00'), upcoming);
});
check('active job wins over chronological sorting', () => {
  assert.equal(selectNextFieldJob([upcoming, later, active], '10:00'), active);
});
check('multiple active jobs preserve server response priority', () => {
  const secondActive = job('second-active', '07:00', 'En proceso', 'in_progress');
  assert.equal(selectNextFieldJob([active, secondActive], '10:00'), active);
});
check('ties preserve server response order', () => {
  const sameTime = job('same-time', '11:00');
  assert.equal(selectNextFieldJob([upcoming, sameTime], '10:00'), upcoming);
  assert.equal(selectNextFieldJob([sameTime, upcoming], '10:00'), sameTime);
});
check('missing time cannot outrank a valid appointment', () => {
  assert.equal(selectNextFieldJob([job('untimed', ''), upcoming], '10:00'), upcoming);
});
check('all missing times preserve order without inventing a time', () => {
  const first = job('first-untimed', '');
  assert.equal(selectNextFieldJob([first, job('second-untimed', '')], '10:00'), first);
});
check('single-digit legacy hour compares numerically', () => {
  const nine = job('legacy-nine', '9:00');
  assert.equal(selectNextFieldJob([upcoming, nine], '08:00'), nine);
});
check('single-digit current hour compares numerically', () => {
  assert.equal(selectNextFieldJob([later, upcoming], '9:30'), upcoming);
});
for (const time of ['24:00', '12:60', 'invalid', '10:30 AM', '10:00:30']) {
  check(`unsupported time ${time} does not become a fabricated appointment time`, () => {
    assert.equal(selectNextFieldJob([job('invalid-time', time), upcoming], '10:00'), upcoming);
  });
}
check('surrounding whitespace does not alter the selected job', () => {
  const padded = job('padded', ' 09:00 ');
  assert.equal(selectNextFieldJob([upcoming, padded], ' 08:00 '), padded);
});
check('appointment exactly at the current time is eligible', () => {
  assert.equal(selectNextFieldJob([later, upcoming], '11:00'), upcoming);
});
check('invalid current time uses chronological fallback without inventing now', () => {
  assert.equal(selectNextFieldJob([later, early], 'invalid'), early);
});
check('closed work and an empty route do not produce a next job', () => {
  assert.equal(selectNextFieldJob([], '10:00'), null);
  assert.equal(selectNextFieldJob([
    completed, job('cancelled', '11:00', 'Confirmada', 'cancelled'),
    job('no-access', '12:00', 'Confirmada', 'no_access'),
  ], '10:00'), null);
});
check('canonical active visit remains next despite a stale completed label', () => {
  const conflicting = job('stale-status', '09:00', 'Completada', 'in_progress');
  assert.equal(selectNextFieldJob([upcoming, conflicting], '10:00'), conflicting);
  assert.equal(isFieldJobCompleted(conflicting), false);
});
check('selection does not mutate input records or reorder the displayed route', () => {
  const jobs = Object.freeze([Object.freeze(later), Object.freeze(upcoming), Object.freeze(completed)]);
  const before = JSON.stringify(jobs);
  assert.equal(selectNextFieldJob(jobs, '10:00'), upcoming);
  assert.equal(JSON.stringify(jobs), before);
  assert.deepEqual(fieldRouteWithoutNextJob(jobs, upcoming), [later, completed]);
});
console.log(`Field route selection acceptance passed (${passed} cases).`);
