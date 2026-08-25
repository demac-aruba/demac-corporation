const assert = require('node:assert/strict');
const test = require('node:test');
const { activatedVisitTransitions } = require('./fieldOperationsVisitActions');

test('activated transitions are projected from the canonical server graph', () => {
  assert.deepEqual(activatedVisitTransitions('scheduled', ['read', 'execute']), ['en_route']);
  assert.deepEqual(activatedVisitTransitions('en_route', ['execute']), ['on_site']);
  assert.deepEqual(activatedVisitTransitions('on_site', ['execute']), ['in_progress']);
  assert.deepEqual(activatedVisitTransitions('in_progress', ['execute']), []);
});

test('non-executing assignments receive no active transition projection', () => {
  assert.deepEqual(activatedVisitTransitions('scheduled', ['read']), []);
  assert.deepEqual(activatedVisitTransitions('on_site', ['read', 'report.edit']), []);
});

test('unknown visit status fails closed instead of inventing a transition', () => {
  assert.throws(() => activatedVisitTransitions('future_status', ['execute']), /Unknown Work Visit status/);
});
