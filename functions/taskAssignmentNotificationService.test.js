'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assignmentEventId,
  assignmentNotificationMessage,
  assignmentQueueId,
  compactRequirements,
} = require('./taskAssignmentNotificationService');

function task(overrides = {}) {
  return {
    id: 'task-abc',
    taskNumber: 'TSK-ABC123',
    title: 'Delta Blue Report',
    description: 'Prepare the Delta Blue report with the requested photos and final notes.',
    priority: 'important',
    dueAt: '2026-09-12T14:00:00.000Z',
    assigneeNameSnapshot: 'Scarlett',
    ...overrides,
  };
}

test('new task message includes task, priority, Aruba deadline and requirements', () => {
  const text = assignmentNotificationMessage(task(), 'Scarlett');
  assert.match(text, /new DEMAC task/i);
  assert.match(text, /TSK-ABC123/);
  assert.match(text, /Delta Blue Report/);
  assert.match(text, /Priority: Important/);
  assert.match(text, /Aruba time/);
  assert.match(text, /Prepare the Delta Blue report/);
  assert.match(text, /review and acknowledge/i);
});

test('assignment queue and event ids are deterministic for trigger retries', () => {
  assert.equal(assignmentQueueId('task-abc'), assignmentQueueId('task-abc'));
  assert.equal(assignmentEventId('task-abc'), assignmentEventId('task-abc'));
  assert.notEqual(assignmentQueueId('task-abc'), assignmentQueueId('task-other'));
});

test('long requirements are compacted for WhatsApp readability', () => {
  const compacted = compactRequirements('x'.repeat(500), 100);
  assert.equal(compacted.length, 100);
  assert.match(compacted, /…$/);
});

test('creation trigger is gated, canonical-phone based and transactionally deduplicated', () => {
  const source = fs.readFileSync(path.join(__dirname, 'taskAssignmentNotifications.js'), 'utf8');
  assert.match(source, /backendEnabled === true/);
  assert.match(source, /staffProfiles/);
  assert.match(source, /transaction\.get\(queueRef\)/);
  assert.match(source, /transaction\.create\(queueRef/);
  assert.match(source, /reason: 'task_assigned'/);
  assert.match(source, /onDocumentCreated/);
});
