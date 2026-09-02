const assert = require('node:assert/strict');
const test = require('node:test');
const {
  activatedWorkInterventionTransitions,
  allowedWorkInterventionTransitions,
  interventionExecutionOptions,
  requiredFieldActionForInterventionTarget,
} = require('./fieldOperationsInterventionTransitions');

test('canonical intervention graph separates confirmation from actual execution', () => {
  assert.deepEqual(allowedWorkInterventionTransitions('confirmed'), ['in_progress', 'not_performed']);
  assert.deepEqual(allowedWorkInterventionTransitions('in_progress'), ['completed', 'pending_part']);
  for (const status of ['planned', 'pending_authorization', 'pending_part', 'not_performed', 'declined', 'cancelled', 'completed']) {
    assert.deepEqual(allowedWorkInterventionTransitions(status), []);
  }
});

test('start uses execute authority while resolution uses intervention.complete', () => {
  assert.equal(requiredFieldActionForInterventionTarget('in_progress'), 'execute');
  assert.equal(requiredFieldActionForInterventionTarget('not_performed'), 'intervention.complete');
  assert.equal(requiredFieldActionForInterventionTarget('completed'), 'intervention.complete');
  assert.equal(requiredFieldActionForInterventionTarget('pending_part'), 'intervention.complete');
  assert.equal(requiredFieldActionForInterventionTarget('declined'), '');
});

test('server projection requires in-progress WorkVisit to start or finish technical execution', () => {
  const both = ['execute', 'intervention.complete'];
  assert.deepEqual(activatedWorkInterventionTransitions({
    status: 'confirmed', visitStatus: 'on_site', allowedActions: both,
  }), ['not_performed']);
  assert.deepEqual(activatedWorkInterventionTransitions({
    status: 'confirmed', visitStatus: 'in_progress', allowedActions: both,
  }), ['in_progress', 'not_performed']);
  assert.deepEqual(activatedWorkInterventionTransitions({
    status: 'in_progress', visitStatus: 'in_progress', allowedActions: both,
  }), ['completed', 'pending_part']);
  assert.deepEqual(activatedWorkInterventionTransitions({
    status: 'in_progress', visitStatus: 'on_site', allowedActions: both,
  }), []);
});

test('helpers/read-only projections cannot acquire execution transitions client-side', () => {
  assert.deepEqual(activatedWorkInterventionTransitions({
    status: 'confirmed', visitStatus: 'in_progress', allowedActions: ['read', 'report.edit'],
  }), []);
  assert.deepEqual(activatedWorkInterventionTransitions({
    status: 'confirmed', visitStatus: 'in_progress', allowedActions: ['execute'],
  }), ['in_progress']);
  assert.deepEqual(activatedWorkInterventionTransitions({
    status: 'confirmed', visitStatus: 'in_progress', allowedActions: ['intervention.complete'],
  }), ['not_performed']);
});

test('job execution options contain only server-authorized interventions and targets', () => {
  assert.deepEqual(interventionExecutionOptions({
    visitStatus: 'in_progress',
    allowedActions: ['execute', 'intervention.complete'],
    interventions: [
      { id: 'WI-1', status: 'confirmed' },
      { id: 'WI-2', status: 'in_progress' },
      { id: 'WI-3', status: 'completed' },
    ],
  }), [
    { interventionId: 'WI-1', allowedTargets: ['in_progress', 'not_performed'] },
    { interventionId: 'WI-2', allowedTargets: ['completed', 'pending_part'] },
  ]);
});