const assert = require('node:assert/strict');
const test = require('node:test');
const { activatedVisitTransitions, projectActivatedVisit } = require('./fieldOperationsVisitActions');

test('activated transitions are projected from the canonical server graph', () => {
  assert.deepEqual(activatedVisitTransitions('scheduled', ['read', 'execute']), ['en_route', 'no_access', 'cancelled']);
  assert.deepEqual(activatedVisitTransitions('en_route', ['execute']), ['on_site', 'pending', 'no_access', 'cancelled']);
  assert.deepEqual(activatedVisitTransitions('on_site', ['execute']), ['in_progress', 'pending', 'requires_return_visit', 'no_access', 'cancelled']);
  assert.deepEqual(activatedVisitTransitions('in_progress', ['execute']), ['pending', 'requires_return_visit', 'cancelled']);
  assert.deepEqual(activatedVisitTransitions('pending', ['execute']), ['in_progress', 'requires_return_visit', 'cancelled']);
  assert.deepEqual(activatedVisitTransitions('requires_return_visit', ['execute']), ['cancelled']);
  assert.deepEqual(activatedVisitTransitions('ready_for_office_review', ['execute']), []);
  assert.deepEqual(activatedVisitTransitions('no_access', ['execute']), []);
  assert.deepEqual(activatedVisitTransitions('cancelled', ['execute']), []);
});

test('one projector owns activated-transition decoration for Field visit responses', () => {
  const visit = { id: 'visit-1', status: 'en_route', version: 2 };
  assert.deepEqual(projectActivatedVisit(visit, ['read', 'execute']), {
    ...visit,
    availableTransitions: ['on_site', 'pending', 'no_access', 'cancelled'],
  });
  assert.deepEqual(projectActivatedVisit(visit, ['read']), {
    ...visit,
    availableTransitions: [],
  });
});

test('non-executing assignments receive no active transition projection', () => {
  assert.deepEqual(activatedVisitTransitions('scheduled', ['read']), []);
  assert.deepEqual(activatedVisitTransitions('on_site', ['read', 'report.edit']), []);
});

test('unknown visit status fails closed instead of inventing a transition', () => {
  assert.throws(() => activatedVisitTransitions('future_status', ['execute']), /Unknown Work Visit status/);
});
