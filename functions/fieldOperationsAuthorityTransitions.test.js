const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertWorkVisitTransition,
  transitionCanonicalWorkVisit,
} = require('./fieldOperationsAuthorityTransitions');

function visit(status = 'scheduled', overrides = {}) {
  return {
    id: 'visit-WO-1',
    workOrderId: 'WO-1',
    appointmentId: 'APT-1',
    customerId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    status,
    participatingStaffIds: ['staff-tech'],
    requiresSecondVisit: false,
    ...overrides,
  };
}

const t1 = '2026-08-24T18:00:00.000-04:00';
const t2 = '2026-08-24T18:15:00.000-04:00';
const t3 = '2026-08-24T18:30:00.000-04:00';

test('scheduled visit progresses through en route, on site and in progress with first timestamps', () => {
  const enRoute = transitionCanonicalWorkVisit({ visit: visit(), to: 'en_route', at: t1 });
  assert.equal(enRoute.changed, true);
  assert.equal(enRoute.next.status, 'en_route');
  assert.equal(enRoute.next.departedAt, t1);

  const onSite = transitionCanonicalWorkVisit({ visit: enRoute.next, to: 'on_site', at: t2 });
  assert.equal(onSite.next.status, 'on_site');
  assert.equal(onSite.next.arrivedAt, t2);

  const inProgress = transitionCanonicalWorkVisit({ visit: onSite.next, to: 'in_progress', at: t3 });
  assert.equal(inProgress.next.status, 'in_progress');
  assert.equal(inProgress.next.startedAt, t3);
  assert.equal(inProgress.next.departedAt, t1);
  assert.equal(inProgress.next.arrivedAt, t2);
});

test('retrying the same status is an idempotent no-op', () => {
  const current = visit('en_route', { departedAt: t1 });
  const result = transitionCanonicalWorkVisit({ visit: current, to: 'en_route', at: t2 });
  assert.equal(result.changed, false);
  assert.equal(result.next, current);
  assert.equal(result.next.departedAt, t1);
});

test('return-visit branch marks second visit requirement without inventing a reason', () => {
  const result = transitionCanonicalWorkVisit({ visit: visit('in_progress'), to: 'requires_return_visit', at: t2 });
  assert.equal(result.next.status, 'requires_return_visit');
  assert.equal(result.next.requiresSecondVisit, true);
  assert.equal(result.next.secondVisitReason, undefined);
});

test('Office Review submission and completion timestamps are transition-owned', () => {
  const submitted = transitionCanonicalWorkVisit({ visit: visit('in_progress'), to: 'ready_for_office_review', at: t2 });
  assert.equal(submitted.next.submittedAt, t2);
  const completed = transitionCanonicalWorkVisit({ visit: submitted.next, to: 'completed', at: t3 });
  assert.equal(completed.next.completedAt, t3);
});

test('pending visit can resume without replacing its original started timestamp', () => {
  const current = visit('pending', { startedAt: t1 });
  const resumed = transitionCanonicalWorkVisit({ visit: current, to: 'in_progress', at: t3 });
  assert.equal(resumed.next.startedAt, t1);
});

test('allowed branch decisions remain server-owned and explicit', () => {
  assert.deepEqual(assertWorkVisitTransition('scheduled', 'en_route'), { current: 'scheduled', next: 'en_route', noop: false });
  assert.deepEqual(assertWorkVisitTransition('scheduled', 'scheduled'), { current: 'scheduled', next: 'scheduled', noop: true });
});

test('arbitrary or terminal transitions fail closed', () => {
  assert.throws(() => assertWorkVisitTransition('scheduled', 'completed'), /scheduled -> completed/);
  assert.throws(() => assertWorkVisitTransition('completed', 'in_progress'), /completed -> in_progress/);
  assert.throws(() => assertWorkVisitTransition('unknown', 'scheduled'), /Unknown Work Visit status/);
  assert.throws(() => transitionCanonicalWorkVisit({ visit: visit(), to: 'en_route', at: '' }), /timestamp is required/);
});