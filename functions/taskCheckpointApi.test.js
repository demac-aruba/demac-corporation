const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _taskCheckpointTest } = require('./taskCheckpointApi');

const { checkpointStatus, dependencyBlocked, normalizeRole } = _taskCheckpointTest;

test('checkpoint status remains backward compatible with legacy completed boolean', () => {
  assert.equal(checkpointStatus({ completed: true }), 'completed');
  assert.equal(checkpointStatus({ completed: false }), 'pending');
  assert.equal(checkpointStatus({ completed: false, status: 'waiting' }), 'waiting');
  assert.equal(checkpointStatus({ completed: false, status: 'blocked' }), 'blocked');
});

test('checkpoint authority reuses the governed Task Tracker role model', () => {
  assert.equal(normalizeRole('admin'), 'super_admin');
  assert.equal(normalizeRole('supervisor'), 'operations');
  assert.equal(normalizeRole('office'), 'office_operator');
  assert.equal(normalizeRole('project_manager'), 'project_manager');
  assert.equal(normalizeRole('technician'), null);
});

test('dependency rule blocks completion until prerequisite is complete', () => {
  const checklist = [
    { id: 'a', label: 'Get price', completed: true },
    { id: 'b', label: 'Confirm order', completed: false, dependsOnItemId: 'a' },
    { id: 'c', label: 'Receive uniforms', completed: false, dependsOnItemId: 'b' },
  ];
  assert.equal(dependencyBlocked(checklist[1], checklist), null);
  assert.match(dependencyBlocked(checklist[2], checklist) || '', /Complete prerequisite/i);
});

test('checkpoint updates are append-only and completion requires narrative result', () => {
  const source = fs.readFileSync(path.join(__dirname, 'taskCheckpointApi.js'), 'utf8');
  assert.match(source, /Write a progress update before saving this checkpoint/);
  assert.match(source, /updates = \[\.\.\.\(Array\.isArray\(item\.updates\)/);
  assert.match(source, /slice\(-100\)/);
  assert.match(source, /checkpoint-approval-required/);
  assert.match(source, /checkpoint-dependency/);
  assert.match(source, /status: requestedStatus/);
});

test('operator checkpoint mutations remain version guarded', () => {
  const source = fs.readFileSync(path.join(__dirname, 'taskCheckpointApi.js'), 'utf8');
  assert.match(source, /const expectedVersion = Number\(payload\.expectedVersion\)/);
  assert.match(source, /version-conflict/);
  assert.match(source, /requireTaskExecutor\(actor, task\)/);
});
