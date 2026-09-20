'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProgress, progressMeasure, reducedProgress } = require('./phase-progress');
const { transitionRule } = require('./project-lifecycle');
const d = require('./registry-domain');
const phase = (patch = {}) => ({ id: 'PH-TEST', name: 'Synthetic phase', progressMethod: 'units', unitsPlanned: 10,
  checklist: [{ id: 'A', label: 'Required' }, { id: 'B', label: 'Optional', required: false }], ...patch });

test('partial units are cumulative, preserve source input and do not imply closure', () => {
  const value = { completedUnits: 4, checklistIds: ['B', 'A'] }; const before = structuredClone(value);
  assert.deepEqual(normalizeProgress(phase(), value), { completedUnits: 4, checklistIds: ['A', 'B'] });
  assert.deepEqual(progressMeasure(phase(), value), { basis: 'reviewed_units', numerator: 4, denominator: 10, percent: 40 });
  assert.deepEqual(value, before);
});
test('zero and full scope are exact quantities, neither fabricates hours', () => {
  for (const count of [0, 10]) {
    const result = progressMeasure(phase(), { completedUnits: count, checklistIds: [] });
    assert.equal(result.percent, count * 10); assert.equal(result.actualMinutes, undefined); assert.equal(result.status, undefined);
  }
});
test('invalid units and units for an unrelated method cannot be accepted', () => {
  for (const completedUnits of [-1, 0.5, 11, NaN, Infinity, '2', null]) assert.throws(() => normalizeProgress(phase(), { completedUnits, checklistIds: [] }));
  assert.throws(() => normalizeProgress(phase({ progressMethod: 'hours' }), { completedUnits: 2, checklistIds: [] }), { code: 'phase_progress_invalid' });
});
test('no fake percent from missing planned units', () => {
  assert.throws(() => normalizeProgress(phase({ unitsPlanned: 0 }), { completedUnits: 0, checklistIds: [] }), { code: 'phase_progress_invalid' });
});
test('only defined checklist identity is accepted and duplicate items do not inflate progress', () => {
  for (const checklistIds of [['A', 'A'], ['UNKNOWN'], ['A/x'], 'A', null]) {
    assert.throws(() => normalizeProgress(phase(), { completedUnits: 0, checklistIds }));
  }
});
test('optional items do not change the required checklist denominator', () => {
  const scope = phase({ progressMethod: 'checklist' });
  assert.equal(progressMeasure(scope, { completedUnits: null, checklistIds: ['B'] }).percent, 0);
  assert.equal(progressMeasure(scope, { completedUnits: null, checklistIds: ['A'] }).percent, 100);
});
test('an undefined required checklist is not treated as 100 percent', () => {
  assert.throws(() => normalizeProgress(phase({ progressMethod: 'checklist', checklist: [] }), { completedUnits: null, checklistIds: [] }), { code: 'phase_progress_invalid' });
});
test('hours and approval methods do not invent a physical completion percentage', () => {
  for (const progressMethod of ['hours', 'approval']) {
    const result = progressMeasure(phase({ progressMethod }), { completedUnits: null, checklistIds: ['A'] });
    assert.equal(result.percent, null); assert.equal(result.denominator, null);
  }
});
test('a reduction is distinguishable from a cumulative update without re-adding amounts', () => {
  const prior = { completedUnits: 5, checklistIds: ['A'] };
  assert.equal(reducedProgress(prior, { completedUnits: 4, checklistIds: ['A'] }), true);
  assert.equal(reducedProgress(prior, { completedUnits: 5, checklistIds: [] }), true);
  assert.equal(reducedProgress(prior, { completedUnits: 6, checklistIds: ['A', 'B'] }), false);
  assert.equal(reducedProgress(prior, prior), false);
});
test('extra operational fields cannot be posted as progress', () => {
  assert.throws(() => normalizeProgress(phase(), { completedUnits: 4, checklistIds: [], actualLaborHours: 7 }), { code: 'invalid_fields' });
});
test('all supported open lifecycle states remain schedulable independently of budget', () => {
  for (const status of ['Draft', 'Planned', 'Active', 'Near Completion']) assert.equal(d.PROJECT_OPEN_STATES.has(status), true);
  for (const status of ['On Hold', 'Completed', 'Cancelled']) assert.equal(d.PROJECT_OPEN_STATES.has(status), false);
});
test('lifecycle preserves exact no-op and explicit reopen boundaries', () => {
  assert.deepEqual(transitionRule('Active', 'Active'), { noop: true, reopening: false, terminal: false });
  assert.deepEqual(transitionRule('Completed', 'Active'), { noop: false, reopening: true, terminal: false });
  assert.deepEqual(transitionRule('Planned', 'Cancelled'), { noop: false, reopening: false, terminal: true });
});
test('closed projects cannot be silently routed to another terminal or planning state', () => {
  for (const from of ['Completed', 'Cancelled']) for (const to of ['Draft', 'Planned', 'On Hold', 'Near Completion']) {
    assert.throws(() => transitionRule(from, to), { code: 'project_reopen_required' });
  }
});
test('unknown lifecycle labels fail instead of reopening the Project', () => {
  assert.throws(() => transitionRule('Unknown', 'Active'), { code: 'invalid_project_status' });
  assert.throws(() => transitionRule('Planned', 'Done'), { code: 'invalid_project_status' });
});
